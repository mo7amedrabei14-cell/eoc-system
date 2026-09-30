#!/usr/bin/env python3
"""
🔎 تدقيق الأسرار في تاريخ Git — *لا يطبع أي سر خام*، فقط: النوع + الموقع + البصمة + الفعالية.

كيف يعمل:
  1) يقرأ قيم .env الحالية ويحسب بصمة SHA-256 لكل قيمة (أول 12 حرفاً) للمقارنة بلا كشف.
  2) يسرد كل كائنات Git (blobs) في كل الـrefs محلياً عبر `git rev-list --objects --all`.
  3) يقرأ محتوى كل كائن بـ `git cat-file --batch` (سريع، بلا command-line ضخم) ويمسحه
     بأنماط بايثون الحقيقية: JWT · مفتاح Google · Anthropic · OpenAI · رابط Postgres بكلمة
     مرور · GitHub PAT.
  4) يفكّ حِمل JWT (payload فقط: هل له exp؟) بلا طباعة التوقيع.
  5) يقارن بصمات ما ظهر بالبصمات الحالية ⇒ هل المفتاح المستخدم الآن مُسرَّب فعلاً؟

التشغيل:  PYTHONIOENCODING=utf-8 python verify_secrets_history.py
"""
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone

os.environ.setdefault("PYTHONIOENCODING", "utf-8")

PATTERNS = {
    "jwt": re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),
    "google_api_key": re.compile(r"AIza[0-9A-Za-z_-]{30,}"),
    "anthropic_key": re.compile(r"sk-ant-[A-Za-z0-9_-]{10,}"),
    "openai_key": re.compile(r"sk-[A-Za-z0-9]{20,}"),
    "postgres_url_with_password": re.compile(r"postgres(?:ql)?://[^\s:/@]+:[^\s@]+@[^\s\"']+"),
    "github_pat": re.compile(r"(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}"),
}
ENV_LINE = re.compile(
    r"^\s*(JWT_SECRET|SYSTEM_TOKEN|DATABASE_URL|GEMINI_API_KEY|ANTHROPIC_API_KEY|RADAR_SECRET_KEY)\s*=\s*(.+?)\s*$",
    re.M,
)
SECRET_NAMES = ("JWT_SECRET", "SYSTEM_TOKEN", "DATABASE_URL", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "RADAR_SECRET_KEY")


