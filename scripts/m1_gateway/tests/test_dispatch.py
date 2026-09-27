import base64
import copy
from contextlib import contextmanager
import hashlib
import json
import os
import stat
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts.m1_gateway.dispatch import Dispatcher, DispatchError, profile_hash

from scripts.m1_gateway.journal import Journal, _transition, JournalError

DIGEST = 'sha256:' + 'a' * 64
CID = '1' * 64


def profile():
    value = dict(schema='m1a-gateway-profile-v1', classification='PRODUCTION',
                 controllerSha='b' * 40, candidate='c' * 40, session='session1',
                 authorityFingerprint='d' * 64, candidateUid=1234,
                 dockerBinary='/protected/bin/docker', endpoint='unix:///protected/docker.sock',
                 composePath='/protected/compose.json', composeSha256='e' * 64,
                 project='campaign1', timeoutMs=1000, cleanupExpiresAt=300,
                 provider=None, services=[dict(name='worker', dependencies=[],
                 image=dict(service='worker', kind='docker-config-id', digest=DIGEST,
                            configId=DIGEST, relationship=None), containers=[CID],
                 mounts=[], devices=[], privileged=False, hostNamespaces=False,
                 restartPolicy='no')], payloads=[dict(id='probe', service='worker',
                 argv=['/usr/bin/node', '-'], maxStdinBytes=32768)],
                 validatedRelationships=[])
    value['profileSha256'] = profile_hash(value)
    return value


def request(op='start', args=None, id='op1', services=None):
    return dict(version=1, session='session1', operationId=id, operation=op,
                services=services or ['worker'], arguments=args or {})


class MemoryJournal:
    """Algorithm fixture only; never deployment/durability evidence."""
    def __init__(self):
        self.records = {}
        self.held = False

    @contextmanager
    def session_lock(self, session):
        self.held = True
        try:
            yield
        finally:
            self.held = False

    def recover(self):
        assert self.held
        return copy.deepcopy(list(self.records.values()))

    def session_records(self, session):
        assert self.held
        return copy.deepcopy([r for r in self.records.values() if r['session'] == session])

    def accept(self, session, id, request_hash):
        assert self.held
        if id in self.records:
            if self.records[id]['requestHash'] != request_hash:
                raise JournalError()
        else:
            self.records[id] = dict(schema=1, session=session, operationId=id,
                requestHash=request_hash, state='accepted', exitCode=None, result={})
        return copy.deepcopy(self.records[id])

    def transition(self, session, id, state, result):
        assert self.held
        self.records[id] = _transition(self.records[id], state, result)
        return copy.deepcopy(self.records[id])


class DispatchTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(Dispatcher, 'Task3 dispatcher is missing')
        self.p = profile()
        self.journal = MemoryJournal()
        self.calls = []
        self.clock = 150
        self.inspection = self.observation()

    def observation(self):
        return dict(endpoint=self.p['endpoint'], composeSha256=self.p['composeSha256'],
                    services=[dict(name='worker', image=copy.deepcopy(self.p['services'][0]['image']),
                        containers=[dict(id=CID, imageConfigId=DIGEST, session='session1',
                        project='campaign1', service='worker', mounts=[], devices=[],
                        privileged=False, hostNamespaces=False, restartPolicy='no')])])

    def authority(self, *, now, cleanup):
        assert self.journal.held
        if not cleanup and now >= 200:
            raise ValueError('expired')
        return dict(policy=dict(schema='m1a-gateway-policy-v1', classification='PRODUCTION',
            controllerSha=self.p['controllerSha'], candidate=self.p['candidate'], session='session1',
            profileSha256=self.p['profileSha256'], authorityFingerprint=self.p['authorityFingerprint'],
            notBefore=100, expiresAt=200, images=[copy.deepcopy(self.p['services'][0]['image'])], provider=None),
            policySha256='f' * 64, signatureSha256='0' * 64, verifiedAt=now,
            revocationCheckedAt=now, revocationValidUntil=now + 1)

    def inspector(self, p):
        assert self.journal.held
        return copy.deepcopy(self.inspection)

    def runner(self, invocation):
        assert self.journal.held
        assert self.journal.records[invocation['operationId']]['state'] == 'dispatching'
        self.calls.append(invocation)
        if invocation['argv'][3] == 'exec':
            return dict(exitCode=0, stdout=b'', stderr=b'')
        return dict(exitCode=0)

    def execute(self, req=None, **deps):
        instance = Dispatcher(self.p, deps.get('authority_check', self.authority),
            deps.get('inspector', self.inspector), deps.get('runner', self.runner), self.journal)
        with patch('scripts.m1_gateway.dispatch.time.time', side_effect=lambda: self.clock):
            return instance.execute(1234, req or request())

    def test_fixed_environment_and_arguments_no_candidate_docker_host(self):
        with patch.dict(os.environ, {'DOCKER_HOST': 'tcp://evil', 'DOCKER_CONTEXT': 'evil', 'PATH': 'evil'}):
            result = self.execute()
        self.assertEqual(result['state'], 'observed-success')
        call = self.calls[0]
        self.assertEqual(call['env'], {})
        self.assertEqual(call['argv'], ['/protected/bin/docker', '--host', self.p['endpoint'], 'start', CID])
        self.assertNotIn('stdin', self.journal.records['op1']['result'])

    def test_closed_profile_rejects_test_keyed_mounts_privileges_and_restart(self):
        for mutation in ('TEST', 'provider', 'mounts', 'devices', 'privileged', 'hostNamespaces', 'restartPolicy'):
            p = profile()
            if mutation == 'TEST': p['classification'] = 'TEST'
            elif mutation == 'provider': p['provider'] = {'kind': 'e2b'}
            else: p['services'][0][mutation] = {'mounts': ['/host'], 'devices': ['/dev/x'], 'privileged': True, 'hostNamespaces': True, 'restartPolicy': 'always'}[mutation]
            p['profileSha256'] = profile_hash(p)
            with self.subTest(mutation=mutation), self.assertRaises(DispatchError):
                Dispatcher(p, self.authority, self.inspector, self.runner, self.journal)

    def test_partial_inventory_endpoint_image_and_container_substitution_refuse(self):
        observations = [self.observation() for _ in range(7)]
        observations[0]['endpoint'] = 'unix:///other.sock'
        observations[1]['services'] = []
        observations[2]['services'][0]['image']['kind'] = 'oci-manifest'
        observations[3]['services'][0]['containers'][0]['id'] = '2' * 64
        observations[4]['services'][0]['containers'][0]['imageConfigId'] = 'sha256:' + '2' * 64
        observations[5]['services'][0]['containers'][0]['session'] = 'other'
        observations[6]['services'][0]['containers'].append(copy.deepcopy(observations[6]['services'][0]['containers'][0]))
        for observation in observations:
            self.inspection = observation
            self.assertEqual(self.execute()['state'], 'refused')
        self.assertEqual(self.calls, [])

    def test_dependency_closure_and_keyless_adapter_manager_refuse(self):
        self.p['services'][0]['dependencies'] = ['missing']
        self.p['profileSha256'] = profile_hash(self.p)
        with self.assertRaises(DispatchError): self.execute()
        self.p = profile()
        self.p['services'][0]['name'] = 'adapter-manager'
        self.p['services'][0]['image']['service'] = 'adapter-manager'
        self.p['payloads'] = []
        self.p['profileSha256'] = profile_hash(self.p)
        with self.assertRaises(DispatchError): self.execute()

    def test_unknown_payload_and_request_paths_never_enter_effect(self):
        for req in [request('exec', dict(payloadId='unknown', stdinBase64='')), request() | {'argv': ['pull']}, request(services=['unknown']), request('apply-rollout', dict(enabled=[], control='00000000-0000-0000-0000-000000000001')), request('run', dict(payloadId='probe', stdinBase64='')), request('create'), request('up'), request('inspect', dict(projection='topology')), request('inspect', dict(projection='rollout'))]:
            self.assertEqual(self.execute(req)['state'], 'refused')
        self.assertEqual(self.calls, [])

    def test_clock_after_inspection_and_unavailable_revocation_refuse(self):
        def wait(p):
            self.clock = 200
            return self.inspector(p)
        self.assertEqual(self.execute(inspector=wait)['state'], 'refused')
        self.clock = 150
        def unavailable(**kwargs): raise ValueError('revocation unavailable')
        self.assertEqual(self.execute(authority_check=unavailable)['state'], 'refused')
        self.assertEqual(self.calls, [])

    def test_complete_authority_binding_rechecked_even_if_callback_returns_cached_verdict(self):
        for field in ('candidate', 'controllerSha', 'session', 'profileSha256', 'authorityFingerprint', 'images', 'classification'):
            def wrong(**kwargs):
                verdict = self.authority(**kwargs)
                verdict['policy'][field] = [] if field == 'images' else 'wrong'
                return verdict
            self.assertEqual(self.execute(authority_check=wrong)['state'], 'refused')
        self.clock = 200
        with self.journal.session_lock('session1'):
            verdict = self.authority(now=150, cleanup=False)
        self.assertEqual(self.execute(authority_check=lambda **kwargs: verdict)['state'], 'refused')
        self.assertEqual(self.calls, [])

    def test_exec_payload_only_stdin_in_admitted_container(self):
        req = request('exec', dict(payloadId='probe', stdinBase64='YWJj'))
        self.assertEqual(self.execute(req)['state'], 'observed-success')
        self.assertEqual(self.calls[0]['stdin'], b'abc')
        self.assertEqual(self.calls[0]['argv'][-4:], ['-i', CID, '/usr/bin/node', '-'])
        self.assertNotIn('YWJj', json.dumps(self.journal.records))

    def test_exception_after_effect_is_unknown_and_replay_never_retries(self):
        def uncertain(invocation):
            self.runner(invocation)
            raise TimeoutError('private output')
        result = self.execute(runner=uncertain)
        self.assertEqual(result['state'], 'outcome-unknown')
        self.assertIsNone(result['exitCode'])
        self.assertEqual(self.execute()['state'], 'outcome-unknown')
        self.assertEqual(self.execute(request(id='op2'))['state'], 'refused')
        self.assertEqual(len(self.calls), 1)
        self.assertNotIn('private output', json.dumps(result))

    def test_completed_replay_and_changed_body_collision(self):
        first = self.execute()
        self.assertEqual(self.execute(), first)
        self.assertEqual(self.execute(request('restart'))['state'], 'refused')
        self.assertEqual(len(self.calls), 1)

    def test_completed_replay_refresh_failure_cannot_ack_completion(self):
        self.assertEqual(self.execute()['state'], 'observed-success')
        def unavailable(*args):
            raise JournalError()
        self.journal.accept = unavailable
        self.assertEqual(self.execute()['state'], 'refused')
        self.assertEqual(len(self.calls), 1)

    def test_clock_regression_across_journal_persistence_never_enters_runner(self):
        for first_return_time in (150, 151):
            with self.subTest(first_return_time=first_return_time):
                self.journal = MemoryJournal()
                self.clock = 150
                original = self.journal.transition
                def persist(session, id, state, result):
                    record = original(session, id, state, result)
                    if state == 'dispatching':
                        self.clock = first_return_time - 1
                    return record
                self.journal.transition = persist
                def authority(**kwargs):
                    verdict = self.authority(**kwargs)
                    verdict['revocationValidUntil'] = 190
                    if self.journal.records == {}:
                        self.clock = first_return_time
                    return verdict
                result = self.execute(authority_check=authority)
                self.assertEqual(result['state'], 'observed-failure')
                self.assertEqual(result['exitCode'], 1)
                self.assertEqual(self.execute()['state'], 'observed-failure')
                self.assertEqual(self.calls, [])

    def test_cleanup_requires_durable_exact_owned_resources_and_separate_expiry(self):
        self.assertEqual(self.execute(request('remove'))['state'], 'refused')
        # Seed only durable gateway creation observations, never request/profile claims.
        self.journal.records['created'] = dict(schema=1, session='session1', operationId='created', requestHash='a'*64, state='observed-success', exitCode=0, result=dict(exitCode=0, resourceIDs=[CID]))
        self.clock = 250
        self.assertEqual(self.execute(request('remove', id='cleanup'))['state'], 'observed-success')
        self.assertEqual(self.calls[0]['argv'][-3:], ['rm', '--force', CID])
        self.clock = 300
        self.assertEqual(self.execute(request('remove', id='late'))['state'], 'refused')

    def test_missing_dependency_and_invalid_runner_status_are_closed(self):
        with self.assertRaises(DispatchError): Dispatcher(self.p, None, self.inspector, self.runner, self.journal)
        result = self.execute(runner=lambda _: {'exitCode': True})
        self.assertEqual(result['state'], 'outcome-unknown')

    def test_fresh_admission_after_journal_wait_and_slow_authority_check(self):
        original = self.journal.transition
        def wait(session, id, state, result):
            record = original(session, id, state, result)
            if state == 'dispatching': self.clock = 200
            return record
        self.journal.transition = wait
        result = self.execute()
        self.assertEqual(result['state'], 'observed-failure')
        self.assertEqual(self.calls, [])
        self.journal = MemoryJournal()
        self.clock = 150
        def slow(**kwargs):
            verdict = self.authority(**kwargs)
            self.clock = 200
            return verdict
        self.assertEqual(self.execute(authority_check=slow)['state'], 'refused')
        self.assertEqual(self.calls, [])

    def test_logs_are_private_bounded_bytes_not_journal_metadata(self):
        result = self.execute(request('logs', dict(limitBytes=4)), runner=lambda _: dict(exitCode=0, stdout=b'abcd', stderr=b''))
        self.assertEqual(result['state'], 'observed-success')
        self.assertEqual(result['result']['streams'], dict(available=True, complete=True,
                         stdoutBase64='YWJjZA==', stderrBase64=''))
        self.assertNotIn('streams', self.journal.records['op1']['result'])
        self.journal = MemoryJournal()
        result = self.execute(request('logs', dict(limitBytes=4)), runner=lambda _: dict(exitCode=0, stdout=b'abcde', stderr=b''))
        self.assertEqual(result['state'], 'outcome-unknown')

    def test_logs_do_not_silently_select_a_partial_window(self):
        def logs(invocation):
            self.calls.append(invocation)
            return dict(exitCode=0, stdout=b'', stderr=b'')
        self.assertEqual(self.execute(request('logs', dict(limitBytes=4)), runner=logs)['state'], 'observed-success')
        self.assertEqual(self.calls[0]['argv'], [self.p['dockerBinary'], '--host', self.p['endpoint'], 'logs', CID])

    def test_cleanup_can_continue_during_session_unknown_but_outsider_cannot(self):
        self.journal.records['created'] = dict(schema=1, session='session1', operationId='created', requestHash='a'*64, state='outcome-unknown', exitCode=None, result=dict(exitCode=None, resourceIDs=[CID], cleanupUncertainty=True))
        self.assertEqual(self.execute()['state'], 'refused')
        self.assertEqual(self.execute(request('stop', id='cleanup'))['state'], 'observed-success')
        dispatcher = Dispatcher(self.p, self.authority, self.inspector, self.runner, self.journal)
        self.assertEqual(dispatcher.execute(9999, request('remove', id='outsider'))['state'], 'refused')

    def test_terminal_storage_failure_reports_unknown_not_no_effect_refusal(self):
        original = self.journal.transition
        def fail_terminal(session, id, state, result):
            if state in ('observed-success', 'observed-failure', 'outcome-unknown'):
                raise JournalError()
            return original(session, id, state, result)
        self.journal.transition = fail_terminal
        result = self.execute()
        self.assertEqual(result['state'], 'outcome-unknown')
        self.assertEqual(self.journal.records['op1']['state'], 'dispatching')
        self.assertEqual(self.execute(request(id='op2'))['state'], 'refused')
        self.assertEqual(len(self.calls), 1)

    def test_revocation_expiring_during_verifier_wait_refuses(self):
        def delayed(**kwargs):
            verdict = self.authority(**kwargs)
            verdict.update(verifiedAt=kwargs['now'], revocationCheckedAt=kwargs['now'], revocationValidUntil=kwargs['now'] + 1)
            self.clock += 1
            return verdict
        self.assertEqual(self.execute(authority_check=delayed)['state'], 'refused')
        self.assertEqual(self.calls, [])

    def test_oversized_private_response_refuses_before_effect_and_inspect_is_unimplemented(self):
        self.assertEqual(self.execute(request('logs', dict(limitBytes=1048576)))['state'], 'refused')
        self.assertEqual(self.execute(request('inspect', dict(projection='binding')))['state'], 'refused')
        self.assertEqual(self.calls, [])

    def test_profile_cannot_be_changed_after_initial_admission(self):
        dispatcher = Dispatcher(self.p, self.authority, self.inspector, self.runner, self.journal)
        dispatcher.profile['endpoint'] = 'unix:///other.sock'
        self.inspection['endpoint'] = 'unix:///other.sock'
        with patch('scripts.m1_gateway.dispatch.time.time', return_value=150):
            self.assertEqual(dispatcher.execute(1234, request())['state'], 'refused')
        self.assertEqual(self.calls, [])

    def test_no_outsider_session_lookup_or_cleanup_authority(self):
        self.journal.records['outsider'] = dict(schema=1, session='other', operationId='outsider', requestHash='a'*64, state='outcome-unknown', exitCode=None, result=dict(exitCode=None, resourceIDs=[CID]))
        self.assertEqual(self.execute()['state'], 'observed-success')
        self.assertEqual(self.execute(request('remove', id='cleanup'))['state'], 'refused')
        self.assertEqual(len(self.calls), 1)

    def stream_request(self, op='exec', id='op1', limit=65536):
        return request(op, dict(payloadId='probe', stdinBase64='') if op == 'exec'
                       else dict(limitBytes=limit), id=id)

    def assert_unavailable(self, response):
        self.assertEqual(response['result']['streams'], dict(available=False,
                         complete=False, stdoutBase64=None, stderrBase64=None))

    def test_private_stream_capture_empty_binary_nonzero_and_replay(self):
        for op in ('exec', 'logs'):
            for code, stdout, stderr in ((0, b'', b''), (7, b'\x00\xff', b'private-error')):
                with self.subTest(op=op, code=code):
                    self.journal = MemoryJournal()
                    self.calls = []
                    def capture(invocation):
                        self.calls.append(invocation)
                        return dict(exitCode=code, stdout=stdout, stderr=stderr)
                    req = self.stream_request(op)
                    result = self.execute(req, runner=capture)
                    self.assertEqual(result['state'], 'observed-success' if code == 0 else 'observed-failure')
                    self.assertEqual(result['exitCode'], code)
                    self.assertEqual(result['result']['streams'], dict(available=True,
                        complete=True, stdoutBase64=base64.b64encode(stdout).decode('ascii'),
                        stderrBase64=base64.b64encode(stderr).decode('ascii')))
                    self.assertEqual(self.journal.records['op1']['result'], dict(exitCode=code))
                    self.assert_unavailable(self.execute(req, runner=capture))
                    self.assertEqual(len(self.calls), 1)

    def test_combined_stream_limit_and_logs_smaller_limit(self):
        for op, limit, size in (('exec', 65536, 65536), ('logs', 100000, 65536),
                               ('logs', 4, 4)):
            with self.subTest(op=op, limit=limit):
                self.journal = MemoryJournal()
                result = self.execute(self.stream_request(op, limit=limit),
                    runner=lambda invocation: dict(exitCode=0, stdout=b'a' * (size - 1), stderr=b'b'))
                self.assertEqual(result['state'], 'observed-success')
                self.journal = MemoryJournal()
                result = self.execute(self.stream_request(op, limit=limit),
                    runner=lambda invocation: dict(exitCode=0, stdout=b'a' * size, stderr=b'b'))
                self.assertEqual(result['state'], 'outcome-unknown')
                self.assert_unavailable(result)

    def test_malformed_streams_unknown_freeze_and_no_retry(self):
        outputs = [dict(exitCode=0), dict(exitCode=0, stdout=b''),
                   dict(exitCode=0, stdout='', stderr=b''),
                   dict(exitCode=0, stdout=b'', stderr=bytearray()),
                   dict(exitCode=0, stdout=b'', stderr=b'', extra=b'secret'),
                   dict(exitCode=True, stdout=b'', stderr=b'')]
        for op in ('exec', 'logs'):
            for output in outputs:
                with self.subTest(op=op, keys=list(output)):
                    self.journal = MemoryJournal()
                    self.calls = []
                    def malformed(invocation):
                        self.calls.append(invocation)
                        return output
                    req = self.stream_request(op)
                    result = self.execute(req, runner=malformed)
                    self.assertEqual(result['state'], 'outcome-unknown')
                    self.assert_unavailable(result)
                    self.assert_unavailable(self.execute(req, runner=malformed))
                    self.assertEqual(self.execute(request(id='op2'))['state'], 'refused')
                    self.assertEqual(len(self.calls), 1)
                    self.assertNotIn('streams', self.journal.records['op1']['result'])

    def test_capture_not_returned_on_terminal_durability_failure(self):
        original = self.journal.transition
        def fail(session, id, state, result):
            if state == 'observed-success':
                self.assertEqual(result, dict(exitCode=0))
                raise JournalError()
            return original(session, id, state, result)
        self.journal.transition = fail
        result = self.execute(self.stream_request(),
            runner=lambda _: dict(exitCode=0, stdout=b'private-capture', stderr=b'private-error'))
        self.assertEqual(result['state'], 'outcome-unknown')
        self.assert_unavailable(result)
        self.assertNotIn('private', json.dumps(result))
        self.assertEqual(self.journal.records['op1']['state'], 'dispatching')

    def test_stream_timeout_and_interrupted_replays_are_unavailable(self):
        req = self.stream_request()
        def timeout(invocation):
            self.calls.append(invocation)
            raise TimeoutError('private-capture')
        result = self.execute(req, runner=timeout)
        self.assertEqual(result['state'], 'outcome-unknown')
        self.assert_unavailable(result)
        self.assert_unavailable(self.execute(req, runner=timeout))
        self.assertEqual(len(self.calls), 1)
        for state in ('accepted', 'dispatching'):
            with self.subTest(state=state):
                self.journal = MemoryJournal()
                digest = hashlib.sha256(json.dumps(req, sort_keys=True, ensure_ascii=True,
                    separators=(',', ':')).encode('ascii')).hexdigest()
                with self.journal.session_lock('session1'):
                    self.journal.accept('session1', 'op1', digest)
                    if state == 'dispatching':
                        self.journal.transition('session1', 'op1', state, {})
                replay = self.execute(req, runner=timeout)
                self.assertEqual(replay['state'], 'accepted' if state == 'accepted' else 'outcome-unknown')
                self.assert_unavailable(replay)
                self.assertEqual(len(self.calls), 1)


