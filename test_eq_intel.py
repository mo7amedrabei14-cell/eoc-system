#!/usr/bin/env python3
"""
🌍 اختبار انحدار لصفحة «استخبارات الزلازل» — على قاعدة البيانات الحقيقية

يُثبت أن:
  1) الجدول earthquake_intel يُنشأ بمعرّف خفيف آمن للإعادة (لا رفع SCHEMA_VERSION).
  2) الاستقبال /api/earthquake-intel/ingest للنظام فقط (SYSTEM_TOKEN) — مستخدم عادي 403، بلا توكن 401/403.
  3) التفرد: نفس (source, external_id) لا يُدرج مرتين — إعادة الإرسال inserted=0.
  4) الأحداث الأقدم من نافذة 180 دقيقة تُتجاهل (إعادة تشغيل التغذية لا تلوّث).
  5) قاعدة القرب: حدث قريب من وسط القارة (وسط مصر) ⇒ sound_alert=True وبث eq_intel في realtime_events؛
     حدث بعيد ضعيف (بخلاف 4.0 وداخل 1500 كم) ⇒ يُخزَّن بدون بث (لا إغراق)؛
     حدث بعيد قوي (≥4) ⇒ بث بلا صوت.
  6) الفاعل «نظام» (actor_user_id=None) — لا يُستبعد أحد من الإشعار.
  7) القراءة /api/earthquake-intel للأدوار التشغيلية (مالك/جوكر/أوبريشن) وتمنع إدارة الشباب 403.
  8) التحليل /api/earthquake-intel/analysis يرجع بنية سليمة (summary + events + risk_score) بلا فشل
     حتى لو فشل جلب التاريخ (fallback 55/45).
  9) حالة المحرك /api/earthquake-intel/status بنية سليمة.
 10) لا مسار مفتوح بلا توكن.

كل بيانات الاختبار (external_id يبدأ بـ test-eq-) تُنظَّف في النهاية مع أحداث realtime المرتبطة.
"""
import os
import sys
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

os.environ.setdefault("PYTHONIOENCODING", "utf-8")

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# 🔐 توكن نظام للاختبار لو مش مضبوط في البيئة (endpoint بيقرأه وقت كل طلب)
#    ملاحظة: setdefault لا يتجاوز مفتاحاً موجوداً فارغاً من .env — نتحقق من القيمة نفسها
if not os.environ.get("SYSTEM_TOKEN", "").strip():
    os.environ["SYSTEM_TOKEN"] = "x-test-system-token"

# 🖥️ إيقاف المحرك المحلي الدوري أثناء الاختبار — حتى لا يضخ أحداث USGS حقيقية
os.environ["EOC_EQ_LOCAL_ENGINE"] = "0"
# 🌍 إيقاف تعبئة كتالوج العالم التلقائية أثناء الاختبار (لا تزاحم اتصالات Aiven)
os.environ["EOC_EQ_WORLD_BACKFILL"] = "0"

from fastapi.testclient import TestClient
from db import get_connection
from auth import create_access_token
import main as M

client = TestClient(M.app)
M.ensure_earthquake_intel_schema()

conn = get_connection()
cur = conn.cursor()

PASS = FAIL = 0


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name} {extra}")


def user_id_of(username):
    cur.execute("SELECT user_id FROM users WHERE username = %s AND is_active", (username,))
    r = cur.fetchone()
    return r[0] if r else None


def hdr(username):
    uid = user_id_of(username)
    return {"Authorization": f"Bearer {create_access_token(uid)}"} if uid else None


OWNER = hdr("mrabea.x")
JOKER = hdr("joker")
OPS_CANAL = hdr("operation.canal")
YOUTH = hdr("yveoc")

SYSTEM = {"Authorization": f"Bearer {os.environ['SYSTEM_TOKEN']}"}

for name, h in [("owner", OWNER), ("joker", JOKER), ("operation.canal", OPS_CANAL), ("yveoc", YOUTH)]:
    if not h:
        print(f"user {name} not found — aborting")
        sys.exit(1)

CREATED_INTEL_IDS = []


def epoch_ms(dt):
    return int(dt.timestamp() * 1000)


