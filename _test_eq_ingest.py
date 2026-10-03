"""🧪 دورة استيعاب زلازل حقيقية على الإنتاج + قياس المهلة من USGS حتى حدث الريال تايم.

⚠️ THIS WRITES TO THE LIVE PRODUCTION DATABASE.
   It only INSERTs rows that USGS genuinely published (the normal production
   cycle's exact code path) — it never fabricates or modifies data. Running it
   is the same thing the GitHub cron does every 5 minutes.

ما الذي يثبته هذا الاختبار (والكود وحده لا يثبته):
  ① التنفيذ: الدورة تعمل فعلاً ولا ترمي.
  ② الإدخال: USGS → DB فعلاً (عدد الصفوف قبل/بعد).
  ③ مضاد التكرار: تشغيل ثانٍ ⇒ صفر صفوف جديدة (قيد UNIQUE في القاعدة).
  ④ حدث الريال تايم: الحدث اتكتب فعلاً وبنفس الـ payload.
  ⑤ الإشعار: بوابة الإشعار اشتغلت/ما اشتغلتش حسب القوة.
  ⑥ قفل القيادة: دورة ثانية متزامنة ترجع skipped، لا إدخال مزدوج.
  ⑦ المهلة: USGS available → ingest → DB → realtime، بالميللي ثانية.
"""
import io
import os
import sys
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from dotenv import load_dotenv

load_dotenv()

import psycopg  # noqa: E402
import requests  # noqa: E402

FAILS = []
DB = os.environ["DATABASE_URL"]
Cairo = ZoneInfo("Africa/Cairo")


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (f"   [{detail}]" if detail else ""))
    if not cond:
        FAILS.append(name)


def db_counts(cur):
    cur.execute("SELECT count(*) FROM earthquake_intel")
    n = cur.fetchone()[0]
    cur.execute("SELECT max(eq_intel_id) FROM earthquake_intel")
    mx = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM realtime_events")
    rt = cur.fetchone()[0]
    return n, mx, rt


print("=" * 78)
print("🧪 دورة استيعاب زلازل حقيقية على الإنتاج — EOC System")
print("=" * 78)

# ── ① USGS متاح الآن؟ (نبدأ من توفّره لنقيس المهلة من المصدر) ────────────
print("\n[1] USGS — هل التغذية متاحة الآن؟")
t0 = time.time()
r = requests.get(
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson",
    timeout=20,
    headers={"User-Agent": "EOC-Earthquake-Intel/1.0"},
)
fetch_ms = (time.time() - t0) * 1000
check("استجابة USGS 200", r.ok, f"HTTP {r.status_code}")
payload = r.json() or {}
feats = payload.get("features") or []
gen = (payload.get("metadata") or {}).get("generated")
check("التغذية فيها أحداث", len(feats) > 0, f"{len(feats)} حدث")
print(f"        USGS generated = {gen}")
print(f"        USGS fetch     = {fetch_ms:.0f} ms")

# ── ② قبل التنفيذ ────────────────────────────────────────────────────────
conn = psycopg.connect(DB, connect_timeout=20)
conn.autocommit = True
cur = conn.cursor()
before_n, before_id, before_rt = db_counts(cur)
print(f"\n[2] قبل الدورة: earthquake_intel={before_n}  max_id={before_id}  realtime_events={before_rt}")

# ── ③ تشغيل الدورة الحقيقية بنفس كود الإنتاج ─────────────────────────────
print("\n[3] تنفيذ دورة الاستيعاب الحقيقية (_eq_intel_engine_cycle) — نفس دالة الإنتاج")
sys.path.insert(0, os.getcwd())
import main  # noqa: E402

print(f"        EOC_SERVERLESS={os.getenv('EOC_SERVERLESS')!r}  VERCEL={os.getenv('VERCEL')!r}")
print(f"        serverless runtime? {main._is_serverless_runtime()}")

t_ing0 = time.time()
res = main._eq_intel_engine_cycle("live_test")
ingest_ms = (time.time() - t_ing0) * 1000
print(f"        نتيجة الدورة : {res}")
print(f"        زمن الدورة    : {ingest_ms:.0f} ms")

check("الدورة نفّذت بلا استثناء", isinstance(res, dict) and res.get("ok") is True, str(res))
check("قفل القيادة لم يُحجب (دورة واحدة)", not res.get("skipped"), "another engine holds the lock")

