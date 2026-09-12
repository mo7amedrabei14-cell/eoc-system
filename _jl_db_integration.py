"""JOIN/LEAVE integration test on the dev neondb — drives the REAL endpoints.
Prereq: migration 20260912_jl_leave_closes_session.sql applied (3 unique indexes dropped).

Scenarios (from the approved plan):
  S1  الخروج يُغلق الجلسة — Draft mission, one participant assigned JL:J:A + JL:L:B
      ⇒ closed session (end_dt = B), return_status='تم انتهاء مهمتة', GET hours = 1.0 in Draft.
  S2  إعادة الإضافة لنفس المهمة — PUT two rows for the same volunteer with periods
      (A,B) and (C,D) ⇒ two active participant rows, two closed segments, hours = 2.0.
  S3  إعادة الحفظ/التطابق — second PUT of the same two rows ⇒ no duplicates; same
      participant_id preserved for period-1 row; both still active.
  S4  التوافر عبر المهام —
      (a) after closed (A,B) in M1 (still active) ⇒ same identity addable to M2 (no block).
      (b) before LEAVE (only JL:J:A, open) in M1 ⇒ adding to M2 BLOCKED by radar.
Test data is named TEST-JL-* and deleted at the end.
"""
import sys, types
from datetime import datetime

sys.path.insert(0, r"C:\Users\mo7am\OneDrive\Work\EOC System")
import main
from db import get_connection

# ── auth: mint a token for real user 1 (exists in dev DB) ────────────────────
import auth
TOKEN = auth.create_access_token(1)
CRED = types.SimpleNamespace(credentials=TOKEN)

DB = "TEST-JL-DB"
created_mission_ids = []
created_volunteer_ids = []   # صفوف volunteers أنشأناها لسيناريوهات الرادار (تُحذف في التنظيف)


def make_mission(name, status="Draft", participants=None, jl=None, prefix="TEST-JL"):
    from main import MissionCreate, ParticipantModel, RouteModel, EOCStaffModel, JoinLeaveEntryModel
    parts = []
    for p in (participants or []):
        parts.append(ParticipantModel(**p))
    routes = [RouteModel(group_title="خط السير الأساسي", route_from="القاهرة", route_to="المنيا",
                         departure_date="2026-09-12", departure_time="06:00",
                         arrival_date="2026-09-12", arrival_time="18:00")]
    jls = [JoinLeaveEntryModel(**e) for e in (jl or [])]
    staff = [EOCStaffModel(role_name=r, staff_name="مسؤول اختبار") for r in
             ("مسؤول المتابعة", "المشرف", "الجوكر", "معبئ الاستمارة")]
    return MissionCreate(
        mission_name=name, mission_classification="عادية", branch_id=6,
        status=status,
        exit_date="2026-09-12", departure_time="06:00",
        departure_date="2026-09-12", arrival_date="2026-09-12",
        arrival_time="18:00", completion_date="2026-09-12", completion_time="18:00",
        idempotency_key=f"{prefix}-{datetime.now().strftime('%H%M%S%f')}",
        routes=routes, participants=parts, beneficiaries=[], eoc_staff=staff,
        join_leave_entries=jls,
    )


def create(m):
    res = main.create_mission(mission=m, credentials=CRED)
    created_mission_ids.append(res["mission_id"])
    return res["mission_id"]


def put(mid, m):
    return main.update_mission(mission_id=mid, mission=m, credentials=CRED,
                               idempotency_key_header=None)


def jl_entries():
    """A=join 10:00, B=leave 11:00, C=join 12:00, D=leave 13:00 (same day)."""
    return [
        {"title": "A", "kind": "join",  "dt": "2026-09-12 10:00"},
        {"title": "B", "kind": "leave", "dt": "2026-09-12 11:00"},
        {"title": "C", "kind": "join",  "dt": "2026-09-12 12:00"},
        {"title": "D", "kind": "leave", "dt": "2026-09-12 13:00"},
    ]


VOL = {"participant_type": "volunteer", "full_name": "متدرب اختبار JL",
       "participation_role": "JL-TEST-MEM", "branch_id": 6, "assigned_itinerary": "خط السير الأساسي"}


def q(cursor, sql, params=()):
    cursor.execute(sql, params)
    return cursor.fetchall()


