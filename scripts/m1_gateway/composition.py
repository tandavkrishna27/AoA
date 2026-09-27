"""Protected source consumers; external launcher custody is a prerequisite."""

import copy
import hashlib
import json
import math
import os
import posixpath
import re
import select
import signal
import socket
import stat
import struct
import subprocess
import sys
import threading
import time
import uuid
from contextlib import contextmanager

from .dispatch import Dispatcher, _profile
from .journal import Journal
from .protocol import IDENTIFIER, refusal


class CompositionError(ValueError):
    def __init__(self): super().__init__('gateway-composition-refused')


class SuppressResponse(Exception):
    """Local transport control: no wire response, no durable state rewrite."""


def require(value):
    if not value: raise CompositionError()


def keys(value, fields):
    require(type(value) is dict and set(value) == set(fields))


def integer(value, minimum=0, maximum=9007199254740991):
    require(type(value) is int and minimum <= value <= maximum)


def identifier(value):
    require(type(value) is str and IDENTIFIER.fullmatch(value))


def digest(value):
    require(type(value) is str and re.fullmatch('[0-9a-f]{64}', value))


def absolute_path(value, *, root=False):
    require(type(value) is str and value.startswith('/') and not value.startswith('//')
            and '\\' not in value and '\x00' not in value
            and (value != '/' or root) and posixpath.normpath(value) == value
            and (value == '/' or all(x not in ('', '.', '..') for x in value.split('/')[1:])))


def strict_json(raw, maximum, *, object_only=True):
    require(type(raw) is bytes and 0 < len(raw) <= maximum)
    def pairs(items):
        out = {}
        for key, value in items:
            require(key not in out)
            out[key] = value
        return out
    def tree(value, depth=0):
        require(depth <= 32)
        if type(value) is str: value.encode('utf-8', 'strict')
        if type(value) is float: require(math.isfinite(value))
        if type(value) in (dict, list):
            require(len(value) <= 4096)
            for item in (value.values() if type(value) is dict else value): tree(item, depth+1)
    try:
        value = json.loads(raw.decode('utf-8', 'strict'), object_pairs_hook=pairs,
                           parse_constant=lambda _: require(False))
        tree(value)
        require(not object_only or type(value) is dict)
        return value
    except (ValueError, UnicodeError, RecursionError): raise CompositionError() from None


def custody_binding(scope, session=None, operation_id=None):
    require(scope in ('startup', 'operation'))
    if scope == 'startup': require(session is None and operation_id is None)
    else:
        identifier(session)
        identifier(operation_id)
    return dict(scope=scope, session=session, operationId=operation_id)


def with_custody(custody, binding, action):
    output, failed = None, False
    try:
        custody.acquire(binding)
        custody.check()
        output = action()
        custody.check()
    except Exception:
        failed = True
    finally:
        try: custody.release()
        except Exception: failed = True
    if failed: raise SuppressResponse() from None
    return output


def project_containers(rows, enumerated, profile):
    try:
        require(type(rows) is list and 1 <= len(rows) <= 32
                and len(rows) == len(enumerated) and len(set(enumerated)) == len(enumerated))
        grouped, seen = {}, set()
        modes = dict(PidMode='', IpcMode='private', UTSMode='', UsernsMode='', CgroupnsMode='private')
        states = {'running': (True, False, False, False), 'paused': (True, True, False, False),
            'restarting': (True, False, True, False), 'created': (False,)*4,
            'exited': (False,)*4, 'removing': (False,)*4, 'dead': (False, False, False, True)}
        for row in rows:
            require(type(row) is dict)
            cid, image = row['Id'], row['Image']
            digest(cid)
            require(cid not in seen and type(image) is str and re.fullmatch('sha256:[0-9a-f]{64}', image))
            seen.add(cid)
            labels = row['Config']['Labels']
            require(type(labels) is dict and all(type(v) is str for v in labels.values()))
            project = labels['com.docker.compose.project']
            service = labels['com.docker.compose.service']
            session = labels['io.aoa.m1a.session']
            require(project == profile['project'] and session == profile['session'])
            identifier(service)
            host = row['HostConfig']
            require(type(host) is dict and type(host['Privileged']) is bool)
            require(type(row['Mounts']) is list and row['Mounts'] == []
                    and type(host['Devices']) is list and host['Devices'] == []
                    and host['Privileged'] is False)
            for field in ('DeviceRequests', 'DeviceCgroupRules', 'Binds'):
                require(host[field] is None or (type(host[field]) is list and host[field] == []))
            for field, allowed in modes.items():
                require(type(host[field]) is str and host[field] == allowed)
            network = host['NetworkMode']
            require(type(network) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', network)
                    and network not in ('host', 'none', 'default'))
            restart = host['RestartPolicy']
            require(type(restart) is dict and restart['Name'] == 'no'
                    and type(restart['MaximumRetryCount']) is int and restart['MaximumRetryCount'] == 0)
            state = row['State']
            flags = tuple(state[k] for k in ('Running', 'Paused', 'Restarting', 'Dead'))
            require(type(state['Status']) is str and state['Status'] in states
                    and all(type(v) is bool for v in flags) and flags == states[state['Status']])
            container = dict(id=cid, imageConfigId=image, session=session, project=project,
                service=service, mounts=copy.deepcopy(row['Mounts']), devices=copy.deepcopy(host['Devices']),
                privileged=host['Privileged'], hostNamespaces=any(host[k] != v for k, v in modes.items())
                or network == 'host', restartPolicy=restart['Name'])
            grouped.setdefault(service, []).append(container)
        require(seen == set(enumerated) and set(grouped) == {s['name'] for s in profile['services']})
        services = []
        for expected in profile['services']:
            containers = sorted(grouped[expected['name']], key=lambda x: x['id'])
            require([c['id'] for c in containers] == sorted(expected['containers'])
                    and all(c['imageConfigId'] == expected['image']['configId'] for c in containers))
            actual_id = containers[0]['imageConfigId']
            services.append(dict(name=expected['name'], containers=containers,
                image=dict(service=expected['name'], kind='docker-config-id', digest=actual_id,
                           configId=actual_id, relationship=None)))
        return services
    except (KeyError, TypeError, ValueError): raise CompositionError() from None