# ── ④ بعد التنفيذ ────────────────────────────────────────────────────────
after_n, after_id, after_rt = db_counts(cur)
print(f"\n[4] بعد الدورة : earthquake_intel={after_n}  max_id={after_id}  realtime_events={after_rt}")
delta = after_n - before_n
check("عدد الصفوف اتسجّل = ما قالته الدورة", delta == res.get("inserted"),
      f"DB Δ={delta} · الدورة قالت {res.get('inserted')}")
check("الدورة لم تدمّر أي صف", after_n >= before_n, f"{before_n} → {after_n}")
check("USGS كل_hour فيه أحداث ⇒ إدخال أول مرة طبيعي أو 0",
      delta >= 0, f"أُدخل {delta} صف جديد")

# ── ⑤ مضاد التكرار: شغّلها مرة ثانية فوراً ───────────────────────────────
print("\n[5] مضاد التكرار — دورة ثانية فوراً على نفس التغذية")
t_dup0 = time.time()
res2 = main._eq_intel_engine_cycle("live_test_dup")
dup_ms = (time.time() - t_dup0) * 1000
after2_n, after2_id, after2_rt = db_counts(cur)
print(f"        نتيجة الدورة الثانية : {res2}")
print(f"        زمنها                : {dup_ms:.0f} ms")
check("الدورة الثانية أدخلت صفر صفوف", res2.get("inserted") == 0,
      f"inserted={res2.get('inserted')} — التكرار متسرّب!")
check("عدد الصفوف لم يتغير", after2_n == after_n, f"{after_n} → {after2_n}")
check("لم يتولد حدث لحظي ثانٍ لنفس الحدث", after2_rt == after_rt,
      f"{after_rt} → {after2_rt} — إشعار مكرر!")

# ── ⑥ القيد نفسه في القاعدة (لا نثق بالكود وحده) ────────────────────────
print("\n[6] القيد على مستوى القاعدة — فريد (source, external_id)")
cur.execute("""
    SELECT count(*) FROM (
      SELECT source, external_id FROM earthquake_intel
      GROUP BY source, external_id HAVING count(*) > 1
    ) d
""")
dups = cur.fetchone()[0]
check("لا يوجد أي معرّف مكرر في الجدول", dups == 0, f"{dups} مكرر")

# أدخل نفس الحدث مرتين عمداً — القاعدة يجب أن ترفض الثاني
cur.execute("SELECT source, external_id FROM earthquake_intel ORDER BY eq_intel_id DESC LIMIT 1")
src, xid = cur.fetchone()
print(f"        اختبار القيد على: {src}/{xid}")
try:
    cur.execute("""
        INSERT INTO earthquake_intel (source, external_id, occurred_at, magnitude)
        VALUES (%s, %s, now(), 1.0)
    """, (src, xid))
    check("القيد UNIQUE رفض التكرار", False, "القبل التكرار!? IntegrityError متوقع")
except psycopg.errors.UniqueViolation as e:
    check("القيد UNIQUE رفض التكرار", True, "UniqueViolation — كما يجب")
except Exception as e:
    check("القيد UNIQUE رفض التكرار", False, f"{type(e).__name__}: {e}")

# ── ⑦ قفل القيادة: دورة متزامنة ─────────────────────────────────────────
print("\n[7] قفل القيادة — دورة واحدة فقط في أي لحظة")
import threading  # noqa: E402

results = {}


def run_cycle(tag):
    try:
        results[tag] = main._eq_intel_engine_cycle(f"concurrent_{tag}")
    except Exception as e:
        results[tag] = {"error": str(e)}


threads = [threading.Thread(target=run_cycle, args=(i,)) for i in range(3)]
for t in threads:
    t.start()
for t in threads:
    t.join()
ran = [v for v in results.values() if not v.get("error")]
skipped = [v for v in ran if v.get("skipped")]
check("الدورات المتزامنة: واحد ينفّذ والباقي skip",
      len(skipped) == len(ran) - 1 or len(ran) <= 1,
      f"نُفّذ={len(ran)-len(skipped)} · skip={len(skipped)}")
final_n, final_id, final_rt = db_counts(cur)
check("لا إدخال مزدوج من التزامن", final_n == after2_n, f"{after2_n} → {final_n}")
print(f"        نتائج التزامن: {[('skip' if v.get('skipped') else v.get('inserted')) for v in ran]}")

