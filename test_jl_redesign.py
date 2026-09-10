# -*- coding: utf-8 -*-
"""Regression test for the JOIN/LEAVE catalog redesign.

Three layers:
  A) Pure derivation — derive_jl_segments asserts every row of the design's
     edge table (JOIN = absolute start priority, swallowed JOINs, no overlap,
     LEAVE-without-start → 400) with zero DB dependency.
  B) DB reconcile — materialize_jl_segments over a real Draft mission that also
     holds a LEGACY untagged session: derived tagged rows appear, the legacy
     row is untouched, deleting an assigned LEAVE re-opens the JOIN; and
  C) compute_working_hours honors requirement C: a roster-only participant
     with no route / no JOIN / no «من بداية المهمة» ⇒ 0 hours.

Requirements: working Neon DB (like test_db.py). Cleanup deletes TEST_JLR_* rows.
"""
import sys
import datetime as dt

sys.path.insert(0, r"C:\Users\mo7am\OneDrive\Work\EOC System")

from fastapi import HTTPException
from main import (
    get_connection,
    derive_jl_segments,
    materialize_jl_segments,
    compute_working_hours,
    JL_PREFIX_JOIN,
    JL_PREFIX_LEAVE,
)

J = JL_PREFIX_JOIN
L = JL_PREFIX_LEAVE
failures = []


def check(label, got, exp, exact=False):
    ok = ((got == exp) if exact
          else (abs(got - exp) < 1e-9 if isinstance(got, float) and isinstance(exp, float) else got == exp))
    print(f"[{'OK' if ok else 'FAIL'}] {label}: got={got!r} expected={exp!r}")
    if not ok:
        failures.append(label)


def emit(*items):
    """items = (kind, title, HH:MM) → {(kind,title): (datetime, entry_id)} with stable ids.
    (derive_jl_segments يتعامل مع datetime فعلية مثلما تأتي من الـ DB — لا نصوص.)"""
    eid = 100
    m = {}
    for kind, title, hh in items:
        m[(kind, title)] = (dt.datetime.strptime(f"2026-08-20 {hh}", "%Y-%m-%d %H:%M"), eid)
        eid += 1
    return m


def _hh(dtobj):
    return dtobj.strftime('%H:%M') if dtobj is not None else None


