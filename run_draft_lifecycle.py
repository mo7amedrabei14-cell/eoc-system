# -*- coding: utf-8 -*-
"""
Draft JOIN/LEAVE lifecycle — end-to-end against a real uvicorn (live, Neon).
covers the redesign: participation is driven by the entry CATALOG
(mission_join_leave_entries) + participant assignment (JL:J:<title>/JL:L:<title>),
materialized into tagged mission_participant_sessions only while Draft.

  JOIN/LEAVE entries are created/edited/deleted at ANY mission status
  (user decision: exactly like participants & routes); each edit re-derives
  the derived segments (update-in-place by provenance). No freezing — the
  catalog stays editable after the mission leaves Draft, and the legacy
  per-participant /join /leave routes remain legacy-only (405).

Scenarios:
  A  JOIN entry assigned on a Draft mission → one open derived segment
  B  Entry PATCH edit allowed (stable entry_id provenance)
  C  LEAVE entry assigned → closes the segment; LEAVE PATCH edit allowed
  D  Multiple cycles JOIN→LEAVE→JOIN→LEAVE → independent segments, no dupes
  E  Entry DELETE undoes a Draft segment (leave deleted before its opener)
  F  Finalization (mission leaves Draft) → entry PATCH still succeeds (200)
  G  Entry DELETE after finalization → succeeds and re-derives (no freeze)
  H  Re-add (create) attempt after finalization → accepted (200)

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


def find_entry(mdata, kind, title):
    for e in mdata.get("join_leave_entries", []):
        if e.get("kind") == kind and e.get("title") == title:
            return e
    raise KeyError((kind, title))


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

    # ── 2) مشاركة عبر كتالوج الانضمام/الانفصال (Draft): إدراج مدخل JOIN + إسناده ──
    #    المسار القديم /join لم يعد متاحاً (405) — الكتالوج + الإسناد + الاشتقاق
    #    هو نظام التصميم الجديد الوحيد. إعادة الحفظ أثناء المسودة تُعيد الاشتقاق.
    join_dt = f"{dep} 09:15"
    mdata["join_leave_entries"] = [{"kind": "join", "title": "بداية المشاركة", "dt": join_dt}]
    mdata["participants"] = [{**mdata["participants"][0], "assigned_days": ["JL:J:بداية المشاركة"]}]
    api("PUT", f"/api/missions/{MID}", headers=H, json={**mdata, "status": "Draft"})
    md = get_mission(MID)
    p = find_part(md, "مختبر المسودة")
    periods = p.get("participation_periods", [])
    check("A1 JOIN entry assigned → one open segment", len(periods), 1, exact=True)
    s0 = periods[0]
    check("A2 join start_dt == requested 09:15", s0.get("start_dt", "")[:16], join_dt, exact=True)
    check("A3 open segment (end_dt None)", s0.get("end_dt") is None, True)
    SID0 = s0.get("session_id")
    check("A4 session_id present in payload", SID0 is not None, True)
    JE = find_entry(md, "join", "بداية المشاركة")
    check("A5 catalog entry persisted with entry_id", JE.get("entry_id") is not None, True)

    # ── 3) تعديل مدخل JOIN عبر PATCH (تعديل في مكانه — نفس entry_id = provenance ثابت) ──
    api("PATCH", f"/api/missions/{MID}/join-leave-entries/{JE['entry_id']}", headers=H, json={
        "title": "بداية المشاركة", "kind": "join", "dt": f"{dep} 10:05"})
    md = get_mission(MID)
    JE2 = find_entry(md, "join", "بداية المشاركة")
    check("B1 PATCH entry edits start_dt in place (10:05)",
          find_part(md, "مختبر المسودة").get("participation_periods", [])[0].get("start_dt", "")[:16],
          f"{dep} 10:05", exact=True)
    check("B2 same entry_id preserved (stable provenance, no delete+recreate)",
          JE2.get("entry_id"), JE["entry_id"], exact=True)

    # ── 4) إنشاء مدخل LEAVE + إسناده (Draft) → يُغلق القطاع عند زمنه ──
    leave_dt = f"{dep} 14:20"
    mdata["join_leave_entries"] = [
        {"entry_id": JE["entry_id"], "kind": "join", "title": "بداية المشاركة", "dt": f"{dep} 10:05"},
        {"kind": "leave", "title": "نهاية المشاركة", "dt": leave_dt},
    ]
    mdata["participants"] = [{**mdata["participants"][0], "assigned_days": ["JL:J:بداية المشاركة", "JL:L:نهاية المشاركة"]}]
    api("PUT", f"/api/missions/{MID}", headers=H, json={**mdata, "status": "Draft"})
    md = get_mission(MID)
    check("C1 LEAVE entry assigned → segment closed at 14:20",
          find_part(md, "مختبر المسودة").get("participation_periods", [])[0].get("end_dt", "")[:16],
          leave_dt, exact=True)
    LE = find_entry(md, "leave", "نهاية المشاركة")

    # ── 5) تعديل مدخل LEAVE عبر PATCH ──
    api("PATCH", f"/api/missions/{MID}/join-leave-entries/{LE['entry_id']}", headers=H, json={
        "title": "نهاية المشاركة", "kind": "leave", "dt": f"{dep} 15:45"})
    md = get_mission(MID)
    check("C2 PATCH leave edits end_dt in place (15:45)",
          find_part(md, "مختبر المسودة").get("participation_periods", [])[0].get("end_dt", "")[:16],
          f"{dep} 15:45", exact=True)

    # ── 6) دورات متعددة: JOIN→LEAVE→JOIN→LEAVE ⇒ قطاعان مستقلان ──
    mdata["join_leave_entries"] = [
        {"entry_id": JE["entry_id"], "kind": "join", "title": "بداية المشاركة", "dt": f"{dep} 10:05"},
        {"entry_id": LE["entry_id"], "kind": "leave", "title": "نهاية المشاركة", "dt": f"{dep} 15:45"},
        {"kind": "join", "title": "عودة", "dt": f"{dep} 16:00"},
        {"kind": "leave", "title": "خروج نهائي", "dt": f"{dep} 17:00"},
    ]
    mdata["participants"] = [{**mdata["participants"][0], "assigned_days": ["JL:J:بداية المشاركة", "JL:L:نهاية المشاركة", "JL:J:عودة", "JL:L:خروج نهائي"]}]
    api("PUT", f"/api/missions/{MID}", headers=H, json={**mdata, "status": "Draft"})
    md = get_mission(MID)
    p = find_part(md, "مختبر المسودة")
    periods = p.get("participation_periods", [])
    check("D1 two cycles → 2 independent segments", len(periods), 2, exact=True)
    seg2 = periods[1]
    check("D2 second segment distinct session_id", seg2.get("session_id") != SID0, True)
    check("D3 second segment start 16:00", seg2.get("start_dt", "")[:16], f"{dep} 16:00", exact=True)
    check("D4 second segment end 17:00", seg2.get("end_dt", "")[:16], f"{dep} 17:00", exact=True)

    # ── 7) حذف مدخلي الدورة الثانية (undo قطاع مسود) — نغلق أولاً ثم نزيل الفاتح ──
    L2 = find_entry(md, "leave", "خروج نهائي")
    J2 = find_entry(md, "join", "عودة")
    api("DELETE", f"/api/missions/{MID}/join-leave-entries/{L2['entry_id']}", headers=H)
    api("DELETE", f"/api/missions/{MID}/join-leave-entries/{J2['entry_id']}", headers=H)
    md = get_mission(MID)
    p = find_part(md, "مختبر المسودة")
    check("E1 DELETE entries removed the second Draft segment", len(p.get("participation_periods", [])), 1, exact=True)

    # ── 8) FINALIZATION: المهمة تخرج من المسودة — الكتالوج يبقى قابلاً للتعديل/الحذف ──
    #    (قرار المستخدم: انضمام/انفصال قابل للتعديل بأي حالة مثل المسارات —
    #    لا تجميد، والاشتقاق يُعاد عند كل تعديل/حفظ.)
    mdata["join_leave_entries"] = [
        {"entry_id": JE["entry_id"], "kind": "join", "title": "بداية المشاركة", "dt": f"{dep} 10:05"},
        {"entry_id": LE["entry_id"], "kind": "leave", "title": "نهاية المشاركة", "dt": f"{dep} 15:45"},
    ]
    mdata["participants"] = [{**mdata["participants"][0], "assigned_days": ["JL:J:بداية المشاركة", "JL:L:نهاية المشاركة"]}]
    api("PUT", f"/api/missions/{MID}", headers=H, json={**mdata, "status": "Under Review"})
    md = get_mission(MID)
    check("F1 mission left Draft (Under Review)", md.get("status"), "Under Review", exact=True)

    # تعديل سجل بعد الخروج من المسودة → ينجح (200) ويُعاد اشتقاق الشريحة في مكانها
    r_patch = requests.patch(f"{API}/api/missions/{MID}/join-leave-entries/{JE['entry_id']}", headers=H,
                             json={"title": "بداية المشاركة", "kind": "join", "dt": f"{dep} 11:00"})
    check("F2 entry PATCH succeeds after finalization (editable at any status)", r_patch.status_code, 200, exact=True)
    md = get_mission(MID)
    check("F2b re-derivation updates segment start to 11:00",
          find_part(md, "مختبر المسودة").get("participation_periods", [])[0].get("start_dt", "")[:16],
          f"{dep} 11:00", exact=True)

    # حذف سجل بعد الخروج من المسودة → ينجح (200) ويُعاد الاشتقاق: الانفصال المتبقي
    # وحده + «من بداية المهمة» للمشارك ⇒ تُغلق من بداية المهمة 08:00 حتى 15:45.
    r_del = requests.delete(f"{API}/api/missions/{MID}/join-leave-entries/{JE['entry_id']}", headers=H)
    check("F3 entry DELETE succeeds after finalization (editable at any status)", r_del.status_code, 200, exact=True)
    md = get_mission(MID)
    p = find_part(md, "مختبر المسودة")
    periods = p.get("participation_periods", [])
    check("G1 leave-only participant re-derives via mission start (no freeze)", len(periods), 1, exact=True)
    check("G2 closed at leave 15:45", periods[0].get("end_dt", "")[:16], f"{dep} 15:45", exact=True)

    # ── 9) إضافة سجل جديد بعد الخروج من المسودة → مقبولة (200 — لم يعد 403) ──
    r_add = requests.post(f"{API}/api/missions/{MID}/join-leave-entries", headers=H,
                          json={"kind": "join", "title": "محاولة متأخرة", "dt": f"{dep} 18:10"})
    check("H1 re-add attempt after finalization → accepted (200)", r_add.status_code, 200, exact=True)

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
