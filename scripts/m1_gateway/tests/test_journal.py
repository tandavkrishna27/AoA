import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts.m1_gateway.journal import Journal, JournalError, _validate_record, _transition, _FailureLatch


HASH = 'a' * 64


def accepted():
    return dict(schema=1, session='session1', operationId='op1', requestHash=HASH,
                state='accepted', exitCode=None, result={})


class RecordTests(unittest.TestCase):
    def test_storage_failure_latches_but_validation_refusal_remains_recoverable(self):
        latch = _FailureLatch()
        with self.assertRaises(JournalError):
            with latch.guard():
                _validate_record(accepted() | {'schema': True})
        with latch.guard():
            self.assertEqual(_validate_record(accepted())['state'], 'accepted')
        with self.assertRaises(JournalError) as caught:
            with latch.guard():
                with latch.guard():
                    raise OSError('private storage details')
        self.assertEqual(str(caught.exception), 'journal-refused')
        for _ in range(2):
            entered = False
            with self.assertRaises(JournalError):
                with latch.guard():
                    entered = True
            self.assertFalse(entered)

    def test_closed_resource_metadata_is_preserved_and_validated(self):
        dispatching = _transition(accepted(), 'dispatching', {})
        metadata = dict(exitCode=0, resourceIDs=['container1', 'container2'],
                        configHash='b' * 64, cleanupUncertainty=True)
        record = _transition(dispatching, 'observed-success', metadata)
        self.assertEqual(record['result'], metadata)
        for change in ({'resourceIDs': ['x', 'x']}, {'resourceIDs': ['../escape']},
                       {'resourceIDs': ['x'] * 33}, {'configHash': 'bad'},
                       {'cleanupUncertainty': 'false'}, {'stdin': 'secret'},
                       {'commands': []}, {'stderr': 'secret'}):
            with self.subTest(change=change), self.assertRaises(JournalError):
                _transition(dispatching, 'observed-success', metadata | change)
        unknown = _transition(dispatching, 'outcome-unknown',
                              dict(exitCode=None, resourceIDs=['container1'],
                                   configHash=None, cleanupUncertainty=True))
        self.assertIsNone(unknown['exitCode'])
        self.assertTrue(unknown['result']['cleanupUncertainty'])

    def test_closed_record_rejects_payload_and_invalid_identity(self):
        for change in ({'schema': True}, {'session': '../escape'}, {'operationId': ''},
                       {'requestHash': 'A' * 64}, {'state': 'other'}, {'payload': 'secret'},
                       {'result': {'stdout': 'secret'}}, {'exitCode': 0}):
            with self.subTest(change=change), self.assertRaises(JournalError):
                _validate_record(accepted() | change)
        self.assertEqual(_validate_record(accepted()), accepted())

    def test_transition_requires_dispatch_and_terminal_never_resets(self):
        with self.assertRaises(JournalError):
            _transition(accepted(), 'observed-success', {'exitCode': 0})
        dispatching = _transition(accepted(), 'dispatching', {})
        for state, result in (('observed-success', {'exitCode': 0}),
                              ('observed-failure', {'exitCode': 7}), ('outcome-unknown', {})):
            terminal = _transition(dispatching, state, result)
            self.assertEqual(terminal['state'], state)
            for target in ('accepted', 'dispatching', 'observed-success'):
                with self.assertRaises(JournalError):
                    _transition(terminal, target, {'exitCode': 0})
        self.assertEqual(accepted()['state'], 'accepted')

    def test_terminal_metadata_cannot_store_raw_or_untyped_data(self):
        dispatching = _transition(accepted(), 'dispatching', {})
        for value in ({'exitCode': True}, {'exitCode': 256}, {'exitCode': -1},
                      {'exitCode': 0, 'stdout': 'secret'}, {'exitCode': 0, 'payload': 'x' * 65536},
                      {'exitCode': 1}, {}, {'exitCode': None}):
            with self.subTest(value=str(value)[:80]), self.assertRaises(JournalError):
                _transition(dispatching, 'observed-success', value)
        with self.assertRaises(JournalError):
            _transition(dispatching, 'observed-failure', {'exitCode': 0})

    def test_platform_refusal_has_no_filesystem_effect(self):
        if sys.platform == 'linux':
            self.skipTest('unsupported-platform check runs on the actual unsupported OS')
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(JournalError):
                Journal(root)
            self.assertEqual(os.listdir(root), [])


