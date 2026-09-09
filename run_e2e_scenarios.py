# -*- coding: utf-8 -*-
"""
End‑to‑end runtime verification (real uvicorn from the working tree + real DB)
for ALL 10 mission-architecture scenarios — including the two new guarantees:

  (A) Frontend root cause: submission of a named participant must no longer throw
      (the branchesList ReferenceError was in MissionsView.handleSubmit). The
      API here cannot see the browser, but it proves the whole create → JOIN →
      Send‑to‑Joker → Completed flow persists and links every bit of state; the
      frontend fix (branches prop, not Dashboard's branchesList) is what lets the
      form reach this API in the first place, and is verified by build + bundle scan.

  (B) Backend root cause fix: when a mission becomes Completed/مكتملة, every open
      JOIN segment is physically closed in the DB at the mission completion time
      (end_dt/check_out_time), not merely capped in display.

Scenarios:
  1  Mission with NO itinerary.
  2  Mission with ONE itinerary route.
  3  Mission with MULTIPLE itinerary routes.
  4  Participant assigned to ONE route.
  5  Participant assigned to MULTIPLE routes.
  6  Participant JOINed while the mission is still being created (Draft).
  7  Mission completed and sent to Joker normally (Draft → Under Review → Completed).
  8  JOINed participants with no LEAVE yet → auto-closed at mission end (DB assert).
  9  JOIN + LEAVE both recorded.
 10 Any valid combination (mixed route assignment + phase/join/leave + complete).

Cleanup: deletes all TEST_E2E_* missions at the end. No business logic is changed.
No deploy, push, or merge — verification runs locally only.
"""
import datetime, json, os, sys, threading, time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

import uvicorn
import requests

import main
from main import get_connection
from auth import create_access_token

PORT = 8097
API = f"http://127.0.0.1:{PORT}"

failures = []


def check(label, got, exp, tol=None, exact=False):
    if tol is not None:
        ok = abs(got - exp) <= tol
    elif exact:
        ok = got == exp
        if not ok and isinstance(got, float) and isinstance(exp, float):
            ok = abs(got - exp) < 1e-9
    else:
        ok = got == exp
    extra = f" (±{tol})" if tol is not None else (" (exact)" if exact else "")
    print(f"[{'OK' if ok else 'FAIL'}] {label}: got={got!r} expected={exp!r}{extra}")
    if not ok:
        failures.append(label)


def now_naive():
    return datetime.datetime.now().replace(microsecond=0)


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


def non_owner_user_id():
    """مستخدم فعّال له دور غير OWNER/المالك وليس مالكاً — لاختبار بوابة تاريخ الإنشاء."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT u.user_id FROM users u
                   LEFT JOIN user_roles ur ON ur.user_id = u.user_id
                   LEFT JOIN roles r ON r.role_id = ur.role_id
                   WHERE u.is_active = true
                   GROUP BY u.user_id
                   HAVING COUNT(*) FILTER (WHERE UPPER(COALESCE(r.role_name,'')) IN ('OWNER','المالك')) = 0
                      AND COUNT(*) FILTER (WHERE UPPER(COALESCE(r.role_name,'')) NOT IN ('OWNER','المالك','')) > 0
                   ORDER BY u.user_id LIMIT 1"""
            )
            row = cur.fetchone()
    finally:
        conn.close()
    return row[0] if row else None


EOC_STAFF = [
    {"role_name": "مسؤول المتابعة", "staff_name": "متابعة"},
    {"role_name": "المشرف", "staff_name": "مشرف"},
    {"role_name": "الجوكر", "staff_name": "جوكر"},
    {"role_name": "معبئ الاستمارة", "staff_name": "معبئ"},
]


def participant(full_name, assigned_days=None, pos="ميداني", start_from_mission=True):
    return {
        "participant_type": "non_volunteer", "full_name": full_name,
        "participation_role": "", "participant_position": pos,
        "branch_id": BRANCH, "assigned_itinerary": "",
        "return_status": "مازال بالمهمة", "phase_name": "اليوم الأول", "stay_type": "ذهاب وعودة",
        "assigned_days": assigned_days or [],
        # checkbox «يُحسب من بداية المهمة»: TRUE ⇒ البداية المخططة = بداية المهمة (الافتراضي)؛
        # FALSE ⇒ بداية المسار المُسند — سيناريوهات «نافذة المسار» تمرر FALSE صراحةً.
        "start_from_mission": start_from_mission,
    }


