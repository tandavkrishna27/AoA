"""Closed dispatch algorithm, with no host execution or production factory.

Task4 must supply concrete protected dependencies. Injected dependencies prove
algorithm behavior, not host custody.
The profile schema below is explicit source for parent review, not activation.
"""

import base64
import copy
import hashlib
import json
import posixpath
import re
import time
import math

from .protocol import (decode_request, encode, MAX_REQUEST_BYTES, refusal, IDENTIFIER,
                       MAX_PRIVATE_STREAM_BYTES)

PROFILE_FIELDS = frozenset(('schema', 'classification', 'controllerSha', 'candidate',
    'session', 'authorityFingerprint', 'profileSha256', 'candidateUid', 'dockerBinary',
    'endpoint', 'composePath', 'composeSha256', 'project', 'timeoutMs', 'cleanupExpiresAt',
    'provider', 'services', 'payloads', 'validatedRelationships'))
SERVICE_FIELDS = frozenset(('name', 'dependencies', 'image', 'containers', 'mounts',
    'devices', 'privileged', 'hostNamespaces', 'restartPolicy'))
CONTAINER_FIELDS = frozenset(('id', 'imageConfigId', 'session', 'project', 'service',
    'mounts', 'devices', 'privileged', 'hostNamespaces', 'restartPolicy'))
IDENTITIES = ('controllerSha', 'candidate', 'session', 'profileSha256', 'authorityFingerprint')
CLEANUP = frozenset(('stop', 'remove'))
EXISTING = frozenset(('start', 'restart', 'unpause', 'kill', 'exec', 'logs'))
MAX_PRIVATE_LOG_BYTES = 786432  # Base64 remains below the existing response frame cap.
HEX = re.compile(r'[0-9a-f]{64}', re.ASCII)
DIGEST = re.compile(r'sha256:[0-9a-f]{64}', re.ASCII)


class DispatchError(ValueError):
    def __init__(self):
        super().__init__('gateway-dispatch-refused')


def _require(condition):
    if not condition:
        raise DispatchError()


def _canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, allow_nan=False,
                      separators=(',', ':')).encode('ascii')


def profile_hash(profile):
    """Hash all explicit protected profile fields except the hash itself."""
    return hashlib.sha256(_canonical({k: v for k, v in profile.items()
                                     if k != 'profileSha256'})).hexdigest()


def _keys(value, fields):
    _require(type(value) is dict and set(value) == set(fields))


def _identifier(value):
    return type(value) is str and IDENTIFIER.fullmatch(value) is not None


def _hash(value):
    return type(value) is str and HEX.fullmatch(value) is not None


def _path(value):
    return (type(value) is str and value.startswith('/') and not value.startswith('//')
            and value != '/' and posixpath.normpath(value) == value
            and '\x00' not in value and '\\' not in value)


def _safe_runtime(value):
    _require(value['mounts'] == [] and value['devices'] == []
             and value['privileged'] is False and value['hostNamespaces'] is False
             and value['restartPolicy'] == 'no')


def _image(value, relationships):
    _keys(value, ('service', 'kind', 'digest', 'configId', 'relationship'))
    _require(_identifier(value['service']) and type(value['digest']) is str
             and DIGEST.fullmatch(value['digest']) and type(value['configId']) is str
             and DIGEST.fullmatch(value['configId']))
    if value['kind'] == 'docker-config-id':
        _require(value['digest'] == value['configId'] and value['relationship'] is None)
    else:
        _require(value['kind'] == 'oci-manifest')
        _keys(value['relationship'], ('manifestDigest', 'configId'))
        _require(value['relationship'] == dict(manifestDigest=value['digest'], configId=value['configId'])
                 and value['relationship'] in relationships)


