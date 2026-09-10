# -*- coding: utf-8 -*-
"""Regression test for multi-itinerary continuous-span hours (Bug 2 fix).

Validates that assigned_span and compute_working_hours compute a SINGLE
continuous window [earliest start → latest end] across all assigned
itineraries/routes for a participant, NOT per-day sum.

Scenarios:
  A) Pure assigned_span: 3 itineraries Sep 8-10 → 57h continuous
  B) Same-day overlap: two overlapping routes → merges (no double count)
  C) start_from_mission: mission start replaces earliest route start
  D) end_cap: clips latest end to mission completion
  E) compute_working_hours: segments-first still dominates assigned_span

Requirements: working Neon DB (like test_jl_redesign). Cleanup deletes TEST_MIH_* rows.
"""
import sys
import datetime as dt

sys.path.insert(0, r"C:\Users\mo7am\OneDrive\Work\EOC System")

from main import (
    get_connection,
    assigned_span,
    compute_working_hours,
)

failures = []


def check(label, got, exp, exact=False):
    ok = ((got == exp) if exact
          else (abs(got - exp) < 1e-9 if isinstance(got, float) and isinstance(exp, float) else got == exp))
    print(f"[{'OK' if ok else 'FAIL'}] {label}: got={got!r} expected={exp!r}")
    if not ok:
        failures.append(label)


def part_a():
    """Pure assigned_span — continuous span across 3 multi-day itineraries."""
    print("=== A) assigned_span: continuous span (57h) ===")
    routes_57h = [
        {"group_title": "I1", "departure_date": "2026-09-08", "departure_time": "10:00",
         "arrival_date": "2026-09-08", "arrival_time": "14:00"},
        {"group_title": "I2", "departure_date": "2026-09-09", "departure_time": "09:00",
         "arrival_date": "2026-09-09", "arrival_time": "17:00"},
        {"group_title": "I3", "departure_date": "2026-09-10", "departure_time": "09:00",
         "arrival_date": "2026-09-10", "arrival_time": "19:00"},
    ]
    # Sep 8 10:00 → Sep 10 19:00 = 57 hours
    h = assigned_span(["I1", "I2", "I3"], routes_57h)
    check("A1 three itineraries → 57h continuous", h, 57.0)

    # Same result regardless of route order (min/max is order-independent)
    routes_shuffled = [routes_57h[2], routes_57h[0], routes_57h[1]]
    h2 = assigned_span(["I3", "I1", "I2"], routes_shuffled)
    check("A2 route order doesn't matter", h2, 57.0)

    # Only one itinerary → just that itinerary's span
    h3 = assigned_span(["I2"], routes_57h)
    check("A3 single itinerary → 8h", h3, 8.0)

    # Empty assignment → 0
    h4 = assigned_span([], routes_57h)
    check("A4 empty assignment → 0", h4, 0.0)


def part_b():
    """Same-day overlap: two routes overlapping → merges, no double count."""
    print("\n=== B) same-day overlap merge ===")
    routes = [
        {"group_title": "A", "departure_date": "2026-09-01", "departure_time": "10:00",
         "arrival_date": "2026-09-01", "arrival_time": "14:00"},
        {"group_title": "B", "departure_date": "2026-09-01", "departure_time": "13:00",
         "arrival_date": "2026-09-01", "arrival_time": "18:00"},
    ]
    # Overlap: 10:00→18:00 = 8h (not 4+5=9h)
    h = assigned_span(["A", "B"], routes)
    check("B1 same-day overlap → 8h merged", h, 8.0)

    # Non-overlapping same-day routes: 10:00→14:00 + 15:00→17:00
    # Continuous span: 10:00→17:00 = 7h
    routes2 = [
        {"group_title": "A", "departure_date": "2026-09-01", "departure_time": "10:00",
         "arrival_date": "2026-09-01", "arrival_time": "14:00"},
        {"group_title": "B", "departure_date": "2026-09-01", "departure_time": "15:00",
         "arrival_date": "2026-09-01", "arrival_time": "17:00"},
    ]
    h2 = assigned_span(["A", "B"], routes2)
    check("B2 non-overlapping same-day → 7h continuous span", h2, 7.0)