def hours_for(conn, mission_id, pid, status):
    """Replicate the GET-path computation exactly (see main.py:3021-3062)."""
    with conn.cursor() as c:
        mr = c.execute("SELECT mission_id, mission_name, mission_classification, branch_id, status, "
                       "exit_date, departure_date, arrival_date, return_date, completion_date, "
                       "start_time, departure_time, arrival_time, completion_time "
                       "FROM missions WHERE mission_id = %s", (mission_id,))
        cols = [d[0] for d in mr.description]
        r = c.fetchone()
        mission_data = dict(zip(cols, r))
        c.execute("SELECT group_title, route_from, route_to, departure_time, arrival_time, "
                  "departure_date, arrival_date FROM mission_itineraries WHERE mission_id = %s",
                  (mission_id,))
        mission_data["routes"] = [
            {"group_title": x[0], "route_from": x[1], "route_to": x[2],
             "departure_time": x[3], "arrival_time": x[4],
             "departure_date": x[5], "arrival_date": x[6]} for x in c.fetchall()]
        c.execute("SELECT itinerary_group FROM mission_participant_itineraries WHERE participant_id = %s",
                  (pid,))
        assigned_days = [d[0] for d in c.fetchall()]
        c.execute("SELECT session_id, session_date, check_in_time, check_out_time, notes, "
                  "start_dt, end_dt, itinerary_group, start_entry_id, end_entry_id "
                  "FROM mission_participant_sessions WHERE participant_id = %s", (pid,))
        segs = []
        for s in c.fetchall():
            segs.append({"session_id": s[0], "session_date": str(s[1]) if s[1] else "",
                         "check_in_time": str(s[2]) if s[2] else "",
                         "check_out_time": str(s[3]) if s[3] else "", "notes": s[4],
                         "start_dt": main.fmt_dt(s[5]), "end_dt": main.fmt_dt(s[6]),
                         "itinerary_group": s[7], "start_entry_id": s[8], "end_entry_id": s[9]})
        wh = main.compute_working_hours(mission_data, status, segs, assigned_days,
                                        mission_data["routes"], now=None,
                                        start_from_mission=True)
        return wh, segs, assigned_days




def check(cond, label, extra=""):
    if not cond:
        raise AssertionError(f"FAIL {label} {extra}")
    print(f"  + {label}")


def cleanup_test_data():
    """Delete ALL TEST-JL-DB-% missions — including leftovers from a prior/crashed
    run (an open session in an orphaned TEST mission would otherwise poison the
    radar checks for the shared synthetic member). Dependency order: children first."""
    conn = get_connection()
    try:
        with conn.cursor() as c:
            c.execute("SELECT mission_id FROM missions WHERE mission_name LIKE %s", (f"{DB}-%",))
            mids = [r[0] for r in c.fetchall()]
            for t, key in [
                ("mission_participant_sessions", "mission_id"),
                ("mission_participant_itineraries", "mission_id"),
                ("mission_participants", "mission_id"),
                ("mission_join_leave_entries", "mission_id"),
                ("mission_itineraries", "mission_id"),
                ("mission_vehicles", "mission_id"),
                ("mission_beneficiaries", "mission_id"),
                ("mission_eoc_staff", "mission_id"),
            ]:
                if mids:
                    c.execute(f"DELETE FROM {t} WHERE {key} = ANY(%s)", (mids,))
            if mids:
                c.execute("DELETE FROM missions WHERE mission_id = ANY(%s)", (mids,))
            # المتطوعون المختبرون (بعد المهام التي تشير إليهم)
            if created_volunteer_ids:
                c.execute("DELETE FROM volunteers WHERE volunteer_id = ANY(%s)",
                          (created_volunteer_ids,))
            conn.commit()
        print(f"  + cleaned test missions: {len(mids)}, volunteers: {len(created_volunteer_ids)}")
    except Exception as exc:
        conn.rollback()
        print(f"  - cleanup failed: {exc}")
    finally:
        conn.close()