def _profile(value):
    _keys(value, PROFILE_FIELDS)
    _require(value['schema'] == 'm1a-gateway-profile-v1' and value['classification'] == 'PRODUCTION')
    for key in ('controllerSha', 'candidate'):
        _require(type(value[key]) is str and re.fullmatch('[0-9a-f]{40}', value[key]))
    for key in ('authorityFingerprint', 'composeSha256', 'profileSha256'):
        _require(_hash(value[key]))
    _require(value['profileSha256'] == profile_hash(value))
    _require(_identifier(value['session']) and _identifier(value['project']))
    _require(type(value['candidateUid']) is int and value['candidateUid'] >= 0)
    _require(_path(value['dockerBinary']) and _path(value['composePath']))
    _require(type(value['endpoint']) is str and value['endpoint'].startswith('unix://')
             and _path(value['endpoint'][7:]))
    _require(type(value['timeoutMs']) is int and 1 <= value['timeoutMs'] <= 2147483647)
    _require(type(value['cleanupExpiresAt']) is int and 0 <= value['cleanupExpiresAt'] <= 9007199254740991)
    _require(value['provider'] is None and type(value['validatedRelationships']) is list)
    _require(type(value['services']) is list and 1 <= len(value['services']) <= 32)
    names, containers = set(), set()
    for service in value['services']:
        _keys(service, SERVICE_FIELDS)
        name = service['name']
        _require(_identifier(name) and name != 'adapter-manager' and name not in names)
        names.add(name)
        _require(type(service['dependencies']) is list and len(service['dependencies']) <= 32
                 and all(_identifier(dep) for dep in service['dependencies'])
                 and len(set(service['dependencies'])) == len(service['dependencies']))
        _image(service['image'], value['validatedRelationships'])
        _require(service['image']['service'] == name)
        _require(type(service['containers']) is list and 1 <= len(service['containers']) <= 32)
        for cid in service['containers']:
            _require(_hash(cid) and cid not in containers)
            containers.add(cid)
        _safe_runtime(service)
    _require(len(containers) <= 32)
    for service in value['services']:
        _require(set(service['dependencies']) <= names and service['name'] not in service['dependencies'])
    # Cycles obscure closure and are not an admitted startup contract.
    by_name = {s['name']: s for s in value['services']}
    visited = set()
    def visit(name, ancestors):
        _require(name not in ancestors)
        if name in visited:
            return
        for dep in by_name[name]['dependencies']:
            visit(dep, ancestors | {name})
        visited.add(name)
    for name in names:
        visit(name, set())
    _require(type(value['payloads']) is list and len(value['payloads']) <= 32)
    payload_ids = set()
    for payload in value['payloads']:
        _keys(payload, ('id', 'service', 'argv', 'maxStdinBytes'))
        _require(_identifier(payload['id']) and payload['id'] not in payload_ids and payload['service'] in names)
        payload_ids.add(payload['id'])
        _require(type(payload['argv']) is list and 1 <= len(payload['argv']) <= 32
                 and _path(payload['argv'][0]) and all(type(arg) is str and len(arg) <= 4096
                 and '\x00' not in arg for arg in payload['argv']))
        _require(type(payload['maxStdinBytes']) is int and 0 <= payload['maxStdinBytes'] <= 32768)


