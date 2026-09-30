#!/usr/bin/env python3
"""
🧪 اختبار انحدار لمحرّك تحليل أخبار الرادار — الهدف: *لا خبر بلا تحليل*.

يغطّي:
  1) التحليل الاحتياطي المحلي (بلا API): تصنيف + خطورة + محافظة + أرقام.
  2) ثبات محلّل JSON: يرفض النص المقطوع/الفارغ ويقبل JSON داخل ``` أو مع نص زائد.
  3) السلوك عند فشل كل النماذج المجانية (404/429/شبكة): يرجّع dict لكل خبر ولا None.
  4) send_report: لا يكتب أبداً «غير مصنف (فشل التحليل)» ولا «تعذر التحليل».
  5) اختبار حقيقي مباشر على Gemini (اختياري): AI_LIVE=1 PYTHONIOENCODING=utf-8 python test_ai_radar_resilience.py
"""
import os
import sys

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import ai_radar as R  # noqa: E402

FAILED_CHUNKS = ("فشل التحليل", "تعذر التحليل")
passed = 0
failed = []


def check(label, condition, detail=""):
    global passed
    if condition:
        passed += 1
        print(f"✅ {label}")
    else:
        failed.append(label)
        print(f"❌ {label} {detail}")


def no_failure_marker(text):
    return not any(chunk in str(text or "") for chunk in FAILED_CHUNKS)


ARTICLES = [
    {"title": "حريق هائل بمخزن أخشاب في شبرا الخيمة", "text": "اندلع حريق كبير في مخزن أخشاب بشارع ترعة الإسماعيلية، وتم الدفع بـ 6 سيارات إطفاء، وأسفر عن إصابة 4 حالات اختناق.", "link": "https://example.com/a1", "publisher": "صدى البلد", "image_url": "لا توجد صورة"},
    {"title": "تصادم ميكروباص بسيارة نقل على طريق مصر أسوان", "text": "وقع تصادم على الطريق الصحراوي أسفر عن مصرع 3 وإصابة 9 أشخاص، وتم نقل المصابين لمستشفى بني سويف العام.", "link": "https://example.com/a2", "publisher": "اليوم السابع", "image_url": "لا توجد صورة"},
    {"title": "-", "text": "", "link": "https://example.com/a3", "publisher": "?", "image_url": "لا توجد صورة"},
]

print("=== 1) التحليل الاحتياطي المحلي (بلا ذكاء اصطناعي) ===")
for article in ARTICLES:
    result = R.fallback_analysis(article)
    check(f"dict كامل للخبر: {article['title'][:35]}", isinstance(result, dict) and bool(result.get("news_type")), result)
    check("   لا توجد علامة فشل في النتيجة", no_failure_marker(result.get("news_type")) and no_failure_marker(result.get("tactical_recommendations")))
    check("   الخطورة رقم منطقي 1..10", isinstance(result.get("severity_score"), int) and 1 <= result["severity_score"] <= 10, result.get("severity_score"))

fire = R.fallback_analysis(ARTICLES[0])
crash = R.fallback_analysis(ARTICLES[1])
check("تصنيف الحريق = حريق", fire["news_type"] == "حريق", fire["news_type"])
check("تصنيف التصادم = حادث مروري", crash["news_type"] == "حادث مروري", crash["news_type"])
check("استخراج الأرقام (مصرع 3 / إصابة 9)", (crash["deaths_count"], crash["injured_count"]) == (3, 9), (crash["deaths_count"], crash["injured_count"]))
check("المحافظة استُنتجت (بني سويف/القليوبية)", crash["governorate"] != "-" or fire["governorate"] != "-", (crash["governorate"], fire["governorate"]))
check("توصيات ميدانية غير فارغة", len(str(crash["tactical_recommendations"])) > 20)
check("خبر بلا نص لا يفشل التحليل", R.fallback_analysis(ARTICLES[2])["news_type"] != "")

print("\n=== 2) ثبات محلّل JSON ===")
check("نص فارغ ⇒ None", R._parse_ai_json("") is None)
check("نص مقطوع ⇒ None", R._parse_ai_json('[{"title": "x", "news_type":') is None)
check("JSON داخل ``` ⇒ list", isinstance(R._parse_ai_json('```json\n[{"news_type":"حريق"}]\n```'), list))
check("JSON مع نص زائد ⇒ list", isinstance(R._parse_ai_json('إليك النتيجة:\n[{"news_type":"حريق"}]\nأتمنى الإفادة'), list))
check("dict واحد ⇒ list", isinstance(R._parse_ai_json('{"news_type":"حريق"}'), list))