def mission_base(name, dep, status="نشطة", routes=None, participants=None, completion=None):
    body = {
        "mission_name": name, "mission_classification": "عادية", "branch_id": BRANCH,
        "mission_type": "إغاثة", "mission_location": "موقع الاختبار", "responsible_person": "فظ",
        "status": status,
        "exit_date": dep.date().isoformat(),
        "departure_date": dep.date().isoformat(),
        "departure_time": dep.strftime("%H:%M"),
        "routes": routes or [], "vehicles": [], "participants": participants or [],
        "eoc_staff": EOC_STAFF, "notes": "اختبار E2E", "internal_notes": "",
    }
    if completion:
        body["completion_date"] = completion.date().isoformat()
        body["completion_time"] = completion.strftime("%H:%M")
    return body


def api(method, path, **kw):
    r = requests.request(method, API + path, timeout=40, **kw)
    try:
        body = r.json()
    except Exception:
        body = r.text
    if r.status_code >= 400:
        raise RuntimeError(f"{method} {path} -> HTTP {r.status_code}: {json.dumps(body, ensure_ascii=False)}")
    return body


def raw_api(method, path, **kw):
    """مثل api() لكن يعيد (status, body) دون رفع RuntimeError على 4xx — لاختبار 403."""
    r = requests.request(method, API + path, timeout=40, **kw)
    try:
        body = r.json()
    except Exception:
        body = r.text
    return r.status_code, body


def get_mission(mid):
    return api("GET", f"/api/missions/{mid}", headers=H)


def find_part(mdata, name):
    for p in mdata["participants"]:
        if p["full_name"] == name:
            return p
    raise KeyError(name)