def pin_schema(pin, directory=False, root=False):
    keys(pin, ('path', 'uid', 'gid', 'mode', 'device', 'inode') if directory else
         ('path', 'uid', 'gid', 'mode', 'device', 'inode', 'size', 'sha256'))
    absolute_path(pin['path'], root=root)
    for key in ('uid', 'gid', 'device', 'inode'): integer(pin[key])
    integer(pin['mode'], 0, 0o7777)
    require(not pin['mode'] & 0o6022)
    if not directory:
        integer(pin['size'], 1, 256*1048576)
        digest(pin['sha256'])


def validate_anchor(anchor):
    try:
        keys(anchor, ('schema', 'installationId', 'generation', 'issuedAt', 'validUntil',
            'accounts', 'manifest', 'code', 'directories', 'ancestors', 'authority',
            'daemon', 'custodyPeer', 'predicates'))
        require(anchor['schema'] == 'm1a-gateway-bootstrap-v1')
        identifier(anchor['installationId']); integer(anchor['generation'], 1)
        integer(anchor['issuedAt']); integer(anchor['validUntil'])
        require(anchor['issuedAt'] < anchor['validUntil'])
        keys(anchor['predicates'], ('importClosureProtected', 'accountGroupExclusion',
            'aclMountCapabilityExclusion', 'writeAliasesExcluded', 'daemonActorsExcluded',
            'generationLifetimeExclusion', 'credentialsSeparated'))
        require(all(v is True for v in anchor['predicates'].values()))
        accounts = anchor['accounts']
        keys(accounts, ('controllerUid', 'controllerGid', 'controllerGroups', 'connectionGid', 'peers'))
        integer(accounts['controllerUid'], 1)
        for k in ('controllerGid', 'connectionGid'): integer(accounts[k])
        def groups(value):
            require(type(value) is list and len(value) <= 128)
            for group in value: integer(group)
            require(value == sorted(set(value)))
        groups(accounts['controllerGroups'])
        require(accounts['connectionGid'] in accounts['controllerGroups'] or
                accounts['connectionGid'] == accounts['controllerGid'])
        require(type(accounts['peers']) is list and 1 <= len(accounts['peers']) <= 32)
        uids, sessions = set(), set()
        for peer in accounts['peers']:
            keys(peer, ('uid', 'primaryGid', 'supplementaryGroups', 'session'))
            integer(peer['uid'], 1); integer(peer['primaryGid']); identifier(peer['session'])
            groups(peer['supplementaryGroups'])
            require(peer['uid'] != accounts['controllerUid'] and peer['uid'] not in uids
                    and peer['session'] not in sessions and
                    (accounts['connectionGid'] == peer['primaryGid'] or
                     accounts['connectionGid'] in peer['supplementaryGroups']))
            require(accounts['controllerGid'] != peer['primaryGid'] and
                    accounts['controllerGid'] not in peer['supplementaryGroups'])
            uids.add(peer['uid']); sessions.add(peer['session'])
        pin_schema(anchor['manifest'])
        keys(anchor['code'], ('python', 'node', 'docker', 'moduleLoader', 'gatewayClosure',
                              'authorityBridge', 'clientClosure'))
        for key, value in anchor['code'].items():
            if key in ('gatewayClosure', 'clientClosure'):
                require(type(value) is list and 1 <= len(value) <= 256)
                for pin in value: pin_schema(pin)
                require(len({pin['path'] for pin in value}) == len(value))
            else: pin_schema(value)
        keys(anchor['directories'], ('privateRoot', 'journalRoot', 'socketParent', 'runtimeCwd'))
        for key, pin in anchor['directories'].items():
            pin_schema(pin, directory=True)
            require(pin['uid'] == accounts['controllerUid'])
            require(pin['mode'] == (0o710 if key == 'socketParent' else 0o700))
            if key == 'socketParent': require(pin['gid'] == accounts['connectionGid'])
        require(type(anchor['ancestors']) is list and 1 <= len(anchor['ancestors']) <= 256)
        ancestors = {}
        for pin in anchor['ancestors']:
            pin_schema(pin, directory=True, root=True)
            require(pin['path'] not in ancestors and pin['uid'] not in uids)
            ancestors[pin['path']] = pin
        require('/' in ancestors)
        for pin in anchor['directories'].values(): require(ancestors.get(pin['path']) == pin)
        authority = anchor['authority']
        keys(authority, ('publicKey', 'fingerprint', 'revocationDirectory', 'revocationName',
            'publisherUid', 'publisherGid', 'maxAgeSeconds', 'minimumRevocationSequence'))
        pin_schema(authority['publicKey']); digest(authority['fingerprint'])
        pin_schema(authority['revocationDirectory'], directory=True)
        require(ancestors.get(authority['revocationDirectory']['path']) == authority['revocationDirectory'])
        identifier(authority['revocationName'])
        integer(authority['publisherUid']); integer(authority['publisherGid'])
        require(authority['publisherUid'] not in uids)
        integer(authority['maxAgeSeconds'], 1, 86400); integer(authority['minimumRevocationSequence'])
        keys(anchor['daemon'], ('endpoint', 'daemonId', 'endpointGeneration'))
        endpoint = anchor['daemon']['endpoint']
        require(type(endpoint) is str and endpoint.startswith('unix://'))
        absolute_path(endpoint[7:]); integer(anchor['daemon']['endpointGeneration'], 1)
        require(type(anchor['daemon']['daemonId']) is str and 1 <= len(anchor['daemon']['daemonId']) <= 128)
        keys(anchor['custodyPeer'], ('uid', 'gid', 'installationDigest', 'enforcementDigest'))
        integer(anchor['custodyPeer']['uid']); integer(anchor['custodyPeer']['gid'])
        require(anchor['custodyPeer']['uid'] not in uids)
        for k in ('installationDigest', 'enforcementDigest'): digest(anchor['custodyPeer'][k])
        require(anchor['manifest']['uid'] == accounts['controllerUid'] and anchor['manifest']['mode'] == 0o600)
        for value in anchor['code'].values():
            for pin in (value if type(value) is list else [value]): require(pin['uid'] not in uids)
        require(authority['publicKey']['uid'] not in uids and authority['publicKey']['mode'] == 0o600)
        return copy.deepcopy(anchor)
    except (KeyError, TypeError, ValueError): raise CompositionError() from None


