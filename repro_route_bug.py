#!/usr/bin/env python3
"""
Empirical reproduction of the 'route deleted on reopen' bug.

Flow mirrors the real frontend:
  1) POST /api/missions with 2 basic routes + 1 custom itinerary (like the form).
  2) GET /api/missions/{id}  (reopen — what handleViewMission receives).
  3) PUT /api/missions/{id} re-sending EXACTLY what the reopen returned,
     but with status 'Under Review' (the user's next action).
  4) GET again — do routes survive?

Rollback-only: mission row is deleted at the end (children cascade via explicit deletes).
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
OWNER_ID = row[0]
TOKEN = create_access_token(OWNER_ID)
HDR = {"Authorization": f"Bearer {TOKEN}"}

MID = None
PASS = FAIL = 0

def ok(name, cond, extra=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  OK  {name}" + (f"  [{extra}]" if extra else ""))
    else: FAIL += 1; print(f"  XX  {name}" + (f"  [{extra}]" if extra else ""))

try:
    payload = {
        "mission_name": "اختبار حذف الخط السير",
        "mission_classification": "عادية",
        "branch_id": 19,
        "mission_type": "تأمين",
        "mission_location": "القاهرة",
        "responsible_person": "مختبر",
        "data_source": "اتصال",
        "status": "Draft",
        "exit_date": "2026-09-25",
        "departure_time": "08:00",
        "start_time": None, "return_date": None, "arrival_date": None, "arrival_time": None,
        "completion_date": None, "completion_time": None, "departure_date": None,
        "notes": "[حالة الميدان: نشطة الآن]\n",
        "internal_notes": "",
        "team_code": "",
        "creation_datetime": "2026-09-25T08:00",
        "routes": [
            {"group_title": "خط السير الأساسي", "route_from": "القاهرة", "route_to": "الإسكندرية",
             "departure_date": "2026-09-25", "departure_time": "08:00",
             "arrival_date": "2026-09-25", "arrival_time": "10:00"},
            {"group_title": "خط السير الأساسي", "route_from": "الإسكندرية", "route_to": "دمنهور",
             "departure_date": "2026-09-25", "departure_time": "11:00",
             "arrival_date": "2026-09-25", "arrival_time": "13:00"},
            {"group_title": "تحركات اليوم الأول", "route_from": "دمنهور", "route_to": "كفر الشيخ",
             "departure_date": "2026-09-26", "departure_time": "09:00",
             "arrival_date": "2026-09-26", "arrival_time": "12:00"}
        ],
        "vehicles": [{"driver_name": "سائق اختبار", "vehicle_number": "ABC 123"}],
        "participants": [{
            "participant_type": "volunteer",
            "full_name": "مختبر الخط السير",
            "team_name": "", "team_code": "",
            "participation_role": "مختبر-99991",
            "participant_position": "",
            "branch_id": 19,
            "assigned_itinerary": "خط السير الأساسي",
            "return_status": "مازال بالمهمة",
            "phase_name": "اليوم الأول",
            "stay_type": "ذهاب وعودة",
            "start_from_mission": True
        }],
        "beneficiaries": [],
        "eoc_staff": [
            {"role_name": "مسؤول المتابعة", "staff_name": "قائد"},
            {"role_name": "المشرف", "staff_name": "مشرف"},
            {"role_name": "الجوكر", "staff_name": "جوكر"},
            {"role_name": "معبئ الاستمارة", "staff_name": "معبئ"},
        ],
        "join_leave_entries": [],
        "idempotency_key": "repro-routes-" + os.urandom(8).hex(),
        "clear_details": False
    }

    # ── 1) CREATE ──
    r = client.post("/api/missions", json=payload, headers=HDR)
    print("POST status:", r.status_code)
    if r.status_code != 200:
        print("POST body:", r.text[:500]); sys.exit(1)
    MID = r.json()["mission_id"]
    ok("POST created mission", True, f"mission_id={MID}")

    cur.execute("SELECT COUNT(*) FROM mission_itineraries WHERE mission_id=%s", (MID,))
    n = cur.fetchone()[0]
    ok("DB has 3 itinerary rows after create", n == 3, f"rows={n}")

    # ── 2) REOPEN (GET detail) ──
    r = client.get(f"/api/missions/{MID}", headers=HDR)
    ok("GET detail 200", r.status_code == 200, str(r.status_code))
    detail = r.json()
    ok("reopen returns 3 routes", len(detail.get("routes", [])) == 3,
       f"got {len(detail.get('routes', []))}")
    print("   routes on reopen:", [(x["group_title"], x["route_from"], x["route_to"]) for x in detail.get("routes", [])])

    # ── 3) RESAVE (PUT) — send back exactly what reopen returned (the frontend behavior),
    #        with from/to values read from the RouteCard DOM (they exist) but dep/arr as the
    #        hidden carrier fields hold them (format HH:MM). We replay the SAME routes. ──
    resave = dict(payload)
    resave["status"] = "Under Review"
    resave["idempotency_key"] = "repro-routes-resave-" + os.urandom(8).hex()
    r = client.put(f"/api/missions/{MID}", json=resave, headers=HDR)
    print("PUT status:", r.status_code)
    if r.status_code != 200:
        print("PUT body:", r.text[:800])
    ok("PUT resave 200", r.status_code == 200)

    cur.execute("SELECT COUNT(*) FROM mission_itineraries WHERE mission_id=%s", (MID,))
    n = cur.fetchone()[0]
    ok("DB still has 3 itinerary rows after resave", n == 3, f"rows={n}")

    r = client.get(f"/api/missions/{MID}", headers=HDR)
    detail2 = r.json()
    ok("routes survive resave", len(detail2.get("routes", [])) == 3,
       f"got {len(detail2.get('routes', []))}")

    # ── 4) THE REAL SCENARIO: reopen → save WITHOUT touching routes but with
    #        empty routes array (what the broken frontend would send if DOM ids missing) ──
    resave2 = dict(payload)
    resave2["status"] = "Approved"
    resave2["routes"] = []            # ← the fatal payload
    resave2["idempotency_key"] = "repro-routes-empty-" + os.urandom(8).hex()
    r = client.put(f"/api/missions/{MID}", json=resave2, headers=HDR)
    ok("empty-routes PUT accepted", r.status_code == 200)
    cur.execute("SELECT COUNT(*) FROM mission_itineraries WHERE mission_id=%s", (MID,))
    n = cur.fetchone()[0]
    ok("routes still survive empty-routes save (shield works)", n == 3, f"rows={n}")

    # ── 5) DATE-ONLY route row (from/to empty but dates set) must survive reopen+resave ──
    resave3 = dict(payload)
    resave3["status"] = "Approved"
    resave3["routes"] = [
        {"group_title": "خط السير الأساسي", "route_from": "القاهرة", "route_to": "الإسكندرية",
         "departure_date": "2026-09-25", "departure_time": "08:00",
         "arrival_date": "2026-09-25", "arrival_time": "10:00"},
        {"group_title": "تحركات اليوم الأول", "route_from": None, "route_to": "",
         "departure_date": "2026-09-26", "departure_time": "09:00",
         "arrival_date": "2026-09-26", "arrival_time": None},
    ]
    resave3["idempotency_key"] = "repro-routes-dateonly-" + os.urandom(8).hex()
    r = client.put(f"/api/missions/{MID}", json=resave3, headers=HDR)
    ok("date-only route PUT 200", r.status_code == 200, r.text[:200] if r.status_code != 200 else "")
    r = client.get(f"/api/missions/{MID}", headers=HDR)
    detail3 = r.json()
    ok("date-only route stored (2 rows)", len(detail3.get("routes", [])) == 2,
       f"got {len(detail3.get('routes', []))}")
    # resave AGAIN via empty payload → date-only row must also survive (backend shield)
    resave4 = dict(resave3)
    resave4["routes"] = []
    resave4["idempotency_key"] = "repro-routes-dateonly-empty-" + os.urandom(8).hex()
    r = client.put(f"/api/missions/{MID}", json=resave4, headers=HDR)
    cur.execute("SELECT COUNT(*) FROM mission_itineraries WHERE mission_id=%s", (MID,))
    n = cur.fetchone()[0]
    ok("date-only route survives empty-payload save", n == 2, f"rows={n}")

    # ── 6) INTENTIONAL clear still works: clear_details=True wipes routes ──
    resave5 = dict(resave3)
    resave5["routes"] = []
    resave5["clear_details"] = True
    resave5["idempotency_key"] = "repro-routes-clear-" + os.urandom(8).hex()
    r = client.put(f"/api/missions/{MID}", json=resave5, headers=HDR)
    ok("intentional clear PUT 200", r.status_code == 200)
    cur.execute("SELECT COUNT(*) FROM mission_itineraries WHERE mission_id=%s", (MID,))
    n = cur.fetchone()[0]
    ok("intentional clear wipes routes", n == 0, f"rows={n}")

except Exception as e:
    FAIL += 1
    print("CRASH:", e)
finally:
    # cleanup (rollback-only for real data)
    try:
        if MID:
            for t in ["mission_participant_sessions", "mission_participant_itineraries",
                      "mission_participants", "mission_itineraries", "mission_vehicles",
                      "mission_beneficiaries", "mission_eoc_staff",
                      "mission_join_leave_entries", "mission_audit_log"]:
                try:
                    cur.execute(f"DELETE FROM {t} WHERE mission_id=%s", (MID,))
                except Exception:
                    conn.rollback()
            cur.execute("DELETE FROM missions WHERE mission_id=%s", (MID,))
        conn.commit()
        print("cleanup done, mission", MID, "removed")
    except Exception as e:
        conn.rollback()
        print("cleanup failed:", e)
    conn.close()

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