print("\n=== 3) فشل كل النماذج المجانية ⇒ تحليل مضمون لكل خبر (لا None) ===")
R.GEMINI_API_KEY = R.GEMINI_API_KEY or "dummy-key"
R.dead_models.update(R.GEMINI_MODELS)
R.quota_exhausted_models.update(R.GEMINI_MODELS)
results = R.analyze_batch_with_ai(ARTICLES)
check("عدد النتائج = عدد الأخبار", len(results) == len(ARTICLES), len(results))
check("لا يوجد None إطلاقاً", all(isinstance(item, dict) for item in results), results)
check("لا تصنيف فشل في أي نتيجة", all(no_failure_marker(item.get("news_type")) for item in results))
R.dead_models.clear()
R.quota_exhausted_models.clear()

print("\n=== 3.b) فشل النماذج برد غير صالح (JSON مكسور) ⇒ تقسيم الدفعة ثم ضمان) ===")
captured = {"calls": 0}


class FakeResponse:
    status_code = 200
    text = ""

    def json(self):
        return {"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": ""}]}}]}


real_post = R.requests.post
R.requests.post = lambda *a, **k: (captured.__setitem__("calls", captured["calls"] + 1), FakeResponse())[1]
try:
    results = R.analyze_batch_with_ai(ARTICLES)
finally:
    R.requests.post = real_post
check("لا None مع ردود مكسورة", all(isinstance(item, dict) for item in results), results)
check("لا تصنيف فشل مع ردود مكسورة", all(no_failure_marker(item.get("news_type")) for item in results))
check("جرّب أكثر من نداء (سلوك التقسيم/تعدد النماذج)", captured["calls"] > 1, captured["calls"])

print("\n=== 4) send_report لا يكتب «فشل التحليل» أبداً ===")
sent = {}


def fake_post(url, json=None, headers=None, timeout=None):  # noqa: A002
    sent["payload"] = json

    class Ok:
        status_code = 201
        text = "ok"
    return Ok()


R.requests.post = fake_post
try:
    R.send_report(ARTICLES[1], None)
    payload = sent["payload"]
    check("news_type ليس «غير مصنف (فشل التحليل)»", no_failure_marker(payload.get("news_type")), payload.get("news_type"))
    check("news_updates بلا «تعذر التحليل»", no_failure_marker(payload.get("news_updates")))
    check("التقرير يوضح مصدر التحليل", "مصدر التحليل" in payload.get("news_updates", ""))
    check("الخطورة رقمية لا ?", "/10" in payload.get("news_updates", "") and "?:/10" not in payload.get("news_updates", ""))
    R.send_report(ARTICLES[0], R.fallback_analysis(ARTICLES[0]))
    check("التحليل المحلي يُوسم كمصدر احتياطي", "احتياطي" in sent["payload"].get("news_updates", ""))
finally:
    R.requests.post = real_post

print("\n=== 5) اختبار حقيقي على Gemini (اختياري AI_LIVE=1) ===")
if os.environ.get("AI_LIVE") == "1":
    live = R.analyze_batch_with_ai(ARTICLES[:2])
    check("التحليل الحي يرجّع dict لكل خبر", all(isinstance(i, dict) for i in live))
    from collections import Counter
    sources = Counter(i.get("analysis_source", "ai") for i in live)
    print("   مصادر التحليل:", dict(sources))
    for item in live:
        print("   •", item.get("news_type"), "| خطورة", item.get("severity_score"), "|", item.get("governorate"))
    check("التحليل الحي لا يحمل علامة فشل", all(no_failure_marker(i.get("news_type")) for i in live))
else:
    print("ℹ️ مُتخطّى (شغّله بـ AI_LIVE=1 لاختبار Gemini فعلياً)")

print("\n" + "=" * 60)
print(f"نتيجة: ✅ {passed} نجح | ❌ {len(failed)} فشل")
for label in failed:
    print("   ❌", label)
print("=" * 60)
sys.exit(1 if failed else 0)