def validate_manifest(value, anchor):
    try:
        keys(value, ('schema', 'installationId', 'generation', 'controllerSha', 'sessions', 'socketName', 'limits'))
        integer(value['generation'], 1)
        require(value['schema'] == 'm1a-gateway-startup-v1' and
                value['installationId'] == anchor['installationId'] and value['generation'] == anchor['generation'])
        require(type(value['controllerSha']) is str and re.fullmatch('[0-9a-f]{40}', value['controllerSha']))
        identifier(value['socketName'])
        ceilings = dict(authorityTimeoutMs=10000, inspectionTimeoutMs=30000,
            clientWaitMs=2147483647, maxConnections=1, maxInspectionBytes=1048576, custodyTimeoutMs=5000)
        keys(value['limits'], ceilings)
        for key, maximum in ceilings.items(): integer(value['limits'][key], 1, maximum)
        require(type(value['sessions']) is list and len(value['sessions']) == len(anchor['accounts']['peers']))
        expected = {p['uid']: p['session'] for p in anchor['accounts']['peers']}
        seen = set()
        for session in value['sessions']:
            keys(session, ('session', 'peerUid', 'profile', 'policy', 'signature', 'compose'))
            integer(session['peerUid'], 1); identifier(session['session'])
            require(expected.get(session['peerUid']) == session['session'] and session['peerUid'] not in seen)
            seen.add(session['peerUid'])
            for key in ('profile', 'policy', 'signature', 'compose'):
                pin = session[key]; pin_schema(pin)
                require(pin['uid'] == anchor['accounts']['controllerUid'] and pin['mode'] == 0o600
                        and posixpath.commonpath([pin['path'], anchor['directories']['privateRoot']['path']])
                        == anchor['directories']['privateRoot']['path'])
        return copy.deepcopy(value)
    except (KeyError, TypeError, ValueError): raise CompositionError() from None


