# tools/ — local security checks

## Credential hygiene check

`check_credential_hygiene.py` is an offline, read-only check that looks for
dangerous credential patterns in the files present in this working tree —
including new, not-yet-committed test/debug scripts — before they can be
committed by accident.

It never prints a secret value, never reads `.env`/key files, never touches
`.git` object contents, needs no network access, and uses only the Python
standard library. No file is created, modified, or deleted by a scan.

```bash
# normal scan (fails on high-severity findings)
python tools/check_credential_hygiene.py

# CI-like local gate: medium findings fail too
python tools/check_credential_hygiene.py --strict

# redacted JSON report (safe to attach to a ticket or keep locally)
python tools/check_credential_hygiene.py --json > /tmp/credential-hygiene.json

# show lines that were skipped by an inline allow directive
python tools/check_credential_hygiene.py --show-suppressed

# scan a directory without git (e.g. an extracted copy of an old revision)
python tools/check_credential_hygiene.py --root /path/to/copy --no-git
```

Exit codes: `0` no actionable findings · `1` actionable findings · `2` scan
could not run.

### What it reports

| Category | Meaning |
| --- | --- |
| `password-literal` | fixed password written into source |
| `password-dictionary` | dict of fixed account credentials |
| `password-guessing-loop` | loop trying candidate passwords at a login endpoint |
| `connection-string-credentials` | DB/service URL carrying a password |
| `jwt-literal`, `bearer-token-literal`, `private-key-material` | embedded session token / key |
| `provider-api-key`, `aws-access-key-id` | provider credential pattern |
| `sensitive-file-tracked` | `.env`, `*.pem`, `_token.txt`, … tracked by git (path only, never read) |
| `credential-in-test-or-debug-script` | test/debug script with a real-looking credential |
| `diagnostic-with-credentials-and-mutation` | the above **plus** SQL writes or authenticated POST/PUT/PATCH/DELETE |

Context is respected: `os.environ.get(...)`/`getenv`/`getpass`/`process.env`/
`import.meta.env`, password form fields, `{"password": {"type": "string"}}`
schema definitions, placeholder values, and weak-password wordlists (clearly
named, and with no login call) are not reported. A file is never exempted
merely because its name starts with `test_`, `diag_`, or `security_`.

### Opting a line out

Synthetic fixtures sometimes have to look like a credential. Mark them
explicitly, with a reason:

```python
body = "password: " + fake_test_value  # cred-hygiene: allow -- synthetic fixture
```

For a whole generated file (the reason after `--` is required, so this cannot
be used as a silent blanket):

```python
# cred-hygiene: allow-file -- generated fixture, values are fake
```

### Tests

```bash
python -m unittest discover -s tools/tests -v
```

19 tests cover detection (password literal, DB URL, bearer/JWT, guessing loop,
password dictionary, private key, tracked sensitive file), non-detection (env
lookups, form fields, `getpass`, schema definitions, placeholders, wordlists),
directory exclusions, redaction of every synthetic value from stdout/stderr/JSON,
and exit-code behaviour. All fixtures are synthetic and live in a temporary
directory that is removed after each test.

### Optional: run it before each commit

Nothing is installed automatically, and no Git hook or global Git configuration
is modified by this repository. If you want the check as a local pre-commit
guard, install the hook yourself, by hand:

```bash
cat > .git/hooks/pre-commit <<'EOF'
#!/bin/sh
python tools/check_credential_hygiene.py --strict || {
  echo "credential hygiene check failed — fix the findings or use an explicit allow directive"
  exit 1
}
EOF
chmod +x .git/hooks/pre-commit
```

Remove it again with `rm .git/hooks/pre-commit` (it is local-only and never
committed).