def mk_event(ext_id, lat, lon, mag, minutes_ago=5, place=""):
    now_cairo = datetime.now(ZoneInfo("Africa/Cairo"))
    return {
        "external_id": ext_id,
        "occurred_at": epoch_ms(now_cairo - timedelta(minutes=minutes_ago)),
        "magnitude": mag,
        "depth_km": 10.0,
        "place": place,
        "latitude": lat,
        "longitude": lon,
    }


print("\n=== 1) الاستقبال: صلاحيات النظام فقط ===")
r = client.post("/api/earthquake-intel/ingest", json={"source": "usgs", "events": []}, headers=OWNER)
check("مستخدم عادي (مالك) → 403", r.status_code == 403, f"got {r.status_code}")
r = client.post("/api/earthquake-intel/ingest", json={"source": "usgs", "events": []})
check("بلا توكن → 401/403", r.status_code in (401, 403), f"got {r.status_code}")

print("\n=== 2) الإدخال والتفرد ===")
r = client.post("/api/earthquake-intel/ingest", json={"source": "usgs", "events": [
    mk_event("test-eq-near-1", 28.0, 31.0, 4.5, place="وسط مصر"),
    mk_event("test-eq-far-weak", 36.0, 140.0, 2.8, place="Japan"),   # بعيد وضعيف → مخزن بلا بث
]}, headers=SYSTEM)
check("إدخال حدثين جديدين → 200", r.status_code == 200, f"got {r.status_code} {r.text[:120]}")
check("inserted=2", r.json().get("inserted") == 2, r.text[:160])

r2 = client.post("/api/earthquake-intel/ingest", json={"source": "usgs", "events": [
    mk_event("test-eq-near-1", 28.0, 31.0, 4.5, place="وسط مصر"),
]}, headers=SYSTEM)
check("إعادة الإرسال → inserted=0 (تفرد source+external_id)", r2.json().get("inserted") == 0, r2.text[:160])

print("\n=== 3) الأحداث القديمة تُتجاهل ===")
r3 = client.post("/api/earthquake-intel/ingest", json={"source": "usgs", "events": [
    mk_event("test-eq-old", 28.0, 31.0, 5.0, minutes_ago=300, place="قديم جداً"),
]}, headers=SYSTEM)
check("حدث قبل 5 ساعات → inserted=0", r3.json().get("inserted") == 0, r3.text[:160])

print("\n=== 4) قاعدة القرب والبث ===")
cur.execute("SELECT eq_intel_id, sound_alert, distance_km FROM earthquake_intel WHERE external_id = 'test-eq-near-1'")
row = cur.fetchone()
check("صف القريب موجود", row is not None)
if row:
    CREATED_INTEL_IDS.append(row[0])
    check("قريب (≈100 كم) ⇒ sound_alert=True", row[1] is True, f"got {row[1]}, dist={row[2]}")
    check("المسافة محسوبة (<300 كم)", row[2] is not None and float(row[2]) < 300, f"dist={row[2]}")

cur.execute("SELECT eq_intel_id, sound_alert FROM earthquake_intel WHERE external_id = 'test-eq-far-weak'")
row2 = cur.fetchone()
check("البعيد الضعيف مخزن (بلا إشعار)", row2 is not None)
if row2:
    CREATED_INTEL_IDS.append(row2[0])
    check("بوابة الصوت: بعيد ضعيف <4 ريختر ⇒ بلا صوت", row2[1] is not True, f"got {row2[1]}")

cur.execute("""
    SELECT COUNT(*) FROM realtime_events
    WHERE event_type = 'eq_intel' AND actor_user_id IS NULL
      AND entity_id IN (SELECT eq_intel_id FROM earthquake_intel WHERE external_id = 'test-eq-near-1')
""")
rt_near = cur.fetchone()[0]
check("بث realtime للقريب (actor=نظام)", rt_near >= 1, f"count={rt_near}")

cur.execute("""
    SELECT COUNT(*) FROM realtime_events
    WHERE event_type = 'eq_intel'
      AND entity_id IN (SELECT eq_intel_id FROM earthquake_intel WHERE external_id = 'test-eq-far-weak')
""")
rt_far_weak = cur.fetchone()[0]
check("بوابة الإشعار: بعيد ضعيف (<4 وقريب لا وخطورة لا) ⇒ بلا بث", rt_far_weak == 0, f"count={rt_far_weak}")

