#!/usr/bin/env python3
"""
Tests for tools/check_credential_hygiene.py — all fixtures are synthetic.

Run:
    python -m unittest discover -s tools/tests -v

Every "secret" below is fabricated and assembled from parts so that the test
file itself never contains a literal credential (the checker is run over this
repository too, and it must stay clean).

No test touches the network, the real database, `.env`, or any production
system: fixtures live in a temporary directory that is removed afterwards.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CHECKER = Path(__file__).resolve().parents[1] / "check_credential_hygiene.py"
sys.path.insert(0, str(CHECKER.parent))

import check_credential_hygiene as hygiene  # noqa: E402  (path set above)


# ── synthetic values (never real credentials) ───────────────────────────────

def _s(*parts: str) -> str:
    return "".join(parts)


PW = _s("Syn", "thetic", "-Pw-", "9317")
PW2 = _s("Syn", "thetic", "-Pw-", "2048")
DB_PW = _s("Db", "-Syn", "thetic-", "5512")
BEARER = _s("syn", "thetic", "Bearer", "Token95123")
JWT = _s(
    "eyJ", "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.",
    "eyJzdWIiOiJzeW50aGV0aWMtdXNlciJ9.",
    "c3ludGhldGljLXNpZ25hdHVyZS1vbmx5",
)
AWS_ID = _s("AKIA", "SYNTHETICKEY1234")   # 16 chars after the prefix, as AWS ids are
ENV_FILE_DUMMY = _s("Syn", "thetic", "-Env", "-Value-", "7788")


def _run(root: Path, *args: str) -> subprocess.CompletedProcess:
    cmd = [sys.executable, str(CHECKER), "--root", str(root), "--no-git", *args]
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


class HygieneTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    # helpers ---------------------------------------------------------------
    def write(self, rel: str, text: str) -> Path:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def categories(self, rel: str) -> list[str]:
        findings, _ = hygiene.scan_file(rel, self.root, hygiene.DEFAULT_MAX_FILE_BYTES)
        return [f.category for f in findings]

    def run_checker(self, *args: str) -> subprocess.CompletedProcess:
        return _run(self.root, *args)


class DetectionTests(HygieneTestCase):
    def test_01_detects_hardcoded_password_in_login_request(self) -> None:
        self.write(
            "diag_login_probe.py",
            "import requests\n"
            "BASE = 'http://127.0.0.1:8000'\n"
            "r = requests.post(BASE + '/token', data={'username': 'svc', 'password': '" + PW + "'})\n"
            "print(r.status_code)\n",
        )
        proc = self.run_checker()
        self.assertEqual(proc.returncode, 1, proc.stdout)
        self.assertIn("password-literal", proc.stdout)

    def test_02_detects_credential_bearing_database_url(self) -> None:
        self.write(
            "notes_config.py",
            "DB = 'postgresql://svc:" + DB_PW + "@db.internal:5432/eoc'\n",
        )
        self.assertIn("connection-string-credentials", self.categories("notes_config.py"))
        proc = self.run_checker()
        self.assertEqual(proc.returncode, 1)

    def test_03_detects_bearer_token_literal(self) -> None:
        self.write(
            "api_client.py",
            "headers = {'Authorization': 'Bearer " + BEARER + "'}\n",
        )
        self.assertIn("bearer-token-literal", self.categories("api_client.py"))

    def test_04_detects_fallback_password_guessing_loop(self) -> None:
        self.write(
            "probe_login.py",
            "import requests\n"
            "for pw in ('admin', '" + PW + "', '" + PW2 + "', 'qwerty'):\n"
            "    r = requests.post('http://127.0.0.1:8000/token', data={'username': 'svc', 'password': pw})\n"
            "    if r.status_code == 200:\n"
            "        break\n",
        )
        self.assertIn("password-guessing-loop", self.categories("probe_login.py"))

    def test_05_detects_jwt_and_password_dictionary(self) -> None:
        self.write("token_dump.py", "TOKEN = '" + JWT + "'\n")
        self.assertIn("jwt-literal", self.categories("token_dump.py"))

        self.write(
            "create_test_users.py",
            "passwords = {\n"
            "    'op.alpha': '" + PW + "',\n"
            "    'op.beta': '" + PW2 + "',\n"
            "}\n",
        )
        self.assertIn("password-dictionary", self.categories("create_test_users.py"))

    def test_06_escalates_test_script_that_also_mutates(self) -> None:
        self.write(
            "diag_mutating_probe.py",
            "import requests\n"
            "requests.post('http://127.0.0.1:8000/token', data={'username': 'admin', 'password': '" + PW + "'})\n"
            "MYFUNC = 'DELETE FROM mission_participants WHERE mission_id = %s'\n",
        )
        self.assertIn(
            "diagnostic-with-credentials-and-mutation",
            self.categories("diag_mutating_probe.py"),
        )

    def test_07_detects_inline_private_key(self) -> None:
        self.write(
            "deploy_helper.py",
            "KEY = '-----BEGIN " + "PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----'\n",
        )
        self.assertIn("private-key-material", self.categories("deploy_helper.py"))


class NonDetectionTests(HygieneTestCase):
    def test_08_does_not_flag_environment_variable_lookup(self) -> None:
        self.write(
            "config_ok.py",
            "import os\n"
            "PASSWORD = os.environ.get('APP_PASSWORD', '')\n"
            "DB_URL = os.environ['DATABASE_URL']\n"
            "API_KEY = os.getenv('API_KEY')\n"
            "token = config.get('token')\n",
        )
        self.assertEqual(self.categories("config_ok.py"), [])
        proc = self.run_checker()
        self.assertEqual(proc.returncode, 0, proc.stdout)

    def test_09_does_not_flag_form_fields_getpass_or_schema(self) -> None:
        self.write(
            "Login.jsx",
            'export const Form = () => <input type="password" name="password" autoComplete="current-password" />;\n',
        )
        self.write(
            "set_ok.py",
            "from getpass import getpass\n"
            "pw = getpass('Enter new password: ')\n"
            "schema = {'password': {'type': 'string'}}\n"
            "def update_password(password: str) -> None:\n"
            "    return None\n",
        )
        self.assertEqual(self.categories("Login.jsx"), [])
        self.assertEqual(self.categories("set_ok.py"), [])
        self.assertEqual(self.run_checker().returncode, 0)

    def test_10_does_not_flag_weak_password_wordlist(self) -> None:
        words = ("letmein", "qwerty", "123456", "password", "admin", "iloveyou", "dragon")
        self.write(
            "weak_passwords.py",
            "COMMON = [\n" + "".join(f"    '{w}',\n" for w in words) + "]\n",
        )
        self.assertEqual(self.categories("weak_passwords.py"), [])
        self.assertEqual(self.run_checker().returncode, 0)

    def test_11_ignores_placeholders_and_documentation(self) -> None:
        self.write(
            "docs_config.md",
            "Export `APP_PASSWORD` before running.\n"
            "Example: postgresql://user:password@localhost:5432/db\n"
            "Set password: '<your-password>'\n",
        )
        self.write(
            "config_placeholder.py",
            "password = 'changeme'\n"
            "api_key = 'YOUR_API_KEY_HERE'\n"
            "db = 'postgresql://user:${DB_PASSWORD}@localhost:5432/eoc'\n",
        )
        self.assertEqual(self.categories("docs_config.md"), [])
        self.assertEqual(self.categories("config_placeholder.py"), [])
        self.assertEqual(self.run_checker().returncode, 0)

    def test_12_excludes_generated_and_dependency_directories(self) -> None:
        body = "requests.post('/token', data={'username': 'svc', 'password': '" + PW + "'})\n"
        for rel in ("node_modules/leak.py", ".venv/leak.py", "dist/leak.py",
                    "__pycache__/leak.py", "frontend/node_modules/leak.js"):
            self.write(rel, body)
        proc = self.run_checker()
        self.assertEqual(proc.returncode, 0, proc.stdout)
        self.assertNotIn("leak", proc.stdout)


class SafetyTests(HygieneTestCase):
    def test_13_never_echoes_secret_values(self) -> None:
        self.write(
            "diag_login_probe.py",
            "import requests\n"
            "requests.post('http://127.0.0.1:8000/token', data={'username': 'svc', 'password': '" + PW + "'})\n"
            "DB = 'postgresql://svc:" + DB_PW + "@db.internal:5432/eoc'\n"
            "headers = {'Authorization': 'Bearer " + BEARER + "'}\n"
            "TOKEN = '" + JWT + "'\n"
            "AWS_KEY = '" + AWS_ID + "'\n",
        )
        for args in ((), ("--json",), ("--strict",), ("--show-suppressed",)):
            proc = self.run_checker(*args)
            combined = proc.stdout + proc.stderr
            for value in (PW, DB_PW, BEARER, JWT, AWS_ID):
                self.assertNotIn(value, combined, f"leaked with args={args}")
            self.assertEqual(proc.returncode, 1)

    def test_14_exit_codes_reflect_actionable_findings(self) -> None:
        self.write("clean_module.py", "TOKEN = os.environ.get('SYSTEM_TOKEN', '')\n")
        self.assertEqual(self.run_checker().returncode, 0)

        self.write(
            "risky_probe.py",
            "requests.post('/token', data={'username': 'admin', 'password': '" + PW + "'})\n",
        )
        self.assertEqual(self.run_checker().returncode, 1)

    def test_15_medium_findings_only_fail_in_strict_mode(self) -> None:
        self.write("aws_notes.py", "ACCESS_KEY = '" + AWS_ID + "'\n")
        self.assertEqual(self.run_checker().returncode, 0)                 # high-only by default
        strict = self.run_checker("--strict")
        self.assertEqual(strict.returncode, 1)
        self.assertIn("aws-access-key-id", strict.stdout)

    def test_16_json_report_is_redacted_and_valid(self) -> None:
        self.write(
            "diag_login_probe.py",
            "requests.post('/token', data={'username': 'svc', 'password': '" + PW + "'})\n",
        )
        proc = self.run_checker("--json")
        self.assertEqual(proc.returncode, 1)
        payload = json.loads(proc.stdout)
        self.assertGreaterEqual(payload["actionable_count"], 1)
        self.assertTrue(payload["findings"])
        for finding in payload["findings"]:
            self.assertNotIn(PW, json.dumps(finding))
            self.assertEqual(
                set(finding),
                {"path", "line", "severity", "category", "message", "remediation"},
            )

    def test_17_allow_directive_suppresses_a_line(self) -> None:
        self.write(
            "fixture_ok.py",
            "pw = 'value'  # cred-hygiene: allow -- synthetic test fixture\n"
            "requests.post('/token', data={'username': 'svc', 'password': pw})\n",
        )
        proc = self.run_checker("--show-suppressed")
        self.assertEqual(proc.returncode, 0, proc.stdout)
        self.assertIn("No findings", proc.stdout)

    def test_18_sensitive_content_is_never_scanned(self) -> None:
        # Fixture text is assembled from parts so this test file does not itself
        # contain a flagged shape (the checker is run over this repository too).
        env_path = self.write(".env", "APP_PASSWORD" + "=" + ENV_FILE_DUMMY + "\n")
        self.write("server.key", "-----BEGIN " + "PRIVATE KEY-----\n" + ENV_FILE_DUMMY + "\n")
        before = env_path.read_text(encoding="utf-8")
        proc = self.run_checker()
        self.assertNotIn(ENV_FILE_DUMMY, proc.stdout + proc.stderr)
        # The scan is read-only: sensitive files are neither read into the report nor modified.
        self.assertEqual(env_path.read_text(encoding="utf-8"), before)


@unittest.skipIf(shutil.which("git") is None, "git not available")
class GitModeTests(HygieneTestCase):
    def test_19_flags_tracked_sensitive_file_without_reading_it(self) -> None:
        env_path = self.write(".env", "APP_PASSWORD" + "=" + ENV_FILE_DUMMY + "\n")
        subprocess.run(["git", "init", "-q", str(self.root)], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(self.root), "add", ".env"], check=True, capture_output=True)

        proc = _run_git_mode(self.root)
        self.assertEqual(proc.returncode, 1, proc.stdout)
        self.assertIn("sensitive-file-tracked", proc.stdout)
        self.assertIn(".env", proc.stdout)
        self.assertNotIn(ENV_FILE_DUMMY, proc.stdout + proc.stderr)
        self.assertTrue(env_path.is_file())


def _run_git_mode(root: Path, *args: str) -> subprocess.CompletedProcess:
    cmd = [sys.executable, str(CHECKER), "--root", str(root), *args]
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", env=env)


if __name__ == "__main__":
    unittest.main(verbosity=2)
