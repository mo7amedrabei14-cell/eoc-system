#!/usr/bin/env python3
"""
🔐 مسبار التدقيق الأمني (RBAC / BOLA / سير العمل) — يُشغَّل قبل الإصلاح وبعده.

الغرض: إثبات الثغرات فعلياً (لا نظرياً) بطلبات حقيقية على التطبيق، ثم إعادة نفس
الطلبات بعد الإصلاح لإثبات الإغلاق (BLOCKED) *مع* إثبات أن الأدوار الشرعية لم تُكسر.

قواعد الأمان في المسبار نفسه:
  • ينشئ *مهمة اختبار خاصة به* بحساب المالك، وكل الهجمات تُوجَّه إليها فقط.
  • لا يعدّل أي بيانات إنتاجية، ويحذف مهمة الاختبار في آخر خطوة (cleanup).
  • التوكنات تُصدر بـ create_access_token (نفس ما يفعله التطبيق) — بلا كلمات مرور.
  • ترتيب الأقسام مهم: القسم المدمِّر (الحذف) في النهاية حتى لا تُلوّث بقية النتائج.
التشغيل:  python security_audit_probe.py
"""
import os
import sys

os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from fastapi.testclient import TestClient
from db import get_connection
from auth import create_access_token
import main as M

client = TestClient(M.app)

conn = get_connection()
cur = conn.cursor()


def uid(username):
    cur.execute("SELECT user_id FROM users WHERE username = %s AND is_active = TRUE", (username,))
    row = cur.fetchone()
    return row[0] if row else None


USERS = {
    "owner": uid("mrabea.x"),
    "manager": uid("manager"),
    "supervisor": uid("supervisor"),
    "joker": uid("joker"),
    "operation": uid("operation.upper") or uid("operation.HQ"),
    "youth": uid("yveoc"),
}
TOK = {k: create_access_token(v) for k, v in USERS.items() if v}
HDR = lambda k: {"Authorization": f"Bearer {TOK[k]}"}  # noqa: E731
print("users:", {k: v for k, v in USERS.items()})

RESULTS = []


def probe(title, expected_secure, method, path, who=None, body=None, headers=None, expect_secure_status=None):
    """يرسل طلباً ويسجّل: BLOCKED (آمن) أم ALLOWED (ثغرة).

    expected_secure=True  ⇒ الطلب يجب أن يُرفض (401/403 افتراضاً).
    expected_secure=False ⇒ الطلب يجب أن ينجح (رحلة دور شرعي).
    """
    h = dict(HDR(who)) if who else {}
    if headers:
        h.update(headers)
    r = client.request(method, path, json=body, headers=h)
    got = r.status_code
    secure_set = expect_secure_status or (401, 403)
    secure = got in secure_set
    RESULTS.append((title, got, secure, expected_secure))
    flag = "🟢 " if secure else "🔴 "
    kind = "BLOCKED" if expected_secure else "ALLOWED(legit)"
    print(f"{flag}{kind:<15}[{got:>3}] {title}")
    return r


# ── 0) تجهيز: مهمة اختبار بحساب المالك (نفس الحقول الإلزامية في السيرفر) ──────
MISSION = {
    "mission_name": "SECURITY PROBE — حذف تلقائي",
    "mission_classification": "عادية",
    "branch_id": 19,
    "mission_type": "طوارئ",
    "mission_location": "القاهرة",
    "data_source": "اختبار أمني (يُحذف)",
    "status": "Draft",
    "exit_date": "2027-02-01",
    "departure_time": "08:00",
    "notes": "",
    "routes": [],
    "vehicles": [],
    "join_leave_entries": [],
    "beneficiaries": [],
    "eoc_staff": [
        {"role_name": "مسؤول المتابعة", "staff_name": "اختبار أمني"},
        {"role_name": "المشرف", "staff_name": "اختبار أمني"},
        {"role_name": "الجوكر", "staff_name": "اختبار أمني"},
        {"role_name": "معبئ الاستمارة", "staff_name": "اختبار أمني"},
    ],
    "participants": [{
        "participant_type": "non_volunteer",
        "full_name": "مشارك اختبار أمني",
        "participant_position": "مراقب",
        "participation_role": "مراقب",
        "assigned_itinerary": "خط السير الأساسي",
        "branch_id": 19,
    }],
}

