# -*- coding: utf-8 -*-
"""
Draft JOIN/LEAVE lifecycle — end-to-end against a real uvicorn (live, Neon).
Verifies the new PATCH (edit-in-place) + DELETE session endpoints and the
Draft lock/unlock lifecycle defined by the four-issue fix:

  MISSION DRAFT = PARTICIPATION DRAFT (editable).
  JOIN and LEAVE are both editable while the Mission is Draft.
  Lock happens ONLY on the general submission (Mission leaves Draft), NOT on
  JOIN/LEAVE press, NOT on Mission creation.
  Once locked, closed participation is IMMUTABLE (PATCH/DELETE -> 403).

Scenarios:
  A  Draft JOIN recorded on a Draft mission → PATCH edit allowed
  B  Draft LEAVE recorded → PATCH edit allowed
  C  Draft session DELETE allowed (undo a Draft segment)
  D  Create/Save: flush JOIN+LEAVE → 2 segments persisted under one mission
  E  Create/Save failure: pending survives (frontend — verified by absence of
     auto-save; backend has no data to lose)
  F  Finalization (mission leaves Draft) → PATCH/DELETE rejected 403
  G  Post-finalization rejection (immutability of closed participation)
  H  Multiple cycles JOIN→LEAVE→JOIN→LEAVE → independent segments, no dupes
  I  Re-add same identity after finalized LEAVE → new independent segment

Cleanup: deletes all TEST_DL_* missions. No business logic changed.
"""
import datetime, json, os, sys, threading, time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

import uvicorn
import requests
import main
from main import get_connection
from auth import create_access_token

PORT = 8098
API = f"http://127.0.0.1:{PORT}"
failures = []


def check(label, got, exp, exact=False):
    if exact:
        ok = got == exp
    else:
        ok = abs(got - exp) < 1e-9 if isinstance(got, float) and isinstance(exp, float) else got == exp
    print(f"[{'OK' if ok else 'FAIL'}] {label}: got={got!r} expected={exp!r}")
    if not ok:
        failures.append(label)


def fmt(dt):
    return dt.strftime("%Y-%m-%d %H:%M")


def branch_id():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT branch_id FROM branches WHERE is_active = true ORDER BY branch_id LIMIT 1")
            return cur.fetchone()[0]
    finally:
        conn.close()