def run(args, stdin=None):
    return subprocess.run(args, input=stdin, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", "replace")).hexdigest()[:12]


def jwt_meta(token: str):
    """يفكّ الـpayload بلا توقيع — (sub, exp_datetime)."""
    try:
        part = token.split(".")[1]
        part += "=" * (-len(part) % 4)
        payload = json.loads(base64.urlsafe_b64decode(part).decode("utf-8", "replace"))
        exp = payload.get("exp")
        return payload.get("sub"), (datetime.fromtimestamp(exp, tz=timezone.utc) if isinstance(exp, (int, float)) else None)
    except Exception:
        return None, None


print("=== 1) قيم .env الحالية (بصمات فقط، بلا قيم) ===")
current = {}
if os.path.exists(".env"):
    with open(".env", encoding="utf-8", errors="replace") as fh:
        for name, value in ENV_LINE.findall(fh.read()):
            value = value.strip().strip('"').strip("'")
            if value:
                current[name] = value
for name in SECRET_NAMES:
    value = (os.environ.get(name) or "").strip()
    if value:
        current.setdefault(name, value)
if not current:
    print("   (لا قيم محلية — المقارنة ستكون بالبصمة فقط)")
for name, value in sorted(current.items()):
    print(f"   {name:<18} len={len(value):<4} present=YES fp={fingerprint(value)}")
for name in SECRET_NAMES:
    if name not in current:
        print(f"   {name:<18} MISSING locally")
current_fps = {fingerprint(v): k for k, v in current.items()}

print("\n=== 2) كل الملفات الحساسة في كل الـrefs ===")
all_paths = {line for line in run(["git", "log", "--all", "--pretty=format:", "--name-only"]).stdout.splitlines() if line}
head_paths = {line for line in run(["git", "ls-files"]).stdout.splitlines() if line}
sensitive = sorted(p for p in all_paths if re.search(r"(?i)\.env|token|secret|credential|password|\.pem$|\.key$|_seed", p))
for path in sensitive:
    rev_list = run(["git", "log", "--all", "--pretty=format:%h", "--", path]).stdout.split()
    print(f"   {path:<30} commits={len(rev_list):<3} at_HEAD={'YES' if path in head_paths else 'NO'}")

print("\n=== 3) مسح كل كائنات Git (blobs) بأنماط الأسرار ===")
objects = run(["git", "rev-list", "--objects", "--all"]).stdout.splitlines()
blob_to_paths = {}
for line in objects:
    parts = line.split(" ", 1)
    if len(parts) == 2 and parts[1]:
        blob_to_paths.setdefault(parts[0], set()).add(parts[1])
shas = list(blob_to_paths)
print(f"   عدد الكائنات: {len(shas)} | عدد الملفات في التاريخ: {len(all_paths)}")

head_blobs = {line.split()[2] for line in run(["git", "ls-tree", "-r", "HEAD"]).stdout.splitlines() if len(line.split()) >= 3}
findings = defaultdict(lambda: {"paths": set(), "fps": {}, "at_head": 0, "count": 0})

proc = subprocess.Popen(["git", "cat-file", "--batch"], stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
assert proc.stdin and proc.stdout
# ⚠️ كتابة كل الـshas قبل القراءة تسبب deadlock لو امتلاً أنبوب الإخراج —
#    لذلك نكتب كائناً ثم نقرأ ردّه فوراً (نفس العملية، بلا إعادة تشغيل git).
for sha in shas:
    proc.stdin.write((sha + "\n").encode())
    proc.stdin.flush()
    header = proc.stdout.readline().decode("utf-8", "replace").strip()
    if not header or header.endswith("missing"):
        continue
    try:
        size = int(header.split()[-1])
    except ValueError:
        continue
    raw = proc.stdout.read(size)
    proc.stdout.read(1)  # سطر فارغ
    text = raw.decode("utf-8", "replace")
    for kind, pattern in PATTERNS.items():
        for match in pattern.findall(text):
            value = match if isinstance(match, str) else match[0]
            if kind == "openai_key" and value.startswith("sk-ant-"):
                continue
            if kind == "anthropic_key" and not value.startswith("sk-ant-"):
                continue
            entry = findings[kind]
            entry["count"] += 1
            entry["fps"][fingerprint(value)] = value
            entry["paths"].update(blob_to_paths.get(sha, set()))
            if sha in head_blobs:
                entry["at_head"] += 1
proc.stdin.close()
proc.wait()

if not findings:
    print("   ✅ لا توجد أي قيمة سرّية بنمط معروف في أي كائن في المستودع/التاريخ")
for kind, entry in sorted(findings.items()):
    print(f"\n   ▸ {kind}: occurrences={entry['count']} blobs_at_HEAD={entry['at_head']} "
          f"paths={sorted(entry['paths'])[:8]}")
    for fp, value in list(entry["fps"].items())[:8]:
        still = current_fps.get(fp)
        extra = ""
        if kind == "jwt":
            sub, exp = jwt_meta(value)
            now = datetime.now(timezone.utc)
            extra = f" | sub={sub} exp={exp.date() if exp else '?'} ({'منتهي' if exp and exp < now else 'ساري/غير معروف'})"
        print(f"      fp={fp} len={len(value)}{extra} | مطابق لقيمة .env الحالية: {still or 'لا'}")

print("\n=== 4) الخلاصة ===")
matched = {kind for kind, entry in findings.items() if any(fp in current_fps for fp in entry["fps"])}
if matched:
    print("   🔴 ACTION REQUIRED — أنواع مطابقة لمفاتيحك الحالية في التاريخ:", sorted(matched))
else:
    print("   🟢 لا يوجد سرّ في التاريخ مطابق لأي قيمة .env حالية ⇒ لا تدوير إلزامي بسبب التاريخ")
print("   ⚠️ لو اتغيّرت أي قيمة في .env بعد نشرها، تدوير المفاتيح يبقى مطلوباً سياسياً (تُدار خارج الكود).")
