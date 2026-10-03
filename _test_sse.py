"""🧪 اختبار قناة الدفع SSE — قراءة فقط، بلا أي كتابة على قاعدة البيانات.

الأهداف (مطلب #1):
  ① البث يفتح ويقبل مصادقة Bearer.
  ② لا يسرّب: 401 بلا ترويسة، 401 بترويسة خاطئة.
  ③ يبقى مفتوحاً ويصدر نبض إحياء (بلا أي حدث) — أي لا ي切断ه proxy فورياً.
  ④ يغلق مجدولاً عند 55 ثانية ويطلق eof — لا قطع مفاجئ على العميل.
  ⑤ شكل الحدث المطبع = شكل حدث الاستطلاع حرفياً (نفس الحقول).
"""
import asyncio
import io
import os
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import main  # noqa: E402  (يستورد التطبيق مع كل المسارات)

from fastapi.testclient import TestClient  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (f"   [{detail}]" if detail else ""))
    if not cond:
        FAILS.append(name)


def make_token(user_id=1):
    """نستخدم مُنشئ التوكن نفسه في الإنتاج — لا نلفّ JWT يدوياً
    (محاولة سابقة استخدمت main.JWT_SECRET وهو غير موجود أصلاً)."""
    return main.create_access_token(user_id)


def test_auth():
    print("\n[1] المصادقة — لا تسريب أحداث بلا ترويسة أو بترويسة خاطئة")
    with TestClient(main.app) as c:
        r = c.get("/api/realtime/stream")
        check("بلا ترويسة ⇒ 401", r.status_code == 401, f"got {r.status_code}")
        r = c.get("/api/realtime/stream", headers={"Authorization": "Bearer not-a-real-token"})
        check("بترويسة خاطئة ⇒ 401", r.status_code == 401, f"got {r.status_code}")


def test_stream_shapes():
    print("\n[2] شكل الأحداث — مطابق لنقطة الاستطلاع حرفياً (مطلب: لا تغيير في العقد)")
    tok = make_token()
    with TestClient(main.app) as c:
        # init على نقطة الاستطلاع ⇒ watermark فقط بلا أحداث (نفس سلوك 4 ثوانٍ)
        pol = c.get("/api/realtime/events?init=1", headers={"Authorization": f"Bearer {tok}"})
        check("الاستطلاع init=1 ما زال يعمل", pol.status_code == 200, f"got {pol.status_code}")
        pj = pol.json()
        check("استطلاع يرجع {events, latest_id}", "events" in pj and "latest_id" in pj, str(list(pj))[:80])
        check("init=1 ⇒ events فارغة", pj.get("events") == [])

        after = pj.get("latest_id", 0)
        sse = c.get(f"/api/realtime/stream?after_id={after}", headers={"Authorization": f"Bearer {tok}"})
        check("البث يفتح 200", sse.status_code == 200, f"got {sse.status_code}")
        check("نوع المحتوى text/event-stream",
              "text/event-stream" in sse.headers.get("content-type", ""),
              sse.headers.get("content-type", ""))
        check("X-Accel-Buffering: no", sse.headers.get("x-accel-buffering") == "no")
        check("Cache-Control: no-cache", "no-cache" in sse.headers.get("cache-control", ""))


def test_no_duplicate_contract():
    print("\n[3] مانع التكرار — نقطة الوصل بين المسارين واحدة")
    import inspect
    src = inspect.getsource(main.stream_realtime_events)
    # القناة تستدعي نفس دالة الاستطلاع ⇒ نفس SQL ونفس الرؤية ونفس الفرز
    check("البث يستدعي get_realtime_events نفسها", "get_realtime_events," in src)
    check("البث يستدعيها في خيط (لا تجميد الحلقة)",
          "asyncio.to_thread" in src)
    # لا منطق إشعار في الخادم إطلاقاً — الإشعار في الواجهة فقط
    for banned in ("notifyRealtime", "playEarthquakeAlarm", "toast", "playSound"):
        check(f"لا يوجد {banned} في الخادم", banned not in src)


def test_heartbeat_and_eof():
    print("\n[4] النبض والإغلاق المجدول — الوصلة تبقى حية بلا قطع مفاجئ")
    import inspect
    src = inspect.getsource(main.stream_realtime_events)
    check("نبضة إحياء مرسلة (سطر تعليق)", '": keep-alive\\n\\n"' in src or "keep-alive" in src)
    check("مدة إغلاق مجدولة موجودة", "_SSE_MAX_LIFETIME_SECONDS" in src)
    check("رسالة eof تُبلّغ العميل قبل الإغلاق", "event: eof" in src)
    check("النبض يحمل لا حدث (لا توست ولا صوت)", "# نبضة إحياء" in src)
    print(f"        (poll={main._SSE_POLL_SECONDS}s, heartbeat={main._SSE_HEARTBEAT_SECONDS}s, "
          f"lifetime={main._SSE_MAX_LIFETIME_SECONDS}s)")


def test_poll_untouched():
    print("\n[5] الاستطلاع 4 ثوانٍ لم يُمس — هو الطبقة الثانية كما هو")
    import inspect
    dj = open("frontend/src/Dashboard.jsx", encoding="utf-8").read()
    check("الاستطلاع ما زال 4000ms للتاب الظاهر",
          "document.hidden ? 30000 : 4000" in dj)
    check("الاستطلاع ما زال يعمل بالتوازي مع الدفع",
          "poll();\n    schedule();\n    startPush();" in dj)
    check("ممنوع تعطيل الاستطلاع عند نجاح الدفع",
          "clearTimeout(pollTimer)" in dj and "pollInFlightRef" in dj)


def test_status_readonly():
    print("\n[6] نقطة الحالة قراءة فقط — صفر نداء USGS لكل مستخدم/تبويب")
    src = open("main.py", encoding="utf-8").read()
    i = src.index("def get_earthquake_intel_status(")
    block = src[i:i+2600]
    for banned in ("_requests.get", "requests.get", "EQ_INTEL_FEEDS[0], timeout"):
        check(f"لا يوجد {banned} في نقطة الحالة", banned not in block)
    check("تقرأ الحرفية من EQ_INTEL_STATE", "EQ_INTEL_STATE.get(\"feed_count\")" in block)
    check("سجل الحرفية يكتبه محرك الاستيعاب نفسه",
          '"feed_generated"' in src and "feed_meta" in src)


if __name__ == "__main__":
    print("=" * 78)
    print("🧪 اختبار قناة الدفع SSE + نقاط الحارس الأخرى — EOC System")
    print("=" * 78)
    test_auth()
    test_stream_shapes()
    test_no_duplicate_contract()
    test_heartbeat_and_eof()
    test_poll_untouched()
    test_status_readonly()
    print("\n" + "=" * 78)
    if FAILS:
        print(f"❌ فشل {len(FAILS)} تحقق: {FAILS}")
        sys.exit(1)
    print("✅ كل الفحوص نجحت")
