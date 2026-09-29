import unittest
from unittest.mock import patch

from scripts.m1_gateway.render import (RenderError, parse_render_profile_shape,
                                       render_profile_hash, render_inputs_hash, require_render_services,
                                       render_compose, RenderUnknown)

SERVICES = ['adapter-manager', 'control-plane', 'control-plane-b',
            'm1-worker-a', 'm1-worker-b', 'm1-worker-c', 'migrate',
            'minio', 'postgres', 'worker-a1', 'worker-a2', 'worker-b1', 'worker-b2']


def profile():
    value = dict(schema='m1a-gateway-render-profile-offline-v1', classification='OFFLINE_TEST_ONLY',
                controllerSha='a' * 40, candidate='b' * 40, session='session1',
                candidateUid=102, authorityFingerprint='c' * 64,
                composeSha256='d' * 64, inputIdentitySha256='e' * 64,
                project='aoa-m1-boot',
                services=[dict(name=name, dependencies=['migrate'] if name == 'control-plane' else [])
                          for name in SERVICES])
    value['profileSha256'] = render_profile_hash(value)
    return value


class RenderMembershipTests(unittest.TestCase):
    def test_offline_render_command_shape_and_mocked_pin_checks(self):
        def pin(path):
            return dict(path=path, uid=101, gid=201, mode=0o600, device=1,
                        inode=2, size=3, sha256='a' * 64)
        inputs = dict(schema='m1a-gateway-render-inputs-offline-v1',
                      mode='keyless', keyedValue=None,
                      project='aoa-m1-boot', endpoint='unix:///private/daemon',
                      dockerBinary=pin('/private/docker'), cwd='/private/cwd',
                      envFile=pin('/private/env'),
                      composeFiles=[pin('/private/base.yml'), pin('/private/overlay.yml')],
                      timeoutMs=5000, maxStdoutBytes=1024, maxStderrBytes=256)
        inputs['inputIdentitySha256'] = render_inputs_hash(inputs)
        class Files:
            def __init__(self): self.checked = []
            def verify(self, value): self.checked.append(value['path'])
            def directory(self, value):
                from contextlib import nullcontext
                return nullcontext()
        files = Files()
        observed = {}
        def runner(argv, **kwargs):
            observed['argv'], observed['kwargs'] = argv, kwargs
            kwargs['before_spawn']()
            return dict(exitCode=0, stdout=b'{"services":{}}', stderr=b'')
        with patch('scripts.m1_gateway.composition.run_private', runner):
            raw, digest = render_compose(files, inputs, lambda: None, inputs['inputIdentitySha256'])
        self.assertEqual(raw, b'{"services":{}}')
        self.assertEqual(len(digest), 64)
        self.assertEqual(observed['argv'], ['/private/docker', '--host', 'unix:///private/daemon',
            'compose', '-p', 'aoa-m1-boot', '--env-file', '/private/env',
            '-f', '/private/base.yml', '-f', '/private/overlay.yml', 'config', '--format', 'json'])
        self.assertEqual(observed['kwargs']['stdin'], b'')
        self.assertEqual(observed['kwargs']['environment'], {})
        self.assertEqual(observed['kwargs']['cwd'], '/private/cwd')
        self.assertGreaterEqual(files.checked.count('/private/env'), 2)
        with patch('scripts.m1_gateway.composition.run_private', return_value=dict(
                exitCode=1, stdout=b'secret', stderr=b'secret')):
            with self.assertRaises(RenderUnknown): render_compose(Files(), inputs, lambda: None, inputs['inputIdentitySha256'])
        for output in (dict(exitCode=0, stdout=b'{"x":1,"x":2}', stderr=b''),
                       dict(exitCode=0, stdout=b'\xff', stderr=b''),
                       dict(exitCode=0, stdout=b'{}', stderr=b'private warning'),
                       dict(exitCode=0, stdout=b'x' * 1025, stderr=b'')):
            with self.subTest(output=output['stdout'][:20]), patch(
                    'scripts.m1_gateway.composition.run_private', return_value=output):
                with self.assertRaises(RenderUnknown): render_compose(Files(), inputs, lambda: None, inputs['inputIdentitySha256'])
        class ChangedFiles(Files):
            def verify(self, value): raise AssertionError('pin changed')
        with patch('scripts.m1_gateway.composition.run_private', side_effect=AssertionError('spawned')):
            with self.assertRaises(RenderError): render_compose(ChangedFiles(), inputs, lambda: None, inputs['inputIdentitySha256'])
        class ChangedAtSpawn(Files):
            def verify(self, value):
                super().verify(value)
                if len(self.checked) > 4: raise AssertionError('pin changed after preflight')
        with patch('scripts.m1_gateway.composition.run_private', runner):
            with self.assertRaises(RenderUnknown): render_compose(ChangedAtSpawn(), inputs, lambda: None, inputs['inputIdentitySha256'])
        with patch('scripts.m1_gateway.composition.run_private', side_effect=TimeoutError('private')):
            with self.assertRaises(RenderUnknown) as failure:
                render_compose(Files(), inputs, lambda: None, inputs['inputIdentitySha256'])
            self.assertNotIn('private', str(failure.exception))
        with patch('scripts.m1_gateway.composition.run_private', side_effect=AssertionError('spawned')):
            with self.assertRaises(RenderError): render_compose(Files(), inputs | {'project': 'evil'}, lambda: None, inputs['inputIdentitySha256'])
            changed = inputs | {'envFile': pin('/private/other-env')}
            with self.assertRaises(RenderError): render_compose(Files(), changed, lambda: None, inputs['inputIdentitySha256'])

    def test_keyed_offline_render_uses_only_protected_process_value(self):
        def pin(path):
            return dict(path=path, uid=101, gid=201, mode=0o600, device=1,
                        inode=2, size=3, sha256='a' * 64)
        inputs = dict(schema='m1a-gateway-render-inputs-offline-v1', mode='keyed',
            keyedValue=pin('/private/provider-key'), project='aoa-m1-boot',
            endpoint='unix:///private/daemon', dockerBinary=pin('/private/docker'),
            cwd='/private/cwd', envFile=pin('/private/env'),
            composeFiles=[pin('/private/base.yml'), pin('/private/overlay.yml')],
            timeoutMs=5000, maxStdoutBytes=1024, maxStderrBytes=256)
        inputs['inputIdentitySha256'] = render_inputs_hash(inputs)
        class Files:
            def directory(self, path):
                from contextlib import nullcontext
                return nullcontext()
            def verify(self, pin): pass
            def read(self, pin, maximum):
                self.asserted_path = pin['path']
                return b'synthetic-fixture-key'
        seen = {}
        def runner(argv, **kwargs):
            seen['environment'] = kwargs['environment']
            kwargs['before_spawn']()
            return dict(exitCode=0, stdout=b'{}', stderr=b'')
        files = Files()
        with patch('scripts.m1_gateway.composition.run_private', runner):
            render_compose(files, inputs, lambda: None, inputs['inputIdentitySha256'])
        self.assertEqual(files.asserted_path, '/private/provider-key')
        self.assertEqual(seen['environment'], {'E2B_API_KEY': 'synthetic-fixture-key'})
        with patch('scripts.m1_gateway.composition.run_private', side_effect=AssertionError('spawned')):
            with self.assertRaises(RenderError):
                render_compose(files, inputs | {'mode': 'keyless'}, lambda: None, inputs['inputIdentitySha256'])
            changed = inputs | {'keyedValue': inputs['keyedValue'] | {'sha256': 'b' * 64}}
            changed['inputIdentitySha256'] = render_inputs_hash(changed)
            with self.assertRaises(RenderError):
                render_compose(files, changed, lambda: None, inputs['inputIdentitySha256'])
        from scripts.m1_gateway import composition
        seen_spawn = {}
        def observe_spawn(argv, **kwargs):
            seen_spawn['environment'] = kwargs['env']
            raise RuntimeError('no actual Docker in tests')
        argv = ['/private/docker', '--host', 'unix:///private/daemon', 'compose',
                '-p', 'aoa-m1-boot', '--env-file', '/private/env', '-f', '/private/base.yml',
                '-f', '/private/overlay.yml', 'config', '--format', 'json']
        with patch.object(composition.subprocess, 'Popen', observe_spawn):
            with self.assertRaises(composition.CompositionError):
                composition.run_private(argv, cwd='/private/cwd', stdin=b'',
                    timeout_ms=5000, maximum=128, environment={'E2B_API_KEY': 'synthetic-fixture-key'})
        self.assertEqual(seen_spawn['environment'], {'E2B_API_KEY': 'synthetic-fixture-key'})
        self.assertNotIn('DOCKER_HOST', seen_spawn['environment'])
        with patch.object(composition.subprocess, 'Popen', side_effect=AssertionError('spawned')):
            with self.assertRaises(composition.CompositionError):
                composition.run_private(['/bin/echo', 'secret'], cwd='/private/cwd', stdin=b'',
                    timeout_ms=5000, maximum=128, environment={'E2B_API_KEY': 'synthetic-fixture-key'})

    def test_closed_declarative_profile_shape(self):
        self.assertEqual(profile()['profileSha256'],
                         '031070302664aedf226a4c135827e92d5fc46b835dc114fb5af05cef750ed699')
        self.assertEqual(parse_render_profile_shape(profile()),
                         SERVICES)
        cases = []
        for key in ('schema', 'classification', 'controllerSha', 'candidate',
                    'session', 'candidateUid', 'authorityFingerprint',
                    'composeSha256', 'project', 'services'):
            value = profile()
            del value[key]
            cases.append(value)
        value = profile(); value['services'][0]['containers'] = ['e' * 64]; cases.append(value)
        value = profile(); value['services'][1]['dependencies'] = ['missing']; cases.append(value)
        value = profile(); value['services'][0]['dependencies'] = ['adapter-manager']; cases.append(value)
        value = profile(); value['services'][1]['dependencies'] = ['migrate', 'migrate']; cases.append(value)
        value = profile(); value['services'][6]['dependencies'] = ['control-plane']; cases.append(value)
        value = profile(); value['services'][0], value['services'][1] = value['services'][1], value['services'][0]; cases.append(value)
        value = profile(); value['extra'] = 'candidate-control'; cases.append(value)
        value = profile(); value['classification'] = 'PRODUCTION'; cases.append(value)
        value = profile(); value['services'][1]['dependencies'] = []; cases.append(value)
        value = profile(); value['profileSha256'] = '0' * 64; cases.append(value)
        for candidate in cases:
            with self.subTest(candidate=candidate), self.assertRaises(RenderError):
                parse_render_profile_shape(candidate)

    def test_exact_sorted_profile_membership(self):
        protected = SERVICES
        require_render_services(protected, protected)
        for supplied in (protected[1:],
                         [*protected[:2], 'extra', *protected[2:]],
                         [*reversed(protected)],
                         [protected[0], protected[0], *protected[2:]]):
            with self.subTest(supplied=supplied), self.assertRaises(RenderError):
                require_render_services(protected, supplied)

    def test_untrusted_profile_shape_refuses(self):
        for protected in ([], ['migrate', 'adapter-manager'],
                          ['adapter-manager', 'adapter-manager'], ['bad/name'],
                          ['adapter-manager'] * 33):
            with self.subTest(protected=protected), self.assertRaises(RenderError):
                require_render_services(protected, ['adapter-manager'])


if __name__ == '__main__':
    unittest.main()
