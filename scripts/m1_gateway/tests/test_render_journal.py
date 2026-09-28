import unittest
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from unittest.mock import patch

from scripts.m1_gateway.journal import JournalError, _validate_record
from scripts.m1_gateway.render_journal import (
    validate_render_record, render_transition, render_marker, validate_render_marker,
    RenderJournal,
)


HASH = 'a' * 64
SERVICES = ['adapter-manager']


def same_file(fd, path):
    try:
        actual, expected = os.fstat(fd), os.stat(path)
    except FileNotFoundError:
        return False
    return (actual.st_dev, actual.st_ino) == (expected.st_dev, expected.st_ino)


def accepted():
    return dict(schema=2, mode='render-only', session='session1', operationId='render1',
                requestHash=HASH, profileSha256='b' * 64, inputIdentitySha256='c' * 64,
                state='accepted', result={})


def verdict(code='OFFLINE_RENDER_CHECK_PASS'):
    return dict(schema='m1a-gateway-render-verdict-offline-v1', offlineOnly=True,
                renderSha256='d' * 64, profileSha256='b' * 64, services=['adapter-manager'],
                scopedPass=code != 'OFFLINE_RENDER_SCOPED_RED',
                dispatchDefaultRed=code != 'OFFLINE_RENDER_CONTROL_MISSING',
                scopedCount=1 if code == 'OFFLINE_RENDER_SCOPED_RED' else 0,
                dispatchDefaultCount=0 if code == 'OFFLINE_RENDER_CONTROL_MISSING' else 1,
                code=code)


class RenderRecordTests(unittest.TestCase):
    def test_separate_schema_cannot_be_read_as_execution_v1(self):
        self.assertEqual(validate_render_record(accepted(), SERVICES)['mode'], 'render-only')
        with self.assertRaises(JournalError):
            _validate_record(accepted())

    def test_in_memory_terminal_transitions_are_closed(self):
        dispatching = render_transition(accepted(), SERVICES, 'dispatching', {})
        completed = render_transition(dispatching, SERVICES, 'observed-success', verdict())
        self.assertEqual(completed['result']['renderSha256'], 'd' * 64)
        for state, result in (('accepted', {}), ('dispatching', {}),
                              ('observed-success', verdict())):
            with self.subTest(state=state), self.assertRaises(JournalError):
                render_transition(completed, SERVICES, state, result)
        unknown = render_transition(dispatching, SERVICES, 'outcome-unknown', {})
        self.assertEqual(unknown['result'], {})

    def test_closed_verdict_rejects_raw_values_and_inconsistent_controls(self):
        dispatching = render_transition(accepted(), SERVICES, 'dispatching', {})
        for change in ({'raw': 'SECRET_CANARY'}, {'stderr': 'SECRET_CANARY'},
                       {'profileSha256': 'e' * 64}, {'offlineOnly': False},
                       {'services': ['adapter-manager', 'adapter-manager']},
                       {'services': ['other-service']},
                       {'scopedCount': 1}, {'dispatchDefaultRed': False},
                       {'code': 'PRODUCTION_PASS'}):
            with self.subTest(change=change), self.assertRaises(JournalError):
                render_transition(dispatching, SERVICES, 'observed-success', verdict() | change)
        for code in ('OFFLINE_RENDER_SCOPED_RED', 'OFFLINE_RENDER_CONTROL_MISSING'):
            with self.subTest(code=code):
                record = render_transition(dispatching, SERVICES, 'observed-failure', verdict(code))
                self.assertEqual(record['result']['code'], code)
                with self.assertRaises(JournalError):
                    render_transition(dispatching, SERVICES, 'observed-success', verdict(code))

    def test_record_identity_and_unknown_payload_refuse(self):
        for change in ({'schema': True}, {'mode': 'execution'}, {'session': '../other'},
                       {'inputIdentitySha256': 'bad'}, {'result': {'raw': 'SECRET_CANARY'}}):
            with self.subTest(change=change), self.assertRaises(JournalError):
                validate_render_record(accepted() | change, SERVICES)


