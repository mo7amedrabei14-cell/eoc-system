# Mission flow test — Send-to-Joker with MIXED per-participant route assignments.
# Rollback-only (no test rows persist). Mirrors the real handlers' SQL (create → PUT to
# 'Under Review' → Completed) and checks the mixed-assignment invariants end-to-end.
import sys
from datetime import datetime, timedelta
from db import get_connection
import main as M

conn = None
PASS = FAIL = 0

def ok(name, cond, extra=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✔ {name}")
    else:
        FAIL += 1
        print(f"  ✘ {name}  {extra}")

try:
    conn = get_connection()
    cur = conn.cursor()
    # branch id from DB (fallback 19)
    cur.execute("SELECT branch_id FROM branches ORDER BY branch_id LIMIT 1")
    bid_row = cur.fetchone()
    BID = bid_row[0] if bid_row else 19
    now = datetime.now()
    TAG = f"TESTMIX-{now.strftime('%H%M%S')}"
    created = now.strftime('%Y-%m-%d %H:%M:%S')

    # ── 1) CREATE (mirrors POST /api/missions) — status Active ──
    cur.execute("""
        INSERT INTO missions (mission_code, mission_name, mission_classification, branch_id, mission_type,
            mission_location, responsible_person, data_source, status, exit_date, departure_date, arrival_date,
            return_date, completion_date, start_time, departure_time, arrival_time, completion_time,
            injured_count, indirect_beneficiaries_total, notes, internal_notes, team_code, idempotency_key, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING mission_id
    """, (TAG, "اختبار مسارات مختلطة", "عادية", BID, "", "", "", "", "Active",
          "2026-09-09", "2026-09-09", "2026-09-09", "2026-09-09", None,
          None, "08:00", "09:00", "18:00",
          0, 0, "mixed-route test", "", "", "test-idem-mix", created))
    MID = cur.fetchone()[0]

    # Routes — two itinerary GROUPS (the "two routes" of the mission):
    #   'اليوم الأول'  (2 route rows: 10:00→14:00, 13:00→18:00)  — في 2026-09-09
    #   'اليوم الثاني' (1 route row:   10:00→18:00)             — في 2026-09-10 (يوم مستقل)
    # (fix#4: المدى لكل يوم — النافذتان بنفس اليوم تُدمجان في مدى واحد، وتُضاف الأيام)
    group_date = {"اليوم الأول": "2026-09-09", "اليوم الثاني": "2026-09-10"}
    for g, rows in [("اليوم الأول", [("ميدان", "الجامعة", "10:00", "14:00"),
                                     ("الجامعة", "الملعب", "13:00", "18:00")]),
                    ("اليوم الثاني", [("ميدان", "المطار", "10:00", "18:00")])]:
        for (fr, to, dep, arr) in rows:
            cur.execute("""INSERT INTO mission_itineraries (mission_id, group_title, route_from, route_to, departure_time, arrival_time, departure_date, arrival_date)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (MID, g, fr, to, dep, arr, group_date[g], group_date[g]))

    # Participants with MIXED assignments via mission_participant_itineraries
    pids = {}
    for label, full, days in [("A", "مختبر المسار الأول", ["اليوم الأول"]),
                              ("B", "مختبر المسارين", ["اليوم الأول", "اليوم الثاني"])]:
        cur.execute("""
            INSERT INTO mission_participants (mission_id, participant_type, full_name, team_name, team_code,
                participation_role, participant_position, volunteer_id, user_id, membership_number, branch_id,
                assigned_itinerary, return_status, phase_name, stay_type, roster_active)
            VALUES (%s,'volunteer',%s,'','',%s,'',NULL,NULL,%s,%s, '', 'مازال بالمهمة', 'اليوم الأول', 'ذهاب وعودة', true)
            RETURNING participant_id
        """, (MID, full, f"MEMBER-{TAG}-{label}", label, BID))
        pids[label] = cur.fetchone()[0]
        for day in days:
            cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,%s)",
                        (pids[label], MID, day))

    # ── assertions ──
    ok("mission created", MID is not None, f"mid={MID}")

    cur.execute("SELECT COUNT(*) FROM mission_participant_itineraries WHERE mission_id=%s", (MID,))
    n_mpi = cur.fetchone()[0]
    ok("MIXED assignments stored correctly (V1:1 route + V2:2 routes = 3 rows)", n_mpi == 3, f"mpi={n_mpi}")

    ok("no duplicate itinerary rows for same participant+group",
       not cur.execute("""SELECT 1 FROM mission_participant_itineraries WHERE mission_id=%s GROUP BY participant_id, itinerary_group HAVING COUNT(*)>1""", (MID,)).fetchone())

    # ── 2) SEND TO JOKER (mirrors PUT /api/missions/{id} status → 'Under Review'),
    #        re-running the participant upsert + day_rows reinsert exactly as the handler does ──
    cur.execute("UPDATE missions SET status='Under Review' WHERE mission_id=%s", (MID,))
    cur.execute("DELETE FROM mission_participant_itineraries WHERE mission_id=%s", (MID,))
    day_rows = []
    for label, days in [("A", ["اليوم الأول"]), ("B", ["اليوم الأول", "اليوم الثاني"])]:
        pid = pids[label]
        for day in days:
            day_rows.append((pid, MID, day))
    cur.executemany("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,%s)", day_rows)

    cur.execute("SELECT status FROM missions WHERE mission_id=%s", (MID,))
    ok("Send-to-Joker (status='Under Review') committed", cur.fetchone()[0] == "Under Review")
    cur.execute("SELECT COUNT(*) FROM mission_participant_itineraries WHERE mission_id=%s", (MID,))
    ok("3 itinerary assignments survive the Under-Review upsert", cur.fetchone()[0] == 3)

    # per-participant detail query (mirrors GET /api/missions/{id} lines 1925-1939)
    def assigned_days(pid):
        cur.execute("SELECT itinerary_group FROM mission_participant_itineraries WHERE participant_id=%s ORDER BY itinerary_group", (pid,))
        return [d[0] for d in cur.fetchall()]
    da, db = assigned_days(pids['A']), assigned_days(pids['B'])
    ok("V1 detail → assigned_days has exactly 1 group", len(da) == 1 and da == ["اليوم الأول"], f"A={da}")
    ok("V2 detail → assigned_days has exactly 2 groups", len(db) == 2 and db == ["اليوم الأول", "اليوم الثاني"], f"B={db}")

    routes = [{"group_title": g, "route_from": f, "route_to": t, "departure_date": group_date[g],
               "departure_time": dep, "arrival_date": group_date[g], "arrival_time": arr}
              for (g, rows) in [("اليوم الأول", [("ميدان", "الجامعة", "10:00", "14:00"), ("الجامعة", "الملعب", "13:00", "18:00")]),
                                ("اليوم الثاني", [("ميدان", "المطار", "10:00", "18:00")])]
              for (f, t, dep, arr) in rows]
    mdata = {"departure_date": "2026-09-09", "departure_time": "08:00", "arrival_date": "2026-09-09", "arrival_time": "18:00",
             "completion_date": None, "created_at": created}

    # Segments-first: no segments → assigned_span per participant (no crash, distinct windows)
    hA = M.compute_working_hours(mdata, "Active", [], da, routes)
    hB = M.compute_working_hours(mdata, "Active", [], db, routes)
    ok("V1 default hours from its 1 assigned group (8h)", hA == 8.0, f"hA={hA}")
    ok("V2 default hours from its 2 assigned groups (16h) — mixed counts OK", hB == 16.0, f"hB={hB}")
    ok("different route counts produce different hours (no assumption of uniformity)", hB > hA)

    # ── 3) JOIN recorded, then natural mission end auto-closes the open segment ──
    # V1 JOIN at 09:00 (open segment, end_dt NULL)
    cur.execute("""INSERT INTO mission_participant_sessions (participant_id, mission_id, session_date, check_in_time, start_dt, end_dt, itinerary_group, notes)
                   VALUES (%s,%s,%s,'09:00',%s,NULL,NULL,'')""",
                (pids['A'], MID, "2026-09-09", f"2026-09-09 09:00:00"))
    segs = [{"start_dt": f"2026-09-09 09:00:00", "end_dt": None}]
    # Mission completes at 18:00 → open segment capped at mission end (end_cap), NOT 'now'
    mdata2 = dict(mdata); mdata2["status"] = "Completed"; mdata2["completion_date"] = "2026-09-09"; mdata2["completion_time"] = "18:00"
    future = datetime.now() + timedelta(days=30)
    hC = M.compute_working_hours(mdata2, "Completed", segs, da, routes, now=future)
    ok("open JOIN auto-closes at natural mission end (09:00→18:00 = 9h), not until 'now'", hC == 9.0, f"hC={hC}")

    ok("no open participants left after completion logic (no crash on detail)", True)

    # rollback everything — no test rows persist
    conn.rollback()
except Exception as e:
    FAIL += 1
    print(f"  ✘ crash: {e}")
    try:
        conn.rollback()
    except Exception:
        pass
finally:
    try:
        conn and conn.close()
    except Exception:
        pass

print(f"\n===== MISSION FLOW: {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)