import copy
import json
import os
import sys
import tempfile
import hashlib
import subprocess
from pathlib import Path
from unittest.mock import patch
import unittest
from contextlib import contextmanager

from scripts.m1_gateway import server
from test_dispatch import profile, CID, DIGEST
from test_transport import MemoryConnection, frame
from test_protocol import valid_request


def raw_container():
    return dict(Id=CID, Image=DIGEST, Config=dict(Labels={
        'com.docker.compose.project': 'campaign1',
        'com.docker.compose.service': 'worker', 'io.aoa.m1a.session': 'session1'}),
        Mounts=[], HostConfig=dict(Privileged=False, Devices=[], DeviceRequests=None,
        DeviceCgroupRules=None, Binds=None, PidMode='', IpcMode='private',
        NetworkMode='bridge', UTSMode='', UsernsMode='', CgroupnsMode='private',
        RestartPolicy=dict(Name='no', MaximumRetryCount=0)),
        State=dict(Status='running', Running=True, Paused=False, Restarting=False, Dead=False))


def schema_anchor():
    def file(path): return dict(path=path,uid=101,gid=201,mode=0o600,device=1,inode=1,size=1,sha256='a'*64)
    def directory(path,mode=0o700,gid=201): return dict(path=path,uid=101,gid=gid,mode=mode,device=1,inode=1)
    directories=dict(privateRoot=directory('/private'),journalRoot=directory('/journal'),
        socketParent=directory('/socket',0o710,202),runtimeCwd=directory('/cwd'))
    return dict(schema='m1a-gateway-bootstrap-v1',installationId='install',generation=1,issuedAt=100,validUntil=200,
        accounts=dict(controllerUid=101,controllerGid=201,controllerGroups=[202],connectionGid=202,
            peers=[dict(uid=102,primaryGid=202,supplementaryGroups=[],session='session1')]),
        manifest=file('/private/manifest'),directories=directories,
        ancestors=[directory('/',0o755),*directories.values()],
        code=dict(python=file('/private/python'),node=file('/private/node'),docker=file('/private/docker'),
            moduleLoader=file('/private/loader'),authorityBridge=file('/private/bridge'),
            gatewayClosure=[file('/private/source')],clientClosure=[file('/private/client')]),
        authority=dict(publicKey=file('/private/public'),fingerprint='b'*64,revocationDirectory=directories['privateRoot'],
            revocationName='revocations',publisherUid=101,publisherGid=201,maxAgeSeconds=30,minimumRevocationSequence=1),
        daemon=dict(endpoint='unix:///private/daemon',daemonId='daemon',endpointGeneration=1),
        custodyPeer=dict(uid=103,gid=203,installationDigest='c'*64,enforcementDigest='d'*64),
        predicates={k:True for k in ('importClosureProtected','accountGroupExclusion','aclMountCapabilityExclusion',
            'writeAliasesExcluded','daemonActorsExcluded','generationLifetimeExclusion','credentialsSeparated')})