r = client.post("/api/missions", json=MISSION, headers=HDR("owner"))
if r.status_code not in (200, 201):
    print("❌ تعذّر إنشاء مهمة الاختبار:", r.status_code, r.text[:300])
    sys.exit(1)
MID = r.json()["mission_id"]
print(f"test mission_id = {MID}\n")

cur.execute("SELECT participant_id FROM mission_participants WHERE mission_id = %s ORDER BY participant_id LIMIT 1", (MID,))
PARTICIPANT_ID = cur.fetchone()[0]

line = "─" * 78

print(line)
print("A) الرحلة الشرعية أولاً (يجب أن تبقى ناجحة — لا يُكسر أي دور)")
print(line)
probe("owner يقرأ تفاصيل المهمة", False, "GET", f"/api/missions/{MID}", who="owner", expect_secure_status=(200,))
probe("owner يحفظ تعديلات بدون إجراء (save_edits_only)", False, "PUT", f"/api/missions/{MID}", who="owner",
      body={**MISSION, "action": "save_edits_only"}, expect_secure_status=(200,))
probe("youth يقرأ تفاصيل المهمة (مراجعة إدارة الشباب)", False, "GET", f"/api/missions/{MID}", who="youth",
      expect_secure_status=(200,))
probe("operation يقرأ تفاصيل المهمة", False, "GET", f"/api/missions/{MID}", who="operation", expect_secure_status=(200,))
probe("operation يرسل للجوكر (Under Review) عبر /status", False, "POST", f"/api/missions/{MID}/status",
      who="operation", body={"status": "Under Review"}, expect_secure_status=(200,))
probe("operation يحفظ مسودة عبر PUT (Draft)", False, "PUT", f"/api/missions/{MID}", who="operation",
      body={**MISSION, "status": "Draft"}, expect_secure_status=(200,))
probe("joker يعتمد المهمة (Approved) عبر /status", False, "POST", f"/api/missions/{MID}/status", who="joker",
      body={"status": "Approved"}, expect_secure_status=(200,))
probe("supervisor يقرأ كل المتطوعين", False, "GET", "/api/volunteers/all", who="supervisor", expect_secure_status=(200,))
probe("owner يقرأ سجل النظام", False, "GET", "/api/audit-logs?limit=2", who="owner", expect_secure_status=(200,))
probe("youth يقرأ القوة البشرية", False, "GET", "/api/human-resources", who="youth", expect_secure_status=(200,))

print("\n" + line)
print("B) تجاوز سير العمل: الدور الميداني (واجهته: إرسال للتحديثات فقط — بلا اعتماد/إنهاء)")
print(line)
probe("operation يرفع المهمة إلى Approved عبر /status", True, "POST", f"/api/missions/{MID}/status",
      who="operation", body={"status": "Approved"})
probe("operation يغلق المهمة Completed عبر /status", True, "POST", f"/api/missions/{MID}/status",
      who="operation", body={"status": "Completed", "completion_date": "2027-02-02", "completion_time": "18:00"})
probe("operation يغلق المهمة عبر PUT (نفس الحمولة الكاملة)", True, "PUT", f"/api/missions/{MID}",
      who="operation", body={**MISSION, "status": "Completed", "completion_date": "2027-02-02", "completion_time": "18:00"})
probe("operation يُرجع المهمة للمتطوع Returned عبر PUT", True, "PUT", f"/api/missions/{MID}",
      who="operation", body={**MISSION, "status": "Returned"})