def owner_user_id():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT u.user_id FROM users u
                   JOIN user_roles ur ON ur.user_id = u.user_id
                   JOIN roles r ON r.role_id = ur.role_id
                   WHERE UPPER(r.role_name) = 'OWNER' AND u.is_active = true
                   ORDER BY u.user_id LIMIT 1"""
            )
            row = cur.fetchone()
    finally:
        conn.close()
    return row[0] if row else None


def api(method, path, **kw):
    r = requests.request(method, API + path, timeout=40, **kw)
    try:
        body = r.json()
    except Exception:
        body = r.text
    if r.status_code >= 400:
        raise RuntimeError(f"{method} {path} -> HTTP {r.status_code}: {json.dumps(body, ensure_ascii=False)}")
    return body


def get_mission(mid):
    return api("GET", f"/api/missions/{mid}", headers=H)


def find_part(mdata, name):
    for p in mdata["participants"]:
        if p["full_name"] == name:
            return p
    raise KeyError(name)


def server_loop(server):
    server.run()


def main_r():
    global BRANCH, H
    oid = owner_user_id()
    if not oid:
        print("NO OWNER USER — abort")
        return 1
    BRANCH = branch_id()
    TOKEN = create_access_token(oid)
    H = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

    config = uvicorn.Config(main.app, host="127.0.0.1", port=PORT, log_level="warning")
    server = uvicorn.Server(config)
    th = threading.Thread(target=server_loop, args=(server,), daemon=True)
    th.start()
    for _ in range(150):
        try:
            if requests.get(API + "/", timeout=1).status_code == 200:
                break
        except Exception:
            time.sleep(0.1)
    else:
        print("SERVER NOT UP")
        return 1

    print(f"✔ Server up on {API} (Neon live)\n")

    # تنظيف أي مهمات مسودة يتيمة من جولات سابقة (فشل متصادم)
    _conn0 = get_connection()
    try:
        with _conn0.cursor() as _c0:
            _c0.execute("DELETE FROM missions WHERE mission_name LIKE 'TEST_DL_%%' ")
        _conn0.commit()
    finally:
        _conn0.close()

    TAG = f"TEST_DL_{datetime.datetime.now().strftime('%H%M%S')}"
    created = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    # تاريخ مهمة في الماضي — كل أزمنة الانضمام/الانفصال في الماضي حتماً
    # (validate_segment_datetime يرفض فقط «المستقبل»، فلا قيد على الماضي).
    dep = (datetime.datetime.now() - datetime.timedelta(days=1)).strftime('%Y-%m-%d')

    # ── 1) Create a DRAFT mission (status 'Draft') with one participant ──
    mdata = {
        "mission_name": f"{TAG} مهمة مسودة",
        "mission_classification": "عادية",
        "branch_id": BRANCH,
        "mission_type": "", "mission_location": "", "responsible_person": "",
        "data_source": "", "status": "Draft",
        "departure_date": dep, "departure_time": "08:00",
        "arrival_date": dep, "arrival_time": "18:00",
        "exit_date": dep, "completion_date": dep,
        "start_time": "08:00", "completion_time": "18:00",
        "notes": "draft-lifecycle", "eoc_staff": [
            {"role_name": "مسؤول المتابعة", "staff_name": "متتبع"},
            {"role_name": "المشرف", "staff_name": "مشرف"},
            {"role_name": "الجوكر", "staff_name": "جوكر"},
            {"role_name": "معبئ الاستمارة", "staff_name": "معبئ"},
        ],
        "participants": [
            {"participant_type": "volunteer", "full_name": "مختبر المسودة",
             "participation_role": "", "participant_position": "ميداني",
             "branch_id": BRANCH, "assigned_itinerary": "",
             "return_status": "مازال بالمهمة", "phase_name": "اليوم الأول",
             "stay_type": "ذهاب وعودة", "assigned_days": [], "start_from_mission": True}
        ],
    }
    created_res = api("POST", "/api/missions", headers=H, json=mdata)
    MID = created_res["mission_id"]
    print(f"✔ Draft mission created: {MID} status={created_res.get('status')}")

    md = get_mission(MID)
    check("A0 mission status is Draft", md.get("status"), "Draft", exact=True)
    p = find_part(md, "مختبر المسودة")
    PID = p["participant_id"]
    check("A0b participant present", PID is not None, True)
    check("A0c participant_id is an int", isinstance(PID, int), True)

    # ── 2) POST /join with exact timestamp (Draft) ──
    join_dt = f"{dep} 09:15"
    api("POST", f"/api/missions/{MID}/join", headers=H, json={
        "participant_id": PID, "join_datetime": join_dt})
    md = get_mission(MID)
    p = find_part(md, "مختبر المسودة")
    periods = p.get("participation_periods", [])
    check("A1 JOIN created one open segment", len(periods), 1, exact=True)
    s0 = periods[0]
    check("A2 join start_dt == requested 09:15", s0.get("start_dt", "")[:16], join_dt, exact=True)
    check("A3 open segment (end_dt None)", s0.get("end_dt") is None, True)
    SID0 = s0.get("session_id")
    check("A4 session_id present in payload", SID0 is not None, True)

    # ── 3) Draft edit JOIN via PATCH (edit-in-place, same session_id) ──
    api("PATCH", f"/api/missions/{MID}/sessions/{SID0}", headers=H, json={
        "action": "join", "dt": f"{dep} 10:05"})
    md = get_mission(MID)
    p = find_part(md, "مختبر المسودة")
    s0b = p.get("participation_periods", [])[0]
    check("B1 PATCH join edits start_dt in place (10:05)", s0b.get("start_dt", "")[:16], f"{dep} 10:05", exact=True)
    check("B2 same session_id preserved (no delete+recreate)", s0b.get("session_id"), SID0, exact=True)

    # ── 4) POST /leave with exact timestamp (Draft) → closes the segment ──
    leave_dt = f"{dep} 14:20"
    api("POST", f"/api/missions/{MID}/leave", headers=H, json={
        "participant_id": PID, "leave_datetime": leave_dt})
    md = get_mission(MID)
    p = find_part(md, "مختبر المسودة")
    periods = p.get("participation_periods", [])
    check("C1 LEAVE closed the segment", periods[0].get("end_dt", "")[:16], leave_dt, exact=True)

    # ── 5) Draft edit LEAVE via PATCH ──
    api("PATCH", f"/api/missions/{MID}/sessions/{SID0}", headers=H, json={
        "action": "leave", "dt": f"{dep} 15:45"})
    md = get_mission(MID)
    p = find_part(md, "مختبر المسودة")
    check("C2 PATCH leave edits end_dt in place (15:45)", p.get("participation_periods", [])[0].get("end_dt", "")[:16], f"{dep} 15:45", exact=True)

    # ── 6) Multiple cycles: JOIN→LEAVE→JOIN→LEAVE → 2 independent segments ──
    api("POST", f"/api/missions/{MID}/join", headers=H, json={
        "participant_id": PID, "join_datetime": f"{dep} 16:00"})
    api("POST", f"/api/missions/{MID}/leave", headers=H, json={
        "participant_id": PID, "leave_datetime": f"{dep} 17:00"})
    md = get_mission(MID)
    p = find_part(md, "مختبر المسودة")
    periods = p.get("participation_periods", [])
    check("D1 two cycles → 2 independent segments", len(periods), 2, exact=True)
    seg2 = periods[1]
    check("D2 second segment distinct session_id", seg2.get("session_id") != SID0, True)
    check("D3 second segment start 16:00", seg2.get("start_dt", "")[:16], f"{dep} 16:00", exact=True)
    check("D4 second segment end 17:00", seg2.get("end_dt", "")[:16], f"{dep} 17:00", exact=True)

    # ── 7) Draft session DELETE (undo a Draft segment) ──
    SID2 = seg2.get("session_id")
    api("DELETE", f"/api/missions/{MID}/sessions/{SID2}", headers=H)
    md = get_mission(MID)
    p = find_part(md, "مختبر المسودة")
    check("E1 DELETE removed the Draft segment", len(p.get("participation_periods", [])), 1, exact=True)

    # ── 8) FINALIZATION: mission leaves Draft → PATCH/DELETE must be REJECTED ──
    api("PUT", f"/api/missions/{MID}", headers=H, json={**mdata, "status": "Under Review"})
    md = get_mission(MID)
    check("F1 mission left Draft (Under Review)", md.get("status"), "Under Review", exact=True)

    r_patch = requests.patch(f"{API}/api/missions/{MID}/sessions/{SID0}", headers=H,
                             json={"action": "join", "dt": f"{dep} 11:00"})
    check("F2 PATCH rejected 403 after finalization (immutability)", r_patch.status_code, 403, exact=True)
    r_del = requests.delete(f"{API}/api/missions/{MID}/sessions/{SID0}", headers=H)
    check("F3 DELETE rejected 403 after finalization (immutability)", r_del.status_code, 403, exact=True)

    # closed participation stays immutable: values unchanged after rejected edits
    md = get_mission(MID)
    p = find_part(md, "مختبر المسودة")
    check("G1 frozen segment start still 10:05 (not clobbered)", p.get("participation_periods", [])[0].get("start_dt", "")[:16], f"{dep} 10:05", exact=True)

    # ── 9) Re-add same identity after finalized LEAVE → NEW independent segment ──
    api("POST", f"/api/missions/{MID}/join", headers=H, json={
        "participant_id": PID, "join_datetime": f"{dep} 18:10"})
    md = get_mission(MID)
    p = find_part(md, "مختبر المسودة")
    periods = p.get("participation_periods", [])
    check("H1 re-add after finalization → new independent segment", len(periods), 2, exact=True)
    newest = periods[-1]
    check("H2 new segment start 18:10", newest.get("start_dt", "")[:16], f"{dep} 18:10", exact=True)
    check("H3 earlier frozen segment preserved (start 10:05)", periods[0].get("start_dt", "")[:16], f"{dep} 10:05", exact=True)

    # cleanup
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM missions WHERE mission_id = %s", (MID,))
        conn.commit()
    finally:
        conn.close()
    print("\nCleanup done (TEST_DL_*).")

    if failures:
        print(f"\nFAILED: {len(failures)} — {failures}")
        return 1
    print("\nSUMMARY — كل اختبارات دورة حياة المسودة نجحت ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main_r())
