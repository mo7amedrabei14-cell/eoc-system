#!/usr/bin/env python3
"""
🛡️ اختبار انحدار لجذر «ضياع بيانات الاستمارة/الطقس»

يثبت — على قاعدة البيانات الحقيقية — أن الحفظ لا يمحو أي بيانات محفوظة:
  1) خط السير: تُحدَّث الصفوف في مكانها بهويتها (itinerary_id) ولا تُحذف إلا بطلب صريح.
  2) حمولة ناقصة (مجموعة مخصصة غائبة) لا تمحو المسارات المحفوظة.
  3) قائمة routes فارغة لا تمحو شيئاً.
  4) إسناد أيام المشاركين لا يُمحى إذا لم تُرسَل الحمولة قسم الأيام (None).
  5) الطقس: حفظ خانة واحدة لا يمحو باقي القياسات المحفوظة (حفظ جزئي).
  6) الحذف/المسح المقصود الصريح يبقى يعمل.

تُنظَّف كل بيانات الاختبار في النهاية (لا تعديل على بيانات إنتاجية).
"""
import os
import sys
import random

os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from fastapi.testclient import TestClient
from db import get_connection
from auth import create_access_token
import main as M

client = TestClient(M.app)
M.ensure_workspace_schema()      # ☁️ جدول حالة العمل (خطوة خفيفة، آمنة للإعادة)

conn = get_connection()
cur = conn.cursor()
cur.execute("SELECT user_id FROM users WHERE username = 'manager' AND is_active")
row = cur.fetchone()
if not row:
    print("manager user not found — aborting")
    sys.exit(1)
USER_ID = row[0]
HDR = {"Authorization": f"Bearer {create_access_token(USER_ID)}"}
# 🖥️ توكن مستخدم آخر = «جهاز/جلسة أخرى»: يقرأ نفس ما حُفظ على السيرفر (لا localStorage).
cur.execute("SELECT user_id FROM users WHERE username = 'joker' AND is_active")
other = cur.fetchone()
OTHER_HDR = {"Authorization": f"Bearer {create_access_token(other[0])}"} if other else HDR

MID = None
WEATHER_DATE = "2027-01-15"          # تاريخ بعيد — لا توجد له توقعات حقيقية
WEATHER_BRANCH = 19
PASS = FAIL = 0