def open_segments(mid):
    """القطاعات المفتوحة (end_dt NULL) في المهمة — من قاعدة البيانات مباشرة."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT participant_id, start_dt, end_dt, check_out_time
                   FROM mission_participant_sessions s
                   JOIN mission_participants p USING (participant_id)
                   WHERE p.mission_id = %s ORDER BY s.start_dt""",
                (mid,),
            )
            return cur.fetchall()
    finally:
        conn.close()


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
            time.sleep(0.2)
    else:
        print("SERVER FAILED TO START")
        return 2
    print(f"✔ Server up on {API} (live from working tree)\n")

    day1 = "اليوم الأول"
    day2 = "اليوم الثاني"

    # ── سيناريو 1: مهمة بلا خط سير — إنشاء + مشارك + إرسال للجوكر ──────────
    dep1 = now_naive() - datetime.timedelta(hours=2)
    s1 = "TEST_E2E_S1"
    mid1 = api("POST", "/api/missions", headers=H, json=mission_base(
        s1, dep1, status="Draft", participants=[participant("E2E_S1_P")]))["mission_id"]
    m1 = get_mission(mid1)
    check("S1a mission created (Draft, no routes)", (m1["mission_id"] == mid1 and m1["routes"] == []), True)
    check("S1b participant persisted", len(m1["participants"]), 1)
    api("PUT", f"/api/missions/{mid1}", headers=H, json=mission_base(
        s1, dep1, status="Under Review", participants=[participant("E2E_S1_P")]))
    m1b = get_mission(mid1)
    check("S1c Send-to-Joker (Under Review) succeeds — no routes still", m1b["status"], "Under Review")
    check("S1d participant survives send-to-Joker", len(m1b["participants"]), 1)
    print()

    # ── سيناريو 2+4: خط سير واحد، مشارك مخصص لمساره — تشغيل ساعات المسار ──
    dep2 = now_naive() - datetime.timedelta(hours=2)
    today2 = dep2.date().isoformat()
    route1 = [{"group_title": day1, "route_from": "أ", "route_to": "ب",
               "departure_date": today2, "departure_time": "10:00",
               "arrival_date": today2, "arrival_time": "18:00"}]
    s2 = "TEST_E2E_S2"
    mid2 = api("POST", "/api/missions", headers=H, json=mission_base(
        s2, dep2, status="Active", routes=route1,
        # FALSE ⇒ نافذة المسار 10:00→18:00 = 8س (TRUE ينقل البداية لبداية المهمة فيغيّرها)
        participants=[participant("E2E_S2_P", [day1], start_from_mission=False)]))["mission_id"]
    m2 = get_mission(mid2)
    check("S2a one route persisted", len(m2["routes"]), 1)
    p2 = find_part(m2, "E2E_S2_P")
    check("S2b assigned_days = [اليوم الأول]", p2["assigned_days"], [day1])
    check("S2c hours from the single route window 10:00→18:00 = 8h", p2["working_hours"], 8.0, tol=0.01)
    print()

    # ── سيناريو 3+4+5: عدة خطوط، مشارك بمسار واحد وآخر بمسارين (السيناريو الفاشل سابقاً) ──
    dep3 = now_naive() - datetime.timedelta(hours=2)
    today3 = dep3.date().isoformat()
    tomorrow3 = (dep3.date() + datetime.timedelta(days=1)).isoformat()
    routes3 = [
        # اليوم الأول: نافذتان لنفس اليوم — قاعدة fix#4: تُدمجان في مدى واحد (10:00→18:00 = 8س)
        {"group_title": day1, "route_from": "ميدان", "route_to": "الجامعة",
         "departure_date": today3, "departure_time": "10:00", "arrival_date": today3, "arrival_time": "14:00"},
        {"group_title": day1, "route_from": "الجامعة", "route_to": "الملعب",
         "departure_date": today3, "departure_time": "13:00", "arrival_date": today3, "arrival_time": "18:00"},
        # اليوم الثاني: يوم مستقل ⇒ نافذته تُضاف (8س) — حصيلة مسارين في يومين = 16س
        {"group_title": day2, "route_from": "ميدان", "route_to": "المطار",
         "departure_date": tomorrow3, "departure_time": "10:00", "arrival_date": tomorrow3, "arrival_time": "18:00"},
    ]
    s3 = "TEST_E2E_S3"
    mid3 = api("POST", "/api/missions", headers=H, json=mission_base(
        s3, dep3, status="Under Review", routes=routes3,
        # FALSE: نوافذ المسار الأصلية (V1=8، V2=16) كما كانت تختبر — checkbox لا يحرّك البداية
        participants=[participant("E2E_S3_V1", [day1], start_from_mission=False),
                      participant("E2E_S3_V2", [day1, day2], start_from_mission=False)]))["mission_id"]
    m3 = get_mission(mid3)
    check("S3a multi-route mission created", len(m3["routes"]), 3)
    v1 = find_part(m3, "E2E_S3_V1"); v2 = find_part(m3, "E2E_S3_V2")
    check("S3b V1 assigned exactly 1 group", v1["assigned_days"], [day1])
    check("S3c V2 assigned 2 groups (معاً في مهمة واحدة)", v2["assigned_days"], [day1, day2])
    check("S3d V1 hours = 8 (single-day route window)", v1["working_hours"], 8.0, tol=0.01)
    check("S3e V2 hours = 16 (two distinct days summed)", v2["working_hours"], 16.0, tol=0.01)
    check("S3f distinct route counts ⇒ distinct hours", v2["working_hours"] > v1["working_hours"], True)
    print()

    # ── سيناريوهات 6+7+8: JOIN أثناء الإنشاء (Draft) → إرسال للجوكر → إنهاء
    #    → الإغلاق التلقائي في قاعدة البيانات ───────────────────────────────
    dep6 = now_naive() - datetime.timedelta(hours=3)
    s6 = "TEST_E2E_S6"
    mid6 = api("POST", "/api/missions", headers=H, json=mission_base(
        s6, dep6, status="Draft", participants=[participant("E2E_S6_P")]))["mission_id"]
    m6 = get_mission(mid6)
    p6 = find_part(m6, "E2E_S6_P")
    check("S6a mission is Draft (still being created)", m6["status"], "Draft")

    join6 = now_naive() - datetime.timedelta(hours=1)     # انضم قبل ساعة
    api("POST", f"/api/missions/{mid6}/join", headers=H,
        json={"participant_id": p6["participant_id"], "join_datetime": fmt(join6)})
    m6b = get_mission(mid6)
    p6b = find_part(m6b, "E2E_S6_P")
    check("S6b JOIN on a Draft mission recorded (1 open segment)",
          len(p6b["participation_periods"]), 1)
    check("S6c open segment end_dt=None", p6b["participation_periods"][0]["end_dt"], None)
    check("S6d live hours ≈1h since JOIN", p6b["working_hours"], 1.0, tol=0.02)

    # إرسال للجوكر أثناء بقاء المهمة قيد الإنشاء/مسودة — يجب أن يبقى JOIN مربوطاً
    api("PUT", f"/api/missions/{mid6}", headers=H, json=mission_base(
        s6, dep6, status="Under Review", participants=[participant("E2E_S6_P")]))
    m6c = get_mission(mid6)
    check("S7a send-to-Joker while JOINed (Under Review)", m6c["status"], "Under Review")
    p6c = find_part(m6c, "E2E_S6_P")
    check("S7b same participant row kept (participant_id ثابت) — JOIN preserved",
          p6c["participant_id"], p6b["participant_id"])
    check("S7c JOIN segment still linked & open after send-to-Joker",
          len(p6c["participation_periods"]) == 1 and p6c["participation_periods"][0]["end_dt"] is None, True)
    check("S7d live hours keep running after send-to-Joker", p6c["working_hours"] >= 1.0, True)

    # إنهاء المهمة ⇒ إغلاق تلقائي فعلي في قاعدة البيانات (المتطلب الحتمي)
    comp6 = now_naive()
    api("PUT", f"/api/missions/{mid6}", headers=H, json=mission_base(
        s6, dep6, status="Completed", completion=comp6, participants=[participant("E2E_S6_P")]))
    rows6 = open_segments(mid6)
    check("S8a all previously-open segments are now closed in the DB (end_dt set)",
          rows6 and all(r[2] is not None for r in rows6), True)
    echoo = datetime.datetime.strptime(fmt(comp6), "%Y-%m-%d %H:%M")
    exact_end = [r for r in rows6 if r[2] is not None]
    check("S8b closed exactly at mission completion time",
          any(abs((r[2].replace(tzinfo=None) - echoo).total_seconds()) <= 120 for r in exact_end), True)
    check("S8c check_out_time set alongside end_dt", rows6 and all(r[3] is not None for r in rows6), True)
    m6d = get_mission(mid6)
    p6d = find_part(m6d, "E2E_S6_P")
    expect6 = (comp6 - join6).total_seconds() / 3600.0
    check("S8d POST-completion hours frozen at JOIN→completion", p6d["working_hours"], expect6, tol=0.02)
    # الحالة الفعلية المعروضة تأتي من compute_participant_status (المهمة منتهية ⇒ تم انتهاء
    # مهمتة) — `return_status` الخام في الصف يبقى كما هو بحكم التصميم (مصدر الحقيقة للفترات).
    check("S8e participant effective status after mission end = تم انتهاء مهمتة",
          p6d["status"], "تم انتهاء مهمتة")
    print()

    # ── سيناريو 9: JOIN + LEAVE — انفصال يُغلق القطاع بزمنه، ثم إنهاء لا يفتحه ──
    dep9 = now_naive() - datetime.timedelta(hours=3)
    s9 = "TEST_E2E_S9"
    mid9 = api("POST", "/api/missions", headers=H, json=mission_base(
        s9, dep9, status="Active", participants=[participant("E2E_S9_P")]))["mission_id"]
    p9 = find_part(get_mission(mid9), "E2E_S9_P")
    j9 = now_naive() - datetime.timedelta(minutes=120)
    l9 = now_naive() - datetime.timedelta(minutes=90)
    api("POST", f"/api/missions/{mid9}/join", headers=H,
        json={"participant_id": p9["participant_id"], "join_datetime": fmt(j9)})
    api("POST", f"/api/missions/{mid9}/leave", headers=H,
        json={"participant_id": p9["participant_id"], "leave_datetime": fmt(l9)})
    m9 = get_mission(mid9)
    p9b = find_part(m9, "E2E_S9_P")
    seg9 = p9b["participation_periods"][0]
    check("S9a JOIN+LEAVE → 1 closed segment", len(p9b["participation_periods"]), 1)
    check("S9b hours frozen at 30min", p9b["working_hours"], 30.0 / 60.0, tol=0.01)
    time.sleep(5)
    check("S9c leaves don't change after 5s", find_part(get_mission(mid9), "E2E_S9_P")["working_hours"],
          p9b["working_hours"], exact=True)
    comp9 = now_naive()
    api("PUT", f"/api/missions/{mid9}", headers=H, json=mission_base(
        s9, dep9, status="Completed", completion=comp9, participants=[participant("E2E_S9_P")]))
    rows9 = open_segments(mid9)
    check("S9d completion does not reopen an already-left segment (no open rows)",
          not any(r[2] is None for r in rows9), True)
    print()

    # ── سيناريو 10: تركيبة كاملة — خطوط متعددة + تخصيصات مختلفة + JOIN/LEAVE + إنهاء ──
    dep10 = now_naive() - datetime.timedelta(hours=4)
    today10 = dep10.date().isoformat()
    routes10 = [
        {"group_title": day1, "route_from": "ميدان", "route_to": "الجامعة",
         "departure_date": today10, "departure_time": "10:00", "arrival_date": today10, "arrival_time": "14:00"},
        {"group_title": day1, "route_from": "الجامعة", "route_to": "الملعب",
         "departure_date": today10, "departure_time": "13:00", "arrival_date": today10, "arrival_time": "18:00"},
        {"group_title": day2, "route_from": "ميدان", "route_to": "المطار",
         "departure_date": today10, "departure_time": "10:00", "arrival_date": today10, "arrival_time": "18:00"},
    ]
    s10 = "TEST_E2E_S10"
    mid10 = api("POST", "/api/missions", headers=H, json=mission_base(
        s10, dep10, status="Draft", routes=routes10,
        participants=[participant("E2E_S10_W1", [day1]),
                      participant("E2E_S10_W2", [day1, day2])]))["mission_id"]
    m10 = get_mission(mid10)
    w1 = find_part(m10, "E2E_S10_W1"); w2 = find_part(m10, "E2E_S10_W2")
    check("S10a combine: Draft + 2 route groups + mixed assignments created",
          m10["status"] == "Draft" and len(m10["routes"]) == 3, True)
    check("S10b W1=1 route, W2=2 routes", (len(w1["assigned_days"]), len(w2["assigned_days"])), (1, 2))
    j10 = now_naive() - datetime.timedelta(minutes=45)
    api("POST", f"/api/missions/{mid10}/join", headers=H,
        json={"participant_id": w1["participant_id"], "itinerary_group": day1, "join_datetime": fmt(j10)})
    api("POST", f"/api/missions/{mid10}/join", headers=H,
        json={"participant_id": w2["participant_id"], "join_datetime": fmt(j10)})
    # إرسال للجوكر، ثم إنهاء — الإغلاق التلقائي للنشطين فقط، المنسحب لم يتأثر
    api("PUT", f"/api/missions/{mid10}", headers=H, json=mission_base(
        s10, dep10, status="Under Review", routes=routes10,
        participants=[participant("E2E_S10_W1", [day1]), participant("E2E_S10_W2", [day1, day2])]))
    m10c = get_mission(mid10)
    check("S10c combined mission sent to Joker with routes intact", m10c["status"], "Under Review")
    comp10 = now_naive()
    api("PUT", f"/api/missions/{mid10}", headers=H, json=mission_base(
        s10, dep10, status="Completed", completion=comp10, routes=routes10,
        participants=[participant("E2E_S10_W1", [day1]), participant("E2E_S10_W2", [day1, day2])]))
    rows10 = open_segments(mid10)
    check("S10d completion auto-closes every open JOIN in the combined mission",
          len(rows10) == 2 and all(r[2] is not None for r in rows10), True)
    m10d = get_mission(mid10)
    check("S10e both participants reach final effective state",
          find_part(m10d, "E2E_S10_W1")["status"] == "تم انتهاء مهمتة"
          and find_part(m10d, "E2E_S10_W2")["status"] == "تم انتهاء مهمتة", True)
    print()

    # ── سيناريو 11: بوابة تاريخ الإنشاء (لقطة ثابتة — المالك فقط يعدّلها) ──────
    noid = non_owner_user_id()
    if noid:
        H_N = {"Authorization": f"Bearer {create_access_token(noid)}", "Content-Type": "application/json"}
        dep11 = now_naive() - datetime.timedelta(hours=2)
        s11 = "TEST_E2E_S11"
        body11 = mission_base(s11, dep11, status="Active", participants=[participant("E2E_S11_P")])
        body11["creation_datetime"] = "2026-09-09 10:00:00"
        mid11 = api("POST", "/api/missions", headers=H, json=body11)["mission_id"]
        check("C11a POST خزّن تاريخ الإنشاء (2026-09-09 10:00:00)",
              get_mission(mid11).get("creation_datetime"), "2026-09-09 10:00:00")
        # غير المالك يعيد إرسال نفس القيمة ⇒ ليست تغييراً ⇒ 200
        echo_body = mission_base(s11, dep11, status="Active", participants=[participant("E2E_S11_P")])
        echo_body["creation_datetime"] = "2026-09-09 10:00:00"
        st_e, _ = raw_api("PUT", f"/api/missions/{mid11}", headers=H_N, json=echo_body)
        check("C11b غير المالك يعيد نفس القيمة ⇒ 200 (نفس القيمة ليست تعديلاً)", st_e, 200, exact=True)
        # غير المالك يغيّر القيمة ⇒ 403
        chg_body = mission_base(s11, dep11, status="Active", participants=[participant("E2E_S11_P")])
        chg_body["creation_datetime"] = "2026-09-09 11:00:00"
        st_c, body_c = raw_api("PUT", f"/api/missions/{mid11}", headers=H_N, json=chg_body)
        check("C11c غير المالك يغيّر القيمة ⇒ 403", st_c, 403, exact=True)
        # المالك يغيّر القيمة ⇒ 200 + القيمة الجديدة + سجل تدقيق
        own_body = mission_base(s11, dep11, status="Active", participants=[participant("E2E_S11_P")])
        own_body["creation_datetime"] = "2026-09-10 09:30:00"
        st_o, _ = raw_api("PUT", f"/api/missions/{mid11}", headers=H, json=own_body)
        check("C11d المالك يغيّر القيمة ⇒ 200", st_o, 200, exact=True)
        check("C11e القيمة الجديدة محفوظة بعد تعديل المالك",
              get_mission(mid11).get("creation_datetime"), "2026-09-10 09:30:00")
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM audit_logs WHERE mission_id=%s AND action='تعديل تاريخ الإنشاء'", (mid11,))
                n_log = cur.fetchone()[0]
        finally:
            conn.close()
        check("C11f سجل تدقيق «تعديل تاريخ الإنشاء» أُشئ", n_log >= 1, True)
        print()
    else:
        print("  (skip: لا يوجد مستخدم غير مالك لاختبار بوابة تاريخ الإنشاء)")
        print()

    return 0 if not failures else 3