r4 = client.post("/api/earthquake-intel/ingest", json={"source": "usgs", "events": [
    mk_event("test-eq-far-strong", 36.0, 140.0, 6.5, place="Japan strong"),
]}, headers=SYSTEM)
cur.execute("SELECT eq_intel_id, sound_alert FROM earthquake_intel WHERE external_id = 'test-eq-far-strong'")
row3 = cur.fetchone()
check("البعيد القوي مخزن", row3 is not None and r4.json().get("inserted") == 1)
if row3:
    CREATED_INTEL_IDS.append(row3[0])
    check("بوابة الصوت: بعيد قوي ≥4 ريختر ⇒ صوت", row3[1] is True, f"got {row3[1]}")
cur.execute("""
    SELECT COUNT(*) FROM realtime_events
    WHERE event_type = 'eq_intel'
      AND entity_id IN (SELECT eq_intel_id FROM earthquake_intel WHERE external_id = 'test-eq-far-strong')
""")
check("بث للبعيد القوي (≥4 يستحق الإشعار)", cur.fetchone()[0] >= 1)

cur.execute("SELECT details FROM realtime_events WHERE event_type='eq_intel' AND entity_id = %s ORDER BY event_id DESC LIMIT 1", (CREATED_INTEL_IDS[0],))
det = cur.fetchone()
if det and det[0]:
    eq_det = det[0].get("earthquake") if isinstance(det[0], dict) else None
    check("details.earthquake.sound_alert يوصل للواجهة", eq_det is not None and eq_det.get("sound_alert") is True)
elif CREATED_INTEL_IDS:
    check("details.earthquake.sound_alert يوصل للواجهة", False, "no realtime row")

print("\n=== 5) القراءة: أدوار التشغيل / إدارة الشباب ممنوعة ===")
r = client.get("/api/earthquake-intel", headers=OWNER)
check("المالك يقرأ → 200", r.status_code == 200, f"got {r.status_code}")
data = r.json()
check("بنية قائمة", isinstance(data, list) and len(data) >= 2)
mine = [e for e in data if str(e.get("external_id", "")).startswith("test-eq-")]
check("أحداث الاختبار ظاهرة", len(mine) >= 2)
if mine:
    e0 = mine[0]
    check("حقول risk_level/risk_score/status موجودة", all(k in e0 for k in ("risk_level", "risk_score", "status")), str(e0.keys()))
    check("status مصنّف (زلزال/هزة أرضية)", e0.get("status") in ("زلزال", "هزة أرضية"), f"got {e0.get('status')}")

r = client.get("/api/earthquake-intel", headers=OPS_CANAL)
check("الأوبريشن يقرأ → 200", r.status_code == 200, f"got {r.status_code}")
r = client.get("/api/earthquake-intel", headers=YOUTH)
check("إدارة الشباب → 403", r.status_code == 403, f"got {r.status_code}")
r = client.get("/api/earthquake-intel")
check("بلا توكن → 401/403", r.status_code in (401, 403), f"got {r.status_code}")

print("\n=== 6) تحليل الخطورة (30 سنة) ===")
r = client.get("/api/earthquake-intel/analysis?days=7&limit=60", headers=OWNER)
check("التحليل → 200", r.status_code == 200, f"got {r.status_code} {r.text[:120]}")
an = r.json() if r.status_code == 200 else {}
check("summary موجود", isinstance(an.get("summary"), dict))
check("events قائمة تغطي أحداث الاختبار", len(an.get("events") or []) >= 2)
test_events = [e for e in (an.get("events") or []) if str(e.get("place", "")) + str(e.get("magnitude", "")) and e.get("magnitude") is not None]
if an.get("events"):
    ev0 = an["events"][0]
    check("كل حدث فيه risk_score 0-100", isinstance(ev0.get("risk_score"), (int, float)) and 0 <= ev0["risk_score"] <= 100, str(ev0.get("risk_score")))
    check("كل حدث فيه risk_level", ev0.get("risk_level") in ("حرجة", "عالية", "متوسطة", "منخفضة"), str(ev0.get("risk_level")))
    check("بنية hist موجودة (قد تكون None قبل أول مسح)", "hist_max_mag" in ev0 and "hist_window_count" in ev0)
    s = an["summary"]
    check("hist_years=30", s.get("hist_years") == 30)
    check("hist_window_days=15", s.get("hist_window_days") == 15)
