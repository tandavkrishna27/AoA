import os
import pathlib
import re
import subprocess
import sys
import tempfile
import textwrap
import unittest


WORKFLOW = pathlib.Path(__file__).resolve().parents[2] / '.github/workflows/testing-host-readonly-diagnostic.yml'


class TestingWorkflowContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = WORKFLOW.read_text(encoding='utf-8')

    def test_manual_exact_ref_and_pin_before_credentials(self):
        source = self.source
        self.assertIn('  workflow_dispatch:', source)
        self.assertNotIn('  push:', source)
        self.assertNotIn('  schedule:', source)
        self.assertIn('github.event_name == \'workflow_dispatch\'', source)
        self.assertIn("github.ref == 'refs/heads/codex/m1a-host-boundary-dossier'", source)
        self.assertIn('"$GITHUB_REF" == refs/heads/codex/m1a-host-boundary-dossier', source)
        self.assertIn('verified\n# out of band', source)
        self.assertIn('"$GITHUB_SHA" == "$REVIEWED_SHA"', source)
        self.assertIn('StrictHostKeyChecking=yes', source)
        self.assertIn('HostKeyAlgorithms=ssh-ed25519', source)
        self.assertNotIn('ssh-keyscan', source)
        self.assertLess(source.index('Validate reviewed ref and independent host pin'),
                        source.index('secrets.DEPLOY_SSH_KEY'))
        self.assertEqual(source.count('secrets.'), 2)
        self.assertNotIn('actions/checkout', source)
        self.assertNotIn('upload-artifact', source)
        self.assertNotIn('ssh-keyscan', source)
        for forbidden in ('DEPLOY_ROOT', 'OPENAI_API_KEY', 'E2B_API_KEY',
                          'AWS_ACCESS_KEY_ID', 'AOA_POSTGRES_PASSWORD',
                          'docker prune', 'docker stop', 'docker restart',
                          'systemctl restart', 'rm -rf /opt', 'git checkout'):
            self.assertNotIn(forbidden, source)

    def test_pin_accepts_synthetic_ed25519_line_only(self):
        match = re.search(r'HOST_PUBLIC_KEY" =~ (\^.+\$) \]\]', self.source)
        self.assertIsNotNone(match)
        bash_pattern = match.group(1).replace(r'\ ', ' ').replace(r'\.', '.')
        valid = ('89.167.10.169 ssh-ed25519 '
                 'AAAAC3NzaC1lZDI1NTE5AAAAIPBFIjxkWVHUn99G1ZhhNci4PQ06LVnv3YDK+OpfMIIb')
        self.assertIsNotNone(re.fullmatch(bash_pattern[1:-1], valid))
        self.assertIsNone(re.fullmatch(bash_pattern[1:-1], valid.replace('89.167.10.169', '89.167.10.170')))
        self.assertIsNone(re.fullmatch(bash_pattern[1:-1], valid + ' extra'))
        bash = pathlib.Path('C:/Program Files/Git/bin/bash.exe') if sys.platform == 'win32' else pathlib.Path('/bin/bash')
        if bash.exists():
            expression = f'[[ "$HOST_PUBLIC_KEY" =~ {match.group(1)} ]]'
            for key, expected in ((valid, 0), (valid + ' extra', 1),
                                  (valid.replace('89.167.10.169', '89.167.10.170'), 1)):
                result = subprocess.run([str(bash), '-c', expression],
                                        env={**os.environ, 'HOST_PUBLIC_KEY': key},
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, expected, result.stderr)

    def validate(self, raw):
        source = textwrap.dedent(self.source.split("<<'PY'\n", 1)[1].split('\n          PY', 1)[0])
        with tempfile.TemporaryDirectory() as temp:
            result = pathlib.Path(temp) / 'result'
            result.write_text(raw, encoding='utf-8')
            return subprocess.run([sys.executable, '-c', source, str(result)],
                                  capture_output=True, text=True)

    def test_closed_schema_accepts_bounded_facts_and_refuses_extra_data(self):
        facts = ('uid=0\ngid=0\narchitecture=x86_64\ncpus=2\nmemory_kib=1000\n'
                 'memory_available_kib=500\nroot_total_kib=2000\nroot_available_kib=1000\n'
                 'docker_socket=absent\naoa_account=absent\ndeployment_root=present\n')
        self.assertEqual(self.validate(facts).returncode, 0)
        refused = self.validate(facts + 'secret=PRIVATE_VALUE\n')
        self.assertNotEqual(refused.returncode, 0)
        self.assertNotIn('PRIVATE_VALUE', refused.stdout + refused.stderr)
        self.assertNotEqual(self.validate(facts.replace('cpus=2\n', '')).returncode, 0)


if __name__ == '__main__':
    unittest.main()
