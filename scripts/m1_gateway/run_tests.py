"""Credential-free ordinary CI gate; real Linux/root execution only."""
import os
from pathlib import Path
import socket
import sys
import unittest


# Pin identities, not just a count: replacement tests cannot hide lost coverage.
_BASELINE = {
    'test_journal.JournalTests': '''
accept_failure_refuses_and_missing_lookup_refuses
changed_hash_refuses_and_completed_replay_never_dispatches
directory_fsync_failure_and_short_write_fail_closed
disconnect_after_effect_preserves_terminal_record
lock_covers_caller_check_dispatch_result
missing_or_corrupt_expected_record_never_becomes_new_accept
record_is_bounded_and_duplicate_keys_refused
replaced_root_and_lock_symlink_refuse
restart_preserves_unknown_and_accepted_without_retry
root_and_ancestor_security_checked_each_operation
root_open_failure_requires_reopening
symlink_hardlink_and_record_permissions_refused_before_read
unsafe_owner_refused_before_record_read
write_fsync_replace_failures_refuse_ack_and_preserve_dispatching
''',
    'test_journal.RecordTests': '''
closed_record_rejects_payload_and_invalid_identity
closed_resource_metadata_is_preserved_and_validated
platform_refusal_has_no_filesystem_effect
storage_failure_latches_but_validation_refusal_remains_recoverable
terminal_metadata_cannot_store_raw_or_untyped_data
transition_requires_dispatch_and_terminal_never_resets
''',
    'test_protocol.ProtocolTests': '''
65537_bytes_refused
closed_fields_and_types
duplicate_keys_refused
invalid_utf8_refused
lifecycle_operations
malformed_and_nonfinite_refused
operation_argument_schemas
response_closed_shape
response_size_and_strict_json
unknown_argument_refused
''',
    'test_transport.TransportTests': '''
accept_authenticates_before_read
client_rejects_unapproved_path_before_socket
client_response_frame_limit_and_partial_read
client_unsupported_socket_fixed_error
client_validates_response_and_request
disconnect_after_handler_has_no_second_dispatch
fragmented_single_frame
linux_real_client_server
linux_real_socket_peer
oversized_header_refused_without_body_read
parser_refusals_never_dispatch
partial_frames_fixed_refusal
peer_cannot_select_other_session
private_handler_and_response_errors
slow_fragments_share_one_deadline
timeout_is_fixed_and_bounded
unknown_peer_rejected_before_read
unsupported_platform_fails_closed
zero_length_frame_refused
''',
}
REQUIRED_BASELINE_IDS = frozenset(
    f'{group}.test_{name}' for group, names in _BASELINE.items()
    for name in names.split()
)
_ALLOWED_SKIP = (
    'test_journal.RecordTests.test_platform_refusal_has_no_filesystem_effect',
    'unsupported-platform check runs on the actual unsupported OS',
)


def discovery_is_valid(ids):
    ids = list(ids)
    return (len(ids) >= 49 and len(ids) == len(set(ids))
            and REQUIRED_BASELINE_IDS.issubset(ids))


def result_is_valid(result, discovered_count):
    return (discovered_count >= 49 and result.testsRun == discovered_count
            and not any((result.failures, result.errors,
                         result.expectedFailures, result.unexpectedSuccesses))
            and len(result.skipped) <= 1
            and all((test.id(), reason) == _ALLOWED_SKIP
                    for test, reason in result.skipped))


def _cases(suite):
    for test in suite:
        if isinstance(test, unittest.TestSuite):
            yield from _cases(test)
        else:
            yield test


def main():
    try:
        supported = (sys.platform == 'linux' and hasattr(socket, 'SO_PEERCRED')
                     and os.geteuid() == 0)
    except Exception:
        supported = False
    if not supported:
        print('gateway-tests-refused: requires actual Linux, root and SO_PEERCRED')
        return 1
    try:
        root = Path(__file__).resolve().parents[2]
        gateway = unittest.TestLoader().discover(str(root / 'scripts/m1_gateway/tests'))
        helpers = unittest.TestLoader().discover(str(root / 'tests'), pattern='test_ci_runner.py')
        suite = unittest.TestSuite((gateway, helpers))
        ids = [test.id() for test in _cases(suite)]
        valid = discovery_is_valid(ids)
    except Exception:
        valid = False
    if not valid:
        print('gateway-tests-refused: incomplete discovery')
        return 1
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result_is_valid(result, len(ids)):
        print('gateway-tests-refused: incomplete or unsuccessful execution')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
