"""🔎 فحص *خصائص* الأسرار (طول/تنوع/قوة) بدون طباعة أي قيمة — لأغراض التدقيق الأمني.
   لا يطبع أي سر؛ يطبع فقط خصائص إحصائية + تطابق مع قائمة كلمات ضعيفة معروفة."""
import os
from urllib.parse import urlparse
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

WEAK = {"secret", "changeme", "password", "test", "dev", "123456", "jwt", "token", "eoc", "hello",
        "supersecret", "jwtsecret", "mysecret", "1234567890", "admin"}

def describe(name):
    v = (os.getenv(name) or "").strip()
    if not v:
        print(f"{name}: MISSING/EMPTY")
        return
    print(f"{name}: length={len(v)} unique_chars={len(set(v))} all_hex={'True' if all(c in '0123456789abcdefABCDEF' for c in v) else 'False'} weak_guess={v.lower() in WEAK}")

for k in ("JWT_SECRET", "SYSTEM_TOKEN", "RADAR_SECRET_KEY"):
    describe(k)

u = os.getenv("DATABASE_URL") or ""
p = urlparse(u)
print("DATABASE_URL: scheme=%s host_is_aiven=%s has_password=%s sslmode_in_query=%s" % (
    p.scheme, "aivencloud" in (p.hostname or ""), bool(p.password), "sslmode" in (p.query or "")))
