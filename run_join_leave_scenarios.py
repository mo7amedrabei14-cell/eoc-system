# -*- coding: utf-8 -*-
"""
التحقق المستهدف من ظاهرة JOIN/LEAVE (البجين) — 8 سيناريوهات ضد uvicorn حقيقي (Neon).

  Bug 1: انفصال مشارك (A) يجب ألا يَقفل/يؤثر على B (نشط) أو C (جديد).
  Bug 2: الانفصال ينعكس بعد إتمام المهمة — النشطة تُحسم من شريحة مفتوحة (end_dt IS NULL)
         لا من return_status قديم/مُستعاد؛ والعودة بعد الإتمام لا يُصرّعها الرادار.

سيناريوهات:
  1) JOIN → LEAVE → Completed → ليس نشطاً
  2) JOIN → بلا LEAVE → Completed → يُغلق تلقائياً عند النهاية → ليس نشطاً
  3) A يغادر ⇒ B (نشط) لا يتأثر — تبقى له شريحة مفتوحة
  4) A يغادر ⇒ C يستطيع الانضمام (بلا قفل عابر)
  5) بعد الإتمام: A ما عاد يظهر «في مهمة حاليًا» في HR
  6) بعد الإتمام: المشارك يستطيع الانضمام لمهمة جديدة (لا رادار منع)
  7) مسودة: قطاعات A المنتقلة تُغيّر، وB التعديل متاح، المهمة تبقى مسودة، استقلال لكل مشارك
  8) الإرسال العام (خروج من المسودة) ⇒ التعديل مُقفَل (PATCH → 403)

Cleanup: يحذف TEST_JL_* في النهاية.
"""
import datetime, json, os, sys, threading, time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

import uvicorn
import requests

import main
from main import get_connection
from auth import create_access_token

PORT = 8099
API = f"http://127.0.0.1:{PORT}"
failures = []


def check(label, got, exp, exact=True):
    ok = got == exp if exact else bool(got)
    print(f"[{'OK' if ok else 'FAIL'}] {label}: got={got!r} expected={exp!r}")
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


EOC_STAFF = [
    {"role_name": "مسؤول المتابعة", "staff_name": "متابعة"},
    {"role_name": "المشرف", "staff_name": "مشرف"},
    {"role_name": "الجوكر", "staff_name": "جوكر"},
    {"role_name": "معبئ الاستمارة", "staff_name": "معبئ"},
]


def participant(full_name, membership=None, assigned_days=None, pos="ميداني", start_from_mission=True):
    p = {
        "participant_type": "non_volunteer", "full_name": full_name,
        "participation_role": "", "participant_position": pos,
        "branch_id": BRANCH, "assigned_itinerary": "",
        "return_status": "مازال بالمهمة", "phase_name": "اليوم الأول", "stay_type": "ذهاب وعودة",
        "assigned_days": assigned_days or [],
        "start_from_mission": start_from_mission,
    }
    if membership:
        p["membership_number"] = membership
    return p


