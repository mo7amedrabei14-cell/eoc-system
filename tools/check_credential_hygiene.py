#!/usr/bin/env python3
"""
Credential-hygiene checker — EOC System (local, offline, read-only).

What it does
------------
Scans the files that are actually present in the working tree (tracked files,
staged files, and new untracked-but-not-ignored files) for dangerous credential
patterns, without ever printing a detected value.

It looks for:
  * password-literal                a fixed password written into source
  * password-dictionary            a dict of fixed account credentials
  * password-guessing-loop         cycling candidate passwords at a login endpoint
  * connection-string-credentials  postgres/mysql/mongo/redis URL carrying a password
  * jwt-literal / bearer-token     an embedded session token
  * provider-api-key               GitHub/OpenAI/Anthropic/Slack/Google/AWS key
  * private-key-material           an inline PEM private key
  * sensitive-file-tracked         .env, *.pem, _token.txt, _seed.json ... tracked by git
  * credential-in-test-or-debug-script
  * diagnostic-with-credentials-and-mutation

Context matters: environment lookups (`os.environ.get(...)`, `process.env.*`,
`import.meta.env.*`), `getpass()` prompts, password *form fields*, schema
definitions such as `"password": {"type": "string"}`, placeholder values, and
weak-password wordlists are not reported. Filenames alone never exempt a file
from inspection — a script called `test_*.py` is escalated, not skipped.

Safety
------
* Read-only: no file is ever created, modified, or deleted by a scan.
* Offline: no network, no API keys, no third-party packages (stdlib only).
* Git object contents (`.git/`) are never read; only worktree file paths and
  file texts are inspected.
* Output never contains a secret, password, token, or credential-bearing URL —
  findings carry only path, line, category, severity and remediation. The
  scanner also never reads `.env`-style files, key files, or backups.

Usage
-----
    python tools/check_credential_hygiene.py                 # normal scan
    python tools/check_credential_hygiene.py --strict        # medium findings also fail
    python tools/check_credential_hygiene.py --json          # redacted JSON report
    python tools/check_credential_hygiene.py --show-suppressed
    python tools/check_credential_hygiene.py --no-git        # walk the tree without git
    python tools/check_credential_hygiene.py --root path/to/project

Exit codes
----------
    0  no actionable findings
    1  actionable findings (high severity; high+medium with --strict)
    2  the scan could not be completed (usage or I/O problem)

To opt out a single line, add a comment:

    payload = {"password": fixture_pw}  # cred-hygiene: allow -- synthetic fixture

The reason after `--` is required for the file-level form:

    # cred-hygiene: allow-file -- generated fixture, values are fake
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

# ── scan surface ────────────────────────────────────────────────────────────

TEXT_EXTENSIONS = {
    ".py", ".pyi", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json",
    ".yml", ".yaml", ".md", ".txt", ".sql", ".sh", ".bash", ".ps1", ".bat",
    ".html", ".htm", ".cfg", ".ini", ".toml", ".conf", ".properties", ".example",
}

EXTRA_TEXT_FILENAMES = {"Dockerfile", "Makefile", "Procfile", ".gitignore", ".gitattributes"}

EXCLUDED_DIRS = {
    ".git", ".hg", ".svn", ".venv", "venv", "env", "node_modules", "dist",
    "build", "out", "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache",
    ".next", ".nuxt", "coverage", "htmlcov", ".idea", ".vscode", ".cache",
    ".mobile-audit", "_dash_profile", "_lx_out", "_mq_profile", "_shot_profile",
}

# Never opened for content: secrets live here by design (presence is reported by
# the tracked-file rule instead, without reading the file).
SENSITIVE_CONTENT_SUFFIXES = {
    ".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".der", ".ppk",
    ".dump", ".backup", ".bak", ".log",
}
SENSITIVE_CONTENT_NAMES = {".netrc", ".pypirc", ".npmrc", ".env"}

SENSITIVE_PATH_PATTERNS = [
    (re.compile(r"(^|/)\.env$"), "dotenv-file"),
    (re.compile(r"(^|/)\.env\.(?!example$|sample$|template$)[A-Za-z0-9_.-]+$"), "dotenv-file"),
    (re.compile(r"(^|/)\.env\.(example|sample|template)$"), None),  # documented, no values
    (re.compile(r"(^|/)id_(rsa|dsa|ecdsa|ed25519)$"), "private-key-file"),
    (re.compile(r"\.(pem|key|p12|pfx|jks|keystore|ppk)$"), "private-key-file"),
    (re.compile(r"(^|/)(credentials|service[-_]?account|service[-_]?key)[^/]*\.json$",
                re.IGNORECASE), "credentials-file"),
    (re.compile(r"(^|/)(\.dev_token\.tmp|_token\.txt|_seed\.json|\.credentials\.json)$"),
     "session-token-file"),
    (re.compile(r"(^|/)\.env\.[A-Za-z0-9_.-]+backup$", re.IGNORECASE), "dotenv-backup-file"),
]

# ── detection patterns ──────────────────────────────────────────────────────

QUOTE = r"""["']"""
PASSWORD_LITERAL_RE = re.compile(
    r"""(?ix)
    (?P<name>password|passwd|pwd)
    ["']?\s*(?:=|:)\s*          # allows both password="x" and "password": "x"
    (?P<q>["'])(?P<value>[^"'\n]{4,200})(?P=q)
    """
)

SECRET_LITERAL_RE = re.compile(
    r"""(?ix)
    (?P<name>
        api[_-]?key | access[_-]?key | access[_-]?token | auth[_-]?token
        | client[_-]?secret | session[_-]?token | secret[_-]?key
        | private[_-]?key | app[_-]?secret | refresh[_-]?token
    )
    ["']?\s*(?:=|:)\s*
    (?P<q>["'])(?P<value>[^"'\n]{12,300})(?P=q)
    """
)

PASSWORD_DICT_RE = re.compile(
    r"""(?ix)
    ["']?\b(passwords|passwds|credentials|creds|logins)\b["']?\s*[:=]\s*\{
    """
)
DICT_ENTRY_RE = re.compile(r"""^\s*(?P<q>["'])(?P<key>[^"'\n]{1,80})(?P=q)\s*:\s*(?P<q2>["'])(?P<val>[^"'\n]{3,200})(?P=q2)\s*,?\s*$""")

CONNECTION_URL_RE = re.compile(
    r"""(?ix)
    \b(?P<scheme>postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps)
    ://(?P<userinfo>[^@\s"'<>/]+)@
    """
)

JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
BEARER_RE = re.compile(r"(?i)\bBearer\s+(?P<value>[A-Za-z0-9._~+/=-]{20,})")
PRIVATE_KEY_RE = re.compile(r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----")

PROVIDER_KEY_RES = [
    ("github-token", "high", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b")),
    ("github-token", "high", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b")),
    ("slack-token", "high", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("openai-or-anthropic-key", "high", re.compile(r"\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b")),
    ("google-api-key", "high", re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b")),
    ("aws-access-key-id", "medium", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
]

ENV_LOOKUP_RE = re.compile(
    r"""(?ix)
    os\.environ(\.get)?\s*[\[(] | os\.getenv\s*\( | getpass\s*\(
    | process\.env\. | import\.meta\.env | environ\[ | env\.(get|require)\s*\(
    | \bconfig\s*\.\s*get\s*\( | \$\{\{?\s*secrets\. | \$\{\{\s*vars\.
    """
)
INTERPOLATION_RE = re.compile(r"[\{\}%$<]|\bstr\.format\b|\bf\"|f'|concatenat")

# A value is not a credential when it is an obvious placeholder / documentation value.
PLACEHOLDER_VALUES = {
    "", "password", "passwd", "pwd", "pass", "secret", "token", "apikey", "api_key",
    "changeme", "change_me", "change-me", "replace_me", "replace-me", "your_password",
    "your-password", "yourpassword", "yes", "no", "true", "false", "none", "null",
    "example", "sample", "dummy", "fake", "placeholder", "redacted", "todo", "tbd",
    "string", "integer", "boolean", "array", "object", "number", "test", "testing",
    "localhost", "admin", "user", "username", "guest", "demo",
}
PLACEHOLDER_PREFIXES = ("your_", "your-", "example", "sample", "dummy", "fake", "test_", "xxx", "<", "{{", "${", "%(")

# ── guessing-loop / mutation heuristics ─────────────────────────────────────

LOOP_RE = re.compile(r"^\s*for\s+(?P<var>[A-Za-z_]\w*)\s+in\s*[\(\[]")
LOOP_VAR_RE = re.compile(r"(?i)^(pw|pwd|pass|passwd|password|guess|cred|creds|secret|combo|attempt)$")
STRLIT_RE = re.compile(r"""["']([^"'\n]{3,200})["']""")
LOGIN_MARKER_RE = re.compile(
    r"(?i)(/token\b|/login\b|/auth\b|/signin\b|verify_password|check_password|authenticate\s*\()"
)
MUTATION_RE = re.compile(
    r"""(?ix)
    \b(INSERT\s+INTO|UPDATE\s+[A-Za-z_][\w.]*\s+SET|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE\s+TABLE)\b
    | \.commit\s*\(\s*\) | requests\.(post|put|patch|delete)\s*\(
    """
)
DIAG_PATH_RE = re.compile(
    r"""(?ix)
    (^|/)(diag|debug|probe|repro|scratch|tmp|_test|test|check|verify|run|seed|probe_)[^/]*\.py$
    | (^|/)(_?probe|_?diag|_test)[^/]*\.py$
    """
)

WEAK_LIST_NAME_RE = re.compile(
    r"(?i)(weak|common|bad|default|top|rockyou|worst)[_-]?(pass(word)?s?|pwd|cred(ential)?s?|logins?)"
)
ALLOW_LINE_RE = re.compile(r"(?i)cred[-_ ]?hygiene\s*:\s*allow\b")
ALLOW_FILE_RE = re.compile(r"(?i)cred[-_ ]?hygiene\s*:\s*allow-file\s*--\s*\S{3,}")

SEVERITY_RANK = {"high": 3, "medium": 2, "low": 1}
DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024


@dataclass
class Finding:
    path: str
    line: int
    severity: str
    category: str
    message: str
    remediation: str

    def as_dict(self) -> dict:
        return {
            "path": self.path,
            "line": self.line,
            "severity": self.severity,
            "category": self.category,
            "message": self.message,
            "remediation": self.remediation,
        }


@dataclass
class ScanResult:
    root: str
    mode: str
    scanned_files: int = 0
    skipped_files: int = 0
    findings: list[Finding] = field(default_factory=list)
    suppressed: list[Finding] = field(default_factory=list)


# ── helpers ─────────────────────────────────────────────────────────────────

def is_placeholder(value: str) -> bool:
    v = value.strip()
    if not v:
        return True
    low = v.lower()
    if low in PLACEHOLDER_VALUES:
        return True
    if low.startswith(PLACEHOLDER_PREFIXES):
        return True
    if any(ch in v for ch in "{}<>$%\\"):
        return True
    if len(set(v)) <= 2:               # xxxx, ****, 0000
        return True
    if not re.search(r"[A-Za-z]", v):  # pure digits/symbols
        return True
    return False


def looks_like_credential_value(value: str) -> bool:
    v = value.strip()
    if is_placeholder(v) or len(v) < 16 or re.search(r"\s", v):
        return False
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", v):   # an identifier, not a secret
        return False
    return len(set(v)) >= 8


def is_sensitive_content_path(rel: str) -> bool:
    name = os.path.basename(rel).lower()
    suffix = os.path.splitext(name)[1]
    if name == ".env" or name.startswith(".env.") or name.endswith(".backup") or name.endswith(".dump"):
        return True
    if suffix in SENSITIVE_CONTENT_SUFFIXES:
        return True
    if name in SENSITIVE_CONTENT_NAMES or name.startswith("id_rsa") or name.startswith("id_ed25519"):
        return True
    return False


def is_scan_extension(rel: str) -> bool:
    name = os.path.basename(rel)
    if name in EXTRA_TEXT_FILENAMES:
        return True
    return os.path.splitext(name)[1].lower() in TEXT_EXTENSIONS


def classify_sensitive_path(rel: str) -> str | None:
    for pattern, category in SENSITIVE_PATH_PATTERNS:
        if pattern.search(rel):
            return category
    return None


def is_weak_password_dataset(rel: str, text: str) -> bool:
    """Name-scoped wordlist exemption — never exempts a file that logs in."""
    if not WEAK_LIST_NAME_RE.search(os.path.basename(rel)):
        return False
    return not LOGIN_MARKER_RE.search(text)


# ── file collection ─────────────────────────────────────────────────────────

def collect_git_files(root: Path) -> list[str] | None:
    """Tracked + staged + untracked-but-not-ignored files. Never reads .git contents."""
    try:
        proc = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z", "-c", "-o", "--exclude-standard"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
    except (OSError, ValueError):
        return None
    if proc.returncode != 0:
        return None
    out = []
    for entry in proc.stdout.split("\0"):
        if not entry:
            continue
        rel = entry.replace("\\", "/")
        if (root / rel).is_file():
            out.append(rel)
    return sorted(set(out))


def walk_files(root: Path) -> list[str]:
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in EXCLUDED_DIRS)
        for name in filenames:
            rel = (Path(dirpath) / name).relative_to(root).as_posix()
            out.append(rel)
    return sorted(set(out))


def read_text(path: Path, max_bytes: int) -> str | None:
    try:
        with path.open("rb") as fh:
            head = fh.read(4096)
            if b"\0" in head:
                return None
            rest = fh.read(max_bytes)
    except OSError:
        return None
    return (head + rest).decode("utf-8", errors="replace")


# ── rules ───────────────────────────────────────────────────────────────────

def scan_lines(rel: str, text: str, weak_dataset: bool) -> list[Finding]:
    findings: list[Finding] = []
    lines = text.splitlines()

    for idx, line in enumerate(lines, start=1):
        if ALLOW_LINE_RE.search(line):
            continue
        env_context = bool(ENV_LOOKUP_RE.search(line))

        # 1) fixed password literal
        if not weak_dataset and not env_context:
            for m in PASSWORD_LITERAL_RE.finditer(line):
                value = m.group("value")
                if is_placeholder(value) or INTERPOLATION_RE.search(value):
                    continue
                findings.append(Finding(
                    rel, idx, "high", "password-literal",
                    "A fixed password value is written directly into source.",
                    "Read it from an environment variable at runtime and fail loudly when it is unset "
                    "(e.g. os.environ[\"APP_PASSWORD\"]), or remove the credential if it is no longer needed.",
                ))

        # 2) generic secret / API key literal
        if not env_context:
            for m in SECRET_LITERAL_RE.finditer(line):
                value = m.group("value")
                if looks_like_credential_value(value):
                    findings.append(Finding(
                        rel, idx, "high", "api-key-or-secret-literal",
                        "A credential-looking value is assigned to a key/secret field in source.",
                        "Move the value to a secret store or environment variable; if it was real, "
                        "rotate it — removing it from the file does not remove it from git history.",
                    ))

        # 3) credential-bearing connection string
        for m in CONNECTION_URL_RE.finditer(line):
            userinfo = m.group("userinfo")
            user, sep, pw = userinfo.partition(":")
            if not sep or not pw:
                continue
            if is_placeholder(pw) or INTERPOLATION_RE.search(pw):
                continue
            findings.append(Finding(
                rel, idx, "high", "connection-string-credentials",
                "A database/service URL embeds a password in the userinfo section.",
                "Load the connection string from an environment variable (.env is gitignored here) and "
                "never commit it; rotate the password if this URL was ever committed.",
            ))

        # 4) plaintext tokens
        for pattern, category, verdict in (
            (JWT_RE, "jwt-literal", "A signed session token is embedded in source."),
            (PRIVATE_KEY_RE, "private-key-material", "Private key material is embedded in source."),
        ):
            if pattern.search(line):
                findings.append(Finding(
                    rel, idx, "high", category, verdict,
                    "Remove the token/key from the file, store it outside the repository, and rotate it "
                    "because history retains prior revisions.",
                ))
        for m in BEARER_RE.finditer(line):
            if INTERPOLATION_RE.search(m.group("value")):
                continue
            findings.append(Finding(
                rel, idx, "high", "bearer-token-literal",
                "A bearer token is hardcoded in a request header.",
                "Obtain the token at runtime (environment variable or login call) and never commit it.",
            ))
        for category, severity, pattern in PROVIDER_KEY_RES:
            if pattern.search(line):
                findings.append(Finding(
                    rel, idx, severity, category,
                    "A provider credential pattern was found in source.",
                    "Revoke/rotate the credential with the provider, then read it from the environment.",
                ))

    findings.extend(scan_password_dictionary(rel, lines))
    findings.extend(scan_guessing_loop(rel, lines))
    return findings


def scan_password_dictionary(rel: str, lines: list[str]) -> list[Finding]:
    """`passwords = {"account": "literal", ...}` — fixed credentials in a dict."""
    findings: list[Finding] = []
    for idx, line in enumerate(lines, start=1):
        m = PASSWORD_DICT_RE.search(line)
        if not m:
            continue
        entries = 0
        for follow in lines[idx: idx + 40]:
            stripped = follow.strip()
            if stripped.startswith("}") and entries:
                break
            em = DICT_ENTRY_RE.match(follow)
            if not em:
                continue
            if is_placeholder(em.group("val")) or INTERPOLATION_RE.search(em.group("val")):
                continue
            entries += 1
        if entries >= 2:
            findings.append(Finding(
                rel, idx, "high", "password-dictionary",
                f"A dictionary of {entries} fixed account credentials is defined in source.",
                "Delete the dictionary; create real accounts through the application/DB workflow and keep "
                "any needed secret in the environment. Rotate any account whose password appeared here.",
            ))
    return findings


def scan_guessing_loop(rel: str, lines: list[str]) -> list[Finding]:
    """`for pw in ("a", "b", "c"):` near a login call — credential guessing."""
    findings: list[Finding] = []
    for idx, line in enumerate(lines):
        cm = LOOP_RE.match(line)
        if not cm or not LOOP_VAR_RE.match(cm.group("var")):
            continue
        candidates, closed = 0, False
        for follow in lines[idx: idx + 10]:
            # Count every candidate string: a real guessing list mixes obvious
            # defaults ("admin", "123456") with plausible ones.
            candidates += len(STRLIT_RE.findall(follow))
            if re.search(r"[\)\]]\s*:", follow):
                closed = True
                break
        if not closed or candidates < 2:
            continue
        window = "\n".join(lines[idx: idx + 15])
        if not LOGIN_MARKER_RE.search(window):
            continue
        findings.append(Finding(
            rel, idx + 1, "high", "password-guessing-loop",
            f"A loop tries {candidates} candidate passwords against a login endpoint.",
            "Remove the guessing loop. Credentials must come from an explicitly named environment "
            "variable, and the operation must fail safely when it is missing — never try a list of guesses.",
        ))
    return findings


def scan_file(rel: str, root: Path, max_bytes: int) -> tuple[list[Finding], bool]:
    """Return (findings, counted_as_scanned)."""
    if not is_scan_extension(rel):
        return [], False
    if is_sensitive_content_path(rel) or classify_sensitive_path(rel):
        return [], False                      # never read secrets/key material
    try:
        if (root / rel).stat().st_size > max_bytes:
            return [], False
    except OSError:
        return [], False
    text = read_text(root / rel, max_bytes)
    if text is None:
        return [], False

    weak_dataset = is_weak_password_dataset(rel, text)
    findings = scan_lines(rel, text, weak_dataset)

    file_allowed = bool(ALLOW_FILE_RE.search(text))
    if findings and not file_allowed and DIAG_PATH_RE.search(rel):
        if MUTATION_RE.search(text):
            findings.append(Finding(
                rel, 0, "high", "diagnostic-with-credentials-and-mutation",
                "A test/debug/diagnostic script embeds credentials and also writes data "
                "(SQL mutation or an authenticated POST/PUT/PATCH/DELETE).",
                "Delete the script if the incident it diagnosed is closed, or rebuild it to take "
                "credentials from the environment, target isolated test data, and clean up after itself.",
            ))
        else:
            findings.append(Finding(
                rel, 0, "high", "credential-in-test-or-debug-script",
                "A test/debug script contains a real-looking credential instead of an "
                "environment-variable reference.",
                "Replace the embedded credential with an env-var lookup (failing safely when unset) "
                "or delete the script if it is obsolete.",
            ))
    return findings, True


def scan(root: Path, use_git: bool, max_bytes: int) -> ScanResult:
    _line_cache.clear()          # never reuse line text across scans
    files = collect_git_files(root) if use_git else None
    mode = "git" if files is not None else "filesystem"
    if files is None:
        files = walk_files(root)

    result = ScanResult(root=str(root), mode=mode)
    for rel in files:
        findings, scanned = scan_file(rel, root, max_bytes)
        if scanned:
            result.scanned_files += 1
        else:
            result.skipped_files += 1
        for finding in findings:
            if finding.line and ALLOW_LINE_RE.search(_line_at(root, rel, finding.line)):
                result.suppressed.append(finding)
            else:
                result.findings.append(finding)

    if mode == "git":
        for rel in files:
            category = classify_sensitive_path(rel)
            if category and (root / rel).is_file():
                result.findings.append(Finding(
                    rel, 0, "high", "sensitive-file-tracked",
                    f"A {category} is tracked by git. Its contents were not read.",
                    "Untrack and gitignore it (git rm --cached), move the real value to a secret store, "
                    "and rotate anything that was committed because history keeps prior revisions.",
                ))

    result.findings.sort(key=lambda f: (-SEVERITY_RANK[f.severity], f.path, f.line))
    result.suppressed.sort(key=lambda f: (f.path, f.line))
    return result


_line_cache: dict[tuple[str, str], list[str]] = {}


def _line_at(root: Path, rel: str, line_no: int) -> str:
    key = (str(root), rel)
    if key not in _line_cache:
        try:
            _line_cache[key] = (root / rel).read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            _line_cache[key] = []
    lines = _line_cache[key]
    if 1 <= line_no <= len(lines):
        return lines[line_no - 1]
    return ""


# ── reporting ───────────────────────────────────────────────────────────────

def actionable(result: ScanResult, strict: bool) -> list[Finding]:
    if strict:
        return [f for f in result.findings if f.severity in ("high", "medium")]
    return [f for f in result.findings if f.severity == "high"]


def print_text_report(result: ScanResult, strict: bool, show_suppressed: bool) -> None:
    print(f"Credential hygiene — root: {result.root} (mode: {result.mode})")
    print(f"Files scanned: {result.scanned_files} · skipped (binary/large/not-scanned): {result.skipped_files}")
    print("Values are never printed; findings show path, line, category and remediation only.")
    print("-" * 72)
    if not result.findings:
        print("No findings.")
    for f in result.findings:
        location = f"{f.path}:{f.line}" if f.line else f.path
        print(f"[{f.severity.upper():6}] {location}  ({f.category})")
        print(f"         {f.message}")
        print(f"         fix: {f.remediation}")
    if show_suppressed:
        print("-" * 72)
        if result.suppressed:
            print("Suppressed by inline 'cred-hygiene: allow' directive (values never shown):")
            for f in result.suppressed:
                print(f"  {f.path}:{f.line}  ({f.category})")
        else:
            print("No suppressed findings.")
    high = sum(1 for f in result.findings if f.severity == "high")
    medium = sum(1 for f in result.findings if f.severity == "medium")
    print("-" * 72)
    print(f"Totals: {high} high · {medium} medium · {len(result.suppressed)} suppressed")
    mode_note = "high+medium (strict)" if strict else "high"
    print(f"Actionable now: {len(actionable(result, strict))} ({mode_note})")


def print_json_report(result: ScanResult, strict: bool, show_suppressed: bool) -> None:
    payload = {
        "root": result.root,
        "mode": result.mode,
        "scanned_files": result.scanned_files,
        "skipped_files": result.skipped_files,
        "actionable_count": len(actionable(result, strict)),
        "strict": strict,
        "findings": [f.as_dict() for f in result.findings],
    }
    if show_suppressed:
        payload["suppressed"] = [f.as_dict() for f in result.suppressed]
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="check_credential_hygiene.py",
        description="Offline credential-hygiene check for tracked/local test and diagnostic scripts. "
                    "Never prints secret values and never modifies files.",
    )
    parser.add_argument("--root", default=".", help="project root to scan (default: current directory)")
    parser.add_argument("--strict", action="store_true", help="treat medium findings as actionable too")
    parser.add_argument("--json", action="store_true", help="emit a redacted JSON report instead of text")
    parser.add_argument("--no-git", action="store_true", help="walk the file tree instead of using git's file list")
    parser.add_argument("--show-suppressed", action="store_true", help="list lines skipped by an allow directive")
    parser.add_argument("--max-file-bytes", type=int, default=DEFAULT_MAX_FILE_BYTES,
                        help=f"skip files larger than this (default {DEFAULT_MAX_FILE_BYTES})")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"error: not a directory: {args.root}", file=sys.stderr)
        return 2
    if args.max_file_bytes <= 0:
        print("error: --max-file-bytes must be positive", file=sys.stderr)
        return 2
    try:
        result = scan(root, use_git=not args.no_git, max_bytes=args.max_file_bytes)
    except OSError as exc:
        print(f"error: scan failed ({type(exc).__name__})", file=sys.stderr)
        return 2
    if args.json:
        print_json_report(result, args.strict, args.show_suppressed)
    else:
        print_text_report(result, args.strict, args.show_suppressed)
    return 1 if actionable(result, args.strict) else 0


if __name__ == "__main__":
    sys.exit(main())
