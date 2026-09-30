#!/usr/bin/env python3
"""
🧪 اختبار انحدار لقناة البوت على أخبار الرادار (AI News):
   1) GET /api/ai-news بمفتاح النظام (SYSTEM_TOKEN) يرجّع السجلات (چانل الرادار).
   2) PUT /api/ai-news/{id} بمفتاح النظام يعيد تحليل خبر كان «غير مصنف (فشل التحليل)»
      — هذا ما يعتمد عليه محرّك الإصلاح في ai_radar.py (repair_unanalyzed_news).
   3) توكن عشوائي غير صالح لا يُقبل على نفس المسار (401).
   4) الحمولة المُصلَحة تُكتب فعلاً في القاعدة وتحمل سطر «مصدر التحليل».
التشغيل: PYTHONIOENCODING=utf-8 python test_ai_news_repair_flow.py
"""
import os
import sys

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
from dotenv import load_dotenv  # noqa: E402

load_dotenv()

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from fastapi.testclient import TestClient  # noqa: E402

import ai_radar as R  # noqa: E402
import main as M  # noqa: E402
from db import get_connection  # noqa: E402

failed = []
passed = 0


def check(label, condition, detail=""):
    global passed
    if condition:
        passed += 1
        print(f"✅ {label}")
    else:
        failed.append(label)
        print(f"❌ {label} {detail}")


token = (os.environ.get("SYSTEM_TOKEN") or "").strip()
bot_channel = bool(token)
if not token:
    # لا مفتاح نظام محلياً (المفتاح الحقيقي في Vercel/GitHub Secrets) ⇒ نتحقق بشكل
    # الحمولة ومسار الكتابة بتوكن مالك حقيقي، ونعلن أن اختبار قناة البوت مُتخطّى.
    print("ℹ️ SYSTEM_TOKEN غير مُعد محلياً — سيُستخدم توكن المالك للتحقق من شكل الحمولة")
    from auth import create_access_token  # noqa: E402
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT u.user_id FROM users u
                JOIN user_roles ur ON ur.user_id = u.user_id
                JOIN roles r ON r.role_id = ur.role_id
                WHERE r.role_name = 'OWNER' AND u.is_active = TRUE LIMIT 1
            """)
            owner_row = cursor.fetchone()
    finally:
        connection.close()
    if not owner_row:
        print("⚠️ لا يوجد حساب مالك — تخطّي الاختبار")
        sys.exit(0)
    token = create_access_token(owner_row[0])

client = TestClient(M.app)
headers = {"Authorization": f"Bearer {token}"}

resp = client.get("/api/ai-news", headers=headers)
check("GET /api/ai-news بالتوكن المستخدم", resp.status_code == 200, resp.status_code)
rows = resp.json() if resp.status_code == 200 else []
check("الرد قائمة سجلات", isinstance(rows, list) and bool(rows), type(rows))

pending = [r for r in rows if isinstance(r, dict) and R._needs_repair(r) and r.get("news_link")]
print(f"   سجلات بلا تحليل داخل القاعدة: {len(pending)}")

if pending:
    row = pending[-1]
    article = {
        "title": (row.get("incident_description") or "بلاغ"),
        "text": row.get("incident_description") or "",
        "link": row["news_link"],
        "publisher": row.get("news_publisher") or "",
        "image_url": "لا توجد صورة",
    }
    analysis = R.fallback_analysis(article, "اختبار انحدار")
    payload = {
        "incident_date": (str(row.get("incident_date") or "")[:10] or None),
        "incident_month": row.get("incident_month"),
        "incident_description": analysis["incident_description"],
        "news_type": analysis["news_type"],
        "news_publisher": row.get("news_publisher"),
        "street_name": analysis["street_name"],
        "area_name": analysis["area_name"],
        "governorate": analysis["governorate"] if analysis["governorate"] not in (None, "", "-") else (row.get("governorate") or "-"),
        "hospital_name": analysis["hospital_name"],
        "injured_count": str(analysis["injured_count"]),
        "deaths_count": str(analysis["deaths_count"]),
        "news_updates": R._build_tactical_report(article, analysis),
        "news_link": row["news_link"],
        "data_entry_name": row.get("data_entry_name") or "OSINT  AI",
        "observed_at": (str(row.get("observed_at") or "")[:19] or None),
    }
    put = client.put(f"/api/ai-news/{row['id']}", json=payload, headers=headers)
    label = "PUT يعمل (قناة البوت بمفتاح النظام)" if bot_channel else "PUT يعمل (شكل حمولة الإصلاح مقبول)"
    check(label, put.status_code in (200, 201), f"{put.status_code} {put.text[:160]}")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT news_type, news_updates FROM ai_news WHERE id = %s", (row["id"],))
            stored = cursor.fetchone()
    finally:
        connection.close()
    check("التصنيف القديم استُبدل بتصنيف حقيقي", stored and "فشل التحليل" not in str(stored[0]), stored)
    check("سطر «مصدر التحليل» مكتوب في القاعدة", stored and "مصدر التحليل" in str(stored[1] or ""))
else:
    print("ℹ️ لا توجد سجلات بلا تحليل — هذه نتيجة أفضل (كل الأخبار محلَّلة).")

bad = client.put("/api/ai-news/1", json={"news_link": "https://example.com"}, headers={"Authorization": "Bearer not.a.token"})
check("توكن غير صالح مرفوض (401)", bad.status_code in (401, 403), bad.status_code)

print("\n" + "=" * 60)
print(f"نتيجة: ✅ {passed} نجح | ❌ {len(failed)} فشل")
for label in failed:
    print("   ❌", label)
print("=" * 60)
sys.exit(1 if failed else 0)