@unittest.skipUnless(sys.platform == 'linux', 'requires actual Linux POSIX durability and ownership')
class JournalTests(unittest.TestCase):
    def setUp(self):
        # /tmp is world writable and correctly refused by production.
        self.tmp = tempfile.TemporaryDirectory(dir=Path.home())
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'journal'
        self.root.mkdir(mode=0o700)
        self.journal = Journal(str(self.root))

    def test_changed_hash_refuses_and_completed_replay_never_dispatches(self):
        self.journal.accept('session1', 'op1', HASH)
        with self.assertRaises(JournalError):
            self.journal.accept('session1', 'op1', 'b' * 64)
        self.journal.transition('session1', 'op1', 'dispatching', {})
        result = self.journal.transition('session1', 'op1', 'observed-success', {'exitCode': 0})
        replay = self.journal.accept('session1', 'op1', HASH)
        self.assertEqual(replay, result)
        with self.assertRaises(JournalError):
            self.journal.transition('session1', 'op1', 'dispatching', {})
        self.assertEqual(Journal(str(self.root)).lookup('session1', 'op1'), result)

    def test_restart_preserves_unknown_and_accepted_without_retry(self):
        self.journal.accept('session1', 'op1', HASH)
        self.journal.accept('session1', 'op2', HASH)
        self.journal.transition('session1', 'op1', 'dispatching', {})
        restarted = Journal(str(self.root))
        self.assertEqual(restarted.lookup('session1', 'op1')['state'], 'outcome-unknown')
        self.assertEqual(restarted.lookup('session1', 'op2')['state'], 'accepted')
        self.assertEqual(restarted.accept('session1', 'op1', HASH)['state'], 'outcome-unknown')
        with self.assertRaises(JournalError):
            restarted.transition('session1', 'op1', 'dispatching', {})
        self.assertEqual(len(restarted.recover()), 2)

    def test_disconnect_after_effect_preserves_terminal_record(self):
        import socket
        from scripts.m1_gateway.protocol import encode, MAX_REQUEST_BYTES, send_frame, deadline
        from scripts.m1_gateway.server import serve_connection
        server, client = socket.socketpair()
        self.addCleanup(server.close)
        request = dict(version=1, session='session1', operationId='op1', operation='up',
                       services=['api'], arguments={})
        send_frame(client, encode(request, MAX_REQUEST_BYTES), MAX_REQUEST_BYTES, deadline())
        client.close()
        effects = []
        def handler(uid, value):
            with self.journal.session_lock(value['session']):
                record = self.journal.accept('session1', 'op1', HASH)
                if record['state'] == 'accepted':
                    self.journal.transition('session1', 'op1', 'dispatching', {})
                    effects.append('effect')
                    record = self.journal.transition('session1', 'op1', 'observed-success', {'exitCode': 0})
                return {key: record[key] for key in ('operationId', 'state', 'exitCode', 'result')} | {'version': 1}
        serve_connection(server, os.geteuid(), lambda uid: 'session1', handler)
        replay = self.journal.accept('session1', 'op1', HASH)
        self.assertEqual(replay['state'], 'observed-success')
        self.assertEqual(effects, ['effect'])
        handler(os.geteuid(), request)
        self.assertEqual(effects, ['effect'])

    def test_missing_or_corrupt_expected_record_never_becomes_new_accept(self):
        self.journal.accept('session1', 'op1', HASH)
        record = self.root / 'session1' / 'op1.json'
        record.unlink()
        with self.assertRaises(JournalError):
            self.journal.accept('session1', 'op1', HASH)
        record.write_text('{"schema":1,"schema":1}')
        record.chmod(0o600)
        with self.assertRaises(JournalError):
            Journal(str(self.root))

    def test_write_fsync_replace_failures_refuse_ack_and_preserve_dispatching(self):
        for function in ('write', 'fsync', 'replace'):
            with self.subTest(function=function):
                operation = 'op_' + function
                self.journal.accept('session1', operation, HASH)
                self.journal.transition('session1', operation, 'dispatching', {})
                with patch('scripts.m1_gateway.journal.os.' + function, side_effect=OSError('private secret')):
                    with self.assertRaises(JournalError) as caught:
                        self.journal.transition('session1', operation, 'observed-success', {'exitCode': 0})
                    self.assertNotIn('private secret', str(caught.exception))
                with self.assertRaises(JournalError):
                    self.journal.lookup('session1', operation)
                self.journal = Journal(str(self.root))
                self.assertEqual(self.journal.lookup('session1', operation)['state'], 'outcome-unknown')

    def test_accept_failure_refuses_and_missing_lookup_refuses(self):
        with patch('scripts.m1_gateway.journal.os.fsync', side_effect=OSError()):
            with self.assertRaises(JournalError):
                self.journal.accept('session1', 'op1', HASH)
        with self.assertRaises(JournalError):
            self.journal.lookup('session1', 'missing')

    def test_symlink_hardlink_and_record_permissions_refused_before_read(self):
        self.journal.accept('session1', 'op1', HASH)
        record = self.root / 'session1' / 'op1.json'
        record.chmod(0o644)
        with self.assertRaises(JournalError):
            self.journal.lookup('session1', 'op1')
        record.chmod(0o600)
        os.link(record, self.root / 'linked')
        with self.assertRaises(JournalError):
            self.journal.lookup('session1', 'op1')
        (self.root / 'linked').unlink()
        record.rename(self.root / 'original')
        record.symlink_to(self.root / 'original')
        with self.assertRaises(JournalError):
            self.journal.lookup('session1', 'op1')

    def test_root_and_ancestor_security_checked_each_operation(self):
        self.root.chmod(0o755)
        with self.assertRaises(JournalError):
            Journal(str(self.root))
        self.root.chmod(0o700)
        Path(self.tmp.name).chmod(0o777)
        with self.assertRaises(JournalError):
            self.journal.accept('session1', 'op1', HASH)
        Path(self.tmp.name).chmod(0o700)
        alias = Path(self.tmp.name) / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(JournalError):
            Journal(str(alias))

    def test_unsafe_owner_refused_before_record_read(self):
        if os.geteuid() != 0:
            self.skipTest('actual ownership substitution requires a privileged Linux test account')
        self.journal.accept('session1', 'op1', HASH)
        record = self.root / 'session1' / 'op1.json'
        os.chown(record, 65534, -1)
        try:
            with self.assertRaises(JournalError):
                self.journal.lookup('session1', 'op1')
        finally:
            os.chown(record, os.geteuid(), -1)

    def test_directory_fsync_failure_and_short_write_fail_closed(self):
        self.journal.accept('session1', 'op1', HASH)
        real_fsync = os.fsync
        def fail_directory(fd):
            import stat
            if stat.S_ISDIR(os.fstat(fd).st_mode):
                raise OSError()
            real_fsync(fd)
        with patch('scripts.m1_gateway.journal.os.fsync', side_effect=fail_directory):
            with self.assertRaises(JournalError):
                self.journal.transition('session1', 'op1', 'dispatching', {})
        restarted = Journal(str(self.root))
        self.assertEqual(restarted.lookup('session1', 'op1')['state'], 'outcome-unknown')
        with patch('scripts.m1_gateway.journal.os.write', return_value=0):
            with self.assertRaises(JournalError):
                restarted.accept('session1', 'op2', HASH)
        with self.assertRaises(JournalError):
            restarted.lookup('session1', 'op1')
        with self.assertRaises(JournalError):
            restarted.recover()

    def test_root_open_failure_requires_reopening(self):
        self.journal.accept('session1', 'op1', HASH)
        with patch('scripts.m1_gateway.journal.os.open', side_effect=OSError('private storage details')):
            with self.assertRaises(JournalError):
                self.journal.lookup('session1', 'op1')
        with self.assertRaises(JournalError):
            self.journal.lookup('session1', 'op1')
        with self.assertRaises(JournalError):
            self.journal.recover()
        self.assertEqual(Journal(str(self.root)).lookup('session1', 'op1')['state'], 'accepted')

    def test_record_is_bounded_and_duplicate_keys_refused(self):
        self.journal.accept('session1', 'op1', HASH)
        record = self.root / 'session1' / 'op1.json'
        record.write_bytes(b' ' * 65537)
        with self.assertRaises(JournalError):
            self.journal.lookup('session1', 'op1')
        raw = json.dumps(accepted(), separators=(',', ':')).replace('"schema":1', '"schema":1,"schema":1')
        record.write_text(raw)
        with self.assertRaises(JournalError):
            self.journal.lookup('session1', 'op1')

    def test_replaced_root_and_lock_symlink_refuse(self):
        self.journal.accept('session1', 'op1', HASH)
        lock = self.root / 'session1' / '.lock'
        lock.rename(self.root / 'old-lock')
        lock.symlink_to(self.root / 'old-lock')
        with self.assertRaises(JournalError):
            self.journal.lookup('session1', 'op1')
        lock.unlink()
        (self.root / 'old-lock').rename(lock)
        self.journal = Journal(str(self.root))
        self.root.rename(Path(self.tmp.name) / 'old-root')
        self.root.mkdir(mode=0o700)
        with self.assertRaises(JournalError):
            self.journal.accept('session1', 'op2', HASH)

    def test_lock_covers_caller_check_dispatch_result(self):
        import subprocess
        script = ('import fcntl, os, sys; fd=os.open(sys.argv[1], os.O_RDWR); '
                  'fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)')
        with self.journal.session_lock('session1'):
            self.journal.accept('session1', 'op1', HASH)
            self.journal.lookup('session1', 'op1')
            self.journal.transition('session1', 'op1', 'dispatching', {})
            child = subprocess.run([sys.executable, '-B', '-c', script,
                                    str(self.root / 'session1' / '.lock')], capture_output=True)
            self.assertNotEqual(child.returncode, 0)
            self.assertIn(b'BlockingIOError', child.stderr)
            self.journal.transition('session1', 'op1', 'outcome-unknown', {})


if __name__ == '__main__':
    unittest.main()