class Dispatcher:
    def __init__(self, profile, authority_check, inspector, runner, journal):
        try:
            self.profile = copy.deepcopy(profile)
            _profile(self.profile)
            _require(all(callable(dep) for dep in (authority_check, inspector, runner)))
            _require(all(callable(getattr(journal, method, None))
                         for method in ('session_lock', 'session_records', 'accept', 'transition')))
            self.authority_check, self.inspector, self.runner, self.journal = authority_check, inspector, runner, journal
        except Exception:
            raise DispatchError() from None

    def _observation(self, observation):
        p = self.profile
        _keys(observation, ('endpoint', 'composeSha256', 'services'))
        _require(observation['endpoint'] == p['endpoint'] and observation['composeSha256'] == p['composeSha256'])
        services = observation['services']
        _require(type(services) is list and len(services) == len(p['services']))
        for expected, actual in zip(p['services'], services):
            _keys(actual, ('name', 'image', 'containers'))
            _require(actual['name'] == expected['name'] and actual['image'] == expected['image'])
            _require(type(actual['containers']) is list and len(actual['containers']) == len(expected['containers']))
            observed = []
            for container in actual['containers']:
                _keys(container, CONTAINER_FIELDS)
                _require(container['imageConfigId'] == expected['image']['configId']
                         and container['session'] == p['session'] and container['project'] == p['project']
                         and container['service'] == expected['name'])
                _safe_runtime(container)
                observed.append(container['id'])
            _require(sorted(observed) == sorted(expected['containers']))

    def _authority(self, now, cleanup):
        p = self.profile
        _require(type(now) is int and 0 <= now <= 9007199254740991)
        verdict = self.authority_check(now=now, cleanup=cleanup)
        _keys(verdict, ('policy', 'policySha256', 'signatureSha256', 'verifiedAt',
                        'revocationCheckedAt', 'revocationValidUntil'))
        _require(_hash(verdict['policySha256']) and _hash(verdict['signatureSha256']))
        policy = verdict['policy']
        _keys(policy, ('schema', 'classification', *IDENTITIES, 'notBefore', 'expiresAt', 'images', 'provider'))
        _require(policy['schema'] == 'm1a-gateway-policy-v1' and policy['classification'] == 'PRODUCTION'
                 and all(policy[key] == p[key] for key in IDENTITIES)
                 and policy['images'] == [s['image'] for s in p['services']] and policy['provider'] is None)
        _require(type(policy['notBefore']) is int and type(policy['expiresAt']) is int
                 and 0 <= policy['notBefore'] < policy['expiresAt'] <= 9007199254740991
                 and now >= policy['notBefore'])
        # A verifier/revocation read may itself block. Reject a verdict that has
        # already expired by the time it returns.
        current = self._clock()
        _require(current >= now and current >= policy['notBefore'])
        _require(type(verdict['verifiedAt']) is int and verdict['verifiedAt'] == now
                 and type(verdict['revocationCheckedAt']) is int
                 and type(verdict['revocationValidUntil']) is int
                 and 0 <= verdict['revocationCheckedAt'] <= now
                 and current < verdict['revocationValidUntil'] <= 9007199254740991)
        _require(current < (p['cleanupExpiresAt'] if cleanup else policy['expiresAt']))
        return current

    @staticmethod
    def _clock():
        clock = time.time()
        _require(type(clock) in (int, float) and math.isfinite(clock) and 0 <= clock <= 9007199254740991)
        return int(clock)

    def _invocation(self, request, owned):
        p = self.profile
        op, args = request['operation'], request['arguments']
        # Creation, disposable run and rollout need separate reviewed resource/config
        # transition contracts; refuse until Tasks4/5 integrate those contracts.
        _require(op in EXISTING | CLEANUP)
        services = {s['name']: s for s in p['services']}
        selected = request['services']
        _require(set(selected) <= set(services))
        closure = set(selected)
        pending = list(selected)
        while pending:
            for dep in services[pending.pop()]['dependencies']:
                if dep not in closure:
                    closure.add(dep)
                    pending.append(dep)
        _require('adapter-manager' not in closure)
        # Complete inventory is inspected; explicit IDs prevent implicit Compose deps.
        ids = [cid for name in selected for cid in services[name]['containers']]
        if op in CLEANUP:
            _require(set(ids) <= owned)
        argv = [p['dockerBinary'], '--host', p['endpoint']]
        stdin = b''
        if op == 'remove': argv += ['rm', '--force', *ids]
        elif op == 'kill': argv += ['kill', '--signal', args['signal'], *ids]
        elif op == 'exec':
            _require(len(ids) == 1 and len(selected) == 1)
            payload = next((x for x in p['payloads'] if x['id'] == args['payloadId'] and x['service'] == selected[0]), None)
            _require(payload is not None)
            stdin = base64.b64decode(args['stdinBase64'], validate=True)
            _require(len(stdin) <= payload['maxStdinBytes'])
            argv += ['exec', '-i', ids[0], *payload['argv']]
        elif op == 'logs':
            _require(len(ids) == 1 and args['limitBytes'] <= MAX_PRIVATE_LOG_BYTES)
            argv += ['logs', ids[0]]
        else: argv += [op, *ids]
        return dict(operationId=request['operationId'], argv=argv, env={}, stdin=stdin,
                    timeoutMs=p['timeoutMs'], maxOutputBytes=min(args.get('limitBytes',
                    MAX_PRIVATE_STREAM_BYTES), MAX_PRIVATE_STREAM_BYTES))

    @staticmethod
    def _response(record):
        return dict(version=1, operationId=record['operationId'], state=record['state'],
                    exitCode=record['exitCode'], result=copy.deepcopy(record['result']) |
                    dict(streams=Dispatcher._unavailable_streams()))

    @staticmethod
    def _unavailable_streams():
        return dict(available=False, complete=False, stdoutBase64=None, stderrBase64=None)

    def execute(self, peer, request):
        try:
            p = self.profile
            _profile(p)
            _require(type(peer) is int and peer == p['candidateUid'])
            request = decode_request(encode(request, MAX_REQUEST_BYTES))
            _require(request['session'] == p['session'])
            request_hash = hashlib.sha256(_canonical(request)).hexdigest()
            with self.journal.session_lock(p['session']):
                records = self.journal.session_records(p['session'])
                # Defensive check on trusted dependency results, never permission
                # to query another session or use its recorded resources.
                _require(all(r['session'] == p['session'] for r in records))
                prior = next((r for r in records if r['operationId'] == request['operationId']), None)
                if prior is not None:
                    _require(prior['requestHash'] == request_hash)
                    prior = self.journal.accept(p['session'], request['operationId'], request_hash)
                    if prior['state'] == 'dispatching':
                        prior = self.journal.transition(p['session'], request['operationId'], 'outcome-unknown', {})
                    # Accepted can be replayed as accepted, never silently dispatched.
                    return self._response(prior)
                cleanup = request['operation'] in CLEANUP
                if not cleanup:
                    _require(not any(r['state'] in ('dispatching', 'outcome-unknown') for r in records))
                owned = {cid for r in records for cid in r['result'].get('resourceIDs', [])}
                invocation = self._invocation(request, owned)
                self._observation(self.inspector(copy.deepcopy(p)))
                # Clock sampling follows all potentially blocking inspection/lock waits.
                admitted_at = self._authority(self._clock(), cleanup)
                self.journal.accept(p['session'], request['operationId'], request_hash)
                self.journal.transition(p['session'], request['operationId'], 'dispatching', {})
                try:
                    now = self._clock()
                    _require(now >= admitted_at)
                    self._authority(now, cleanup)
                except Exception:
                    # No effect entered: this is a known admission failure, not
                    # an uncertain daemon outcome. Persist before replying.
                    record = self.journal.transition(p['session'], request['operationId'],
                                                     'observed-failure', dict(exitCode=1))
                    return self._response(record)
                stream = None
                try:
                    output = self.runner(invocation)
                    capture = request['operation'] in ('exec', 'logs')
                    _keys(output, ('exitCode', 'stdout', 'stderr') if capture else ('exitCode',))
                    code = output['exitCode']
                    _require(type(code) is int and 0 <= code <= 255)
                    if capture:
                        stdout, stderr = output['stdout'], output['stderr']
                        _require(type(stdout) is bytes and type(stderr) is bytes
                                 and len(stdout) + len(stderr) <= invocation['maxOutputBytes'])
                        stream = dict(available=True, complete=True,
                            stdoutBase64=base64.b64encode(stdout).decode('ascii'),
                            stderrBase64=base64.b64encode(stderr).decode('ascii'))
                    metadata = dict(exitCode=code)
                    state = 'observed-success' if code == 0 else 'observed-failure'
                except Exception:
                    stream = None
                    state, metadata = 'outcome-unknown', dict(exitCode=None, cleanupUncertainty=cleanup)
                try:
                    record = self.journal.transition(p['session'], request['operationId'], state, metadata)
                except Exception:
                    # This is not a durable completion ACK. The prior dispatching
                    # record and journal failure latch prevent retries. Reopening
                    # recovers dispatching to unknown; a replaced terminal record
                    # must pass accept's durability refresh before any replay ACK.
                    return dict(version=1, operationId=request['operationId'],
                                state='outcome-unknown', exitCode=None,
                                result=dict(exitCode=None, cleanupUncertainty=cleanup,
                                            streams=self._unavailable_streams()))
                response = self._response(record)
                if stream is not None:
                    response['result']['streams'] = stream
                return response
        except Exception:
            # No raw configuration, policy, stdin or daemon error crosses this seam.
            # Journal replay failures cannot acknowledge a durable completion.
            return refusal('handler-error')