class RenderMarkerTests(unittest.TestCase):
    def test_marker_binds_complete_terminal_bytes_and_identity(self):
        terminal = render_transition(
            render_transition(accepted(), SERVICES, 'dispatching', {}),
            SERVICES, 'observed-success', verdict(),
        )
        raw = json.dumps(terminal, allow_nan=False, separators=(',', ':')).encode('ascii')
        marker = render_marker(terminal, raw, SERVICES)
        self.assertEqual(validate_render_marker(marker, terminal, raw, SERVICES), marker)
        for changed in (raw + b' ', raw.replace(b'render1', b'render2')):
            with self.subTest(changed=changed), self.assertRaises(JournalError):
                validate_render_marker(marker, terminal, changed, SERVICES)
        for change in ({'schema': True}, {'recordSha256': '0' * 64}, {'session': 'other'},
                       {'operationId': 'other'}, {'profileSha256': '0' * 64},
                       {'inputIdentitySha256': '0' * 64}, {'extra': 'bad'}):
            with self.subTest(change=change), self.assertRaises(JournalError):
                validate_render_marker(marker | change, terminal, raw, SERVICES)


@unittest.skipUnless(sys.platform == 'linux', 'requires Linux fsync and file ownership')
class RenderJournalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path.home())
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'render-journal'
        self.root.mkdir(mode=0o700)
        self.journal = RenderJournal(str(self.root), SERVICES)

    def dispatch(self, operation='render1'):
        self.journal.accept('session1', operation, HASH, 'b' * 64, 'c' * 64)
        return self.journal.transition('session1', operation, 'dispatching', {})

    def test_committed_terminal_replays_without_render_bytes(self):
        self.dispatch()
        terminal = self.journal.transition('session1', 'render1', 'observed-success', verdict())
        self.assertEqual(RenderJournal(str(self.root), SERVICES).lookup('session1', 'render1'), terminal)
        self.assertEqual(sorted(p.suffix for p in (self.root / 'session1').iterdir()),
                         ['', '.claim', '.commit', '.dispatch', '.json', '.terminal'])
        for path in (self.root / 'session1').iterdir():
            self.assertNotIn(b'SECRET_CANARY', path.read_bytes())

    def test_terminal_without_marker_recovers_unknown_not_success(self):
        self.dispatch()
        terminal = render_transition(self.journal.lookup('session1', 'render1'),
                                     SERVICES, 'observed-success', verdict())
        path = self.root / 'session1' / 'render1.terminal'
        path.write_bytes(json.dumps(terminal, separators=(',', ':')).encode('ascii'))
        path.chmod(0o600)
        restarted = RenderJournal(str(self.root), SERVICES)
        self.assertEqual(restarted.lookup('session1', 'render1')['state'], 'outcome-unknown')
        self.assertEqual(restarted.accept('session1', 'render1', HASH, 'b' * 64, 'c' * 64)['state'],
                         'outcome-unknown')
        with self.assertRaises(JournalError):
            restarted.transition('session1', 'render1', 'observed-success', verdict())

    def test_unknown_recovery_requires_dispatch_resync(self):
        self.dispatch()
        dispatch = self.root / 'session1' / 'render1.dispatch'
        real_fsync = os.fsync

        def fail_dispatch_sync(fd):
            if same_file(fd, dispatch):
                raise OSError('injected-dispatch-refresh-failure')
            return real_fsync(fd)

        with patch('scripts.m1_gateway.render_journal.os.fsync', side_effect=fail_dispatch_sync):
            with self.assertRaises(JournalError):
                RenderJournal(str(self.root), SERVICES)
        self.assertEqual(RenderJournal(str(self.root), SERVICES).lookup('session1', 'render1')['state'],
                         'outcome-unknown')

    def test_invalid_terminal_verdict_cannot_be_retried(self):
        self.dispatch()
        with self.assertRaises(JournalError):
            self.journal.transition('session1', 'render1', 'observed-success',
                                    verdict() | {'raw': 'SECRET_CANARY'})
        with self.assertRaises(JournalError):
            self.journal.transition('session1', 'render1', 'observed-success', verdict())
        self.assertEqual(RenderJournal(str(self.root), SERVICES).lookup('session1', 'render1')['state'],
                         'outcome-unknown')

    def test_present_invalid_marker_refuses_without_promoting(self):
        self.dispatch()
        self.journal.transition('session1', 'render1', 'observed-success', verdict())
        marker = self.root / 'session1' / 'render1.commit'
        raw = marker.read_bytes()
        marker.write_bytes(raw.replace(b'render1', b'render2'))
        with self.assertRaises(JournalError):
            RenderJournal(str(self.root), SERVICES)

    def test_missing_terminal_from_committed_pair_refuses(self):
        self.dispatch()
        self.journal.transition('session1', 'render1', 'observed-success', verdict())
        (self.root / 'session1' / 'render1.terminal').unlink()
        with self.assertRaises(JournalError):
            RenderJournal(str(self.root), SERVICES)

    def test_terminal_replacement_between_validation_and_sync_refuses(self):
        self.dispatch()
        self.journal.transition('session1', 'render1', 'observed-success', verdict())
        terminal = self.root / 'session1' / 'render1.terminal'
        original = terminal.read_bytes()
        real_fsync = os.fsync
        swapped = False

        def swap_before_sync(fd):
            nonlocal swapped
            if same_file(fd, terminal) and not swapped:
                swapped = True
                terminal.rename(self.root / 'session1' / 'quarantined')
                terminal.write_bytes(original)
                terminal.chmod(0o600)
            return real_fsync(fd)

        with patch('scripts.m1_gateway.render_journal.os.fsync', side_effect=swap_before_sync):
            with self.assertRaises(JournalError):
                self.journal.lookup('session1', 'render1')
        self.assertTrue(swapped)

    def test_terminal_write_sync_and_marker_creation_failures_recover_unknown(self):
        for fault in ('terminal-write', 'terminal-sync', 'marker-create'):
            with self.subTest(fault=fault):
                operation = 'render' + fault.replace('-', '')
                self.dispatch(operation)
                real_write, real_fsync, real_open = os.write, os.fsync, os.open

                def write(fd, data):
                    if fault == 'terminal-write' and same_file(fd, self.root / 'session1' / (operation + '.terminal')):
                        raise OSError('injected-terminal-write')
                    return real_write(fd, data)

                def fsync(fd):
                    if fault == 'terminal-sync' and same_file(fd, self.root / 'session1' / (operation + '.terminal')):
                        raise OSError('injected-terminal-sync')
                    return real_fsync(fd)

                def open_file(path, flags, *args, **kwargs):
                    if fault == 'marker-create' and path == operation + '.commit':
                        raise OSError('injected-marker-create')
                    return real_open(path, flags, *args, **kwargs)

                with patch('scripts.m1_gateway.journal.os.write', side_effect=write), \
                     patch('scripts.m1_gateway.journal.os.fsync', side_effect=fsync), \
                     patch('scripts.m1_gateway.journal.os.open', side_effect=open_file):
                    with self.assertRaises(JournalError):
                        self.journal.transition('session1', operation, 'observed-success', verdict())
                self.journal = RenderJournal(str(self.root), SERVICES)
                self.assertEqual(self.journal.lookup('session1', operation)['state'], 'outcome-unknown')

    def test_surviving_marker_after_directory_sync_error_is_adopted(self):
        self.dispatch()
        real_fsync = os.fsync
        marker = self.root / 'session1' / 'render1.commit'
        failed = False

        def fail_marker_directory_once(fd):
            nonlocal failed
            if (marker.exists() and stat.S_ISDIR(os.fstat(fd).st_mode)
                    and same_file(fd, marker.parent) and not failed):
                failed = True
                raise OSError('injected-marker-directory-sync')
            return real_fsync(fd)

        with patch('scripts.m1_gateway.journal.os.fsync', side_effect=fail_marker_directory_once):
            with self.assertRaises(JournalError):
                self.journal.transition('session1', 'render1', 'observed-success', verdict())
        self.assertTrue(failed)
        self.assertEqual(RenderJournal(str(self.root), SERVICES).lookup('session1', 'render1')['state'],
                         'observed-success')

    def test_two_operations_and_execution_record_do_not_cross_promote(self):
        self.dispatch('render1')
        self.journal.transition('session1', 'render1', 'observed-success', verdict())
        self.dispatch('render2')
        restarted = RenderJournal(str(self.root), SERVICES)
        self.assertEqual(restarted.lookup('session1', 'render2')['state'], 'outcome-unknown')
        other = self.root / 'session1' / 'execution.json'
        other.write_text(json.dumps(dict(schema=1, session='session1', operationId='execution',
                                         requestHash=HASH, state='accepted', exitCode=None,
                                         result={})), encoding='ascii')
        other.chmod(0o600)
        with self.assertRaises(JournalError):
            RenderJournal(str(self.root), SERVICES)
