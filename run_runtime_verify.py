# -*- coding: utf-8 -*-
"""
Task C — FINAL runtime + UI verification (هم-check حي على نفس الـ API الذي تستهلكه الواجهة).
يُشغّل خادوم uvicorn حقيقياً على Neon ويتحقق من نقاط القبول السبع:
  1) ساعات مباشرة تتزايد بدون تحديث/إعادة تحميل، وتتجمد عند الإنهاء (بخط سير وبلا خط سير)
  2) خط السير: من/إلى حقول منفصلة + تواريخ/ساعات كاملة الجهتين + المبيت 23:00→03:00 = 4س
  3) مهمة بلا خط سير: لا واجهة خط سير زائدة، المشارك يرث جدول المهمة، انضمام/انفصال سليمان
  4) فقط JOIN/LEAVE بتاريخ وساعة دقيقة — إعادة الانضمام تُنشئ القطاع داخلياً
  5) هوية المهمة: مهمة بلا خط سير تنمو (خط سير + يوم + مسار) دون تحويل عادية→مفتوحة
  6) HR: «عدد ساعات آخر مهمة» قبل «إجمالي الساعات»، نشطة=مباشرة، آخر مكتملة=مجمّدة، الإجمالي=تراكمي
  7) build/tests في نهاية الجري (أداة خارجية يدوية) — هنا نؤكد سلامة الجولة فقط

Cleanup: يحذف كل مهام TEST_RT_* في النهاية. لا يغيّر أي Business Logic.
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
        ok = getattr(got, "__eq__", lambda o: False)(exp)
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
        # checkbox «يُحسب من بداية المهمة» — يُرسل صراحةً حتى تتحقق كلتا الحالتين:
        # TRUE ⇒ البداية المخططة = بداية المهمة (الافتراضي) ; FALSE ⇒ بداية المسار المسند.
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
        "eoc_staff": EOC_STAFF, "notes": "اختبار Task C", "internal_notes": "",
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


def hr_row(name):
    for r_ in hr_rows():
        if r_["full_name"] == name:
            return r_
    raise KeyError(name)


def server_loop(server):
    server.run()


# ─────────────────────────────────────────────────────────────────────
def main_r():
    global BRANCH, H, SAVEJ, SAVEL, SAVE_COMP
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

    depA = now_naive() - datetime.timedelta(hours=3)   # انطلقتا قبل 3 ساعات
    Apid, Apname, Pb1name, Pb2name = None, "TEST_RT_P_A", "TEST_RT_P_B1", "TEST_RT_P_B2"

    midA = api("POST", "/api/missions", headers=H, json=mission_base(
        "TEST_RT_A", depA, participants=[participant(Apname)]))["mission_id"]

    # ── 1) ساعات مباشرة — مهمة بلا خط سير، بلا أي إجراء ──────────────
    m = get_mission(midA)
    pA = find_part(m, Apname)
    wh0 = pA["working_hours"]
    check("A1 default live ≈3h (بلا خط سير، بلا انضمام)", wh0, 3.0, tol=0.02)
    # A2: المحرك يعيد التقريب لأقرب 0.01 ساعة، وtick بـ16ث (0.0044س) لا تعبر حد التقريب عند
    # مقياس الساعات. ننتظر 60ث (0.0167س > 0.01س = عرض خلية التقريب) لتظهر الزيادة يقيناً.
    time.sleep(60)
    wh1 = find_part(get_mission(midA), Apname)["working_hours"]
    check("A2 تزيد تلقائياً بعد 60ث بلا تحديث/إعادة تحميل", wh1 > wh0, True)
    print(f"     Δ = {(wh1-wh0)*3600:.1f} ثانية حقيقية\n")

    # 6) HR نشطة = ساعات مباشرة
    prow = hr_row(Apname)
    check("A3 HR نشطة ⇒ آخر مهمة = مباشرة ≈3h", prow["last_mission_hours"], 3.0, tol=0.05)
    check("A3b HR active_mission true", bool(prow["active_mission"]), True)

    # ── 4) JOIN/LEAVE بتااريخ وساعة + إعادة الانضمام ─────────────────
    # J تُرسل بدقة الدقيقة (كما تفعل الواجهة) ⇒ تُقربها لتطابق القيمة المخزنة تماماً،
    # فيكون التوقّع «قراءة − بداية مخزنة» دقيقاً (لا يتحمل تقريب الثواني).
    J = (now_naive() - datetime.timedelta(minutes=10)).replace(second=0, microsecond=0)
    SAVEJ = J
    api("POST", f"/api/missions/{midA}/join", headers=H,
        json={"participant_id": pA["participant_id"], "join_datetime": fmt(J)})
    t_read = now_naive()
    whj0 = find_part(get_mission(midA), Apname)["working_hours"]
    # التوقّع ديناميكي من القيمة المخزنة فعلاً (J بدقة الدقيقة) لا من 10 دقائق اسميَّة:
    # القطاع المفتوح = لحظة القراءة − بداية الانضمام المخزنة.
    check("A4 انضمام (10 د قبل الآن) ⇒ مباشرة = (القراءة − البداية المخزنة)", whj0, (t_read - J).total_seconds() / 3600.0, tol=0.01)
    # نفس سبب A2: tick 13ث لا يعبر حد التقريب 0.01س عند نطاق الدقائق أحياناً ⇒ 60ث تُظهر الزيادة.
    time.sleep(60)
    whj1 = find_part(get_mission(midA), Apname)["working_hours"]
    check("A5 ساعات الانضمام المباشر تتزايد", whj1 > whj0, True)

    L = (now_naive() - datetime.timedelta(minutes=8)).replace(second=0, microsecond=0)
    SAVEL = L
    api("POST", f"/api/missions/{midA}/leave", headers=H,
        json={"participant_id": pA["participant_id"], "leave_datetime": fmt(L)})
    whL0 = find_part(get_mission(midA), Apname)["working_hours"]
    # الثابت الصحيح ليس «دقيقتين» — J وL بُعدتا عن «الآن» في لحظتين متباعدتين (بعد نومة A5)،
    # فالفجوة الفعلية L−J ≈ 3د. التوقّع يُشتق من القيم المخزنة (دقائق كاملة).
    check("A6 انفصال ⇒ مجمّدة بالفجوة الفعلية (L−J)", whL0, (L - J).total_seconds() / 3600.0, tol=0.01)
    time.sleep(10)
    check("A7 قيمة الانفصال لا تتغير بعد 10ث (تجمّد)", find_part(get_mission(midA), Apname)["working_hours"], whL0, exact=True)

    J2 = now_naive() - datetime.timedelta(minutes=1)
    api("POST", f"/api/missions/{midA}/join", headers=H,
        json={"participant_id": pA["participant_id"], "join_datetime": fmt(J2)})
    segs = find_part(get_mission(midA), Apname)["participation_periods"]
    check("A8 إعادة الانضمام أنشأت قطاعاً تلقائياً (2 قطع)", len(segs), 2)
    check("A9 القطاع الجديد مفتوح end_dt=None", segs[1]["end_dt"], None)
    whR0 = find_part(get_mission(midA), Apname)["working_hours"]
    time.sleep(13)
    whR1 = find_part(get_mission(midA), Apname)["working_hours"]
    check("A10 ساعات إعادة الانضمام مباشرة تتزايد", whR1 > whR0, True)

    # ── إنهاء ثم تجمّد نهائي ───────────────────────────────────────────
    compA = now_naive()
    SAVE_COMP = compA
    api("PUT", f"/api/missions/{midA}", headers=H, json=mission_base(
        "TEST_RT_A", depA, status="Completed", completion=compA,
        participants=[participant(Apname)]))
    whF = find_part(get_mission(midA), Apname)["working_hours"]
    expectF = (L - J).total_seconds() / 3600.0 + (compA - J2).total_seconds() / 3600.0
    check("A11 إنهاء المهمة ⇒ تجمّد نهائي بالساعات الفعلية", whF, expectF, tol=0.012)
    time.sleep(10)
    check("A12 المجمّدة لا تتغير بعد 10ث", find_part(get_mission(midA), Apname)["working_hours"], whF, exact=True)

    # ── 5) هوية المهمة: تنمو (خط سير + يوم + مسار) بلا تحويل ──────────
    today = depA.date()
    route_add = [
        {"group_title": "خط السير الأساسي", "route_from": "مقر الهلال", "route_to": "موقع الطوارئ",
         "departure_date": today.isoformat(), "departure_time": "06:00", "arrival_date": today.isoformat(), "arrival_time": "06:30"},
        {"group_title": "اليوم الميداني", "route_from": "مركز القيادة", "route_to": "الموقع الميداني",
         "departure_date": today.isoformat(), "departure_time": "08:00", "arrival_date": today.isoformat(), "arrival_time": "18:00"},
    ]
    api("PUT", f"/api/missions/{midA}", headers=H, json=mission_base(
        "TEST_RT_A", depA, status="Completed", completion=compA, routes=route_add,
        participants=[participant(Apname, ["اليوم الميداني"])]))
    mG = get_mission(midA)
    check("A13 نفس المهمة (mission_id ثابت)", mG["mission_id"], midA)
    check("A14 التصنيف بقي 'عادية' — لا تحويل لمفتوحة", mG["mission_classification"], "عادية")
    pA2 = find_part(mG, Apname)
    check("A15 نفس المشارك (participant_id ثابت)", pA2["participant_id"], pA["participant_id"])
    check("A16 الساعات المجمّدة لم تتغيّر بإضافة خط السير/اليوم", pA2["working_hours"], whF, exact=True)
    print()

    # ── 2+الخ) مهمة بخط سير: هيكل من/إلى + تواريخ كاملة + مبيت 23:00→03:00 ─
    depB = now_naive() - datetime.timedelta(hours=3)
    tomorrow = today + datetime.timedelta(days=1)
    routesB = [
        {"group_title": "خط السير الأساسي", "route_from": "مقر الهلال الأحمر", "route_to": "موقع الطوارئ",
         "departure_date": today.isoformat(), "departure_time": "06:00", "arrival_date": today.isoformat(), "arrival_time": "06:30"},
        {"group_title": "اليوم الليلي", "route_from": "الموقع الميداني", "route_to": "نقطة الإراحة",
         "departure_date": today.isoformat(), "departure_time": "23:00", "arrival_date": tomorrow.isoformat(), "arrival_time": "03:00"},
        {"group_title": "اليوم الميداني", "route_from": "مركز القيادة", "route_to": "الموقع الميداني",
         "departure_date": today.isoformat(), "departure_time": "08:00", "arrival_date": today.isoformat(), "arrival_time": "18:00"},
    ]
    midB = api("POST", "/api/missions", headers=H, json=mission_base(
        "TEST_RT_B", depB, routes=routesB,
        # checkbox صريح: B3/B4 تجمع نافذة المسار (FALSE) — لأن TRUE ينقل البداية لبداية
        # المهمة فيغيّر 10س→6.5س ويحوّل المبيت 4س→15س. اختبارات خط السير تبقى على FALSE.
        participants=[participant(Apname, ["اليوم الميداني"]),
                      participant(Pb1name, ["اليوم الميداني"], start_from_mission=False),
                      participant(Pb2name, ["اليوم الليلي"], start_from_mission=False)]))["mission_id"]

    mB = get_mission(midB)
    ok_struct = all(
        r["group_title"] and str(r.get("route_from", "")).strip()
        and r["departure_date"] and r["departure_time"] and r["arrival_date"] and r["arrival_time"]
        for r in mB["routes"]
    )
    check("B1 كل مسار: من + إلى + تاريخ/ساعة تحرك + تاريخ/ساعة وصول", ok_struct, True)
    check("B2 أول مسار من='مقر الهلال الأحمر' إلى='موقع الطوارئ'", (mB["routes"][0]["route_from"], mB["routes"][0]["route_to"]), ("مقر الهلال الأحمر", "موقع الطوارئ"))
    check("B3 نافذة اليوم الميداني (08:00→18:00)=10س", find_part(mB, Pb1name)["working_hours"], 10.0)
    check("B4 المبيت 23:00→03:00 (اليوم التالي) = 4س", find_part(mB, Pb2name)["working_hours"], 4.0)

    # انضمام بخط سير (العادي + اليومي المطلوب): مباشر يتزايد
    pB1 = find_part(mB, Pb1name)
    api("POST", f"/api/missions/{midB}/join", headers=H,
        json={"participant_id": pB1["participant_id"], "itinerary_group": "اليوم الميداني", "join_datetime": fmt(now_naive() - datetime.timedelta(minutes=5))})
    whB0 = find_part(get_mission(midB), Pb1name)["working_hours"]
    time.sleep(60)
    whB1 = find_part(get_mission(midB), Pb1name)["working_hours"]
    check("B5 مهمة بخط سير: ساعات الانضمام مباشرة تتزايد", whB1 > whB0, True)
    # (نومة B5 أُطيلت أعلاه إلى 60ث — 11ث لا تعبر حد التقريب 0.01س عند نطاق 5 دقائق)

    compB = now_naive()
    # تجمّد المهمة B لكل مشارك بلا قطاعات = مدى المهمة (بداية المهمة → الإكمال): checkbox TRUE
    expectLastB = (compB - depB).total_seconds() / 3600.0
    api("PUT", f"/api/missions/{midB}", headers=H, json=mission_base(
        "TEST_RT_B", depB, status="Completed", completion=compB, routes=routesB,
        participants=[participant(Apname, ["اليوم الميداني"]),
                      participant(Pb1name, ["اليوم الميداني"], start_from_mission=False),
                      participant(Pb2name, ["اليوم الليلي"])]))
    whBf = find_part(get_mission(midB), Pb1name)["working_hours"]
    time.sleep(9)
    check("B6 إنهاء مهمة بخط سير ⇒ تجمّد", find_part(get_mission(midB), Pb1name)["working_hours"], whBf, exact=True)
    print()

    # ── 6) HR: آخر مهمة قبل الإجمالي + تراكمي ─────────────────────────
    rows = hr_rows()
    keys = list(rows[0].keys()) if rows else []
    io = keys.index("last_mission_hours") if "last_mission_hours" in keys else -1
    ti = keys.index("total_hours") if "total_hours" in keys else -1
    check("C1 HR: عمود «عدد ساعات آخر مهمة» قبل «إجمالي الساعات» مباشرة", io >= 0 and ti >= 0 and io + 1 == ti, True)

    hra = hr_row(Apname)
    expectTot = whF + expectLastB   # A مجمّدة فعلية + تجمّد مهمة B (مدى المهمة — TRUE)
    check("C2 نفس الهوية عبر مهمتين → missions_count=2", hra["missions_count"], 2)
    check("C3 الإجمالي = تراكمي (A+B)", hra["total_hours"], expectTot, tol=0.05)
    check("C4 آخر مهمة مكتملة = تجمّد مدى المهمة B (TRUE: بداية المهمة→الإكمال)", hra["last_mission_hours"], expectLastB, tol=0.05)
    hrb = hr_row(Pb2name)
    check("C5 آخر مهمة (مبيت، checkbox TRUE) = تجمّد مدى المهمة B", hrb["last_mission_hours"], expectLastB, tol=0.05)
    print()

    return 0 if not failures else 3


def cleanup():
    try:
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT mission_id FROM missions WHERE mission_name LIKE 'TEST_RT_%'")
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
        print("Cleanup done (TEST_RT_*).")
    except Exception as e:
        print(f"cleanup error: {e}")


if __name__ == "__main__":
    print("═" * 70)
    print(" جولة التحقق الحي النهائية — Task C (uvicorn حقيقي + Neon)")
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