def cleanup():
    try:
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT mission_id FROM missions WHERE mission_name LIKE 'TEST_E2E_%'")
                ids = [r[0] for r in cur.fetchall()]
                if ids:
                    for t in ("mission_participant_itineraries", "mission_participant_sessions",
                              "mission_itineraries", "mission_vehicles", "mission_beneficiaries",
                              "mission_eoc_staff", "mission_participants"):
                        try:
                            cur.execute(f"DELETE FROM {t} WHERE mission_id = ANY(%s)", (ids,))
                        except Exception as e:
                            print(f"  cleanup skip {t}: {e}")
                    cur.execute("DELETE FROM missions WHERE mission_id = ANY(%s)", (ids,))
                conn.commit()
        finally:
            conn.close()
        print("Cleanup done (TEST_E2E_*).")
    except Exception as e:
        print(f"cleanup error: {e}")


if __name__ == "__main__":
    print("═" * 70)
    print(" E2E — كل السيناريوهات (uvicorn حقيقي من الشجرة العاملة + قاعدة البيانات)")
    print("═" * 70)
    code = 0
    try:
        code = main_r()
    finally:
        try:
            cleanup()
        except Exception:
            pass
    if failures:
        print("\nSUMMARY — فشل " + str(len(failures)) + " ❌")
        for f in failures:
            print("  -", f)
        code = 3
    else:
        print("\nSUMMARY — كل الاختبارات الحية نجحت ✅")
    sys.exit(code)