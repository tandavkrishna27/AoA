import unittest

from scripts.m1_gateway.journal import JournalError, _validate_record
from scripts.m1_gateway.render_journal import validate_render_record, render_transition


HASH = 'a' * 64
SERVICES = ['adapter-manager']


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