print("\n" + line)
print("C) دور القراءة فقط (READ_ONLY_MISSIONS): لا استمارة ولا أزرار كتابة في الواجهة")
print(line)
probe("youth يعدّل المهمة عبر PUT", True, "PUT", f"/api/missions/{MID}", who="youth", body=MISSION)
probe("youth يغيّر الحالة عبر /status", True, "POST", f"/api/missions/{MID}/status", who="youth", body={"status": "Approved"})
probe("youth يُنهي مشاركة عبر end-participation", True, "POST", f"/api/missions/{MID}/end-participation",
      who="youth", body={"participant_ids": [PARTICIPANT_ID]})
probe("youth يُنشئ سجل انضمام/انفصال", True, "POST", f"/api/missions/{MID}/join-leave-entries",
      who="youth", body={"title": "بروب أمني", "kind": "join", "dt": "2027-02-01 09:00"})

print("\n" + line)
print("D) مسارات حذف بلا حد دور في السيرفر (الواجهة تُخفيها عن الدور الميداني)")
print(line)
probe("operation يحذف سجلاً في الأخبار المحلية", True, "DELETE", "/api/local-news/999999999", who="operation")
probe("operation يحذف كارثة عالمية", True, "DELETE", "/api/global-disasters/999999999", who="operation")
probe("operation يحذف خبر الرادار (AI)", True, "DELETE", "/api/ai-news/999999999", who="operation")
probe("joker يحذف خبر الرادار (المالك فقط في الواجهة)", True, "DELETE", "/api/ai-news/999999999", who="joker")

print("\n" + line)
print("E) نقاط بلا مصادقة إطلاقاً / تحقق من المدخلات / تسريب الأخطاء")
print(line)
probe("GET /branches/ (راوتر الفروع) بلا توكن", True, "GET", "/branches/")
probe("GET /api/volunteers/all بلا توكن", True, "GET", "/api/volunteers/all")
probe("GET /api/dashboard/stats بلا توكن", True, "GET", "/api/dashboard/stats")
probe("GET /api/branches/locations بلا توكن", True, "GET", "/api/branches/locations")
probe("GET مهمة غير موجودة ⇒ 404 لا 500", True, "GET", "/api/missions/999999999", who="owner",
      expect_secure_status=(404,))
probe("DELETE مهمة غير موجودة ⇒ 404 لا 500", True, "DELETE", "/api/missions/999999999", who="owner",
      expect_secure_status=(404,))
probe("رابط خبر بصيغة javascript: للرادار (يجب رفضه)", True, "POST", "/api/ai-news", who="owner",
      body={"incident_description": "بروب", "news_link": "javascript:alert(1)"}, expect_secure_status=(422, 400))

h = client.get("/api/health").json()
leak = any(k in str(h.get("database", {})) for k in ("@", "password=", "postgres://", "postgresql://"))
RESULTS.append(("نقطة الصحة لا تسرّب بيانات اتصال خام", 200, not leak, True))
print(("🟢 " if not leak else "🔴 ") + f"{'CLEAN':<15}[200] نقطة الصحة لا تسرّب بيانات اتصال خام")

print("\n" + line)
print("F) تنظيف: حذف مهمة الاختبار بحساب المالك")
print(line)
r = client.delete(f"/api/missions/{MID}", headers=HDR("owner"))
print(f"cleanup delete -> {r.status_code}")
cur.execute("SELECT COUNT(*) FROM missions WHERE mission_id = %s", (MID,))
print("mission still exists in DB:", cur.fetchone()[0])

cur.close()
conn.close()

print("\n" + "=" * 78)
bad = [x for x in RESULTS if not x[2]]
print(f"نتائج: {len(RESULTS)} حالة | 🔴 غير مطابق = {len(bad)} | 🟢 مطابق = {len(RESULTS) - len(bad)}")
for t, code, _, exp in bad:
    print(f"   🔴 [{code}] {'(يجب أن يُرفض)' if exp else '(رحلة شرعية يجب أن تنجح)'} {t}")
print("=" * 78)
sys.exit(1 if bad else 0)