def mission_base(name, dep, status="نشطة", participants=None, completion=None):
    body = {
        "mission_name": name, "mission_classification": "عادية", "branch_id": BRANCH,
        "mission_type": "إغاثة", "mission_location": "موقع الاختبار", "responsible_person": "فظ",
        "status": status,
        "exit_date": dep.date().isoformat(),
        "departure_date": dep.date().isoformat(),
        "departure_time": dep.strftime("%H:%M"),
        "routes": [], "vehicles": [], "participants": participants or [],
        "eoc_staff": EOC_STAFF, "notes": "اختبار JOIN/LEAVE", "internal_notes": "",
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


def get_mission(mid):
    return api("GET", f"/api/missions/{mid}", headers=H)


def find_part(mdata, name):
    for p in mdata["participants"]:
        if p["full_name"] == name:
            return p
    raise KeyError(name)


def hr_rows():
    return api("GET", "/api/human-resources", headers=H)


def hr_active(name):
    for r_ in hr_rows():
        if r_["full_name"] == name:
            return bool(r_["active_mission"])
    return None


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
    print(f"✔ Server up on {API} (Neon live)\n")

    # تنظيف أي مهام يتيمة من جولة سابقة فاشلة
    _conn0 = get_connection()
    try:
        with _conn0.cursor() as _c0:
            _c0.execute("DELETE FROM missions WHERE mission_name LIKE 'TEST_JL_%%'")
            _c0.execute("DELETE FROM missions WHERE mission_name LIKE 'TEST_JL2_%%'")
            _c0.execute("DELETE FROM missions WHERE mission_name LIKE 'TEST_JL3_%%'")
        _conn0.commit()
    finally:
        _conn0.close()

    dep = (now_naive() - datetime.timedelta(days=1)).date().isoformat()  # كل الأزمنة في الماضي
    dep_dt = datetime.datetime.strptime(dep, "%Y-%m-%d")

    # ═══════════ مهمة M1 «نشطة» مع A, B, C — سيناريوهات 1..5 ═══════════
    m1 = api("POST", "/api/missions", headers=H, json=mission_base(
        "TEST_JL_A", dep_dt, status="نشطة",
        participants=[participant("مشارك A المسودة JL", membership="JL-A"),
                      participant("مشارك B المسودة JL", membership="JL-B"),
                      participant("مشارك C المسودة JL", membership="JL-C")]))
    M1 = m1["mission_id"]
    m = get_mission(M1)
    pA = find_part(m, "مشارك A المسودة JL"); pB = find_part(m, "مشارك B المسودة JL"); pC = find_part(m, "مشارك C المسودة JL")

    # A ينضم، B ينضم، A يغادر، C ينضم — استقلال كامل لكل مشارك
    api("POST", f"/api/missions/{M1}/join", headers=H, json={"participant_id": pA["participant_id"], "join_datetime": f"{dep} 09:00", "client_now": fmt(now_naive())})
    api("POST", f"/api/missions/{M1}/join", headers=H, json={"participant_id": pB["participant_id"], "join_datetime": f"{dep} 10:00", "client_now": fmt(now_naive())})
    api("POST", f"/api/missions/{M1}/leave", headers=H, json={"participant_id": pA["participant_id"], "leave_datetime": f"{dep} 11:00", "client_now": fmt(now_naive())})
    # C ينضم بعدما غادر A — يجب ألا يكون مقفولاً بفعل انفصال A
    api("POST", f"/api/missions/{M1}/join", headers=H, json={"participant_id": pC["participant_id"], "join_datetime": f"{dep} 11:30", "client_now": fmt(now_naive())})

    m = get_mission(M1)
    A = find_part(m, "مشارك A المسودة JL"); B = find_part(m, "مشارك B المسودة JL"); C = find_part(m, "مشارك C المسودة JL")
    Asegs, Bsegs, Csegs = A["participation_periods"], B["participation_periods"], C["participation_periods"]

    # السيناريو 3 — A غادر، B (نشط) لا يتأثر إطلاقاً
    check("S3 A غادر ⇒ شريحته مغلقة", len(Asegs) == 1 and Asegs[0].get("end_dt") is not None, True)
    check("S3 B ما زال نشطاً (شريحة مفتوحة) بعد انفصال A", len(Bsegs) == 1 and Bsegs[0].get("end_dt") is None, True)
    check("S3 B return_status لم يتغير بفعل A", B["return_status"], "مازال بالمهمة")
    check("S3 انفصال A ⇐ أزرار/حالة B لا تُقفل (B يملك قطاعاً واحداً مفتوحاً)", len(Bsegs), 1)

    # السيناريو 4 — C جديد ينضم بعد انفصال A (بلا أي قفل عابر)
    check("S4 C انضم بنجاح (شريحة مفتوحة)", len(Csegs) == 1 and Csegs[0].get("end_dt") is None, True)
    check("S4 C return_status 'مازال بالمهمة'", C["return_status"], "مازال بالمهمة")

    # السيناريو 1 — A: JOIN → LEAVE → Completed → ليس نشطاً
    comp = dep_dt + datetime.timedelta(hours=16)
    api("PUT", f"/api/missions/{M1}", headers=H, json=mission_base(
        "TEST_JL_A", dep_dt, status="Completed",
        participants=[participant("مشارك A المسودة JL", membership="JL-A"),
                      participant("مشارك B المسودة JL", membership="JL-B"),
                      participant("مشارك C المسودة JL", membership="JL-C")],
        completion=comp))
    m = get_mission(M1)
    check("S1 المهمة Completed", m["status"], "Completed")
    A2 = find_part(m, "مشارك A المسودة JL"); B2 = find_part(m, "مشارك B المسودة JL"); C2 = find_part(m, "مشارك C المسودة JL")
    A2segs, B2segs = A2["participation_periods"], B2["participation_periods"]
    check("S1 A قطاعاته مغلقة عند الإتمام", all(s.get("end_dt") is not None for s in A2segs), True)
    check("S1 A return_status = تم انتهاء مهمتة", A2["return_status"], "تم انتهاء مهمتة")

    # السيناريو 2 — B: JOIN بلا LEAVE → Completed → يُغلق تلقائياً عند النهاية
    check("S2 B قطاعه أُغلق تلقائياً عند نهاية المهمة", len(B2segs) == 1 and B2segs[0].get("end_dt") is not None, True)
    check("S2 B return_status = تم انتهاء مهمتة (لا يُستعاد القديم)", B2["return_status"], "تم انتهاء مهمتة")

    # السيناريو 5 — بعد الإتمام، لا أحد يظهر «في مهمة حاليًا» في HR
    ha = hr_active("مشارك A المسودة JL"); hb = hr_active("مشارك B المسودة JL"); hc = hr_active("مشارك C المسودة JL")
    check("S5 HR: A ليس نشطاً بعد الإتمام (Bug 2)", ha, False)
    check("S5 HR: B ليس نشطاً بعد الإتمام (Bug 2)", hb, False)
    check("S5 HR: C ليس نشطاً بعد الإتمام", hc, False)

    # السيناريو 6 — بعد الإتمام، B يستطيع الانضمام لمهمة جديدة (لا رادار منع)
    m2 = api("POST", "/api/missions", headers=H, json=mission_base(
        "TEST_JL_B", dep_dt, status="نشطة",
        participants=[participant("مشارك B المسودة JL", membership="JL-B")]))
    M2 = m2["mission_id"]
    mb = get_mission(M2)
    pB2 = find_part(mb, "مشارك B المسودة JL")
    api("POST", f"/api/missions/{M2}/join", headers=H, json={"participant_id": pB2["participant_id"], "join_datetime": f"{dep} 13:00", "client_now": fmt(now_naive())})
    check("S6 انضمام B لمهمة جديدة نجح (الرادار لم يصرّعه)", len(find_part(get_mission(M2), "مشارك B المسودة JL")["participation_periods"]), 1)

    # ═══════════ سيناريوهات المسودة 7 و8 (مهمة Draft مع A' وB') ═══════════
    dep_s = dep
    m3 = api("POST", "/api/missions", headers=H, json=mission_base(
        "TEST_JL_C", dep_dt, status="Draft",
        participants=[participant("AJ مسودة", membership="JL-AD"),
                      participant("BJ مسودة", membership="JL-BD")]))
    M3 = m3["mission_id"]
    m = get_mission(M3)
    pAJ = find_part(m, "AJ مسودة"); pBJ = find_part(m, "BJ مسودة")

    # س7 — انضمام/انفصال/تعديل في المسودة: كلا المشاركين قابلان للتعديل، وسحب A لا يخص B
    api("POST", f"/api/missions/{M3}/join", headers=H, json={"participant_id": pAJ["participant_id"], "join_datetime": f"{dep_s} 09:00", "client_now": fmt(now_naive())})
    api("POST", f"/api/missions/{M3}/leave", headers=H, json={"participant_id": pAJ["participant_id"], "leave_datetime": f"{dep_s} 11:00", "client_now": fmt(now_naive())})
    api("POST", f"/api/missions/{M3}/join", headers=H, json={"participant_id": pBJ["participant_id"], "join_datetime": f"{dep_s} 10:00", "client_now": fmt(now_naive())})
    m = get_mission(M3)
    AJ, BJ = find_part(m, "AJ مسودة"), find_part(m, "BJ مسودة")
    AJseg = AJ["participation_periods"][0]
    check("S7 المهمة ما زالت Draft بعد انضمام/انفصال", m["status"], "Draft")
    check("S7 AJ مغلق (غادر) في المسودة", AJseg.get("end_dt") is not None, True)
    check("S7 BJ ما زال مفتوحاً (تعديله متاح) رغم سحب AJ", BJ["participation_periods"][0].get("end_dt") is None, True)
    # تعديل في مكانه أثناء المسودة (B — JOKER: تُعدَّل الشريحة نفسها) — مسموح
    api("PATCH", f"/api/missions/{M3}/sessions/{BJ['participation_periods'][0]['session_id']}", headers=H,
        json={"action": "join", "dt": f"{dep_s} 10:05"})
    m = get_mission(M3)
    check("S7 تعديل BJ في المسودة نجح (قطاع واحد لا يتكرر)", len(find_part(m, "BJ مسودة")["participation_periods"]), 1)
    check("S7 المسودة تسمح بتعديل AJ أيضاً (له شريحة مغلقة)", len(AJ["participation_periods"]), 1)

    # س8 — الإرسال العام (خروج من المسودة) = القفل والجمود (PATCH → 403)
    api("PUT", f"/api/missions/{M3}", headers=H, json=mission_base(
        "TEST_JL_C", dep_dt, status="Under Review",
        participants=[participant("AJ مسودة", membership="JL-AD"),
                      participant("BJ مسودة", membership="JL-BD")]))
    m = get_mission(M3)
    check("S8 المهمة غادرت المسودة (Under Review)", m["status"], "Under Review")
    r1 = requests.patch(f"{API}/api/missions/{M3}/sessions/{find_part(m, 'AJ مسودة')['participation_periods'][0]['session_id']}",
                        headers=H, json={"action": "leave", "dt": f"{dep_s} 12:00"})
    r2 = requests.patch(f"{API}/api/missions/{M3}/sessions/{find_part(get_mission(M3), 'BJ مسودة')['participation_periods'][0]['session_id']}",
                        headers=H, json={"action": "join", "dt": f"{dep_s} 10:07"})
    check("S8 PATCH مُرفوض 403 بعد الإرسال العام (AJ)", r1.status_code, 403)
    check("S8 PATCH مُرفوض 403 بعد الإرسال العام (BJ)", r2.status_code, 403)

    # تنظيف
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            for mid in (M1, M2, M3):
                cur.execute("DELETE FROM missions WHERE mission_id = %s", (mid,))
        conn.commit()
    finally:
        conn.close()
    print("\nCleanup done (TEST_JL_*).")

    if failures:
        print(f"\nFAILED: {len(failures)} — {failures}")
        return 1
    print("\nSUMMARY — كل السيناريوهات الثمانية نجحت ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main_r())