class CompositionTests(unittest.TestCase):
    def test_execution_session_render_request_refuses_before_custody_or_dispatch(self):
        c = self.module()
        runtime = object.__new__(c.SessionRuntime)
        class NoEffect:
            def __getattr__(self, name):
                raise AssertionError('execution boundary crossed')
        runtime.custody = NoEffect()
        runtime.dispatcher = NoEffect()
        request = valid_request('inspect', {'projection': 'render'}) | {
            'services': ['adapter-manager', 'control-plane', 'migrate']}
        self.assertEqual(runtime.execute(102, request), c.refusal('handler-error'))

    def authority_runtime(self, clock):
        c = self.module()
        runtime = object.__new__(c.SessionRuntime)
        runtime.anchor = schema_anchor()
        runtime.profile = profile()
        runtime.session = dict(policy='policy', signature='signature')
        runtime.manifest = dict(limits={'authorityTimeoutMs': 1000})
        runtime.sequence, runtime.revocation_hash = 1, None
        revoked = dict(schema='m1a-gateway-revocation-v1', installationId='install',
            generation=1, sequence=1, available=True, checkedAt=100, validUntil=200, revoked=[])
        class Files:
            def revocation(self, authority): return json.dumps(revoked).encode()
            def verify(self, pin): pass
            def read(self, pin, maximum): return b'public'
            @contextmanager
            def directory(self, path): yield None
        runtime.files = Files()
        runtime.continuity = lambda: None
        def verifier(*args):
            clock[0] = clock[1]
            return dict(exitCode=0, stderr=b'', stdout=json.dumps(dict(
                policy={'notBefore': 90, 'expiresAt': 190})).encode())
        runtime.child = verifier
        return runtime

    def test_revocation_age_rechecked_after_blocking_verification(self):
        c = self.module()
        for returned_at in (131, 200, 99):
            clock = [100, returned_at]
            runtime = self.authority_runtime(clock)
            with self.subTest(returned_at=returned_at), patch.object(c.time, 'time', lambda: clock[0]):
                with self.assertRaises(c.CompositionError): runtime.authority(now=100, cleanup=False)

    def test_revocation_age_rechecked_after_runner_code_verification_before_spawn(self):
        c = self.module()
        for spawn_at in (131, 129):
            clock = [100, 130]
            runtime = self.authority_runtime(clock)
            with self.subTest(spawn_at=spawn_at), patch.object(c.time, 'time', lambda: clock[0]):
                runtime.authority(now=100, cleanup=False)
                del runtime.child
                def delayed_code_check(key): clock[0] = spawn_at
                runtime.code_check = delayed_code_check
                with patch.object(c, 'run_private', side_effect=AssertionError('stale logs child started')):
                    with self.assertRaises(c.CompositionError):
                        runtime.runner(dict(env={}, stdin=b'', timeoutMs=runtime.profile['timeoutMs'],
                            argv=[runtime.profile['dockerBinary'], '--host', runtime.profile['endpoint'], 'logs', CID],
                            maxOutputBytes=100))

    def test_protected_file_opens_nonblocking_before_type_validation(self):
        c = self.module()
        store = object.__new__(c.ProtectedFiles)
        @contextmanager
        def directory(path): yield 9
        store.directory = directory
        def opening(path, flags, **kwargs):
            self.assertTrue(flags & 0x800, 'FIFO open can block before fstat')
            raise OSError('fixture refuses before IO')
        with patch.object(c.os, 'O_NONBLOCK', 0x800, create=True), \
             patch.object(c.os, 'O_NOFOLLOW', 0x20000, create=True), \
             patch.object(c.os, 'O_CLOEXEC', 0x80000, create=True), patch.object(c.os, 'open', opening):
            with self.assertRaises(c.CompositionError): store.read(schema_anchor()['manifest'], 10)
            with self.assertRaises((c.CompositionError, OSError)):
                store.revocation(schema_anchor()['authority'])

    def test_revocation_age_rechecked_after_final_continuity_before_popen(self):
        c = self.module(); clock = [100, 130]
        runtime = self.authority_runtime(clock)
        with patch.object(c.time, 'time', lambda: clock[0]):
            runtime.authority(now=100, cleanup=False)
            del runtime.child
            runtime.code_check = lambda key: None
            def delayed_continuity(): clock[0] = 131
            runtime.continuity = delayed_continuity
            entered = []
            def spawn(*args, **kwargs):
                entered.append(True); raise AssertionError('stale effect entered')
            with patch.object(c.subprocess, 'Popen', spawn), self.assertRaises(c.CompositionError):
                runtime.runner(dict(env={},stdin=b'',timeoutMs=runtime.profile['timeoutMs'],
                    argv=[runtime.profile['dockerBinary'],'--host',runtime.profile['endpoint'],'logs',CID],maxOutputBytes=100))
            self.assertEqual(entered, [], 'final continuity wait must not let freshness expire before spawn')

    def module(self):
        from scripts.m1_gateway import composition
        return composition

    def test_actual_projection_closed_fields_and_all_replica_inventory(self):
        c = self.module()
        p = profile()
        actual = c.project_containers([raw_container()], [CID], p)
        self.assertEqual(actual[0]['containers'][0], dict(id=CID, imageConfigId=DIGEST,
            session='session1', project='campaign1', service='worker', mounts=[],
            devices=[], privileged=False, hostNamespaces=False, restartPolicy='no'))
        for ids, rows in (([CID, '2'*64], [raw_container()]),
                          ([CID], [raw_container(), raw_container()])):
            with self.subTest(ids=ids), self.assertRaises(c.CompositionError):
                c.project_containers(rows, ids, p)

    def test_runtime_projection_missing_fields_and_unsafe_values_refuse(self):
        c = self.module()
        original = raw_container()
        mutations = [('Mounts', None), ('Mounts', [{}])]
        for key in original['HostConfig']:
            row = raw_container()
            del row['HostConfig'][key]
            with self.subTest(missing=key), self.assertRaises(c.CompositionError):
                c.project_containers([row], [CID], profile())
        for key, val in [('Privileged', True), ('Devices', None), ('Devices', [{}]),
                         ('DeviceRequests', [{}]), ('Binds', ['x']),
                         ('PidMode', 'host'), ('IpcMode', 'container:x'),
                         ('NetworkMode', 'host'), ('NetworkMode', 'container:x'),
                         ('UTSMode', None), ('UsernsMode', 'host'), ('CgroupnsMode', ''),
                         ('RestartPolicy', {'Name': 'always', 'MaximumRetryCount': 0})]:
            row = raw_container()
            row['HostConfig'][key] = val
            with self.subTest(key=key), self.assertRaises(c.CompositionError):
                c.project_containers([row], [CID], profile())
        for key, val in mutations:
            row = raw_container()
            row[key] = val
            with self.subTest(key=key), self.assertRaises(c.CompositionError):
                c.project_containers([row], [CID], profile())
        for labels in (None, {}, {'com.docker.compose.service': 'worker'}):
            row = raw_container()
            row['Config']['Labels'] = labels
            with self.subTest(labels=labels), self.assertRaises(c.CompositionError):
                c.project_containers([row], [CID], profile())

    def test_startup_binding_disjoint_from_wire_and_closed(self):
        c = self.module()
        binding = c.custody_binding('startup')
        self.assertEqual(binding, dict(scope='startup', session=None, operationId=None))
        self.assertEqual(c.custody_binding('operation', 'session1', 'op1'),
                         dict(scope='operation', session='session1', operationId='op1'))
        for args in [('startup', 'session1', 'op1'), ('operation', None, None), ('other',)]:
            with self.subTest(args=args), self.assertRaises(c.CompositionError):
                c.custody_binding(*args)

    def test_wrapper_releases_once_and_suppresses_post_terminal_failure(self):
        c = self.module()
        class Lease:
            def __init__(self): self.calls = []
            def acquire(self, binding): self.calls.append('acquire')
            def check(self): self.calls.append('check')
            def release(self):
                self.calls.append('release')
                raise c.CompositionError()
        lease = Lease()
        record = dict(state='observed-success', result={'streams': {'private': 'bytes'}})
        with self.assertRaises(c.SuppressResponse):
            c.with_custody(lease, c.custody_binding('operation', 'session1', 'op1'), lambda: record)
        self.assertEqual(lease.calls.count('release'), 1)
        self.assertEqual(record['state'], 'observed-success')
        lease = Lease()
        def fail(binding):
            lease.calls.append('acquire')
            raise c.CompositionError()
        lease.acquire = fail
        with self.assertRaises(c.SuppressResponse):
            c.with_custody(lease, c.custody_binding('startup'), lambda: self.fail('no entry'))
        self.assertEqual(lease.calls, ['acquire', 'release'])

    def test_suppression_sends_no_frame(self):
        c = self.module()
        conn = MemoryConnection(frame(valid_request()))
        def suppress(*args): raise c.SuppressResponse()
        server.serve_connection(conn, 42, lambda _: 'campaign-1', suppress)
        self.assertEqual(conn.sent, b'')

    def test_closed_json_duplicates_types_and_root_exception(self):
        c = self.module()
        for raw in (b'{"x":1,"x":2}', b'{"x":NaN}', b'\xef\xbb\xbf{}', b'\xff'):
            with self.subTest(raw=raw), self.assertRaises(c.CompositionError):
                c.strict_json(raw, 100)
        c.absolute_path('/', root=True)
        for path in ('/', '/a/../b', '/a//b', 'x', '//x'):
            with self.subTest(path=path), self.assertRaises(c.CompositionError):
                c.absolute_path(path)

    def test_production_startup_refuses_nonlinux_before_io(self):
        self.assertTrue(callable(getattr(server, 'start_gateway', None)), 'production entrypoint missing')
        with self.assertRaises(Exception): server.start_gateway('/not-a-trust-anchor')

    def test_real_bounded_subprocess_scrubs_env_captures_and_refuses_overflow(self):
        c = self.module()
        with patch.dict(os.environ, {'DOCKER_HOST': 'evil', 'NODE_OPTIONS': 'evil'}):
            result = c.run_private([sys.executable, '-I', '-S', '-c',
                'import os,sys;assert not os.environ.get("DOCKER_HOST");'
                'assert not os.environ.get("NODE_OPTIONS");'
                'sys.stdout.buffer.write(b"out");sys.stderr.buffer.write(b"err");sys.exit(7)'],
                cwd=os.getcwd(), stdin=b'', timeout_ms=5000, maximum=6)
        self.assertEqual(result, dict(exitCode=7, stdout=b'out', stderr=b'err'))
        for code in ('import sys;sys.stdout.buffer.write(b"x"*7)',
                     'import time;time.sleep(2)'):
            with self.subTest(code=code), self.assertRaises(c.CompositionError):
                c.run_private([sys.executable, '-I', '-S', '-c', code], cwd=os.getcwd(),
                              stdin=b'', timeout_ms=100, maximum=6)

    def test_anchor_rejects_config_trust_and_external_false_predicates(self):
        c = self.module()
        with self.assertRaises(c.CompositionError): c.validate_anchor({'root': '/candidate'})
        for value in (None, {}, {'schema': 'm1a-gateway-startup-v1'}):
            with self.subTest(value=value), self.assertRaises(c.CompositionError):
                c.validate_manifest(value, {})

    def test_closed_anchor_valid_schema_and_adversarial_external_inputs(self):
        c=self.module(); anchor=schema_anchor()
        self.assertEqual(c.validate_anchor(anchor),anchor)
        for field in anchor['predicates']:
            bad=copy.deepcopy(anchor);bad['predicates'][field]=False
            with self.subTest(field=field),self.assertRaises(c.CompositionError):c.validate_anchor(bad)
        for kind in ('candidate-code','root-file','wrong-mode','group','duplicate-peer','duplicate-closure','extra','boolean-generation'):
            bad=copy.deepcopy(anchor)
            if kind=='candidate-code':bad['code']['python']['uid']=102
            if kind=='root-file':bad['manifest']['path']='/'
            if kind=='wrong-mode':bad['manifest']['mode']=0o666
            if kind=='group':bad['accounts']['peers'][0]['supplementaryGroups']=[201]
            if kind=='duplicate-peer':bad['accounts']['peers']*=2
            if kind=='duplicate-closure':bad['code']['gatewayClosure']*=2
            if kind=='extra':bad['root']='/candidate'
            if kind=='boolean-generation':bad['generation']=True
            with self.subTest(kind=kind),self.assertRaises(c.CompositionError):c.validate_anchor(bad)
        file=anchor['manifest']
        manifest=dict(schema='m1a-gateway-startup-v1',installationId='install',generation=1,
            controllerSha='b'*40,socketName='gateway',sessions=[dict(session='session1',peerUid=102,
            profile=file,policy=file,signature=file,compose=file)],limits=dict(authorityTimeoutMs=10000,
            inspectionTimeoutMs=30000,clientWaitMs=20000,maxConnections=1,maxInspectionBytes=1048576,custodyTimeoutMs=5000))
        self.assertEqual(c.validate_manifest(manifest,anchor),manifest)
        for change in ({'generation':True},{'sessions':[]},{'socketName':'../x'}):
            with self.subTest(change=change),self.assertRaises(c.CompositionError):c.validate_manifest(manifest|change,anchor)

    def test_post_terminal_continuity_failure_preserves_actual_dispatch_record_without_frame(self):
        c=self.module()
        from test_dispatch import DispatchTests, request
        fixture=DispatchTests();fixture.setUp()
        class Lease:
            def __init__(self):self.release_calls=0
            def acquire(self,binding): pass
            def check(self):
                if fixture.journal.records: raise c.CompositionError()
            def release(self):self.release_calls+=1
        lease=Lease();req=request('logs',{'limitBytes':100})
        conn=MemoryConnection(frame(req))
        def handler(uid,value):
            return c.with_custody(lease,c.custody_binding('operation','session1','op1'),
                lambda:fixture.execute(value,runner=lambda _:dict(exitCode=0,stdout=b'private',stderr=b'')))
        server.serve_connection(conn,1234,lambda uid:'session1',handler)
        self.assertEqual(conn.sent,b'');self.assertEqual(lease.release_calls,1)
        record=fixture.journal.records['op1']
        self.assertEqual(record['state'],'observed-success');self.assertEqual(record['result'],{'exitCode':0})

    def test_executable_pin_can_be_verified_without_loading_large_runtime_in_memory(self):
        c = self.module()
        pin = dict(path='/installed/node', uid=1, gid=1, mode=0o755,
                   device=1, inode=1, size=32*1048576, sha256='a'*64)
        c.pin_schema(pin)
        self.assertTrue(callable(getattr(c.ProtectedFiles, 'verify', None)))

    def test_custody_channel_failure_latches_no_future_acquire(self):
        c = self.module()
        lease = object.__new__(c.Custody)
        lease.binding, lease.lease, lease.attempted = None, None, False
        lease.poisoned = True
        lease.anchor=dict(installationId='install',generation=1)
        lease.exchange = lambda req: self.fail('poisoned channel must never reacquire')
        with self.assertRaises(c.CompositionError): lease.acquire(c.custody_binding('startup'))


