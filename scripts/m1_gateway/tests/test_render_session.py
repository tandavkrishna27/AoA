import hashlib
from pathlib import Path
import socket
import sys
import tempfile
import threading
import unittest

from scripts.m1_gateway.protocol import (MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES,
                                         deadline, decode_response, encode,
                                         receive_response_frame, send_frame)
from scripts.m1_gateway.render import render_profile_hash
from scripts.m1_gateway.render_journal import RenderJournal
from scripts.m1_gateway.render_session import OfflineRenderSession
from scripts.m1_gateway.server import serve_accepted_connection


def profile():
    value = dict(schema='m1a-gateway-render-profile-offline-v1',
                 classification='OFFLINE_TEST_ONLY', controllerSha='a' * 40,
                 candidate='b' * 40, session='session1', candidateUid=102,
                 authorityFingerprint='c' * 64, composeSha256='d' * 64,
                 inputIdentitySha256='e' * 64, project='aoa-m1-boot',
                 services=[dict(name='adapter-manager', dependencies=[])])
    value['profileSha256'] = render_profile_hash(value)
    return value


def request(operation='render1'):
    return dict(version=1, session='session1', operationId=operation,
                operation='inspect', services=['adapter-manager'],
                arguments={'projection': 'render'})


def verdict(raw, protected):
    return dict(schema='m1a-gateway-render-verdict-offline-v1', offlineOnly=True,
                renderSha256=hashlib.sha256(raw).hexdigest(),
                profileSha256=protected['profileSha256'], services=['adapter-manager'],
                scopedPass=True, dispatchDefaultRed=True, scopedCount=0,
                dispatchDefaultCount=1, code='OFFLINE_RENDER_CHECK_PASS')


class OfflineRenderSnapshotTests(unittest.TestCase):
    def test_validated_profile_is_not_exposed_as_mutable_session_state(self):
        journal = object.__new__(RenderJournal)
        journal.expected_services = ['adapter-manager']
        session = OfflineRenderSession(profile(), journal, lambda _: b'{}', lambda *_: {})
        self.assertFalse(hasattr(session, 'profile'))
        self.assertFalse(hasattr(session, 'names'))


@unittest.skipUnless(sys.platform == 'linux', 'requires Linux journal fsync and ownership')
class OfflineRenderSessionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path.home())
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'render-journal'
        self.root.mkdir(mode=0o700)
        self.journal = RenderJournal(str(self.root), ['adapter-manager'])
        self.calls = []

        def capture(_):
            self.calls.append('capture')
            return b'{"services":{"adapter-manager":{"secret":"SECRET_CANARY"}}}'

        def verify(raw, protected):
            self.calls.append('verify')
            return verdict(raw, protected)

        self.capture, self.verify = capture, verify
        self.session = OfflineRenderSession(profile(), self.journal, capture, verify)

    def test_fresh_result_commits_metadata_and_replay_never_recaptures(self):
        first = self.session.execute(request())
        self.assertEqual(first['state'], 'observed-success')
        self.assertEqual(first['result']['renderAvailable'], True)
        self.assertEqual(self.calls, ['capture', 'verify'])
        self.assertNotIn('SECRET_CANARY', str(first))
        for path in (self.root / 'session1').iterdir():
            self.assertNotIn(b'SECRET_CANARY', path.read_bytes())
        reopened = OfflineRenderSession(
            profile(), RenderJournal(str(self.root), ['adapter-manager']),
            lambda _: self.fail('capture replayed'), lambda *_: self.fail('verify replayed'))
        replay = reopened.execute(request())
        self.assertEqual(replay['result']['renderSha256'], first['result']['renderSha256'])
        self.assertEqual(replay['result']['renderAvailable'], False)
        self.assertEqual(self.calls, ['capture', 'verify'])

    def test_capture_or_verifier_failure_after_dispatch_is_unknown_without_retry(self):
        for failure in ('capture', 'verify'):
            with self.subTest(failure=failure):
                operation = 'render' + failure
                def capture(_):
                    if failure == 'capture':
                        raise RuntimeError('SECRET_CANARY')
                    return b'{}'
                def verify(raw, protected):
                    if failure == 'verify':
                        raise RuntimeError('SECRET_CANARY')
                    return verdict(raw, protected)
                session = OfflineRenderSession(profile(), self.journal, capture, verify)
                outcome = session.execute(request(operation))
                self.assertEqual(outcome['state'], 'outcome-unknown')
                self.assertNotIn('SECRET_CANARY', str(outcome))
                self.assertEqual(session.execute(request(operation))['state'], 'outcome-unknown')

    def test_changed_identity_or_request_refuses_before_capture(self):
        self.session.execute(request())
        changed = request() | {'services': ['control-plane']}
        with self.assertRaises(ValueError):
            self.session.execute(changed)
        changed = request() | {'operation': 'logs', 'arguments': {'limitBytes': 1}}
        with self.assertRaises(ValueError):
            self.session.execute(changed)
        self.assertEqual(self.calls, ['capture', 'verify'])

    def test_external_and_callback_profile_mutation_cannot_change_binding(self):
        external = profile()
        original_input = external['inputIdentitySha256']
        def capture(received):
            received['inputIdentitySha256'] = '0' * 64
            received['services'].clear()
            return b'{}'
        def verify(raw, received):
            self.assertEqual(received['inputIdentitySha256'], original_input)
            self.assertEqual(received['services'][0]['name'], 'adapter-manager')
            return verdict(raw, received)
        session = OfflineRenderSession(external, self.journal, capture, verify)
        external['inputIdentitySha256'] = 'f' * 64
        external['services'].clear()
        self.assertEqual(session.execute(request())['state'], 'observed-success')
        record = self.journal.lookup('session1', 'render1')
        self.assertEqual(record['inputIdentitySha256'], original_input)

    def test_authenticated_unix_transport_replays_metadata_after_lost_reply(self):
        def send_once(disconnect=False):
            client, server = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
            committed = threading.Event()
            release = threading.Event()
            def handler(_uid, value):
                response = self.session.execute(value)
                if disconnect:
                    committed.set()
                    release.wait()
                return response
            def serve():
                try:
                    serve_accepted_connection(server, lambda _uid: 'session1', handler)
                finally:
                    server.close()
            worker = threading.Thread(target=serve, daemon=True)
            worker.start()
            try:
                send_frame(client, encode(request(), MAX_REQUEST_BYTES),
                           MAX_REQUEST_BYTES, deadline())
                if disconnect:
                    self.assertTrue(committed.wait(timeout=5))
                    client.close()
                    release.set()
                    return None
                return decode_response(receive_response_frame(client, MAX_RESPONSE_BYTES, 5000))
            finally:
                release.set()
                client.close()
                worker.join(timeout=5)
                self.assertFalse(worker.is_alive())

        self.assertIsNone(send_once(disconnect=True))
        record = self.journal.lookup('session1', 'render1')
        self.assertEqual(record['state'], 'observed-success')
        replay = send_once()
        self.assertEqual(replay['state'], 'observed-success')
        self.assertEqual(replay['result'], record['result'] | {'renderAvailable': False})
        self.assertNotIn(b'SECRET_CANARY', encode(replay, MAX_RESPONSE_BYTES))
        for path in (self.root / 'session1').iterdir():
            self.assertNotIn(b'SECRET_CANARY', path.read_bytes())
        self.assertEqual(self.calls, ['capture', 'verify'])


if __name__ == '__main__':
    unittest.main()
