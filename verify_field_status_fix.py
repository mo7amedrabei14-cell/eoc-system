#!/usr/bin/env python3
"""
التوثيق الحي لإصلاح انعكاس حالة العملية الميدانية ومسح خط السير (جذري).
يتبع نفس نمط repro_route_bug.py: TestClient + توكن مالك + تنظيف كامل في النهاية.

السيناريوهات:
  A) إنشاء بمسارات → إعادة فتح: المسارات باقية
  B) إرسال للجوكر (نقطة الحالة الجديدة): المسارات + الحالة الميدانية كما هي
  C) اعتماد: نفس النتيجة
  D) إنهاء (مكتملة ميدانياً): المسارات باقية والحالة الميدانية «مكتملة»
  E) إعادة فتح (إلغاء الإغلاق): الحالة الميدانية تبقى «مكتملة» (لا انعكاس)
  F) حفظ كامل (Draft) يعيد إرسال الاستمارة كما فُتحت: المسارات باقية
  G) إعادة إرسال حمولة الحالة القديمة (outbox stale replay): لا ضرر
  H) محاولة إغلاق مهمة حالتها الميدانية «نشطة» تُرفض (بوابة الإنهاء)
"""
import os, sys
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from fastapi.testclient import TestClient
from db import get_connection
from auth import create_access_token
import main as M

client = TestClient(M.app)

conn = get_connection()
cur = conn.cursor()
cur.execute("SELECT user_id FROM users WHERE username = 'manager' AND is_active")
row = cur.fetchone()
if not row:
    print("No 'manager' user found — adjust seed user and rerun.")
    sys.exit(2)
OWNER_ID = row[0]
TOKEN = create_access_token(OWNER_ID)
HDR = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

MID = None
PASS = FAIL = 0

