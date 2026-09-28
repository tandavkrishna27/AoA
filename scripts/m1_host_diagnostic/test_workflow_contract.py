import pathlib
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest


WORKFLOW = pathlib.Path(__file__).resolve().parents[2] / '.github/workflows/aws-evidence-access-check.yml'


def validator_source():
    source = WORKFLOW.read_text(encoding='utf-8')
    embedded = source.split("<<'PY'\n", 1)[1].split('\n          PY', 1)[0]
    return textwrap.dedent(embedded)


def remote_block(name):
    source = WORKFLOW.read_text(encoding='utf-8')
    return textwrap.dedent(source.split(f'# {name}_PROBE_BEGIN\n', 1)[1]
                           .split(f'\n          # {name}_PROBE_END', 1)[0])


def bash_binary():
    if sys.platform == 'win32':
        path = pathlib.Path('C:/Program Files/Git/bin/bash.exe')
        return str(path) if path.exists() else None
    return shutil.which('bash')


BASE = {
    'uid': '0',
    'gid': '0',
    'cpus': '2',
    'memory_kib': '3906292',
    'memory_available_kib': '1000000',
    'root_total_kib': '39020108',
    'root_available_kib': '4152332',
    'architecture': 'x86_64',
    'virtualization': 'kvm',
    'kvm': 'absent',
    'docker_socket': 'present',
    'campaign_root': 'present',
    'deployment_root': 'present',
    'docker': 'present',
    'podman': 'absent',
    'unshare': 'present',
    'bwrap': 'absent',
    'dedicated_user': 'absent',
    'campaign_account': 'absent',
    'docker_group': 'present',
    'candidate_in_docker_group': 'not_applicable',
    'docker_socket_uid': '0',
    'docker_socket_gid': '999',
    'docker_socket_mode': '660',
    'docker_service_active': 'active',
    'docker_service_enabled': 'enabled',
    'rootless_runtime_dir': 'present',
    'rootless_socket_count': '0',
    'docker_storage': 'present',
    'docker_storage_total_kib': '39020108',
    'docker_storage_available_kib': '4152332',
    'docker_storage_shares_root': 'yes',
    'containers_running': '4',
    'containers_total': '7',
    'campaign_containers_running': '3',
}


class WorkflowContractTest(unittest.TestCase):
    def validate(self, rows):
        return self.validate_raw(''.join(f'{k}={v}\n' for k, v in rows.items()))

    def validate_raw(self, raw):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / 'metadata'
            path.write_text(raw, encoding='utf-8')
            return subprocess.run([sys.executable, '-c', validator_source(), str(path)],
                                  capture_output=True, text=True)

    def test_accepts_complete_closed_metadata(self):
        result = self.validate(BASE)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('READ_ONLY_DIAGNOSTIC_NOT_CUSTODY_PROOF', result.stdout)
        self.assertIn('candidate_in_docker_group=not_applicable', result.stdout)

    def test_rejects_missing_socket_owner_when_socket_present(self):
        rows = dict(BASE)
        del rows['docker_socket_gid']
        self.assertNotEqual(self.validate(rows).returncode, 0)

    def test_rejects_account_absent_with_membership_yes(self):
        rows = dict(BASE, candidate_in_docker_group='yes')
        self.assertNotEqual(self.validate(rows).returncode, 0)

    def test_rejects_unexpected_or_secret_bearing_value_without_echo(self):
        rows = dict(BASE, docker_service_active='active SECRET_VALUE')
        result = self.validate(rows)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('SECRET_VALUE', result.stdout + result.stderr)

    def test_rejects_impossible_container_counts(self):
        rows = dict(BASE, campaign_containers_running='5')
        self.assertNotEqual(self.validate(rows).returncode, 0)

    def test_rejects_missing_capacity_field(self):
        rows = dict(BASE)
        del rows['memory_available_kib']
        self.assertNotEqual(self.validate(rows).returncode, 0)

    def test_rejects_rootless_count_above_limit(self):
        rows = dict(BASE, rootless_socket_count='17')
        self.assertNotEqual(self.validate(rows).returncode, 0)

    def test_rejects_storage_fields_when_storage_absent(self):
        rows = dict(BASE, docker_storage='absent')
        self.assertNotEqual(self.validate(rows).returncode, 0)

    def test_rejects_duplicate_field_without_echo(self):
        raw = ''.join(f'{k}={v}\n' for k, v in BASE.items()) + 'uid=9999\n'
        result = self.validate_raw(raw)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('9999', result.stdout + result.stderr)

    def test_rejects_oversized_remote_output(self):
        result = self.validate_raw('x' * 4097)
        self.assertNotEqual(result.returncode, 0)

    def test_accepts_absent_socket_storage_and_runtime_dir(self):
        rows = dict(BASE, docker_socket='absent', docker_storage='absent',
                    rootless_runtime_dir='absent')
        for key in ('docker_socket_uid', 'docker_socket_gid', 'docker_socket_mode',
                    'containers_running', 'containers_total',
                    'campaign_containers_running', 'docker_storage_total_kib',
                    'docker_storage_available_kib', 'docker_storage_shares_root',
                    'rootless_socket_count'):
            del rows[key]
        self.assertEqual(self.validate(rows).returncode, 0)

    def run_probe(self, name, stubs):
        bash = bash_binary()
        if bash is None:
            self.skipTest('bash unavailable')
        return subprocess.run([bash, '--noprofile', '--norc', '-c',
                               'set -euo pipefail\n' + stubs + '\n' + remote_block(name)],
                              capture_output=True, text=True)

    def test_account_probe_refuses_group_lookup_error(self):
        stubs = 'getent() { if [[ "$1" == passwd ]]; then return 0; else return 1; fi; }'
        result = self.run_probe('ACCOUNT', stubs)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('candidate_in_docker_group=no', result.stdout)

    def test_account_probe_refuses_id_lookup_error(self):
        stubs = ('getent() { if [[ "$1" == passwd ]]; then return 0; '
                 'else printf "docker:x:999:\\n"; fi; }\n'
                 'id() { return 1; }')
        result = self.run_probe('ACCOUNT', stubs)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('candidate_in_docker_group=no', result.stdout)

    def test_account_probe_reports_positive_membership(self):
        stubs = ('getent() { if [[ "$1" == passwd ]]; then return 0; '
                 'else printf "docker:x:999:\\n"; fi; }\n'
                 'id() { printf "100 999\\n"; }')
        result = self.run_probe('ACCOUNT', stubs)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('candidate_in_docker_group=yes', result.stdout)

    def test_storage_probe_refuses_stat_error(self):
        stubs = ('test() { if [[ "$1" == -d ]]; then return 0; fi; builtin test "$@"; }\n'
                 'df() { printf "Filesystem 1024-blocks Used Available Capacity Mounted\\nmock 1000 100 900 10%% /mock\\n"; }\n'
                 'stat() { return 1; }')
        result = self.run_probe('STORAGE', stubs)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('docker_storage_shares_root=no', result.stdout)

    def test_storage_probe_reports_same_filesystem(self):
        stubs = ('test() { if [[ "$1" == -d ]]; then return 0; fi; builtin test "$@"; }\n'
                 'df() { printf "Filesystem 1024-blocks Used Available Capacity Mounted\\nmock 1000 100 900 10%% /mock\\n"; }\n'
                 'stat() { printf "123\\n"; }')
        result = self.run_probe('STORAGE', stubs)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('docker_storage_shares_root=yes', result.stdout)


if __name__ == '__main__':
    unittest.main()