def part_c():
    """start_from_mission: mission start replaces earliest route start."""
    print("\n=== C) start_from_mission ===")
    routes = [
        {"group_title": "I1", "departure_date": "2026-09-08", "departure_time": "10:00",
         "arrival_date": "2026-09-08", "arrival_time": "14:00"},
        {"group_title": "I3", "departure_date": "2026-09-10", "departure_time": "09:00",
         "arrival_date": "2026-09-10", "arrival_time": "19:00"},
    ]
    mission_start = dt.datetime(2026, 9, 8, 8, 0)  # 08:00, before 10:00
    # Sep 8 08:00 → Sep 10 19:00 = 59h
    h = assigned_span(["I1", "I3"], routes, mission_start=mission_start, start_from_mission=True)
    check("C1 mission start 08:00 replaces 10:00 → 59h", h, 59.0)

    # mission start AFTER earliest route start → no replacement
    mission_start2 = dt.datetime(2026, 9, 8, 12, 0)  # 12:00, after 10:00
    h2 = assigned_span(["I1", "I3"], routes, mission_start=mission_start2, start_from_mission=True)
    # Sep 8 10:00 (kept) → Sep 10 19:00 = 57h (mission start 12:00 > 10:00, not used)
    check("C2 mission start 12:00 > 10:00 → no replacement → 57h", h2, 57.0)

    # start_from_mission=False → mission start ignored
    h3 = assigned_span(["I1", "I3"], routes, mission_start=mission_start, start_from_mission=False)
    check("C3 sfm=False → mission start ignored → 57h", h3, 57.0)


def part_d():
    """end_cap: clips latest end to mission completion."""
    print("\n=== D) end_cap ===")
    routes = [
        {"group_title": "I1", "departure_date": "2026-09-08", "departure_time": "10:00",
         "arrival_date": "2026-09-08", "arrival_time": "14:00"},
        {"group_title": "I3", "departure_date": "2026-09-10", "departure_time": "09:00",
         "arrival_date": "2026-09-10", "arrival_time": "19:00"},
    ]
    # end_cap after latest end → no clip
    end_cap_late = dt.datetime(2026, 9, 10, 23, 0)
    h = assigned_span(["I1", "I3"], routes, end_cap=end_cap_late)
    check("D1 end_cap after latest → no clip → 57h", h, 57.0)

    # end_cap before latest end → clips
    end_cap_early = dt.datetime(2026, 9, 10, 15, 0)  # 15:00 < 19:00
    # Sep 8 10:00 → Sep 10 15:00 = 53h
    h2 = assigned_span(["I1", "I3"], routes, end_cap=end_cap_early)
    check("D2 end_cap 15:00 clips 19:00 → 53h", h2, 53.0)

    # end_cap during I1 only
    end_cap_mid = dt.datetime(2026, 9, 8, 12, 0)
    h3 = assigned_span(["I1", "I3"], routes, end_cap=end_cap_mid)
    # Sep 8 10:00 → Sep 8 12:00 = 2h
    check("D3 end_cap during I1 → 2h", h3, 2.0)


def part_e():
    """compute_working_hours: explicit segments still dominate assigned_span."""
    print("\n=== E) segments-first dominance ===")
    mdata = {
        "mission_name": "اختبار", "status": "Active",
        "departure_date": "2026-09-08", "departure_time": "08:00",
        "arrival_date": "2026-09-10", "arrival_time": "19:00",
        "completion_date": None, "completion_time": None, "start_time": "08:00",
        "created_at": "2026-09-08 08:00:00",
    }
    routes_57h = [
        {"group_title": "I1", "departure_date": "2026-09-08", "departure_time": "10:00",
         "arrival_date": "2026-09-08", "arrival_time": "14:00"},
        {"group_title": "I2", "departure_date": "2026-09-09", "departure_time": "09:00",
         "arrival_date": "2026-09-09", "arrival_time": "17:00"},
        {"group_title": "I3", "departure_date": "2026-09-10", "departure_time": "09:00",
         "arrival_date": "2026-09-10", "arrival_time": "19:00"},
    ]

    # No segments → assigned_span (57h)
    h_no_seg = compute_working_hours(mdata, "Active", [], ["I1", "I2", "I3"], routes_57h)
    check("E1 no segments → assigned_span = 57h", h_no_seg, 57.0)

    # With segments → segments dominate
    segs = [{"start_dt": "2026-09-09 10:00:00", "end_dt": "2026-09-09 13:00:00"}]
    h_seg = compute_working_hours(mdata, "Active", segs, ["I1", "I2", "I3"], routes_57h)
    check("E2 segments present → segments dominate = 3h", h_seg, 3.0)

    # start_from_mission + assigned_span → 57h with sfm (mission start 08:00 < 10:00 → 59h)
    h_sfm = compute_working_hours(mdata, "Active", [], ["I1", "I2", "I3"], routes_57h, start_from_mission=True)
    check("E3 sfm: mission start 08:00 → 59h", h_sfm, 59.0)