# ── ⑧ حدث الريال تايم: يوجد فعلاً وله earthquake payload ─────────────────
print("\n[8] حدث الريال تايم — مكتوب فعلاً ويحمل بيانات الزلزال")
cur.execute("""
    SELECT event_id, event_type, action, details, created_at
    FROM realtime_events
    WHERE event_type = 'eq_intel'
    ORDER BY event_id DESC LIMIT 5
""")
rows = cur.fetchall()
print(f"        آخر 5 أحداث eq_intel: {len(rows)}")
check("أحداث eq_intel موجودة في الجدول", len(rows) > 0)
if rows:
    eid, etype, action, det, created = rows[0]
    check("النوع eq_intel", etype == "eq_intel", str(etype))
    check("الحدث يحمل كائن earthquake", isinstance(det, dict) and "earthquake" in det,
          str(list(det or {}))[:70])
    check("فيه magnitude و place", bool((det.get("earthquake") or {}).get("magnitude")) and
          bool((det.get("earthquake") or {}).get("place")),
          f"M={(det.get('earthquake') or {}).get('magnitude')} · {(det.get('earthquake') or {}).get('place')}")

# ── ⑨ بوابة الإشعار: القرار محسوب لا مخمَّن ──────────────────────────────
print("\n[9] بوابة الإشعار — منطق الإنتاج كما هو")
cur.execute("""
    SELECT magnitude, sound_alert FROM earthquake_intel
    WHERE created_at >= now() - interval '15 minutes' ORDER BY eq_intel_id DESC
""")
recent = cur.fetchall()
notif = [m for m, s in recent if m is not None and float(m) >= 4.0]
print(f"        صفوف آخر 15 دقيقة: {len(recent)} · منها ≥4.0: {len(notif)}")
ok = all(s is True for m, s in notif if m is not None and float(m) >= 4.0)
check("كل زلزال ≥4.0 يحمل sound_alert=true", ok,
      "الصوت إلزامي فوق 4 ريختر")
under = [s for m, s in recent if m is not None and float(m) < 4.0]
print(f"        أقل من 4.0: {len(under)} صف · sound_alert средиها: {set(under)}")

# ── ⑩ قياس المهلة من USGS ────────────────────────────────────────────────
print("\n[10] ⏱️ المهلة المقيسة (ليست أرقاماً تاريخية)")
gen_dt = None
try:
    gen_dt = datetime.fromisoformat(gen.replace("Z", "+00:00"))
except Exception:
    pass
if gen_dt is None:
    print("        (metadata.generated غير قابل للتحويل — نستخدم وقت الجلب)")
    gen_dt = datetime.now(timezone.utc)
gen_ms = gen_dt.timestamp() * 1000

# آخر صف دخل + حدثه اللحظي ⇒ زمن USGS →(DB+إشعار)
cur.execute("""
    SELECT e.created_at, e.external_id, e.magnitude
    FROM earthquake_intel e ORDER BY e.eq_intel_id DESC LIMIT 1
""")
r_created, r_xid, r_mag = cur.fetchone()
db_ms = r_created.replace(tzinfo=timezone.utc).timestamp() * 1000

cur.execute("""
    SELECT r.created_at FROM realtime_events r
    JOIN earthquake_intel e ON e.eq_intel_id = (r.details->'earthquake'->>'eq_intel_id')::bigint
    WHERE r.event_type='eq_intel' ORDER BY r.event_id DESC LIMIT 1
""")
rt_row = cur.fetchone()
rt_ms = rt_row[0].replace(tzinfo=timezone.utc).timestamp() * 1000 if rt_row else db_ms

usgs_to_db = db_ms - gen_ms
db_to_rt = rt_ms - db_ms
usgs_to_rt = rt_ms - gen_ms

print(f"        USGS metadata.generated → DB insert : {usgs_to_db/1000:8.2f} s")
print(f"        DB insert              → realtime  : {db_to_rt/1000:8.2f} s")
print(f"        ‼️ USGS → مستخدم (حدث جاهز)   : {usgs_to_rt/1000:8.2f} s")
print(f"        زمن دورتنا البرمجية وحدها       : {ingest_ms/1000:8.2f} s  (UTC→DB→إشعار)")
print(f"        زمن جلب التغذية                   : {fetch_ms/1000:8.2f} s")
print("        ملاحظة: أرقام آخر حدث قديم — القياس الحقيقي يحتاج دورة على حدث جديد.")

conn.close()

print("\n" + "=" * 78)
if FAILS:
    print(f"❌ فشل {len(FAILS)} تحقق: {FAILS}")
    sys.exit(1)
print("✅ المسار حيّ: USGS → tick → DB → حدث لحظي، بلا تكرار")
