import unittest
from types import SimpleNamespace

from scripts.m1_gateway.run_tests import (
    REQUIRED_BASELINE_IDS, discovery_is_valid, result_is_valid,
)


ALLOWED_ID = 'test_journal.RecordTests.test_platform_refusal_has_no_filesystem_effect'
ALLOWED_REASON = 'unsupported-platform check runs on the actual unsupported OS'


class Case:
    def __init__(self, name):
        self.name = name

    def id(self):
        return self.name


def result(**changes):
    return SimpleNamespace(testsRun=49, failures=[], errors=[], skipped=[],
                           expectedFailures=[], unexpectedSuccesses=[], **changes)


class RunnerTests(unittest.TestCase):
    def test_complete_baseline_and_future_cases_accepted(self):
        self.assertTrue(discovery_is_valid(list(REQUIRED_BASELINE_IDS)))
        self.assertTrue(discovery_is_valid([*REQUIRED_BASELINE_IDS, 'future.Case.test_new']))

    def test_empty_and_missing_baseline_refused_despite_count(self):
        self.assertFalse(discovery_is_valid([]))
        for missing in REQUIRED_BASELINE_IDS:
            ids = list(REQUIRED_BASELINE_IDS - {missing}) + ['future.Case.test_new']
            with self.subTest(missing=missing):
                self.assertFalse(discovery_is_valid(ids))

    def test_duplicate_discovery_refused(self):
        self.assertFalse(discovery_is_valid([*REQUIRED_BASELINE_IDS, ALLOWED_ID]))

    def test_success_and_exact_platform_skip_accepted(self):
        self.assertTrue(result_is_valid(result(), 49))
        value = result()
        value.skipped = [(Case(ALLOWED_ID), ALLOWED_REASON)]
        self.assertTrue(result_is_valid(value, 49))

    def test_wrong_skip_id_reason_and_duplicate_refused(self):
        for skips in ([(Case('test_journal.JournalTests.test_unsafe_owner_refused_before_record_read'), ALLOWED_REASON)],
                      [(Case(ALLOWED_ID), 'other reason')],
                      [(Case(ALLOWED_ID), ALLOWED_REASON)] * 2):
            value = result()
            value.skipped = skips
            self.assertFalse(result_is_valid(value, 49))

    def test_failures_errors_and_non_success_outcomes_refused(self):
        for field in ('failures', 'errors', 'expectedFailures', 'unexpectedSuccesses'):
            value = result()
            setattr(value, field, [Case('failed')])
            with self.subTest(field=field):
                self.assertFalse(result_is_valid(value, 49))

    def test_empty_short_and_incomplete_execution_refused(self):
        for ran, discovered in ((0, 0), (48, 48), (49, 50), (50, 49)):
            value = result()
            value.testsRun = ran
            self.assertFalse(result_is_valid(value, discovered))

    def test_future_cases_must_all_execute(self):
        value = result()
        value.testsRun = 50
        self.assertTrue(result_is_valid(value, 50))


if __name__ == '__main__':
    unittest.main()