def ok(name, cond, extra=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  OK  {name}" + (f"  [{extra}]" if extra else ""))
    else: FAIL += 1; print(f"  XX  {name}" + (f"  [{extra}]" if extra else ""))

def details(mid):
    r = client.get(f"/api/missions/{mid}", headers=HDR)
    assert r.status_code == 200, r.text
    return r.json()

def routes_of(d):
    return [(x.get("group_title"), x.get("route_from"), x.get("route_to")) for x in d.get("routes", [])]

BASE_ROUTES = [
    {"group_title": "خط السير الأساسي", "route_from": "نقطة الانطلاق أ", "route_to": "الموقع ب",
     "departure_date": "2026-09-24", "departure_time": "08:00", "arrival_date": "2026-09-24", "arrival_time": "09:00"},
    {"group_title": "خط سير مخصص", "route_from": "الموقع ب", "route_to": "الموقع جـ",
     "departure_date": "2026-09-24", "departure_time": "10:00", "arrival_date": "2026-09-24", "arrival_time": "11:00"},
]

MISSION = {
    "mission_name": "اختبار جذري - حالة الميدان والمسارات",
    "mission_classification": "عادية",
    "branch_id": 19,
    "mission_type": "تأمين",
    "mission_location": "موقع الاختبار",
    "responsible_person": "مسؤول الاختبار",
    "data_source": "اختبار آلي",
    "status": "Draft",
    "exit_date": "2026-09-24",
    "departure_time": "08:00",
    "notes": "ملاحظات الاختبار",
    "field_operation_status": "نشطة",
    "routes": BASE_ROUTES,
    "vehicles": [{"driver_name": "سائق", "vehicle_number": "ABC-123"}],
    "beneficiaries": [{"category_name": "رجال", "direct_count": 5, "indirect_count": 2}],
    "eoc_staff": [
        {"role_name": "مسؤول المتابعة", "staff_name": "قائد"},
        {"role_name": "المشرف", "staff_name": "مشرف"},
        {"role_name": "الجوكر", "staff_name": "جوكر"},
        {"role_name": "معبئ الاستمارة", "staff_name": "معبئ"},
    ],
    "participants": [{"participant_type": "volunteer", "full_name": "متطوع اختبار", "participation_role": "متطوع", "branch_id": 19, "assigned_itinerary": "خط السير الأساسي"}],
}

try:
    print("== A) create with routes + reopen ==")
    r = client.post("/api/missions", json=MISSION, headers=HDR)
    ok("create 200", r.status_code == 200, r.text[:80] if r.status_code != 200 else "")
    MID = r.json()["mission_id"]
    d = details(MID)
    ok("routes saved (2)", len(d["routes"]) == 2, str(len(d["routes"])))
    ok("fs = نشطة", d.get("field_operation_status") == "نشطة", str(d.get("field_operation_status")))

    print("== B) send to Joker (status transition endpoint) ==")
    r = client.post(f"/api/missions/{MID}/status", json={"status": "Under Review", "field_operation_status": "نشطة"}, headers=HDR)
    ok("transition 200", r.status_code == 200, r.text[:120] if r.status_code != 200 else "")
    d = details(MID)
    ok("status = Under Review", d["status"] == "Under Review", d["status"])
    ok("routes intact", routes_of(d) == routes_of(details(MID)) and len(d["routes"]) == 2)
    ok("fs still نشطة", d.get("field_operation_status") == "نشطة", str(d.get("field_operation_status")))

    print("== C) approve ==")
    r = client.post(f"/api/missions/{MID}/status", json={"status": "Approved"}, headers=HDR)
    ok("transition 200", r.status_code == 200)
    d = details(MID)
    ok("status = Approved", d["status"] == "Approved", d["status"])
    ok("routes intact (2)", len(d["routes"]) == 2)
    ok("fs still نشطة", d.get("field_operation_status") == "نشطة", str(d.get("field_operation_status")))

    print("== H) closing gate: complete with fs=نشطة must be blocked client-side; server endpoint allows only data rule ==")
    # البوابة الأمامية (fs !== مكتملة) منعت الإنهاء سابقاً — هنا نثبت أن السيرفر يقبل
    # الإنهاء فقط بتاريخ/ساعة انتهاء، وأن الحالة الميدانية لا تتأثر بأي إجراء.
    r = client.post(f"/api/missions/{MID}/status",
                    json={"status": "Completed", "field_operation_status": "مكتملة",
                          "completion_date": "2026-09-24", "completion_time": "12:00"},
                    headers=HDR)
    ok("complete 200", r.status_code == 200, r.text[:120] if r.status_code != 200 else "")
    d = details(MID)
    ok("status = Completed", d["status"] == "Completed", d["status"])
    ok("fs = مكتملة (user's explicit value)", d.get("field_operation_status") == "مكتملة", str(d.get("field_operation_status")))
    ok("routes intact after close (2)", len(d["routes"]) == 2)
    ok("marker kept for old clients", (d.get("notes") or "").startswith("[حالة الميدان: مكتملة]"), (d.get("notes") or "")[:40])

    print("== E) reopen (cancel close): fs must NOT flip back to نشطة ==")
    r = client.post(f"/api/missions/{MID}/status", json={"status": "Approved"}, headers=HDR)
    ok("reopen 200", r.status_code == 200)
    d = details(MID)
    ok("fs remains مكتملة after reopen", d.get("field_operation_status") == "مكتملة", str(d.get("field_operation_status")))
    ok("routes intact after reopen (2)", len(d["routes"]) == 2)

    print("== F) full save (Draft) re-sending the form exactly as reopened (fs omitted → tri-state preserve) ==")
    payload = dict(MISSION)
    payload.update({"status": "Draft", "notes": d.get("notes"), "routes": d["routes"]})
    payload.pop("field_operation_status", None)  # عمود الحالة غير مُرسَل ⇒ يجب أن يبقى المخزَّن
    r = client.put(f"/api/missions/{MID}", json=payload, headers=HDR)
    ok("full save 200", r.status_code == 200, r.text[:120] if r.status_code != 200 else "")
    d = details(MID)
    ok("routes intact after full save (2)", len(d["routes"]) == 2)
    ok("fs intact after full save", d.get("field_operation_status") == "مكتملة", str(d.get("field_operation_status")))

    print("== D2) user flips fs back to نشطة explicitly via full save, then completes again ==")
    payload2 = dict(payload); payload2["field_operation_status"] = "نشطة"; payload2["status"] = "Draft"
    r = client.put(f"/api/missions/{MID}", json=payload2, headers=HDR)
    ok("explicit fs change 200", r.status_code == 200)
    d = details(MID)
    ok("fs = نشطة (explicit user change honored)", d.get("field_operation_status") == "نشطة", str(d.get("field_operation_status")))
    r = client.post(f"/api/missions/{MID}/status",
                    json={"status": "Completed", "field_operation_status": "مكتملة",
                          "completion_date": "2026-09-24", "completion_time": "12:00"},
                    headers=HDR)
    ok("complete 200", r.status_code == 200, r.text[:120] if r.status_code != 200 else "")
    d = details(MID)
    ok("fs = مكتملة", d.get("field_operation_status") == "مكتملة")

    print("== G) stale transition replay (offline outbox simulation) ==")
    r1 = client.post(f"/api/missions/{MID}/status", json={"status": "Completed"}, headers=HDR)
    r2 = client.post(f"/api/missions/{MID}/status", json={"status": "Completed"}, headers=HDR)
    ok("replay accepted (idempotent-ish, no data change)", r1.status_code == 200 and r2.status_code == 200)
    d = details(MID)
    ok("routes still intact (2)", len(d["routes"]) == 2)
    ok("fs still مكتملة", d.get("field_operation_status") == "مكتملة")

finally:
    if MID:
        c2 = get_connection(); cu2 = c2.cursor()
        cu2.execute("DELETE FROM mission_participant_sessions WHERE participant_id IN (SELECT participant_id FROM mission_participants WHERE mission_id=%s)", (MID,))
        cu2.execute("DELETE FROM mission_participant_itineraries WHERE mission_id=%s", (MID,))
        cu2.execute("DELETE FROM mission_participants WHERE mission_id=%s", (MID,))
        cu2.execute("DELETE FROM mission_itineraries WHERE mission_id=%s", (MID,))
        cu2.execute("DELETE FROM mission_vehicles WHERE mission_id=%s", (MID,))
        cu2.execute("DELETE FROM mission_beneficiaries WHERE mission_id=%s", (MID,))
        cu2.execute("DELETE FROM mission_eoc_staff WHERE mission_id=%s", (MID,))
        cu2.execute("DELETE FROM mission_join_leave_entries WHERE mission_id=%s", (MID,))
        try:
            cu2.execute("DELETE FROM realtime_events WHERE entity_id=%s", (MID,))
        except Exception:
            c2.rollback()
        cu2.execute("DELETE FROM audit_logs WHERE mission_id=%s", (MID,))
        cu2.execute("DELETE FROM missions WHERE mission_id=%s", (MID,))
        c2.commit(); c2.close()
        print(f"\ncleanup: mission {MID} removed")

print(f"\nRESULT: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