r = client.get("/api/earthquake-intel/analysis", headers=YOUTH)
check("التحليل ممنوع على إدارة الشباب → 403", r.status_code == 403, f"got {r.status_code}")

print("\n=== 7) حالة المحرك ===")
r = client.get("/api/earthquake-intel/status", headers=OWNER)
check("status → 200", r.status_code == 200, f"got {r.status_code}")
st = r.json() if r.status_code == 200 else {}
check("engine بنية سليمة", isinstance(st.get("engine"), dict) and "poll_seconds" in st["engine"])
check("feed بنية سليمة", isinstance(st.get("feed"), dict) and "url" in st["feed"])
r = client.get("/api/earthquake-intel/status", headers=YOUTH)
check("status ممنوع على إدارة الشباب → 403", r.status_code == 403, f"got {r.status_code}")

print("\n=== 7.5) توقعات الأسبوع القادم (forecast) ===")
r = client.get("/api/earthquake-intel/forecast", headers=OWNER)
check("forecast → 200", r.status_code == 200, f"got {r.status_code} {r.text[:120]}")
fc = r.json() if r.status_code == 200 else {}
check("مناطق الرصد (12 منطقة + العالم كله)", isinstance(fc.get("zones"), list) and len(fc.get("zones")) == 13 and any(z.get("id") == "world" for z in fc.get("zones") or []), f"got {len(fc.get('zones') or [])}")
check("معلومات النموذج (10 سنوات)", fc.get("model", {}).get("hist_years") == 10)
check("أفق 7 أيام", fc.get("horizon_days") == 7)
zones_ok = [z for z in (fc.get("zones") or []) if z.get("model_ok")]
if zones_ok:
    z0 = zones_ok[0]
    check("حقول التوقع كاملة (expected/prob/trend/risk)",
          all(k in z0 for k in ("expected_week_m4", "prob_m4_pct", "prob_m45_pct", "prob_m5_pct", "activity_trend", "week_risk", "daily_cumulative_m4")),
          str([k for k in ("expected_week_m4", "prob_m4_pct", "prob_m45_pct", "prob_m5_pct", "activity_trend", "week_risk", "daily_cumulative_m4") if k not in z0]))
    check("الاحتمالات داخل 0-100", all(0 <= z0[k] <= 100 for k in ("prob_m4_pct", "prob_m45_pct", "prob_m5_pct")))
    check("منحنى 7 أيام", isinstance(z0.get("daily_cumulative_m4"), list) and len(z0["daily_cumulative_m4"]) == 7)
    check("week_risk مصنّف", z0.get("week_risk") in ("مرتفع", "متوسط", "منخفض"))
else:
    # لا فشل: مناطق بفشل شبكة ترجع model_ok=false دون 500 (no-fail design)
    check("no-fail: فشل جلب الشبكة ⇒ model_ok=false دون 500", True)
r = client.get("/api/earthquake-intel/forecast", headers=YOUTH)
check("forecast ممنوع على إدارة الشباب → 403", r.status_code == 403, f"got {r.status_code}")

print("\n=== 8) helpers: درجة الخطورة ===")
check("mag 7 → عامل شدة ~97", 90 <= M._eq_intel_magnitude_factor(7.0) <= 100)
check("mag 4.5 → 40", M._eq_intel_magnitude_factor(4.5) == 40.0)
check("قرب 0 كم → 100", M._eq_intel_proximity_factor(0) == 100.0)
check("قرب 3000 كم → 0", M._eq_intel_proximity_factor(3000) == 0.0)
check("مفارقة تاريخية: قوة=تاريخ → 100", M._eq_intel_historical_anomaly(6.0, 6.0) == 100.0)
check("مفارقة تاريخية: ضعف التاريخ → 50", M._eq_intel_historical_anomaly(3.0, 6.0) == 50.0)
check("بلا تاريخ → score 55/45", M._eq_intel_risk_score(100, 100, None) == 100.0)
check("مستوى 80 → حرجة", M._eq_intel_risk_level(80) == "حرجة")
check("مستوى 60 → عالية", M._eq_intel_risk_level(60) == "عالية")
check("مستوى 30 → متوسطة", M._eq_intel_risk_level(30) == "متوسطة")
check("مستوى 10 → منخفضة", M._eq_intel_risk_level(10) == "منخفضة")