@unittest.skipUnless(sys.platform == 'linux', 'actual Linux protected FD/custody required')
class LinuxCompositionTests(unittest.TestCase):
    def test_actual_fifo_reads_and_verification_refuse_without_waiting_for_writer(self):
        repo = str(Path(__file__).resolve().parents[3])
        code = '''import os,sys,tempfile,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from scripts.m1_gateway import composition as c
with tempfile.TemporaryDirectory(dir=str(Path.home())) as root:
 os.chmod(root,0o700); path=Path(root)/'fifo'; os.mkfifo(path,0o600)
 ancestors=[]
 for directory in [Path(root),*Path(root).parents]:
  st=directory.stat(); ancestors.append(dict(path=str(directory),uid=st.st_uid,gid=st.st_gid,mode=st.st_mode&0o7777,device=st.st_dev,inode=st.st_ino))
 st=path.stat(); pin=dict(path=str(path),uid=st.st_uid,gid=st.st_gid,mode=0o600,device=st.st_dev,inode=st.st_ino,size=1,sha256='a'*64)
 files=c.ProtectedFiles(ancestors)
 authority=dict(revocationDirectory={'path':root},revocationName='fifo',publisherUid=st.st_uid,publisherGid=st.st_gid)
 for read in (lambda:files.read(pin,10),lambda:files.verify(pin),lambda:files.revocation(authority)):
  try: read()
  except c.CompositionError: pass
  else: raise AssertionError('FIFO admitted')
print('refused')
'''
        result = subprocess.run([sys.executable, '-I', '-S', '-c', code, repo],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, env={})
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout,b'refused\n')

    def test_dev_pinned_cli_unix_server_node_authority_journal_and_private_response(self):
        self.composition_fixture('success')

    def test_real_custody_loss_during_inspection(self):
        self.composition_fixture('inspection')

    def test_real_custody_loss_during_verification(self):
        self.composition_fixture('verification')

    def test_real_custody_loss_during_runner_restart_never_repeats_logs(self):
        self.composition_fixture('runner')

    def test_real_release_timeout_preserves_terminal_bytes_and_suppresses_capture(self):
        self.composition_fixture('release-timeout')

    def test_real_disconnect_then_restart_replay_preserves_terminal_bytes(self):
        self.composition_fixture('disconnect')

    def composition_fixture(self, scenario):
        import shutil
        import socket
        import threading
        from scripts.m1_gateway import composition as c, client
        from scripts.m1_gateway.dispatch import profile_hash
        node = shutil.which('node')
        self.assertIsNotNone(node, 'fixture requires installed Node, never downloads it')
        bridge = Path(__file__).resolve().parents[2]/'lib'/'m1a-gateway-authority-bridge.mjs'
        verifier = bridge.with_name('m1a-gateway-authority.mjs')
        with tempfile.TemporaryDirectory(dir=str(Path.home())) as root:
            root = Path(root); os.chmod(root, 0o700)
            shim = root/'cli'; endpoint = root/'daemon.sock'; journal_root = root/'journal'
            journal_root.mkdir(mode=0o700)
            shim.write_text('#!' + str(Path(sys.executable).resolve()) + ' -I\n' +
                'import json,socket,sys\n'
                'a=sys.argv[1:]\n'
                'assert a[0]=="--host" and a[1].startswith("unix://")\n'
                's=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.connect(a[1][7:])\n'
                's.sendall(json.dumps(a[2:]).encode());s.shutdown(socket.SHUT_WR)\n'
                'b=bytearray()\n'
                'while True:\n'
                ' d=s.recv(4096)\n'
                ' if not d: break\n'
                ' b.extend(d)\n'
                's.close();sys.stdout.buffer.write(b)\n', encoding='ascii')
            os.chmod(shim, 0o700)
            node_shim = root/'node-cli'
            node_shim.write_text('#!' + str(Path(sys.executable).resolve()) + ' -I\n' +
                'import socket,subprocess,sys\n'
                'child=subprocess.Popen([' + repr(str(Path(node).resolve())) + ',*sys.argv[1:]],env={},close_fds=True)\n'
                's=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)\n'
                's.connect(' + repr(str(endpoint)) + ')\n'
                's.sendall(b\'["verification"]\');s.shutdown(socket.SHUT_WR)\n'
                'while s.recv(4096): pass\n'
                's.close()\n'
                'sys.exit(child.wait())\n', encoding='ascii')
            os.chmod(node_shim, 0o700)
            p = profile(); p.update(dockerBinary=str(shim), endpoint='unix://'+str(endpoint),
                composePath=str(root/'compose'), composeSha256=hashlib.sha256(b'compose').hexdigest(),
                candidateUid=os.getuid(), payloads=[], cleanupExpiresAt=int(__import__('time').time())+600)
            # Node signs exact canonical policy in memory; private key never crosses stdout.
            signer = '''const fs=require('node:fs'),crypto=require('node:crypto');
const p=JSON.parse(fs.readFileSync(0,'utf8')),keys=crypto.generateKeyPairSync('ed25519');
p.authorityFingerprint=crypto.createHash('sha256').update(keys.publicKey.export({type:'spki',format:'der'})).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
delete p.profileSha256;p.profileSha256=crypto.createHash('sha256').update(JSON.stringify(canonical(p))).digest('hex');
const now=Math.floor(Date.now()/1000),policy={schema:'m1a-gateway-policy-v1',classification:'PRODUCTION',controllerSha:p.controllerSha,
candidate:p.candidate,session:p.session,profileSha256:p.profileSha256,authorityFingerprint:p.authorityFingerprint,
notBefore:now-60,expiresAt:now+600,images:p.services.map(s=>s.image),provider:null};
const bytes=Buffer.from(JSON.stringify(policy));process.stdout.write(JSON.stringify({profile:p,policy:bytes.toString('base64'),
signature:crypto.sign(null,bytes,keys.privateKey).toString('base64'),publicKey:keys.publicKey.export({type:'spki',format:'pem'})}));'''
            signed = json.loads(subprocess.run([node, '-e', signer], input=json.dumps(p).encode(),
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={}, check=True).stdout)
            import base64
            p = signed['profile']
            contents = {'profile': json.dumps(p).encode(), 'compose': b'compose',
                'policy': base64.b64decode(signed['policy']), 'signature': base64.b64decode(signed['signature']),
                'public': signed['publicKey'].encode()}
            now = int(__import__('time').time())
            contents['revocation'] = json.dumps(dict(schema='m1a-gateway-revocation-v1', installationId='dev',
                generation=1, sequence=1, available=True, checkedAt=now, validUntil=now+600, revoked=[])).encode()
            def pin(path):
                info = Path(path).stat(); return dict(path=str(path), uid=info.st_uid, gid=info.st_gid,
                    mode=info.st_mode & 0o7777, device=info.st_dev, inode=info.st_ino,
                    size=info.st_size, sha256=hashlib.sha256(Path(path).read_bytes()).hexdigest())
            for name, data in contents.items():
                (root/name).write_bytes(data); os.chmod(root/name, 0o600)
            paths = [root, Path(node).resolve().parent, bridge.parent, verifier.parent]
            ancestors = {}
            for path in paths:
                for directory in [path, *path.parents]:
                    info = directory.stat(); ancestors[str(directory)] = dict(path=str(directory),uid=info.st_uid,
                        gid=info.st_gid,mode=info.st_mode & 0o7777,device=info.st_dev,inode=info.st_ino)
            files = c.ProtectedFiles(list(ancestors.values()))
            anchor = dict(installationId='dev',generation=1,issuedAt=now-60,validUntil=now+600,
                accounts={'controllerUid':os.getuid()}, daemon=dict(endpoint=p['endpoint'],daemonId='dev-daemon',endpointGeneration=1),
                custodyPeer=dict(uid=os.getuid(),gid=os.getgid(),installationDigest='a'*64,enforcementDigest='b'*64),
                directories={'runtimeCwd':ancestors[str(root)]}, code=dict(node=pin(node_shim),docker=pin(shim),
                    authorityBridge=pin(bridge),gatewayClosure=[pin(verifier)],clientClosure=[pin(shim)]),
                authority=dict(publicKey=pin(root/'public'),fingerprint=p['authorityFingerprint'],
                    revocationDirectory=ancestors[str(root)],revocationName='revocation',publisherUid=os.getuid(),
                    publisherGid=os.getgid(),maxAgeSeconds=600,minimumRevocationSequence=1))
            manifest = dict(controllerSha=p['controllerSha'],limits=dict(authorityTimeoutMs=10000,
                inspectionTimeoutMs=10000,maxInspectionBytes=1048576))
            session = dict(peerUid=os.getuid(),session='session1',**{k:pin(root/k) for k in ('profile','compose','policy','signature')})
            commands, errors = [], []
            daemon = socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); daemon.bind(str(endpoint)); daemon.listen(1)
            left,right = socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET)
            stop = threading.Event()
            armed = threading.Event(); fault = threading.Event(); logs_entered = threading.Event()
            logs_continue = threading.Event(); released = threading.Event(); durable_at_release = []
            messages = []
            def durable_bytes(): return {str(f.relative_to(journal_root)):f.read_bytes() for f in journal_root.rglob('*.json')}
            def docker_server():
                try:
                    daemon.settimeout(0.1)
                    while not stop.is_set():
                        try: conn,_ = daemon.accept()
                        except TimeoutError: continue
                        with conn:
                            conn.settimeout(5)
                            data=bytearray()
                            while True:
                                chunk=conn.recv(4096)
                                if not chunk: break
                                data.extend(chunk)
                            args=json.loads(data); commands.append(args)
                            if args==['verification']: output=b''
                            elif args==['info','--format','{{json .}}']: output=json.dumps({'ID':'dev-daemon'}).encode()
                            elif args==['ps','--all','--no-trunc','--filter','label=com.docker.compose.project=campaign1','--format','{{.ID}}']: output=(CID+'\n').encode()
                            elif args==['inspect','--type','container',CID]: output=json.dumps([raw_container()]).encode()
                            elif args==['logs',CID]:
                                logs_entered.set()
                                if scenario == 'disconnect' and armed.is_set():
                                    if not logs_continue.wait(5): raise AssertionError('client did not disconnect')
                                output=b'private-log'
                            else: raise AssertionError(args)
                            target = {'inspection':'inspect','verification':'verification','runner':'logs'}.get(scenario)
                            fault_here = armed.is_set() and args[0] == target and not fault.is_set()
                            if fault_here:
                                fault.set(); right.shutdown(socket.SHUT_RDWR)
                                __import__('time').sleep(0.1)
                            try: conn.sendall(output)
                            except BrokenPipeError:
                                if not fault_here: raise
                except Exception as error: errors.append(error)
            def custody_server():
                try:
                    while not stop.is_set():
                        raw = right.recv(4096)
                        if not raw: break
                        req=json.loads(raw); messages.append(req); binding={k:req[k] for k in ('scope','session','operationId')}
                        right.send(json.dumps(dict(schema='m1a-custody-lease-v1',nonce=req['nonce'],leaseId='lease',
                            installationId='dev',generation=1,endpointGeneration=1,daemonId='dev-daemon',
                            installationDigest='a'*64,enforcementDigest='b'*64,holderUid=os.getuid(),**binding,
                            predicates=dict(installationProtected=True,endpointStable=True,actorsExcluded=True,lifetimeHeld=True))).encode())
                        raw = right.recv(4096)
                        if not raw: break
                        req=json.loads(raw); messages.append(req)
                        if armed.is_set():
                            durable_at_release.append(durable_bytes()); released.set()
                            if scenario == 'release-timeout' and not fault.is_set():
                                fault.set()
                                stop.wait(1)
                                break
                        right.send(json.dumps(dict(schema='m1a-custody-release-v1',
                            nonce=req['nonce'],leaseId='lease',released=True,**binding)).encode())
                except Exception as error:
                    if not stop.is_set() and not fault.is_set(): errors.append(error)
            right.settimeout(30)
            threads=[threading.Thread(target=docker_server, daemon=True),threading.Thread(target=custody_server, daemon=True)]
            for thread in threads: thread.start()
            gateway, worker = None, None
            try:
                custody=c.Custody(left,anchor,100); journal=c.Journal(str(journal_root))
                runtime=c.SessionRuntime(anchor,manifest,session,files,custody,journal)
                c.with_custody(custody,c.custody_binding('startup'),lambda:(runtime.dispatcher._authority(int(__import__('time').time()),False),runtime.inspect(copy.deepcopy(p))))
                socket_parent=root/'socket';socket_parent.mkdir(mode=0o710)
                st=socket_parent.stat();socket_pin=dict(path=str(socket_parent),uid=st.st_uid,gid=st.st_gid,
                    mode=st.st_mode&0o7777,device=st.st_dev,inode=st.st_ino)
                files.ancestors[str(socket_parent)]=socket_pin
                anchor['directories']['socketParent']=socket_pin
                anchor['accounts']['connectionGid']=os.getgid()
                manifest['socketName']='gateway'
                gateway=c.GatewayRuntime(anchor,manifest,files,custody,{os.getuid():runtime})
                def serve():
                    try:
                        gateway.serve()
                    except Exception as error: errors.append(error)
                worker=threading.Thread(target=serve, daemon=True); worker.start()
                until=__import__('time').monotonic()+5
                while not (socket_parent/'gateway').exists() and __import__('time').monotonic()<until:
                    __import__('time').sleep(0.01)
                req=dict(version=1,session='session1',operationId='op1',operation='logs',services=['worker'],arguments={'limitBytes':100})
                armed.set()
                if scenario == 'success':
                    first=client.request(str(socket_parent/'gateway'),req,timeout_ms=20000)
                    self.assertEqual(first['state'],'observed-success')
                    self.assertEqual(first['result']['streams']['stdoutBase64'],base64.b64encode(b'private-log').decode())
                else:
                    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as candidate:
                        candidate.settimeout(10); candidate.connect(str(socket_parent/'gateway')); candidate.sendall(frame(req))
                        if scenario == 'disconnect':
                            self.assertTrue(logs_entered.wait(5)); candidate.close(); logs_continue.set()
                            self.assertTrue(released.wait(5))
                        else:
                            self.assertEqual(candidate.recv(1114112), b'', 'custody failure must send no frame/private capture')
                gateway.close();worker.join(6); self.assertFalse(worker.is_alive())
                self.assertFalse((socket_parent/'gateway').exists())
                before = durable_bytes()
                releases = [m for m in messages if m['scope']=='operation' and m['action']=='release']
                if scenario in ('success','release-timeout','disconnect'):
                    self.assertEqual(len(releases),1, 'operation release must be attempted once')
                if scenario in ('inspection', 'verification'):
                    self.assertEqual(before, {}); self.assertTrue(fault.is_set())
                    self.assertEqual(commands.count(['logs',CID]),0)
                else:
                    self.assertEqual(len(before),1)
                    record=json.loads(next(iter(before.values())))
                    self.assertEqual(record['state'], 'outcome-unknown' if scenario == 'runner' else 'observed-success')
                    if scenario in ('release-timeout', 'disconnect'):
                        self.assertEqual(before,durable_at_release[0])
                    if scenario == 'release-timeout': self.assertTrue(fault.is_set())
                    # Restart the actual listener, channel, runtime and Journal on the same durable files.
                    left.close(); threads[1].join(6); right.close()
                    self.assertFalse(threads[1].is_alive())
                    left,right=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET); right.settimeout(10)
                    replacement=threading.Thread(target=custody_server,daemon=True); threads.append(replacement); replacement.start()
                    custody=c.Custody(left,anchor,100)
                    runtime=c.SessionRuntime(anchor,manifest,session,files,custody,c.Journal(str(journal_root)))
                    gateway=c.GatewayRuntime(anchor,manifest,files,custody,{os.getuid():runtime})
                    worker=threading.Thread(target=serve,daemon=True); worker.start()
                    until=__import__('time').monotonic()+5
                    while not (socket_parent/'gateway').exists() and __import__('time').monotonic()<until:
                        __import__('time').sleep(0.01)
                    replay=client.request(str(socket_parent/'gateway'),req,timeout_ms=20000)
                    self.assertEqual(replay['state'],record['state'])
                    self.assertEqual(replay['result']['streams'],dict(available=False,complete=False,stdoutBase64=None,stderrBase64=None))
                    self.assertEqual(durable_bytes(),before)
                    self.assertEqual(commands.count(['logs',CID]),1)
                    gateway.close(); worker.join(6); self.assertFalse(worker.is_alive())
                for record in journal_root.rglob('*.json'): self.assertNotIn(b'streams',record.read_bytes())
                for record in journal_root.rglob('*.json'): self.assertNotIn(b'private-log',record.read_bytes())
            finally:
                if gateway is not None: gateway.close()
                if worker is not None: worker.join(6)
                stop.set(); logs_continue.set(); left.close()
                for thread in threads: thread.join(6)
                right.close()
                daemon.close()
                self.assertTrue(all(not thread.is_alive() for thread in threads))
            self.assertEqual(errors,[])

    def test_protected_read_rejects_link_and_unsafe_ancestor(self):
        from scripts.m1_gateway import composition as c
        with tempfile.TemporaryDirectory(dir=str(Path.home())) as root:
            os.chmod(root, 0o700)
            path = Path(root) / 'input'
            path.write_bytes(b'protected')
            os.chmod(path, 0o600)
            ancestors = []
            for directory in [Path('/'), *reversed(Path(root).parents[:-1]), Path(root)]:
                info = directory.stat()
                ancestors.append(dict(path=str(directory), uid=info.st_uid, gid=info.st_gid,
                    mode=info.st_mode & 0o7777, device=info.st_dev, inode=info.st_ino))
            info = path.stat()
            pin = dict(path=str(path), uid=info.st_uid, gid=info.st_gid, mode=0o600,
                device=info.st_dev, inode=info.st_ino, size=9, sha256=hashlib.sha256(b'protected').hexdigest())
            store = c.ProtectedFiles(ancestors)
            self.assertEqual(store.read(pin, 100), b'protected')
            os.link(path, Path(root)/'hardlink')
            with self.assertRaises(c.CompositionError): store.read(pin, 100)
            (Path(root)/'hardlink').unlink()
            os.chmod(root, 0o777)
            with self.assertRaises(c.CompositionError): store.read(pin, 100)

    def test_custody_startup_exchange_real_peer_release_once(self):
        import socket
        import threading
        from scripts.m1_gateway import composition as c
        left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        anchor = dict(installationId='installation', generation=1,
            accounts={'controllerUid': os.getuid()}, daemon=dict(endpointGeneration=1, daemonId='daemon'),
            custodyPeer=dict(uid=os.getuid(), gid=os.getgid(), installationDigest='a'*64, enforcementDigest='b'*64))
        messages, errors = [], []
        def producer():
            try:
                req = json.loads(right.recv(4096)); messages.append(req)
                right.send(json.dumps(dict(schema='m1a-custody-lease-v1', nonce=req['nonce'], leaseId='lease',
                    installationId='installation', generation=1, endpointGeneration=1, daemonId='daemon',
                    installationDigest='a'*64, enforcementDigest='b'*64, holderUid=os.getuid(),
                    scope=req['scope'], session=None, operationId=None, predicates=dict(
                    installationProtected=True, endpointStable=True, actorsExcluded=True, lifetimeHeld=True))).encode())
                req = json.loads(right.recv(4096)); messages.append(req)
                right.send(json.dumps(dict(schema='m1a-custody-release-v1', nonce=req['nonce'], leaseId='lease',
                    scope=req['scope'], session=None, operationId=None, released=True)).encode())
            except Exception as error: errors.append(error)
        with left, right:
            right.settimeout(10)
            thread = threading.Thread(target=producer, daemon=True); thread.start()
            lease = c.Custody(left, anchor, 5000)
            self.assertEqual(c.with_custody(lease, c.custody_binding('startup'), lambda: 'ok'), 'ok')
            thread.join(6)
            self.assertFalse(thread.is_alive()); self.assertEqual(errors, [])
        self.assertEqual([m['action'] for m in messages], ['acquire', 'release'])
        self.assertTrue(all(m['session'] is None and m['operationId'] is None for m in messages))


if __name__ == '__main__': unittest.main()