class ProtectedFiles:
    def __init__(self, ancestors):
        self.ancestors = {p['path']: copy.deepcopy(p) for p in ancestors}
        require(len(self.ancestors) == len(ancestors) and '/' in self.ancestors)

    @staticmethod
    def matches(info, pin, directory=False):
        require((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
                and info.st_uid == pin['uid'] and info.st_gid == pin['gid']
                and stat.S_IMODE(info.st_mode) == pin['mode']
                and (info.st_dev, info.st_ino) == (pin['device'], pin['inode'])
                and not info.st_mode & 0o6022)
        if not directory: require(info.st_nlink == 1 and info.st_size == pin['size'])

    @contextmanager
    def directory(self, path):
        absolute_path(path, root=True)
        handles, checks = [], []
        try:
            fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            handles.append(fd); self.matches(os.fstat(fd), self.ancestors['/'], True)
            current = ''
            for part in ([] if path == '/' else path.split('/')[1:]):
                parent = fd; current += '/' + part
                fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
                handles.append(fd); self.matches(os.fstat(fd), self.ancestors[current], True)
                checks.append((parent, part, current, fd))
            yield fd
            for parent, part, current, fd in checks:
                self.matches(os.fstat(fd), self.ancestors[current], True)
                self.matches(os.stat(part, dir_fd=parent, follow_symlinks=False), self.ancestors[current], True)
        except (OSError, KeyError, ValueError): raise CompositionError() from None
        finally:
            for fd in reversed(handles): os.close(fd)

    def read(self, pin, maximum):
        return self._read(pin, maximum, capture=True)

    def verify(self, pin):
        self._read(pin, 256*1048576, capture=False)

    def _read(self, pin, maximum, *, capture):
        pin_schema(pin); require(pin['size'] <= maximum)
        try:
            with self.directory(posixpath.dirname(pin['path'])) as parent:
                fd = os.open(posixpath.basename(pin['path']), os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
                try:
                    self.matches(os.fstat(fd), pin)
                    data, hashed, size = bytearray(), hashlib.sha256(), 0
                    while size <= maximum:
                        chunk = os.read(fd, min(65536, maximum + 1 - size))
                        if not chunk: break
                        size += len(chunk); hashed.update(chunk)
                        if capture: data.extend(chunk)
                    self.matches(os.fstat(fd), pin)
                    self.matches(os.stat(posixpath.basename(pin['path']), dir_fd=parent, follow_symlinks=False), pin)
                    require(size == pin['size'] and hashed.hexdigest() == pin['sha256'])
                    return bytes(data)
                finally: os.close(fd)
        except OSError: raise CompositionError() from None

    def revocation(self, authority):
        path = posixpath.join(authority['revocationDirectory']['path'], authority['revocationName'])
        with self.directory(authority['revocationDirectory']['path']) as parent:
            fd = os.open(authority['revocationName'], os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
            try:
                info = os.fstat(fd)
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600
                        and info.st_uid == authority['publisherUid'] and info.st_gid == authority['publisherGid']
                        and 0 < info.st_size <= 65536)
                raw = bytearray()
                while len(raw) <= 65536:
                    part = os.read(fd, 65537-len(raw))
                    if not part: break
                    raw.extend(part)
                pin = dict(path=path, uid=info.st_uid, gid=info.st_gid, mode=0o600,
                    device=info.st_dev, inode=info.st_ino, size=info.st_size, sha256=hashlib.sha256(raw).hexdigest())
                self.matches(os.fstat(fd), pin)
                self.matches(os.stat(authority['revocationName'], dir_fd=parent, follow_symlinks=False), pin)
                require(len(raw) == info.st_size)
                return bytes(raw)
            finally: os.close(fd)


def run_private(argv, *, cwd, stdin, timeout_ms, maximum, continuity=None, before_spawn=None):
    require(type(argv) is list and argv and all(type(a) is str and '\x00' not in a for a in argv))
    integer(timeout_ms, 1, 2147483647); integer(maximum, 1, 2097152)
    require(type(stdin) is bytes and len(stdin) <= 2097152)
    if continuity: continuity()
    child, workers = None, []
    try:
        if before_spawn: before_spawn()
        child = subprocess.Popen(argv, cwd=cwd, env={}, shell=False, close_fds=True,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            bufsize=0, start_new_session=sys.platform == 'linux')
        streams, failure, total = [bytearray(), bytearray()], threading.Event(), [0]
        mutex = threading.Lock()
        def drain(index, pipe):
            try:
                while True:
                    data = pipe.read(4096)
                    if not data: break
                    with mutex:
                        total[0] += len(data)
                        if total[0] > maximum: failure.set(); break
                        streams[index].extend(data)
            except Exception: failure.set()
            finally: pipe.close()
        def write():
            try:
                view = memoryview(stdin)
                while view:
                    written = child.stdin.write(view)
                    require(type(written) is int and written > 0)
                    view = view[written:]
                child.stdin.close()
            except BrokenPipeError: pass
            except Exception: failure.set()
        workers = [threading.Thread(target=drain, args=(0, child.stdout), daemon=True),
            threading.Thread(target=drain, args=(1, child.stderr), daemon=True),
            threading.Thread(target=write, daemon=True)]
        for worker in workers: worker.start()
        expires = time.monotonic() + timeout_ms / 1000
        while child.poll() is None or any(worker.is_alive() for worker in workers):
            if continuity: continuity()
            require(not failure.is_set() and time.monotonic() < expires)
            time.sleep(0.005)
        if continuity: continuity()
        require(not failure.is_set() and type(child.returncode) is int and 0 <= child.returncode <= 255)
        return dict(exitCode=child.returncode, stdout=bytes(streams[0]), stderr=bytes(streams[1]))
    except Exception: raise CompositionError() from None
    finally:
        if child is not None:
            if sys.platform == 'linux' and (child.poll() is None or any(w.is_alive() for w in workers)):
                try: os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError: pass
            elif child.poll() is None: child.kill()
            child.wait()
            for pipe in (child.stdin, child.stdout, child.stderr):
                if pipe and not pipe.closed: pipe.close()


class Custody:
    def __init__(self, conn, anchor, timeout_ms):
        require(sys.platform == 'linux' and conn.family == socket.AF_UNIX and conn.type == socket.SOCK_SEQPACKET)
        self.conn, self.anchor, self.timeout_ms = conn, anchor, timeout_ms
        self.binding, self.lease, self.attempted = None, None, False
        self.poisoned = False
        self.peer()

    def peer(self):
        pid, uid, gid = struct.unpack('3i', self.conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        require(pid > 0 and (uid, gid) == (self.anchor['custodyPeer']['uid'], self.anchor['custodyPeer']['gid']))

    def exchange(self, request):
        try:
            self.peer(); raw = json.dumps(request, separators=(',', ':')).encode('ascii'); require(len(raw) <= 4096)
            self.conn.settimeout(self.timeout_ms/1000)
            require(self.conn.send(raw) == len(raw))
            raw, _, flags, _ = self.conn.recvmsg(4097)
            require(not flags and len(raw) <= 4096)
            return strict_json(raw, 4096)
        except Exception:
            self.poisoned = True
            raise CompositionError() from None

    def common(self, action):
        return dict(schema='m1a-custody-request-v1', action=action, nonce=uuid.uuid4().hex,
            installationId=self.anchor['installationId'], generation=self.anchor['generation'], **self.binding)

    def acquire(self, binding):
        require(self.binding is None and not self.poisoned)
        self.binding, self.attempted = binding, False
        try: self._acquire(binding)
        except Exception:
            self.poisoned = True
            raise CompositionError() from None

    def _acquire(self, binding):
        req = self.common('acquire'); response = self.exchange(req)
        keys(response, ('schema', 'nonce', 'leaseId', 'installationId', 'generation', 'endpointGeneration',
            'daemonId', 'installationDigest', 'enforcementDigest', 'holderUid', 'predicates', *binding))
        require(response['schema'] == 'm1a-custody-lease-v1' and response['nonce'] == req['nonce'])
        identifier(response['leaseId'])
        integer(response['generation'], 1); integer(response['endpointGeneration'], 1)
        for key in ('installationId', 'generation'): require(response[key] == self.anchor[key])
        for key in ('endpointGeneration', 'daemonId'): require(response[key] == self.anchor['daemon'][key])
        for key in ('installationDigest', 'enforcementDigest'): require(response[key] == self.anchor['custodyPeer'][key])
        require(type(response['holderUid']) is int and response['holderUid'] == self.anchor['accounts']['controllerUid'])
        require(all(response[k] == v for k, v in binding.items()))
        keys(response['predicates'], ('installationProtected', 'endpointStable', 'actorsExcluded', 'lifetimeHeld'))
        require(all(v is True for v in response['predicates'].values()))
        self.lease = response['leaseId']; self.check()

    def check(self):
        try:
            require(self.lease is not None and not self.attempted and not self.poisoned)
            self.peer()
            poll = select.poll(); poll.register(self.conn, select.POLLIN | select.POLLHUP | select.POLLERR)
            require(not poll.poll(0))
        except Exception:
            self.poisoned = True
            raise CompositionError() from None

    def release(self):
        require(self.binding is not None and not self.attempted)
        self.attempted = True
        try:
            req = self.common('release') | dict(leaseId=self.lease)
            response = self.exchange(req)
            keys(response, ('schema', 'nonce', 'leaseId', 'released', *self.binding))
            require(response['schema'] == 'm1a-custody-release-v1' and response['nonce'] == req['nonce']
                    and response['leaseId'] == self.lease and response['released'] is True
                    and all(response[k] == v for k, v in self.binding.items()))
        except Exception:
            self.poisoned = True
            raise CompositionError() from None
        finally:
            self.binding, self.lease = None, None


def load_launch_anchor():
    require(sys.platform == 'linux' and hasattr(socket, 'SO_PEERCRED')
            and hasattr(socket, 'SOCK_SEQPACKET') and os.open in os.supports_dir_fd
            and hasattr(os, 'getresuid') and hasattr(os, 'getresgid')
            and hasattr(os, 'O_NOFOLLOW') and hasattr(select, 'poll'))
    require(sys.flags.isolated and sys.flags.no_site and set(os.environ) <= {'LC_CTYPE'})
    try:
        info = os.fstat(3)
        require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= 262144)
        os.set_inheritable(3, False); os.set_inheritable(4, False)
        raw = os.pread(3, info.st_size + 1, 0)
        after = os.fstat(3)
        require((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns))
        anchor = validate_anchor(strict_json(raw, 262144))
        account = anchor['accounts']
        require(os.getresuid() == (account['controllerUid'],)*3
                and os.getresgid() == (account['controllerGid'],)*3
                and sorted(os.getgroups()) == account['controllerGroups'])
        now = int(time.time()); require(anchor['issuedAt'] <= now < anchor['validUntil'])
        for entry in os.listdir('/proc/self/fd'):
            if int(entry) > 4:
                try: os.fstat(int(entry))
                except OSError: continue
                raise CompositionError()
        return anchor
    except (OSError, ValueError): raise CompositionError() from None


class SessionRuntime:
    """Concrete fixed subprocess dependencies; no callback executor injection."""
    def __init__(self, anchor, manifest, session, files, custody, journal):
        self.anchor, self.manifest, self.session = anchor, manifest, session
        self.files, self.custody = files, custody
        self.profile = strict_json(files.read(session['profile'], 262144), 262144)
        _profile(self.profile)
        p = self.profile
        require(p['provider'] is None and p['payloads'] == [] and p['validatedRelationships'] == []
                and all(s['image']['kind'] == 'docker-config-id' for s in p['services'])
                and p['candidateUid'] == session['peerUid'] and p['session'] == session['session']
                and p['controllerSha'] == manifest['controllerSha']
                and p['authorityFingerprint'] == anchor['authority']['fingerprint']
                and p['dockerBinary'] == anchor['code']['docker']['path']
                and p['endpoint'] == anchor['daemon']['endpoint']
                and p['composePath'] == session['compose']['path']
                and p['composeSha256'] == session['compose']['sha256'])
        self.sequence, self.revocation_hash = anchor['authority']['minimumRevocationSequence'], None
        self.admission = None
        self.dispatcher = Dispatcher(p, self.authority, self.inspect, self.runner, journal)

    def continuity(self):
        self.custody.check()
        now = int(time.time())
        require(self.anchor['issuedAt'] <= now < self.anchor['validUntil'])

    def code_check(self, key):
        self.continuity()
        self.files.verify(self.anchor['code'][key])
        for group in ('gatewayClosure', 'clientClosure'):
            for pin in self.anchor['code'][group]: self.files.verify(pin)

    def child(self, argv, key, stdin, timeout, maximum):
        self.code_check(key)
        with self.files.directory(self.anchor['directories']['runtimeCwd']['path']):
            logs = key == 'docker' and argv[3:4] == ['logs']
            if logs:
                self.fresh_admission()
            return run_private(argv, cwd=self.anchor['directories']['runtimeCwd']['path'],
                stdin=stdin, timeout_ms=timeout, maximum=maximum, continuity=self.continuity,
                before_spawn=self.fresh_admission if logs else None)

    def authority(self, *, now, cleanup):
        self.admission = None
        require(cleanup is False)
        self.continuity()
        authority = self.anchor['authority']
        raw = self.files.revocation(authority); revoked = strict_json(raw, 65536)
        keys(revoked, ('schema', 'installationId', 'generation', 'sequence', 'available', 'checkedAt', 'validUntil', 'revoked'))
        require(revoked['schema'] == 'm1a-gateway-revocation-v1' and revoked['available'] is True
                and revoked['installationId'] == self.anchor['installationId']
                and revoked['generation'] == self.anchor['generation'])
        for k in ('sequence', 'checkedAt', 'validUntil'): integer(revoked[k])
        require(revoked['sequence'] >= self.sequence and revoked['checkedAt'] <= now < revoked['validUntil']
                and now - revoked['checkedAt'] <= authority['maxAgeSeconds'])
        require(type(revoked['revoked']) is list and len(revoked['revoked']) <= 512)
        for item in revoked['revoked']: digest(item)
        require(len(set(revoked['revoked'])) == len(revoked['revoked']))
        hashed = hashlib.sha256(raw).hexdigest()
        require(revoked['sequence'] != self.sequence or self.revocation_hash in (None, hashed))
        self.sequence, self.revocation_hash = revoked['sequence'], hashed
        p = self.profile
        expected = {key: p[key] for key in ('controllerSha', 'candidate', 'session', 'profileSha256', 'authorityFingerprint')}
        expected.update(images=[s['image'] for s in p['services']], provider=None,
                        fullProfile=p, validatedRelationships=[])
        import base64
        self.files.verify(self.anchor['code']['authorityBridge'])
        request = dict(schema='m1a-gateway-bridge-v1', cleanup=False, now=now,
            policyBase64=base64.b64encode(self.files.read(self.session['policy'], 1048576)).decode('ascii'),
            signatureBase64=base64.b64encode(self.files.read(self.session['signature'], 64)).decode('ascii'),
            publicKeyPem=self.files.read(authority['publicKey'], 16384).decode('utf-8', 'strict'),
            expected=expected, revocation={k: revoked[k] for k in ('available', 'checkedAt', 'validUntil', 'revoked')})
        output = self.child([self.anchor['code']['node']['path'], self.anchor['code']['authorityBridge']['path']],
            'node', json.dumps(request, ensure_ascii=False, separators=(',', ':')).encode('utf-8'),
            self.manifest['limits']['authorityTimeoutMs'], 1114112)
        require(output['exitCode'] == 0 and output['stderr'] == b'')
        self.continuity()
        verdict = strict_json(output['stdout'], 1114112)
        self.admission = (now, revoked, verdict['policy'])
        try: self.fresh_admission()
        except Exception:
            self.admission = None
            raise
        return verdict

    def fresh_admission(self):
        require(self.admission is not None)
        admitted_at, revoked, policy = self.admission
        current = Dispatcher._clock()
        require(current >= admitted_at and revoked['checkedAt'] <= current < revoked['validUntil']
                and current - revoked['checkedAt'] <= self.anchor['authority']['maxAgeSeconds']
                and policy['notBefore'] <= current < policy['expiresAt'])
        self.admission = (current, revoked, policy)

    def docker(self, args, *, maximum=None, timeout=None):
        p, limits = self.profile, self.manifest['limits']
        return self.child([p['dockerBinary'], '--host', p['endpoint'], *args], 'docker', b'',
                          timeout or limits['inspectionTimeoutMs'], maximum or limits['maxInspectionBytes'])

    def inspect(self, profile):
        require(profile == self.profile)
        info = self.docker(['info', '--format', '{{json .}}'])
        require(info['exitCode'] == 0 and info['stderr'] == b'')
        observed = strict_json(info['stdout'], self.manifest['limits']['maxInspectionBytes'])
        require(type(observed.get('ID')) is str and observed['ID'] == self.anchor['daemon']['daemonId'])
        ps = self.docker(['ps', '--all', '--no-trunc', '--filter',
                         'label=com.docker.compose.project=' + profile['project'], '--format', '{{.ID}}'])
        require(ps['exitCode'] == 0 and ps['stderr'] == b'')
        text = ps['stdout'].decode('ascii', 'strict')
        lines = (text[:-1] if text.endswith('\n') else text).split('\n')
        require(1 <= len(lines) <= 32 and len(set(lines)) == len(lines))
        for cid in lines: digest(cid)
        ids = sorted(lines)
        inspect = self.docker(['inspect', '--type', 'container', *ids])
        require(inspect['exitCode'] == 0 and inspect['stderr'] == b'')
        rows = strict_json(inspect['stdout'], self.manifest['limits']['maxInspectionBytes'], object_only=False)
        services = project_containers(rows, ids, profile)
        compose = self.files.read(self.session['compose'], 1048576)
        actual_hash = hashlib.sha256(compose).hexdigest()
        require(actual_hash == profile['composeSha256'])
        self.continuity()
        return dict(endpoint=profile['endpoint'], composeSha256=actual_hash, services=services)

    def runner(self, invocation):
        require(invocation['env'] == {} and invocation['stdin'] == b''
                and invocation['timeoutMs'] == self.profile['timeoutMs'])
        argv = invocation['argv']; ids = {cid for s in self.profile['services'] for cid in s['containers']}
        require(len(argv) == 5 and argv[:4] == [self.profile['dockerBinary'], '--host', self.profile['endpoint'], 'logs']
                and argv[4] in ids)
        integer(invocation['maxOutputBytes'], 1, 65536)
        output = self.docker(['logs', argv[4]], maximum=invocation['maxOutputBytes'], timeout=invocation['timeoutMs'])
        self.continuity()
        return output

    def execute(self, uid, request):
        if request['operation'] != 'logs': return refusal('handler-error')
        return with_custody(self.custody, custody_binding('operation', request['session'], request['operationId']),
                            lambda: self.dispatcher.execute(uid, request))


class GatewayRuntime:
    def __init__(self, anchor, manifest, files, custody, sessions):
        self.anchor, self.manifest, self.files, self.custody, self.sessions = anchor, manifest, files, custody, sessions
        self.stopping = threading.Event()

    def close(self):
        self.stopping.set()

    def serve(self):
        from .server import serve_accepted_connection
        parent_pin = self.anchor['directories']['socketParent']
        name = self.manifest['socketName']; path = posixpath.join(parent_pin['path'], name)
        with self.files.directory(parent_pin['path']) as parent:
            try: os.stat(name, dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError: pass
            else: raise CompositionError()
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            identity = None
            try:
                old_umask = os.umask(0o117)
                try: listener.bind(path)
                finally: os.umask(old_umask)
                os.chown(name, self.anchor['accounts']['controllerUid'], self.anchor['accounts']['connectionGid'],
                         dir_fd=parent, follow_symlinks=False)
                info = os.stat(name, dir_fd=parent, follow_symlinks=False)
                require(stat.S_ISSOCK(info.st_mode) and info.st_uid == self.anchor['accounts']['controllerUid']
                        and info.st_gid == self.anchor['accounts']['connectionGid'] and stat.S_IMODE(info.st_mode) == 0o660)
                identity = (info.st_dev, info.st_ino)
                listener.listen(1)
                listener.settimeout(0.25)
                while not self.stopping.is_set():
                    self.files.matches(os.fstat(parent), parent_pin, True)
                    try: conn, _ = listener.accept()
                    except TimeoutError: continue
                    with conn:
                        serve_accepted_connection(conn, lambda uid: self.sessions[uid].profile['session']
                            if uid in self.sessions else None, lambda uid, req: self.sessions[uid].execute(uid, req))
            finally:
                listener.close()
                if identity is not None:
                    try:
                        info = os.stat(name, dir_fd=parent, follow_symlinks=False)
                        if (info.st_dev, info.st_ino) == identity: os.unlink(name, dir_fd=parent)
                    except FileNotFoundError: pass


def compose_gateway(config_path):
    absolute_path(config_path)
    anchor = load_launch_anchor()
    require(config_path == anchor['manifest']['path'])
    files = ProtectedFiles(anchor['ancestors'])
    channel = socket.socket(fileno=os.dup(4))
    custody = Custody(channel, anchor, 5000)
    def startup():
        manifest = validate_manifest(strict_json(files.read(anchor['manifest'], 262144), 262144), anchor)
        custody.timeout_ms = manifest['limits']['custodyTimeoutMs']
        for key, value in anchor['code'].items():
            for pin in (value if type(value) is list else [value]): files.verify(pin)
        for pin in anchor['directories'].values():
            with files.directory(pin['path']): pass
        journal = Journal(anchor['directories']['journalRoot']['path'])
        sessions = {}
        for session in manifest['sessions']:
            runtime = SessionRuntime(anchor, manifest, session, files, custody, journal)
            now = int(time.time())
            runtime.dispatcher._authority(now, False)
            runtime.dispatcher._observation(runtime.inspect(copy.deepcopy(runtime.profile)))
            sessions[session['peerUid']] = runtime
        return GatewayRuntime(anchor, manifest, files, custody, sessions)
    try: return with_custody(custody, custody_binding('startup'), startup)
    except Exception:
        channel.close()
        raise CompositionError() from None
