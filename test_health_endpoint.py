"""اختبار نبضة السيرفر ( /api/health ) — الباك إند.

الغرض: نضمن إن الحارس في الواجهة عنده باب حقيقي يسأل عليه:

  1) الباب بيرد 200 **بدون أي توكن مصادقة** — وإلا الشاشة هتقول «السيرفر واقع»
     لمجرد أن الجلسة انتهت (وهي المشكلة اللي بنينا الحارس عليها).
  2) الرد فيه الحقول اللي الواجهة بتقراها فعلاً: status / boot_id / database /
     schema_ready — لو اتغير اسم حقل، الواجهة هتعتبر السيرفر واقف في صمت.
  3) الرد سريع (ما يتعلّقش على بناء الجداول عند الإقلاع) — كان ensure_schema
     بتشتغل متزامنة فأول طلب بعد أي cold start ياخد 504.

التشغيل (من جذر المشروع):
    .venv/Scripts/python.exe test_health_endpoint.py

ملاحظة: الاختبار بيستورد main.py — يعني نفس اللي بيحصل عند تشغيل السيرفر:
النبض بيتصل بقاعدة البيانات قراءةً فقط (SELECT 1)، وبناء الجداول في الخلفية
idempotent ولا يحذف أي بيانات.
"""

import sys
import time
import warnings

# ويندوز افتراضياً بيطبع بـ cp1252 ⇒ أي نص عربي بيرمي UnicodeEncodeError.
# (نفس المشكلة بتظهر في أي سكربت بيطبع عربي من الطرفية.)
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

# تحذير starlette عن httpx مش مهم للاختبار وبيشوّش المخرجات
for _category in (DeprecationWarning, UserWarning):
    warnings.filterwarnings("ignore", module=r"fastapi\.testclient", category=_category)

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402


def fail(message):
    print("FAIL:", message)
    sys.exit(1)


def run_tests():
    boot_id = getattr(main, "BOOT_ID", None)
    if not boot_id:
        fail("main.BOOT_ID مش موجود — الواجهة مش هتقدر تعرف إن السيرفر عمل رستر")
    print("boot_id:", boot_id)

    with TestClient(main.app) as client:
        # (1) الباب مفتوح بدون أي مصادقة — وده مقصود: الحارس لازم يشتغل والجلسة منتهية
        t0 = time.time()
        res = client.get("/api/health")
        elapsed = time.time() - t0

        if res.status_code != 200:
            fail(f"المتوقع 200 بدون توكن، والراجع {res.status_code}")
        print(f"GET /api/health (بدون توكن) -> 200 خلال {elapsed * 1000:.0f} مللي ثانية")

        # (3) السرعة: الباب ما يعلّقش بسبب بناء الجداول
        if elapsed > 8:
            fail(f"النبضة بطيئة ({elapsed:.1f}s) — الباب لازم يرد فوراً حتى أثناء بناء الجداول")

        body = res.json()

        # (2) الشكل اللي الواجهة بتقراه حرفياً (شوف serverHealthCore.js)
        for field in ("status", "boot_id", "uptime_seconds", "database", "schema_ready"):
            if field not in body:
                fail(f"حقل ناقص في الرد: {field}")
        if body["boot_id"] != boot_id:
            fail("boot_id في الرد مش نفس boot_id العملية")
        if body["status"] not in ("online", "degraded"):
            fail(f"status غير متوقع: {body['status']}")
        if not isinstance(body["database"], dict) or "ok" not in body["database"]:
            fail("database لازم يكون كائن فيه ok — الواجهة بتقول «الداتا واقعة» من الحقل ده")
        print(f"status={body['status']} | database.ok={body['database']['ok']} | schema_ready={body['schema_ready']}")

        # توكن تالف ما يمنعش النبضة (الحارس مش بيعتمد على الجلسة)
        # (قيمة الهيدر لازم ASCII — ترويسات HTTP ما بتقبلش عربي)
        res_bad = client.get("/api/health", headers={"Authorization": "Bearer invalid-token-123"})
        if res_bad.status_code != 200:
            fail(f"النبضة اتأثرت بتوكن تالف ({res_bad.status_code}) — المفروض تتجاهله")
        print("توكن تالف ⇒ 200 برضه (النبضة مستقلة عن الجلسة) ✓")

        # الباب ما بيعملش أي كتابة أو تغيير
        if res.request.method != "GET":
            fail("النبضة المفروض GET")

        other = client.get("/api/health?t=123456")
        if other.status_code != 200:
            fail("النبضة بتفشل مع بارامتر كسر الكاش ?t=")
        print("مع ?t= (كسر الكاش) ⇒ 200 ✓")

    print("\n✅ كل اختبارات /api/health نجحت")


if __name__ == "__main__":
    run_tests()