def part_f():
    """DB integration: real mission + real itineraries → continuous span."""
    print("\n=== F) DB integration ===")
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT branch_id FROM branches WHERE is_active = true ORDER BY branch_id LIMIT 1")
            bid = cur.fetchone()[0]
            d1, d2, d3 = "2026-09-08", "2026-09-09", "2026-09-10"
            tag = "TEST_MIH_" + dt.datetime.now().strftime('%H%M%S')

            # Create a mission spanning Sep 8-10
            cur.execute("""
                INSERT INTO missions (
                    mission_code, mission_name, mission_classification, branch_id, status,
                    departure_date, departure_time, arrival_date, arrival_time,
                    completion_date, completion_time, exit_date,
                    injured_count, indirect_beneficiaries_total, notes, team_code)
                VALUES (%s, %s, 'عادية', %s, 'Active', %s, '08:00', %s, '19:00',
                        NULL, NULL, %s, 0, 0, 'multi-itin test', '')
                RETURNING mission_id
            """, (tag, f"مهمة {tag}", bid, d1, d3, d3))
            mid = cur.fetchone()[0]

            # Create 3 itinerary groups
            for title, dd, dt_, ad, at_ in [
                ("I1", d1, "10:00", d1, "14:00"),
                ("I2", d2, "09:00", d2, "17:00"),
                ("I3", d3, "09:00", d3, "19:00"),
            ]:
                cur.execute("""
                    INSERT INTO mission_itineraries
                        (mission_id, group_title, departure_date, departure_time,
                         arrival_date, arrival_time, route_from, route_to)
                    VALUES (%s, %s, %s, %s, %s, %s, 'من', 'إلى')
                """, (mid, title, dd, dt_, ad, at_))

            # Create a participant assigned to all 3
            cur.execute("""
                INSERT INTO mission_participants
                    (mission_id, participant_type, full_name, branch_id, return_status,
                     phase_name, stay_type, start_from_mission, roster_active)
                VALUES (%s, 'volunteer', 'مشارك اختبار', %s, 'مازال بالمهمة', 'الأول',
                        'ذهاب وعودة', false, true)
                RETURNING participant_id
            """, (mid, bid))
            pid = cur.fetchone()[0]
            for title in ["I1", "I2", "I3"]:
                cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,%s)",
                            (pid, mid, title))
            conn.commit()

            # Verify via assigned_span
            cur.execute("""
                SELECT group_title, departure_date, departure_time, arrival_date, arrival_time
                FROM mission_itineraries WHERE mission_id = %s
            """, (mid,))
            db_routes = [{"group_title": r[0], "departure_date": r[1], "departure_time": r[2],
                          "arrival_date": r[3], "arrival_time": r[4]} for r in cur.fetchall()]
            h_db = assigned_span(["I1", "I2", "I3"], db_routes)
            check("F1 DB assigned_span → 57h", h_db, 57.0)

            # Verify via compute_working_hours (Active, no segments, sfm=False)
            mdata_db = {"mission_name": f"مهمة {tag}", "status": "Active",
                        "departure_date": d1, "departure_time": "08:00",
                        "arrival_date": d3, "arrival_time": "19:00",
                        "completion_date": None, "completion_time": None, "start_time": "08:00",
                        "created_at": dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
            h_cwh = compute_working_hours(mdata_db, "Active", [], ["I1", "I2", "I3"], db_routes)
            check("F2 compute_working_hours → 57h", h_cwh, 57.0)

            # Cleanup
            cur.execute("DELETE FROM mission_participant_itineraries WHERE mission_id=%s", (mid,))
            cur.execute("DELETE FROM mission_participant_sessions WHERE mission_id=%s", (mid,))
            cur.execute("DELETE FROM mission_participants WHERE mission_id=%s", (mid,))
            cur.execute("DELETE FROM mission_itineraries WHERE mission_id=%s", (mid,))
            cur.execute("DELETE FROM missions WHERE mission_id=%s", (mid,))
            conn.commit()
            print("Cleanup done (TEST_MIH_*).")
    finally:
        conn.close()


if __name__ == "__main__":
    part_a()
    part_b()
    part_c()
    part_d()
    part_e()
    part_f()
    print()
    if failures:
        print(f"FAILED: {len(failures)} — {failures}")
        sys.exit(1)
    print("SUMMARY — multi-itinerary continuous-span hours regression passed ✅")
    sys.exit(0)