def part_a():
    print("=== A) pure derivation (derive_jl_segments) ===")
    mission_row = {"mission_name": "م", "departure_date": "2026-08-20", "departure_time": "08:00"}

    # (1) two cycles JOIN10/LEAVE14 + JOIN17/LEAVE20 → [10-14],[17-20], 7.0h
    m = emit(("join", "دخول", "10:00"), ("leave", "خروج", "14:00"),
             ("join", "عودة", "17:00"), ("leave", "نهاية", "20:00"))
    periods = derive_jl_segments([J+"دخول", L+"خروج", J+"عودة", L+"نهاية"], m, mission_row, [])
    check("A1 two cycles → 2 periods", len(periods), 2, exact=True)
    check("A2 first period 10:00-14:00", [_hh(periods[0]['start']), _hh(periods[0]['end'])], ['10:00', '14:00'])
    check("A3 second 17:00-20:00", [_hh(periods[1]['start']), _hh(periods[1]['end'])], ['17:00', '20:00'])
    h = sum((p['end'] - p['start']).total_seconds() / 3600 for p in periods)
    check("A4 hours = 7.0", h, 7.0)

    # (2) swallowed JOIN: J10 + J11 + L14 → SINGLE [10-14], 4h, periods never overlap
    m = emit(("join", "دخول", "10:00"), ("join", "دخول مبكر", "11:00"), ("leave", "خروج", "14:00"))
    periods = derive_jl_segments([J+"دخول", J+"دخول مبكر", L+"خروج"], m, mission_row, [])
    check("A5 swallowed join → 1 period", len(periods), 1, exact=True)
    check("A6 opens at earliest join 10:00", _hh(periods[0]['start']), '10:00')
    check("A7 closes 14:00", _hh(periods[0]['end']), '14:00')
    h = (periods[0]['end'] - periods[0]['start']).total_seconds() / 3600
    check("A8 hours = 4.0 single period", h, 4.0)

    # (3) LEAVE 10:00 while participant HAS a JOIN 11:30 + assigned route 08:00
    #     → 400: JOIN is the absolute start priority, the route/mission fallback
    #       is never eligible for a participant with any JOIN.
    routes = [{"group_title": "خط السير الأساسي", "departure_date": "2026-08-20", "departure_time": "08:00"}]
    m = emit(("join", "متقدم", "11:30"), ("leave", "مبكر", "10:00"))
    try:
        derive_jl_segments(["خط السير الأساسي", J+"متقدم", L+"مبكر"], m, mission_row, routes, start_from_mission=False)
        check("A9 400 on LEAVE before FIRST join (route ignored)", "no-400", "400")
    except HTTPException as e:
        check("A9 400 on LEAVE before FIRST join (route ignored)", e.status_code, 400, exact=True)

    # (4) double LEAVE without a re-JOIN → 400 (must re-JOIN to re-enter)
    m = emit(("join", "دخول", "10:00"), ("leave", "خروج", "14:00"), ("leave", "خروج2", "20:00"))
    try:
        derive_jl_segments([J+"دخول", L+"خروج", L+"خروج2"], m, mission_row, [])
        check("A10 400 on double LEAVE without re-JOIN", "no-400", "400")
    except HTTPException as e:
        check("A10 400 on double LEAVE without re-JOIN", e.status_code, 400, exact=True)

    # (5) LEAVE only + assigned route → [earliest route .. LEAVE] (route start, never route end)
    routes = [{"group_title": "المسار الأول", "departure_date": "2026-08-20", "departure_time": "10:00"}]
    m = emit(("leave", "خروج", "16:30"))
    periods = derive_jl_segments(["المسار الأول", L+"خروج"], m, mission_row, routes, start_from_mission=False)
    check("A11 leave-only+route → 1 period", len(periods), 1, exact=True)
    check("A12 starts at assigned route 10:00", _hh(periods[0]['start']), '10:00')
    check("A13 ends 16:30", _hh(periods[0]['end']), '16:30')

    # (6) LEAVE only + «من بداية المهمة» → mission start (08:00)
    m = emit(("leave", "خروج", "16:30"))
    periods = derive_jl_segments([L+"خروج"], m, mission_row, [], start_from_mission=True)
    check("A14 leave-only+sfm starts at mission 08:00", _hh(periods[0]['start']), '08:00')

    # (7) LEAVE only, no start at all → 400
    m = emit(("leave", "خروج", "16:30"))
    try:
        derive_jl_segments([L+"خروج"], m, mission_row, [], start_from_mission=False)
        check("A15 400 on leave-only without any start", "no-400", "400")
    except HTTPException as e:
        check("A15 400 on leave-only without any start", e.status_code, 400, exact=True)

    # (8) JOIN only → open [10, None] (مازال بالمهمة)
    m = emit(("join", "دخول", "10:00"))
    periods = derive_jl_segments([J+"دخول"], m, mission_row, [])
    check("A16 join-only → open end None", periods[0]['end'] is None, True)
    check("A17 join-only opens 10:00", _hh(periods[0]['start']), '10:00')