def main_test():
    cleanup_test_data()   # start clean — prior crashed runs may have orphaned open sessions
    # S1: closed session from LEAVE in Draft, hours computed live
    m1 = make_mission(f"{DB}-S1", status="Draft",
                      participants=[{**VOL, "assigned_days": ["JL:J:A", "JL:L:B"]}],
                      jl=jl_entries())
    mid1 = create(m1)
    conn = get_connection()
    try:
        with conn.cursor() as c:
            rows = q(c, """SELECT p.participant_id, p.return_status,
                        s.end_dt, s.start_entry_id, s.end_entry_id, s.start_dt
                    FROM mission_participants p
                    LEFT JOIN mission_participant_sessions s ON s.participant_id = p.participant_id
                    WHERE p.mission_id = %s""", (mid1,))
            check(len(rows) == 1, "S1: one participant + one session row", str(rows))
            pid1 = rows[0][0]
            check(rows[0][1] == 'تم انتهاء مهمتة', "S1: return_status synced to 'تم انتهاء مهمتة'",
                  rows[0][1])
            check(rows[0][2] is not None, "S1: session CLOSED (end_dt set from LEAVE B)")
            check(rows[0][3] is not None and rows[0][4] is not None,
                  "S1: tagged segment (start_entry=A, end_entry=B)")
            # hours live in Draft = 1.0 (the '0 minutes' bug is fixed)
        wh, segs, ad = hours_for(conn, mid1, pid1, "Draft")
        check(abs(wh - 1.0) < 1e-9, "S1: Draft working hours = 1.0 (was 0.0)", f"got {wh}")

        # S2: two independent periods for the SAME volunteer in the SAME mission
        m2 = make_mission(f"{DB}-S2", status="Draft",
                          participants=[
                              {**VOL, "assigned_days": ["JL:J:A", "JL:L:B"]},
                              {**VOL, "assigned_days": ["JL:J:C", "JL:L:D"]},
                          ], jl=jl_entries())
        mid2 = create(m2)
        with conn.cursor() as c:
            rows = q(c, """SELECT participant_id, membership_number, return_status,
                        (SELECT COUNT(*) FROM mission_participant_sessions s
                         WHERE s.participant_id = p.participant_id AND s.end_dt IS NOT NULL),
                        (SELECT COUNT(*) FROM mission_participant_sessions s
                         WHERE s.participant_id = p.participant_id AND s.end_dt IS NULL)
                    FROM mission_participants p WHERE p.mission_id = %s AND p.roster_active = true
                    ORDER BY participant_id""", (mid2,))
            check(len(rows) == 2, "S2: two active participant rows (periods A,B)+(C,D)", str(rows))
            check(all(r[2] == 'تم انتهاء مهمتة' for r in rows),
                  "S2: both periods closed => return_status done", str(rows))
            check(all(r[3] == 1 and r[4] == 0 for r in rows),
                  "S2: one closed segment each, no open segments")
        # PUT the same two rows again => idempotent: same ids, both still active
        m2b = make_mission(f"{DB}-S2b", status="Draft",
                           participants=[
                               {**VOL, "assigned_days": ["JL:J:A", "JL:L:B"]},
                               {**VOL, "assigned_days": ["JL:J:C", "JL:L:D"]},
                           ], jl=jl_entries())
        put(mid2, m2b)
        with conn.cursor() as c:
            rows2 = q(c, """SELECT participant_id, roster_active FROM mission_participants
                         WHERE mission_id = %s ORDER BY participant_id""", (mid2,))
            check(len(rows2) == 2, "S2b: re-save keeps exactly 2 rows (no duplicates)",
                  str(rows2))
            check(rows[0][0] == rows2[0][0] and rows[1][0] == rows2[1][0],
                  "S2b: participant_ids preserved across re-save (in-place update)",
                  f"{rows} -> {rows2}")
            check(all(r[1] for r in rows2), "S2b: both still active (roster_active=true)")
        # hours for M2 = 2.0 (1h + 1h from two separate periods)
        pids2 = [r[0] for r in rows]
        h1, _, _ = hours_for(conn, mid2, pids2[0], "Draft")
        h2, _, _ = hours_for(conn, mid2, pids2[1], "Draft")
        check(abs(h1 - 1.0) < 1e-9 and abs(h2 - 1.0) < 1e-9,
              "S2c: each period = 1.0h, total 2.0h", f"h1={h1} h2={h2}")

        # S3: cross-mission availability -------------------------------------
        # M3 has a CLOSED period (A,B) and stays active (not Completed).
        m3 = make_mission(f"{DB}-S3a", status="Draft",
                          participants=[{**VOL, "assigned_days": ["JL:J:A", "JL:L:B"]}],
                          jl=jl_entries())
        mid3 = create(m3)
        # (a) same volunteer with a CLOSED period in M3 => ADDABLE to M4 (no block)
        m4 = make_mission(f"{DB}-S4a", status="Draft",
                          participants=[{**VOL, "assigned_days": ["JL:J:A", "JL:L:B"]}],
                          jl=jl_entries())
        mid4 = create(m4)   # must NOT raise
        check(True, "S3a: re-add same identity to another mission while M3 active (allowed)")

        # (b) volunteer with OPEN period in M5 (only JOIN, no LEAVE) => BLOCKED in M6
        m5 = make_mission(f"{DB}-S5a", status="Draft",
                          participants=[{**VOL, "assigned_days": ["JL:J:A"]}],
                          jl=jl_entries())
        mid5 = create(m5)
        try:
            m6 = make_mission(f"{DB}-S6a", status="Draft",
                              participants=[{**VOL, "assigned_days": ["JL:J:C", "JL:L:D"]}],
                              jl=jl_entries())
            create(m6)
            raise AssertionError("FAIL S3b: open session in M5 should have blocked M6 add")
        except main.HTTPException as e:
            check(e.status_code == 400 and "جلسة مفتوحة" in str(e.detail),
                  "S3b: OPEN (no LEAVE) session blocks re-add — radar", str(e.detail)[:90])

        # ── Fix 1 (HR): two periods in SAME mission must SUM (was MAX ⇒ 1) ──────
        # HR report excludes Draft/Cancelled/Returned ⇒ use Completed status.
        # Each H-scenario uses its OWN identity: VOL was left with an OPEN session
        # by S3b — re-adding it anywhere is (correctly) blocked by the radar — and
        # an identity shared across two Completed missions would make the HR record
        # global (total 2+2) which H2's "total stays 2.0" contradicts.
        def volH(tag, mem):
            return {**VOL, "full_name": f"متدرب اختبار JL-HT{tag}",
                    "participation_role": mem}

        def hr_for(mem):
            return [r for r in main.get_human_resources(credentials=CRED)
                    if str(r.get('membership_number', '')) == mem]

        h1 = volH("1", "JL-TEST-MEM-H1")
        mH1 = make_mission(f"{DB}-H1", status="Completed",
                           participants=[
                               {**h1, "assigned_days": ["JL:J:A", "JL:L:B"]},
                               {**h1, "assigned_days": ["JL:J:C", "JL:L:D"]},
                           ], jl=jl_entries())
        midH1 = create(mH1)
        hr1 = hr_for("JL-TEST-MEM-H1")
        check(len(hr1) == 1, "H1: two same-identity rows collapse into one HR record", f"found {len(hr1)}")
        check(abs((hr1[0].get('total_hours') or 0) - 2.0) < 1e-9,
              "H1: HR total = 2h in one mission (was 1h via MAX)", f"{hr1[0].get('total_hours')}")
        check(hr1[0].get('missions_count') == 1
              and abs((hr1[0].get('last_mission_hours') or 0) - 2.0) < 1e-9,
              "H1: missions_count=1, last_mission_hours=2.0", str(hr1[0]))

        # H2 — roster(-plan) row + JL rows in same mission ⇒ actual dominates plan
        h2 = volH("2", "JL-TEST-MEM-H2")
        mH2 = make_mission(f"{DB}-H2", status="Completed",
                           participants=[
                               {**h2, "assigned_days": ["JL:J:A", "JL:L:B"]},
                               {**h2, "assigned_days": ["JL:J:C", "JL:L:D"]},
                               {**h2, "assigned_days": ["خط السير الأساسي"]},
                           ], jl=jl_entries())
        midH2 = create(mH2)
        hr2 = hr_for("JL-TEST-MEM-H2")
        check(len(hr2) == 1, "H2: identity resolves to one HR record", f"found {len(hr2)}")
        check(abs((hr2[0].get('total_hours') or 0) - 2.0) < 1e-9,
              "H2: roster plan hours do NOT add on top of actual (total stays 2.0)",
              f"{hr2[0].get('total_hours')}")

        # ── Fix 2 (radar): roster-only blocks; LEAVE / end_participation frees ──
        # الفرع الموسّع للرادار يعمل فقط لمن يُحلّ volunteer_id (ربط الرقم+الفرع).
        # جدول volunteers فارغ فعلياً في بيئة التطوير ⇒ نُنشئ متطوعاً حقيقياً لكل
        # سيناريو N (رقم عضوية فريد) ويُحذف في التنظيف؛ كل استدعاء = هوية نظيفة.
        def fresh_volunteer(tag):
            mem = f"JL-N-{tag}"
            with conn.cursor() as c:
                c.execute("""INSERT INTO volunteers
                             (full_name, phone, branch_id, is_active, membership_number, status_mode)
                             VALUES (%s, NULL, %s, TRUE, %s, 'auto')
                             RETURNING volunteer_id""",
                          (f"متدرب اختبار JL {tag}", 6, mem))
                vid = c.fetchone()[0]
                created_volunteer_ids.append(vid)
                conn.commit()
            return {**VOL, "full_name": f"{DB}_{tag}",
                    "participation_role": mem, "branch_id": 6}

        # N1 — roster-only (zero sessions) in an UNFINISHED mission ⇒ blocked elsewhere
        rv1 = fresh_volunteer("V1")
        mN1 = make_mission(f"{DB}-N1", status="Draft",
                           participants=[{**rv1, "assigned_days": ["خط السير الأساسي"]}])
        midN1 = create(mN1)
        with conn.cursor() as c:
            nses = q(c, """SELECT COUNT(*) FROM mission_participant_sessions s
                        JOIN mission_participants p ON p.participant_id = s.participant_id
                        WHERE p.mission_id = %s""", (midN1,))[0][0]
        check(nses == 0, "N1: roster-only participant has ZERO sessions", f"{nses}")
        try:
            create(make_mission(f"{DB}-N2", status="Draft",
                                participants=[{**rv1, "assigned_days": ["خط السير الأساسي"]}]))
            raise AssertionError("FAIL N1: adding roster-only person to a 2nd unfinished mission must block")
        except main.HTTPException as e:
            check(e.status_code == 400, "N1: roster-only in unfinished mission BLOCKS re-add (400)",
                  str(e.detail)[:60])

        # N2 — closed (LEAVE) in an active mission ⇒ same volunteer is FREE (volunteer branch)
        rv2 = fresh_volunteer("V2")
        mN3 = make_mission(f"{DB}-N3", status="Draft",
                           participants=[{**rv2, "assigned_days": ["JL:J:A", "JL:L:B"]}],
                           jl=jl_entries())
        midN3 = create(mN3)
        create(make_mission(f"{DB}-N4", status="Draft",
                            participants=[{**rv2, "assigned_days": ["JL:J:C", "JL:L:D"]}],
                            jl=jl_entries()))
        check(True, "N2: closed (LEAVE) in active M1 ⇒ re-addable — no block")

        # N3 — one row holding CLOSED then LATER OPEN ⇒ still blocked (open wins)
        rv3 = fresh_volunteer("V3")
        mN5 = make_mission(f"{DB}-N5", status="Draft",
                           participants=[{**rv3, "assigned_days": ["JL:J:A", "JL:L:B", "JL:J:C"]}],
                           jl=jl_entries())
        midN5 = create(mN5)
        try:
            create(make_mission(f"{DB}-N6", status="Draft",
                                participants=[{**rv3, "assigned_days": ["JL:J:C", "JL:L:D"]}],
                                jl=jl_entries()))
            raise AssertionError("FAIL N3: mixed closed+open row must still block (open session)")
        except main.HTTPException as e:
            check(e.status_code == 400, "N3: closed+open in one row ⇒ blocked (EXISTS open)", str(e.detail)[:60])

        # N4 — roster-only in a COMPLETED mission ⇒ does NOT block new mission
        rv4 = fresh_volunteer("V4")
        mN7 = make_mission(f"{DB}-N7", status="Completed",
                           participants=[{**rv4, "assigned_days": ["خط السير الأساسي"]}])
        midN7 = create(mN7)
        create(make_mission(f"{DB}-N8", status="Draft",
                            participants=[{**rv4, "assigned_days": ["خط السير الأساسي"]}]))
        check(True, "N4: roster-only in COMPLETED mission does not block a new mission")

        # N5 — "إنهاء المشاركة الآن" on a roster-only volunteer writes a CLOSED doc row ⇒ freed
        rv5 = fresh_volunteer("V5")
        mN9 = make_mission(f"{DB}-N9", status="Draft",
                           participants=[{**rv5, "assigned_days": ["خط السير الأساسي"]}])
        midN9 = create(mN9)
        with conn.cursor() as c:
            pids9 = [r[0] for r in q(c, "SELECT participant_id FROM mission_participants WHERE mission_id = %s",
                                     (midN9,))]
        check(len(pids9) == 1, "N5: one roster-only participant to end", str(pids9))
        main.end_participation(midN9, main.EndParticipationRequest(participant_ids=pids9, client_now=None), CRED)
        with conn.cursor() as c:
            drow = q(c, "SELECT start_dt, end_dt FROM mission_participant_sessions WHERE participant_id = %s",
                     (pids9[0],))
        check(len(drow) == 1 and drow[0][1] is not None,
              "N5: documentary session written with end_dt set (start_dt NULL)", str(drow))
        create(make_mission(f"{DB}-N10", status="Draft",
                            participants=[{**rv5, "assigned_days": ["خط السير الأساسي"]}]))
        check(True, "N5: after ending participation, same volunteer addable again")
    finally:
        conn.close()

    # ── Cleanup: delete created TEST-JL data ──
    cleanup_test_data()
    print("\nALL INTEGRATION TESTS PASSED")


if __name__ == "__main__":
    main_test()