def ok(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  OK  {name}" + (f"  [{extra}]" if extra else ""))
    else:
        FAIL += 1
        print(f"  XX  {name}" + (f"  [{extra}]" if extra else ""))


def db_routes(mission_id):
    cur.execute(
        "SELECT itinerary_id, COALESCE(group_title,''), route_from, route_to "
        "FROM mission_itineraries WHERE mission_id = %s ORDER BY itinerary_id",
        (mission_id,),
    )
    return cur.fetchall()


def db_days(mission_id):
    cur.execute(
        "SELECT itinerary_group FROM mission_participant_itineraries WHERE mission_id = %s ORDER BY itinerary_group",
        (mission_id,),
    )
    return [r[0] for r in cur.fetchall()]


try:
    base_payload = {
        "mission_name": "اختبار عدم فقد البيانات",
        "mission_classification": "عادية",
        "branch_id": 19,
        "mission_type": "تأمين",
        "mission_location": "القاهرة",
        "responsible_person": "مختبر",
        "data_source": "اتصال",
        "status": "Under Review",
        "exit_date": "2026-12-01",
        "departure_time": "08:00",
        "start_time": None,
        "return_date": None,
        "arrival_date": None,
        "arrival_time": None,
        "completion_date": None,
        "completion_time": None,
        "departure_date": None,
        "notes": "اختبار",
        "internal_notes": "",
        "team_code": "",
        "creation_datetime": "2026-12-01T08:00",
        "field_operation_status": "نشطة",
        "routes": [
            {"group_title": "خط السير الأساسي", "route_from": "القاهرة", "route_to": "الجيزة",
             "departure_date": "2026-12-01", "departure_time": "08:00",
             "arrival_date": "2026-12-01", "arrival_time": "09:00"},
            {"group_title": "خط السير الأساسي", "route_from": "الجيزة", "route_to": "الفيوم",
             "departure_date": "2026-12-01", "departure_time": "10:00",
             "arrival_date": "2026-12-01", "arrival_time": "12:00"},
            {"group_title": "تحركات اليوم الثاني", "route_from": "الفيوم", "route_to": "بني سويف",
             "departure_date": "2026-12-02", "departure_time": "09:00",
             "arrival_date": "2026-12-02", "arrival_time": "11:00"},
        ],
        "vehicles": [{"driver_name": "سائق اختبار", "vehicle_number": "NDL 001"}],
        "participants": [{
            "participant_type": "volunteer",
            "full_name": "مختبر عدم الفقد",
            "participation_role": "TEST-NDL-1",
            "participant_position": "",
            "branch_id": 19,
            "assigned_itinerary": "",
            "assigned_days": ["تحركات اليوم الثاني"],
            "return_status": "مازال بالمهمة",
            "phase_name": "اليوم الأول",
            "stay_type": "ذهاب وعودة",
            "start_from_mission": True,
        }],
        "beneficiaries": [{"category_name": "أسر", "direct_count": 3, "indirect_count": 1}],
        "eoc_staff": [
            {"role_name": "مسؤول المتابعة", "staff_name": "قائد"},
            {"role_name": "المشرف", "staff_name": "مشرف"},
            {"role_name": "الجوكر", "staff_name": "جوكر"},
            {"role_name": "معبئ الاستمارة", "staff_name": "معبئ"},
        ],
        "join_leave_entries": [],
        "clear_details": False,
        "idempotency_key": "ndl-" + os.urandom(6).hex(),
    }
    payload = dict(base_payload)

    # ── 0) إنشاء المهمة ──
    r = client.post("/api/missions", json=payload, headers=HDR)
    if r.status_code != 200:
        print("POST failed:", r.status_code, r.text[:400])
        sys.exit(1)
    MID = r.json()["mission_id"]
    ok("created mission", True, f"mission_id={MID}")
    rows = db_routes(MID)
    ok("3 routes stored", len(rows) == 3, f"rows={len(rows)}")
    ids = [x[0] for x in rows]
    custom_id = next((x[0] for x in rows if x[1] == "تحركات اليوم الثاني"), None)
    ok("GET exposes itinerary_id on every route", all(isinstance(i, int) for i in ids), str(ids))
    ok("participant day link stored", db_days(MID) == ["تحركات اليوم الثاني"], str(db_days(MID)))

    # ── 1) إعادة الفتح (ما تراه الواجهة) ──
    detail = client.get(f"/api/missions/{MID}", headers=HDR).json()
    reopened = detail["routes"]
    ok("reopen returns 3 routes with ids", len(reopened) == 3 and all(x.get("itinerary_id") for x in reopened))
    ok("legacy/NULL-safe titles", sorted({x["group_title"] for x in reopened}) == ["تحركات اليوم الثاني", "خط السير الأساسي"],
       str([x["group_title"] for x in reopened]))

    def put(routes=None, participants=None, extra=None):
        p = dict(base_payload)
        p["idempotency_key"] = "ndl-" + os.urandom(6).hex()
        if routes is not None:
            p["routes"] = routes
        if participants is not None:
            p["participants"] = participants
        if extra:
            p.update(extra)
        res = client.put(f"/api/missions/{MID}", json=p, headers=HDR)
        return res

    # ── 1ب) نفس البيانات تُقرأ من جلسة/جهاز آخر (مصدر الحقيقة = قاعدة البيانات) ──
    other_detail = client.get(f"/api/missions/{MID}", headers=OTHER_HDR).json()
    ok("another session sees the same saved routes (3 with ids)",
       len(other_detail.get("routes", [])) == 3 and
       [x["itinerary_id"] for x in other_detail["routes"]] == [x["itinerary_id"] for x in reopened],
       f"other_session={len(other_detail.get('routes', []))}")

    # ── 2) حمولة ناقصة (مجموعة اليوم الثاني غائبة) ⇒ لا حذف ──
    only_basic = [x for x in reopened if x["group_title"] == "خط السير الأساسي"]
    res = put(routes=only_basic)
    ok("partial payload accepted", res.status_code == 200, res.text[:200] if res.status_code != 200 else "")
    rows = db_routes(MID)
    ok("partial payload keeps the missing custom group", len(rows) == 3, f"rows={len(rows)}")
    ok("no duplicated rows from partial payload", len({x[0] for x in rows}) == 3)

    # ── 3) تحديث صف في مكانه بنفس الهوية ──
    edited = [dict(x) for x in reopened]
    edited[0]["route_to"] = "المعادي"
    res = put(routes=edited)
    ok("in-place update accepted", res.status_code == 200, res.text[:200] if res.status_code != 200 else "")
    rows = db_routes(MID)
    ok("row count unchanged after edit", len(rows) == 3, f"rows={len(rows)}")
    ok("same itinerary_id kept after edit", [x[0] for x in rows] == ids, f"{[x[0] for x in rows]} vs {ids}")
    ok("value updated in place", rows[0][3] == "المعادي", str(rows[0]))

    # ── 4) قائمة مسارات فارغة ⇒ لا حذف ──
    res = put(routes=[])
    ok("empty routes payload keeps stored rows", len(db_routes(MID)) == 3, f"rows={len(db_routes(MID))}")

    # ── 5) الحمولة بلا قسم الأيام (None) ⇒ إسناد المشاركين يبقى ──
    part_no_days = dict(base_payload["participants"][0])
    part_no_days.pop("assigned_days", None)
    res = put(routes=reopened, participants=[part_no_days])
    ok("payload without assigned_days accepted", res.status_code == 200, res.text[:200] if res.status_code != 200 else "")
    ok("day link survives when section is not sent", db_days(MID) == ["تحركات اليوم الثاني"], str(db_days(MID)))

    # ── 6) إخلاء صريح للأيام يُحترم ──
    part_empty_days = dict(part_no_days)
    part_empty_days["assigned_days"] = []
    res = put(routes=reopened, participants=[part_empty_days])
    ok("explicit day clearing works", db_days(MID) == [], str(db_days(MID)))
    # نُعيد الإسناد للاختبارات التالية
    part_again = dict(part_no_days)
    part_again["assigned_days"] = ["تحركات اليوم الثاني"]
    put(routes=reopened, participants=[part_again])

    # ── 7) الحذف الصريح بمعرّف الصف ──
    part_after_delete = dict(part_no_days)
    part_after_delete["assigned_days"] = []          # الواجهة تُعيد إسناد اليوم مع الحذف
    res = put(routes=[x for x in reopened if x["itinerary_id"] != custom_id],
              participants=[part_after_delete],
              extra={"deleted_route_ids": [custom_id]})
    ok("explicit delete accepted", res.status_code == 200, res.text[:200] if res.status_code != 200 else "")
    rows = db_routes(MID)
    ok("only the explicitly deleted row is gone", len(rows) == 2 and custom_id not in [x[0] for x in rows],
       f"rows={[x[0] for x in rows]}")
    ok("deleted group day links cleaned", "تحركات اليوم الثاني" not in db_days(MID), str(db_days(MID)))

    # ── 8) المسح المقصود الصريح (لا يوجد خط سير) ──
    res = put(routes=[], extra={"clear_details": True})
    ok("intentional clear wipes routes", len(db_routes(MID)) == 0, f"rows={len(db_routes(MID))}")

    # ── 8ب) ☁️ حالة العمل على السيرفر (مسودات + إرسالات معلّقة) ──
    DRAFT_SCOPE = "ndl-test-mission:999"
    cur.execute("DELETE FROM user_workspace_items WHERE scope = %s OR scope LIKE 'ndl-test%%'", (DRAFT_SCOPE,))
    conn.commit()
    r = client.put("/api/workspace", json={
        "kind": "draft", "scope": DRAFT_SCOPE,
        "payload": {"state": {"routes": [{"route_from": "القاهرة", "route_to": "أسيوط"}]}},
    }, headers=HDR)
    ok("server-side draft save", r.status_code == 200, r.text[:200] if r.status_code != 200 else "")
    items = client.get("/api/workspace?kind=draft", headers=HDR).json()
    mine = [x for x in items if x["scope"] == DRAFT_SCOPE]
    ok("server-side draft is readable (any device of the same account)", len(mine) == 1,
       f"items={len(items)}")
    ok("draft payload round-trips intact",
       mine and mine[0]["payload"]["state"]["routes"][0]["route_to"] == "أسيوط")
    other_items = client.get("/api/workspace?kind=draft", headers=OTHER_HDR).json()
    ok("workspace is isolated per account",
       not [x for x in other_items if x["scope"] == DRAFT_SCOPE])

    r = client.put("/api/workspace", json={
        "kind": "pending_save", "scope": "ndl-test-pending-1",
        "payload": {"mission_name": "اختبار"}, "meta": {"method": "PUT", "url": "/api/missions/1"},
    }, headers=HDR)
    ok("pending (outbox) save stored on server", r.status_code == 200)
    pending = client.get("/api/workspace?kind=pending_save", headers=HDR).json()
    ok("pending save listed for retry from any device",
       any(x["scope"] == "ndl-test-pending-1" for x in pending), f"n={len(pending)}")
    r = client.delete("/api/workspace?kind=pending_save&scope=ndl-test-pending-1", headers=HDR)
    ok("pending save removed after delivery", r.status_code == 200 and r.json().get("deleted") == 1)
    client.delete(f"/api/workspace?kind=draft&scope={DRAFT_SCOPE}", headers=HDR)
    ok("draft removed from server",
       not [x for x in client.get("/api/workspace?kind=draft", headers=HDR).json() if x["scope"] == DRAFT_SCOPE])

    # ── 9) الطقس: حفظ جزئي لا يمحو باقي القياسات ──
    cur.execute("DELETE FROM weather_forecasts WHERE forecast_date = %s", (WEATHER_DATE,))
    conn.commit()
    r1 = client.post("/api/weather/batch", json={
        "date": WEATHER_DATE, "shift": "morning",
        "rows": [{"branch_id": WEATHER_BRANCH, "shift": "morning", "temp_min": 10, "temp_max": 20, "rain_min": 1}],
    }, headers=HDR)
    ok("weather first save", r1.status_code == 200, r1.text[:200] if r1.status_code != 200 else "")
    r2 = client.post("/api/weather/batch", json={
        "date": WEATHER_DATE, "shift": "morning",
        "rows": [{"branch_id": WEATHER_BRANCH, "shift": "morning", "temp_min": 12}],
    }, headers=HDR)
    ok("weather partial save", r2.status_code == 200, r2.text[:200] if r2.status_code != 200 else "")
    cur.execute(
        "SELECT temp_min, temp_max, rain_min FROM weather_forecasts WHERE forecast_date = %s AND shift = 'morning' AND branch_id = %s",
        (WEATHER_DATE, WEATHER_BRANCH),
    )
    wrow = cur.fetchone()
    ok("partial save updates the touched column only",
       wrow is not None and float(wrow[0]) == 12 and float(wrow[1]) == 20 and float(wrow[2]) == 1, str(wrow))

except Exception as e:
    import traceback
    traceback.print_exc()
    FAIL += 1
    print("CRASH:", e)
finally:
    try:
        if MID:
            for t in ["mission_participant_sessions", "mission_participant_itineraries",
                      "mission_participants", "mission_itineraries", "mission_vehicles",
                      "mission_beneficiaries", "mission_eoc_staff",
                      "mission_join_leave_entries"]:
                try:
                    cur.execute(f"DELETE FROM {t} WHERE mission_id=%s", (MID,))
                except Exception:
                    conn.rollback()
            cur.execute("DELETE FROM missions WHERE mission_id=%s", (MID,))
        cur.execute("DELETE FROM weather_forecasts WHERE forecast_date=%s", (WEATHER_DATE,))
        cur.execute("DELETE FROM user_workspace_items WHERE user_id=%s AND scope LIKE 'ndl-test%%'", (USER_ID,))
        conn.commit()
        print(f"cleanup done (mission {MID}, weather {WEATHER_DATE})")
    except Exception as e:
        conn.rollback()
        print("cleanup failed:", e)
    conn.close()

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