def part_b():
    print("\n=== B) DB reconcile over a real Draft mission ===")
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT branch_id FROM branches WHERE is_active = true ORDER BY branch_id LIMIT 1")
            bid = cur.fetchone()[0]
            d = (dt.date.today() - dt.timedelta(days=5)).isoformat()
            tag = "TEST_JLR_" + dt.datetime.now().strftime('%H%M%S')

            cur.execute("""
                INSERT INTO missions (
                    mission_code, mission_name, mission_classification, branch_id, status,
                    exit_date, departure_date, departure_time, completion_date, completion_time,
                    injured_count, indirect_beneficiaries_total, notes, team_code)
                VALUES (%s, %s, 'عادية', %s, 'Draft', %s, %s, '08:00', %s, '18:00', 0, 0, 'regression', '')
                RETURNING mission_id
            """, (tag, "مهمة اختبار الانضمام", bid, d, d, d))
            mid = cur.fetchone()[0]

            cur.execute("INSERT INTO mission_join_leave_entries (mission_id, title, kind, dt) VALUES (%s,'بداية','join',%s) RETURNING entry_id", (mid, f"{d} 10:00"))
            e_join = cur.fetchone()[0]
            cur.execute("INSERT INTO mission_join_leave_entries (mission_id, title, kind, dt) VALUES (%s,'نهاية','leave',%s) RETURNING entry_id", (mid, f"{d} 14:00"))
            e_leave = cur.fetchone()[0]

            cur.execute("""
                INSERT INTO mission_participants
                    (mission_id, participant_type, full_name, branch_id, return_status,
                     phase_name, stay_type, start_from_mission, roster_active)
                VALUES (%s, 'volunteer', 'مشارك الاختبار', %s, 'مازال بالمهمة', 'اليوم الأول', 'ذهاب وعودة', true, true)
                RETURNING participant_id
            """, (mid, bid))
            pid = cur.fetchone()[0]
            cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,%s)", (pid, mid, "JL:J:بداية"))
            cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,%s)", (pid, mid, "JL:L:نهاية"))

            # legacy UNTAGGED row (simulated old per-participant data) — must never be touched
            cur.execute("""
                INSERT INTO mission_participant_sessions
                    (participant_id, mission_id, session_date, check_in_time, check_out_time, notes, start_dt, end_dt)
                VALUES (%s, %s, %s, '09:00', '09:30', 'تسجيل قديم', %s, %s)
            """, (pid, mid, d, f"{d} 09:00", f"{d} 09:30"))
            cur.execute("SELECT session_id FROM mission_participant_sessions WHERE participant_id=%s AND start_entry_id IS NULL AND end_entry_id IS NULL", (pid,))
            legacy_sid = cur.fetchone()[0]
            conn.commit()

            mission_row = {"mission_name": "مهمة اختبار الانضمام", "departure_date": d, "departure_time": "08:00", "exit_date": d}
            materialize_jl_segments(cur, mid, mission_row, user_id=None, fire_events=False)
            conn.commit()

            cur.execute("SELECT start_entry_id, end_entry_id, start_dt, end_dt FROM mission_participant_sessions WHERE participant_id=%s", (pid,))
            rows = cur.fetchall()
            tagged = [r for r in rows if r[0] is not None or r[1] is not None]
            check("B1 derived tagged rows exist", len(tagged), 1, exact=True)
            check("B2 derived period 10:00-14:00", [str(tagged[0][2])[:16], str(tagged[0][3])[:16]], [f"{d} 10:00", f"{d} 14:00"])

            cur.execute("SELECT start_dt, end_dt, notes, start_entry_id, end_entry_id FROM mission_participant_sessions WHERE session_id=%s", (legacy_sid,))
            lg = cur.fetchone()
            check("B3 legacy row untouched (09:00-09:30, untagged)",
                  [str(lg[0])[:16], str(lg[1])[:16], lg[2], lg[3] is None and lg[4] is None],
                  [f"{d} 09:00", f"{d} 09:30", 'تسجيل قديم', True])

            # delete the assigned LEAVE (explicit cleanup order) → re-materialize → JOIN reopens
            cur.execute("DELETE FROM mission_participant_sessions WHERE start_entry_id=%s OR end_entry_id=%s", (e_leave, e_leave))
            cur.execute("DELETE FROM mission_participant_itineraries WHERE itinerary_group='JL:L:نهاية'")
            cur.execute("DELETE FROM mission_join_leave_entries WHERE entry_id=%s", (e_leave,))
            materialize_jl_segments(cur, mid, mission_row, user_id=None, fire_events=False)
            conn.commit()
            cur.execute("SELECT start_dt, end_dt, end_entry_id FROM mission_participant_sessions WHERE participant_id=%s AND start_entry_id=%s", (pid, e_join))
            reopened = cur.fetchone()
            check("B4 delete assigned LEAVE → JOIN reopens open (end None)",
                  reopened is not None and reopened[1] is None, True)

            # requirement C: roster-only participant, no route / no JOIN / no sfm ⇒ 0 hours
            cur.execute("""
                INSERT INTO mission_participants
                    (mission_id, participant_type, full_name, branch_id, return_status,
                     phase_name, stay_type, start_from_mission, roster_active)
                VALUES (%s, 'volunteer', 'بلا بداية', %s, 'مازال بالمهمة', 'اليوم الأول', 'ذهاب وعودة', false, true)
            """, (mid, bid))
            conn.commit()
            mdata = {"mission_name": "مهمة اختبار الانضمام", "departure_date": d, "departure_time": "08:00", "exit_date": d}
            now_ref = dt.datetime.strptime(f"{d} 12:00", "%Y-%m-%d %H:%M")
            check("C1 roster-only, no start → 0 hours",
                  compute_working_hours(mdata, "Draft", [], [], [], now=now_ref, start_from_mission=False), 0.0)
            # the derived participant (open JOIN since its LEAVE was deleted) → counts live up to now_ref
            check("C2 open derived segment counts live (10:00→12:00 = 2.0)",
                  compute_working_hours(mdata, "Draft", [{"start_dt": f"{d} 10:00", "end_dt": None}], [],
                                        [], now=now_ref, start_from_mission=False), 2.0)

            # ⭐ JOIN 15:00 → LEAVE 16:00 must equal exactly 1.0 hour (60 minutes)
            mdata_with_end = {"mission_name": "...", "departure_date": d, "departure_time": "08:00",
                              "exit_date": d, "completion_date": d, "completion_time": "18:00"}
            check("C3 JOIN 15:00→LEAVE 16:00 = 1.0 hour",
                  compute_working_hours(mdata_with_end, "Draft",
                                         [{"start_dt": f"{d} 15:00", "end_dt": f"{d} 16:00",
                                           "start_entry_id": 1, "end_entry_id": 2}],
                                         [], [], now=now_ref, start_from_mission=False), 1.0)
            # open JOIN (no LEAVE) on a Draft mission with completion → capped at mission end (18:00)
            check("C4 open JOIN 15:00, no LEAVE, mission ends 18:00 → 3.0 hours",
                  compute_working_hours(mdata_with_end, "Draft",
                                         [{"start_dt": f"{d} 15:00", "end_dt": None,
                                           "start_entry_id": 1}],
                                         [], [], now=now_ref, start_from_mission=False), 3.0)
            # open JOIN 15:00, no LEAVE, NO mission end → falls back to now_ref (12:00) → 0 (now < start)
            check("C5 open JOIN, no mission end, now before start → 0",
                  compute_working_hours(mdata, "Draft",
                                         [{"start_dt": f"{d} 15:00", "end_dt": None,
                                           "start_entry_id": 1}],
                                         [], [], now=now_ref, start_from_mission=False), 0.0)

            # cleanup (order-safe: sessions → itineraries → entries → participants → mission)
            cur.execute("DELETE FROM mission_participant_sessions WHERE mission_id=%s", (mid,))
            cur.execute("DELETE FROM mission_participant_itineraries WHERE mission_id=%s", (mid,))
            cur.execute("DELETE FROM mission_join_leave_entries WHERE mission_id=%s", (mid,))
            cur.execute("DELETE FROM mission_participants WHERE mission_id=%s", (mid,))
            cur.execute("DELETE FROM missions WHERE mission_id=%s", (mid,))
            conn.commit()
            print("Cleanup done (TEST_JLR_*).")
    finally:
        conn.close()


if __name__ == "__main__":
    part_a()
    part_b()
    print()
    if failures:
        print(f"FAILED: {len(failures)} — {failures}")
        sys.exit(1)
    print("SUMMARY — JOIN/LEAVE redesign regression passed ✅")
    sys.exit(0)