@unittest.skipUnless(sys.platform == 'linux', 'real journal dispatch requires actual Linux filesystem')
class LinuxDispatchTests(unittest.TestCase):
    observation = DispatchTests.observation
    execute = DispatchTests.execute
    def setUp(self):
        DispatchTests.setUp(self)
        # /tmp is intentionally unsafe under journal ancestry rules.
        self.temp = tempfile.TemporaryDirectory(dir=str(Path.home()))
        self.addCleanup(self.temp.cleanup)
        os.chmod(self.temp.name, 0o700)
        self.journal = Journal(self.temp.name)

    def authority(self, **kwargs):
        assert 'session1' in self.journal._held
        old = self.journal
        self.journal = type('Held', (), {'held': True})()
        try: return DispatchTests.authority(self, **kwargs)
        finally: self.journal = old

    def inspector(self, p):
        assert 'session1' in self.journal._held
        return copy.deepcopy(self.inspection)

    def runner(self, invocation):
        assert 'session1' in self.journal._held
        assert self.journal.lookup('session1', invocation['operationId'])['state'] == 'dispatching'
        self.calls.append(invocation)
        if invocation['argv'][3] == 'exec':
            return dict(exitCode=0, stdout=b'', stderr=b'')
        return dict(exitCode=0)

    # Fixture-only record access tests belong to the portable class.
    def test_fixed_environment_and_arguments_no_candidate_docker_host(self):
        self.assertEqual(self.execute()['state'], 'observed-success')
        self.assertEqual(self.calls[0]['env'], {})
        self.assertEqual(self.journal.lookup('session1', 'op1')['exitCode'], 0)

    def test_exec_payload_only_stdin_in_admitted_container(self):
        self.assertEqual(self.execute(request('exec', dict(payloadId='probe', stdinBase64='YWJj')))['state'], 'observed-success')
        self.assertNotIn('YWJj', json.dumps(self.journal.lookup('session1', 'op1')))

    def test_cleanup_requires_durable_exact_owned_resources_and_separate_expiry(self):
        with self.journal.session_lock('session1'):
            self.journal.accept('session1', 'created', 'a' * 64)
            self.journal.transition('session1', 'created', 'dispatching', {})
            self.journal.transition('session1', 'created', 'observed-success', dict(exitCode=0, resourceIDs=[CID]))
        self.clock = 250
        self.assertEqual(self.execute(request('remove', id='cleanup'))['state'], 'observed-success')

    def test_real_journal_unknown_replay_never_reenters_runner(self):
        def uncertain(invocation):
            self.runner(invocation)
            raise TimeoutError()
        self.assertEqual(self.execute(runner=uncertain)['state'], 'outcome-unknown')
        self.assertEqual(self.execute()['state'], 'outcome-unknown')
        self.assertEqual(self.execute(request(id='op2'))['state'], 'refused')
        self.assertEqual(len(self.calls), 1)

    def test_terminal_directory_fsync_failure_reopen_replay_requires_refresh(self):
        real_fsync = os.fsync
        req = DispatchTests.stream_request(self)
        def capture(invocation):
            self.calls.append(invocation)
            return dict(exitCode=0, stdout=b'private-capture', stderr=b'private-error')
        terminal = Path(self.temp.name) / 'session1' / 'op1.json'
        failed = []
        def fail_terminal_directory(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode) and terminal.exists():
                if json.loads(terminal.read_bytes())['state'] == 'observed-success':
                    failed.append(True)
                    raise OSError('injected directory fsync failure')
            return real_fsync(fd)
        with patch('scripts.m1_gateway.journal.os.fsync', side_effect=fail_terminal_directory):
            result = self.execute(req, runner=capture)
        self.assertEqual(result['state'], 'outcome-unknown')
        DispatchTests.assert_unavailable(self, result)
        self.assertIsNone(result['exitCode'])
        self.assertEqual(len(failed), 1)
        self.assertEqual(json.loads(terminal.read_bytes())['state'], 'observed-success')

        self.journal = Journal(self.temp.name)
        with patch('scripts.m1_gateway.journal.os.fsync', side_effect=fail_terminal_directory):
            self.assertEqual(self.execute(req, runner=capture)['state'], 'refused')
        self.assertEqual(len(failed), 2)
        self.assertEqual(len(self.calls), 1)

        self.journal = Journal(self.temp.name)
        refreshed = []
        def refresh(fd):
            refreshed.append('directory' if stat.S_ISDIR(os.fstat(fd).st_mode) else 'file')
            return real_fsync(fd)
        with patch('scripts.m1_gateway.journal.os.fsync', side_effect=refresh):
            replay = self.execute(req, runner=capture)
        self.assertEqual(refreshed, ['file', 'file', 'directory'])
        self.assertEqual(replay['state'], 'observed-success')
        self.assertEqual(replay['exitCode'], 0)
        DispatchTests.assert_unavailable(self, replay)
        self.assertEqual(len(self.calls), 1)

    def test_scoped_snapshot_does_not_read_outsider_session_record(self):
        with self.journal.session_lock('other'):
            self.journal.accept('other', 'outsider', 'a' * 64)
        outsider = Path(self.temp.name) / 'other' / 'outsider.json'
        outsider.write_bytes(b'invalid outsider record')
        self.assertEqual(self.execute()['state'], 'observed-success')
        self.assertEqual(outsider.read_bytes(), b'invalid outsider record')

    def test_private_streams_never_persist_and_reopen_replay_is_unavailable(self):
        for op in ('exec', 'logs'):
            req = DispatchTests.stream_request(self, op, id=op)
            def capture(invocation):
                self.calls.append(invocation)
                return dict(exitCode=7, stdout=b'private-stdout', stderr=b'private-stderr')
            result = self.execute(req, runner=capture)
            self.assertEqual(result['state'], 'observed-failure')
            self.assertTrue(result['result']['streams']['available'])
            for path in Path(self.temp.name).rglob('*'):
                if path.is_file():
                    raw = path.read_bytes()
                    self.assertNotIn(b'private-', raw)
                    self.assertNotIn(b'streams', raw)
                    self.assertNotIn(b'cHJpdmF0ZS', raw)
            self.journal = Journal(self.temp.name)
            DispatchTests.assert_unavailable(self, self.execute(req, runner=capture))
        self.assertEqual(len(self.calls), 2)
