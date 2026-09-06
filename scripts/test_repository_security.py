import importlib.util
import pathlib
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('guard', pathlib.Path(__file__).with_name('repository-security-check.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

class RepositorySecurityTests(unittest.TestCase):
    def test_nested_captures_and_local_env_are_rejected(self):
        for name in ['.playwright-cli/page.yml', 'app/.playwright-mcp/session.json', '.env', 'api/.env.production']:
            self.assertTrue(guard.findings([(name, b'ordinary data')]), name)

    def test_secret_value_is_found_without_being_returned(self):
        token = b'gh' + b'p_' + b'A' * 36
        hits = guard.findings([('config.py', b'token = "' + token + b'"')])
        self.assertEqual(hits, [('config.py', 'github-token')])
        self.assertNotIn(token.decode(), repr(hits))

    def test_private_key_and_stripe_are_detected(self):
        key = b'-----BEGIN ' + b'PRIVATE KEY-----'
        stripe = b'sk_' + b'live_' + b'a' * 24
        self.assertEqual(len(guard.findings([('a.txt', key), ('b.txt', stripe)])), 2)

    def test_examples_and_public_configuration_are_allowed(self):
        for name in ['.env.example', 'api/.env.production.example', '.env.sample', 'src/config.js']:
            self.assertFalse(guard.findings([(name, b'PUBLIC_URL=https://example.com')]))

    def test_binary_capture_is_rejected_by_path(self):
        self.assertTrue(guard.findings([('nested/.playwright-cli/test.png', b'\0png')]))

    def test_private_runtime_exports_are_rejected(self):
        for name in ['memory/notes.md', 'zoho_exports/clients.csv', 'MEMORY.md']:
            self.assertTrue(guard.findings([(name, b'private runtime data')]))

    def test_gitlink_does_not_crash_scan(self):
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(['git', 'init', '-q', tmp], check=True)
            subprocess.run(['git', 'update-index', '--add', '--cacheinfo',
                '160000,' + 'a' * 40 + ',vendor'], cwd=tmp, check=True)
            result = subprocess.run([sys.executable, str(pathlib.Path(guard.__file__).resolve())],
                cwd=tmp, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('submodule reference', result.stdout)

if __name__ == '__main__':
    unittest.main()
