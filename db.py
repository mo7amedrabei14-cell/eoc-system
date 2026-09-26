import os
import time
import psycopg
from dotenv import load_dotenv
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# 🔌 أخطاء الاتصال «العابرة» — اللي يستحق نعيد المحاولة عليها
# ─────────────────────────────────────────────────────────────────────────────
# أهمها: "remaining connection slots are reserved" — يعني القاعدة وصلت حد
# الاتصالات (اتصالات متسربة أو عاصفة cold start على Vercel). قبل كده كان أي خطأ
# زي ده يطلع 500 للمستخدم على طول؛ وبلاتفورم Vercel بيرد بنفسه *بدون* ترويسات
# CORS، فالمتصفح يقول «CORS policy» والمشكلة الحقيقية تختفي تماماً.
# ملاحظة: مش بنعيد المحاولة على أخطاء البرمجة/الصلاحيات — دي مش تتحسن بالإعادة.
_RETRYABLE_MARKERS = (
    "remaining connection slots",          # القاعدة وصلت حد الاتصالات
    "too many clients",
    "too many connections",
    "no more connections allowed",          # PgBouncer (pooler بتاع Aiven) وصل سقفه
    "server login has been failing",        # الـpooler مش قادر يسجّل دخول
    "pgbouncer",
    "the database system is starting up",
    "connection refused",
    "could not connect",
    "connection timed out",
    "timeout expired",
    "server closed the connection unexpectedly",
    "terminating connection due to administrator command",
    "ssl connection has been closed",
    "connection reset by peer",
)

# ⏱️ ميزانية محدودة: نعيد المحاولة في إطار زمني صغير حتى لا نتجاوز مهلة الاستضافة.
CONNECT_TIMEOUT = int(os.getenv("DB_CONNECT_TIMEOUT", "10"))
MAX_ATTEMPTS = int(os.getenv("DB_CONNECT_RETRIES", "3"))
RETRY_BUDGET_S = float(os.getenv("DB_CONNECT_BUDGET_S", "7"))
BASE_DELAY_S = float(os.getenv("DB_CONNECT_BASE_DELAY_S", "0.35"))

# ─────────────────────────────────────────────────────────────────────────────
# 🌊 Aiven: الاتصال المباشر ولا الـpooler؟
# ─────────────────────────────────────────────────────────────────────────────
# Aiven بتوفّر PgBouncer على منفذ مستقل عن الاتصال المباشر (الافتراضي 21581،
# وممكن يتغيّر من الكونسول ⇒ DB_POOLER_PORT). الـpooler هو الحل الموصى به مع
# الـserverless: كل طلب بيفتح اتصال جديد والقاعدة ليها سقف اتصالات صغير،
# فالـpooler بيلمّهم في اتصالات قليلة بدل ما نستهلك السقف كله.
# ⚠️ لكن PgBouncer (وضع transaction) مبيسمحش بالـprepared statements، وpsycopg
# بيجهّز الاستعلام تلقائياً بعد 5 استخدامات ⇒ أخطاء متقطعة غامضة. فبنكتشف
# الـpooler ونطفي التجهيز تلقائياً — مش محتاج تعدّل أي مكان تاني في الكود.
_raw_pooler_port = os.getenv("DB_POOLER_PORT")
POOLER_PORT = ("21581" if _raw_pooler_port is None else _raw_pooler_port.strip())
_TRUE_VALUES = ("1", "true", "yes", "on")


def _is_pooled(url: str) -> bool:
    """هل الاتصال رايح للـpooler؟ (باراميتر صريح / منفذ Aiven / مضيف فيه pooler)"""
    if not url:
        return False
    if (os.getenv("DB_VIA_POOLER") or "").strip().lower() in _TRUE_VALUES:
        return True
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    params = {k.lower(): (v or "") for k, v in parse_qsl(parsed.query or "", keep_blank_values=True)}
    if params.get("pgbouncer", "").lower() in _TRUE_VALUES or params.get("pooler", "").lower() in _TRUE_VALUES:
        return True
    if "pooler" in (parsed.hostname or "").lower():
        return True
    return bool(POOLER_PORT) and bool(parsed.port) and str(parsed.port) == POOLER_PORT


def _clean_dsn(url: str) -> str:
    """يشيل باراميترات الـpooler من الرابط — libpq مايعرفهاش وهترفض الاتصال."""
    if not url:
        return url
    try:
        parsed = urlparse(url)
        params = parse_qsl(parsed.query or "", keep_blank_values=True)
    except Exception:
        return url
    kept = [(k, v) for k, v in params if k.lower() not in ("pgbouncer", "pooler")]
    if len(kept) == len(params):
        return url
    return urlunparse(parsed._replace(query=urlencode(kept)))


def _pooler_kwargs(url: str) -> dict:
    """إعدادات psycopg الإضافية المطلوبة لما يكون الاتصال على الـpooler."""
    return {"prepare_threshold": None} if _is_pooled(url) else {}


def _is_retryable(exc: Exception) -> bool:
    message = str(exc).lower()
    return any(marker in message for marker in _RETRYABLE_MARKERS)


def get_connection(max_attempts: int = None, budget_s: float = None):
    """اتصال قاعدة البيانات — مع إعادة محاولة قصيرة عند الأخطاء العابرة.

    Keepalives + connect timeout: prevents cold/startup stalls that surface as
    Vercel gateway timeouts / HTML 504, which the frontend shows as "server connection error".
    Aiven: لو الرابط على منفذ الـpooler (PgBouncer) بنطفي الـprepared statements
    تلقائياً — لأن الـserverless مبيسمحش بإمساك اتصال بين الطلبات، والـpooler هو
    البديل الصحيح (وبنغلق الاتصال بنهاية كل طلب زي ما إحنا).

    إعادة المحاولة هنا بتحوّل *التعثّر اللحظي* (القاعدة في لحظة ضغط/عاصفة تشغيلات
    فاتحة اتصالات) من خطأ 500 فوراً ⇒ استنى أجزاء من الثانية ووصل. ميزانية وقتية
    مؤقتة (budget_s) تضمن إننا ما نتجاوزش مهلة الاستضافة لو القاعدة واقعة فعلاً.
    """
    attempts = MAX_ATTEMPTS if max_attempts is None else max_attempts
    budget = RETRY_BUDGET_S if budget_s is None else budget_s
    started = time.monotonic()
    attempt = 0

    while True:
        attempt += 1
        try:
            return psycopg.connect(
                _clean_dsn(os.getenv("DATABASE_URL")),
                **_pooler_kwargs(os.getenv("DATABASE_URL")),
                connect_timeout=CONNECT_TIMEOUT,
                keepalives=1,
                keepalives_idle=30,
                keepalives_interval=10,
                keepalives_count=5,
            )
        except psycopg.OperationalError as exc:
            elapsed = time.monotonic() - started
            delay = BASE_DELAY_S * (2 ** (attempt - 1))
            can_retry = (
                attempt < attempts
                and _is_retryable(exc)
                and (elapsed + delay) < budget
            )
            if not can_retry:
                raise
            print(f"db: connect attempt {attempt} failed ({str(exc)[:90]}) — retrying in {delay:.2f}s")
            time.sleep(delay)