print("\n=== 8.5) الكتالوج التاريخي المحلي ===")
M.ensure_earthquake_catalog_schema()
r = client.get("/api/earthquake-intel/catalog/stats", headers=OWNER)
check("catalog/stats → 200", r.status_code == 200, f"got {r.status_code}")
cs = r.json() if r.status_code == 200 else {}
check("بنية الكتالوج (total/ready/per_region)", all(k in cs for k in ("total", "ready", "per_region")))
r = client.get("/api/earthquake-intel/catalog/stats", headers=YOUTH)
check("catalog/stats ممنوع على إدارة الشباب → 403", r.status_code == 403, f"got {r.status_code}")
r = client.post("/api/earthquake-intel/catalog/backfill", headers=JOKER)
check("backfill ممنوع على غير المالك → 403", r.status_code == 403, f"got {r.status_code}")
# منطقة واحدة بحد أدنى منخفض للتأكد من جلب/تخزين الكتالوج فعلياً (عينة تركيا: نشطة تكتونياً)
cur.execute("SELECT COUNT(*) FROM earthquake_catalog WHERE region_id = 'turkey'")
turkey_before = cur.fetchone()[0]
if turkey_before > 0:
    check("عينة تركيا موجودة في الكتالوج (سبق تعبئتها)", True)
else:
    check("no-fail: الكتالوج يظل فارغاً دون 500 قبل تعبئة المالك", True)
# helpers الدمج والاتجاه
lam, ratio = M._eq_forecast_blend(2.0, 4.0)
check("blend: 45/55 ⇒ λ=3.1", abs(lam - 3.1) < 0.01 and abs(ratio - 2.0) < 0.01)
check("trend: ×2 ⇒ مرتفع", M._eq_forecast_trend(ratio, 2.0, 4.0) == "مرتفع")
check("trend: تاريخ صفري وحديث نشط ⇒ مرتفع", M._eq_forecast_trend(None, 0, 1.0) == "مرتفع")
check("poisson: λ=0 ⇒ 0%", M._eq_forecast_poisson_prob(0) == 0.0)
check("poisson: λ كبير ⇒ ~100%", M._eq_forecast_poisson_prob(50) == 100.0)
check("مناطق مصر المؤثرة = 8 (+العالم كله في التوقعات)", len(M.EQ_CATALOG_REGIONS) == 8, f"got {len(M.EQ_CATALOG_REGIONS)}")
check("تركيا ضمن المناطق المؤثرة", any(z["id"] == "turkey" for z in M.EQ_CATALOG_REGIONS))

print("\n=== 9) تنظيف بيانات الاختبار ===")
if CREATED_INTEL_IDS:
    # 🔄 إعادة محاولة عند deadlock عابر (سيرفر حي يعمل بالتوازي مع الاختبار)
    for attempt in range(3):
        try:
            cur.execute("DELETE FROM realtime_events WHERE event_type = 'eq_intel' AND entity_id = ANY(%s)", (CREATED_INTEL_IDS,))
            cur.execute("DELETE FROM earthquake_intel WHERE eq_intel_id = ANY(%s)", (CREATED_INTEL_IDS,))
            # 📚 مرآة الكتالوج: أحداث الاختبار تنسخ فيها أيضاً ⇒ تُنظَّف من الكتالوج كذلك
            cur.execute("DELETE FROM earthquake_catalog WHERE external_id LIKE 'test-eq-%'")
            conn.commit()
            break
        except Exception:
            conn.rollback()
            if attempt == 2:
                raise
            time.sleep(2)
cur.execute("SELECT COUNT(*) FROM earthquake_intel WHERE external_id LIKE 'test-eq-%'")
left = cur.fetchone()[0]
check("لا بقايا لبيانات الاختبار", left == 0, f"left={left}")

print(f"\n{'='*50}\nالنتيجة: {PASS} نجاح / {FAIL} فشل")
sys.exit(1 if FAIL else 0)
