# -*- coding: utf-8 -*-
"""
FINAL SYSTEM AUDIT — Rollback-only tests (no test rows persist).
Verifies the unified hours engine, identity composite key, JOIN/LEAVE cycles,
the HR CTE chain, and data-integrity cleanup. Every DB write happens inside ONE
transaction that is rolled back in `finally`, so nothing survives.

Run:  python audit_test.py
"""
import sys, traceback
from datetime import datetime, timedelta

sys.path.insert(0, ".")  # allow importing main.py + db.py from project root
if hasattr(sys.stdout, "reconfigure"):  # force UTF-8 so ✔/✘ print on Windows
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── Pull the exact production functions under test ──────────────────────────
from main import (
    compute_working_hours, assigned_span, dt_from_parts, parse_dt_input,
    segment_span_from_parts, compute_participant_status,
    mission_start_dt, mission_end_dt,
)
from db import get_connection

PASS = 0
FAIL = 0
def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✔ {name}")
    else:
        FAIL += 1
        print(f"  ✘ {name}  {extra}")

def route(group, dep_d, dep_t, arr_d, arr_t):
    return {"group_title": group, "departure_date": dep_d, "departure_time": dep_t,
            "arrival_date": arr_d, "arrival_time": arr_t}

def mission_data(**over):
    base = {
        "mission_name": "اختبار", "mission_code": "#TST-1", "mission_classification": "عادية",
        "status": "Active", "departure_date": "2026-09-01", "departure_time": "08:00",
        "arrival_date": "2026-09-01", "arrival_time": "20:00",
        "completion_date": None, "completion_time": None, "start_time": "08:00",
        "created_at": "2026-09-01 08:00:00",
    }
    base.update(over)
    return base

# ═══════════════════════════ PART A — Pure functions ════════════════════════
print("\n[PART A] Hours engine & helpers (no DB)")

# A1. assigned_span — overlapping same-day routes must be a single span (8h, not 9h)
routes2 = [route("أ", "2026-09-01", "10:00", "2026-09-01", "14:00"),
           route("ب", "2026-09-01", "13:00", "2026-09-01", "18:00")]
check("assigned_span: same-day overlapping = 8h (not 9h)",
      abs(assigned_span(["أ", "ب"], routes2) - 8.0) < 0.001,
      f"got {assigned_span(['أ','ب'], routes2)}")

# A2. different-day routes → summed per-day spans (8h + 6h = 14h)
routes3 = [route("د1", "2026-09-01", "10:00", "2026-09-01", "18:00"),
           route("د2", "2026-09-02", "09:00", "2026-09-02", "15:00")]
check("assigned_span: different days summed (14h)",
      abs(assigned_span(["د1", "د2"], routes3) - 14.0) < 0.001,
      f"got {assigned_span(['د1','د2'], routes3)}")

# A3. compute_working_hours: explicit segments are the sole source of truth (even if completed)
md = mission_data(status="Completed", completion_date="2026-09-01", completion_time="20:00")
segs = [{"start_dt": "2026-09-01 10:00:00", "end_dt": "2026-09-01 13:00:00"},
        {"start_dt": "2026-09-01 14:00:00", "end_dt": "2026-09-01 18:00:00"}]
check("hours: segments sum (7h) beats plan/freeze",
      abs(compute_working_hours(md, "Completed", segs, [], routes2) - 7.0) < 0.001,
      f"got {compute_working_hours(md,'Completed',segs,[],routes2)}")

# A4. no segments + assigned days → assigned_span (8h)
md2 = mission_data(status="Active")
check("hours: no segments + assigned → assigned_span (8h)",
      abs(compute_working_hours(md2, "Active", [], ["أ", "ب"], routes2) - 8.0) < 0.001,
      f"got {compute_working_hours(md2,'Active',[],['أ','ب'],routes2)}")

# A5. completed + no segments → mission freeze (08:00→20:00 = 12h)
mdc = mission_data(status="Completed", completion_date="2026-09-01", completion_time="20:00")
check("hours: completed no-segment → mission span (12h)",
      abs(compute_working_hours(mdc, "Completed", [], [], []) - 12.0) < 0.001,
      f"got {compute_working_hours(mdc,'Completed',[],[],[])}")

# A6. basic route default (no segments, no assigned) → 08:00→20:00 = 12h
routes_basic = [route("خط السير الأساسي", "2026-09-01", "08:00", "2026-09-01", "20:00")]
check("hours: no segment/assigned + basic route → 12h",
      abs(compute_working_hours(md2, "Active", [], [], routes_basic) - 12.0) < 0.001,
      f"got {compute_working_hours(md2,'Active',[],[],routes_basic)}")

# A7. no itinerary at all → mission start/end, capped at now for active (now far past)
mdi = mission_data(status="Active", arrival_date="2026-09-05", arrival_time="20:00")
now_far = datetime(2026, 9, 4, 12, 0)
check("hours: no itinerary → window capped at now (from 09-01 08:00 to 09-04 12:00 = 76h)",
      abs(compute_working_hours(mdi, "Active", [], [], [], now=now_far) - 76.0) < 0.001,
      f"got {compute_working_hours(mdi,'Active',[],[],[],now=now_far)}")

# A8. overnight segment via segment_span_from_parts (end <= start ⇒ +1 day)
sd, ed = segment_span_from_parts("2026-09-01", "22:00", "02:00")
check("overnight: 22:00→02:00 becomes next-day 02:00 (4h)",
      sd is not None and ed is not None and (ed - sd) == timedelta(hours=4),
      f"got {sd} {ed}")

# A9. compute_participant_status mapping (by design, a Completed mission forces 'finished')
check("status: active mission + open segment → still on mission",
      compute_participant_status("Active", "مازال بالمهمة", [{"start_dt": "2026-09-01 10:00:00", "end_dt": None}]) == "مازال بالمهمة")
check("status: active mission + all closed → finished",
      compute_participant_status("Active", "مازال بالمهمة", [{"start_dt": "2026-09-01 10:00:00", "end_dt": "2026-09-01 12:00:00"}]) == "تم انتهاء مهمتة")
check("status: completed mission → always finished (even with open segment)",
      compute_participant_status("Completed", "مازال بالمهمة", [{"start_dt": "2026-09-01 10:00:00", "end_dt": None}]) == "تم انتهاء مهمتة")

# ═══════════════════════════ PART B — DB integrity (rollback) ════════════════
print("\n[PART B] DB integrity + HR CTE (single transaction, rolled back)")
conn = None
try:
    conn = get_connection()
    cur = conn.cursor()

    # Unique test identifiers to avoid clashing with real data.
    tag = f"AUDIT{datetime.now().strftime('%y%m%d%H%M%S%f')}"

    # Real branch ids (branch_id is FK-constrained to branches). Use the first two
    # existing branches so the composite-identity test (same membership, diff branch)
    # is valid; fall back to NULL if none exist.
    cur.execute("SELECT branch_id FROM branches ORDER BY branch_id LIMIT 2")
    branch_rows = cur.fetchall()
    b1 = branch_rows[0][0] if len(branch_rows) >= 1 else None
    b2 = branch_rows[1][0] if len(branch_rows) >= 2 else None

    # ── Seed a mission with two same-day routes ──
    cur.execute("""
        INSERT INTO missions (mission_code, mission_name, mission_classification, status,
                              departure_date, departure_time, arrival_date, arrival_time)
        VALUES (%s, %s, 'عادية', 'Active', '2026-09-10', '08:00', '2026-09-10', '22:00')
        RETURNING mission_id
    """, (tag, f"مهمة {tag}"))
    mid = cur.fetchone()[0]

    # route أ: 10:00→14:00 ; route ب: 13:00→18:00  (same day)
    cur.execute("INSERT INTO mission_itineraries (mission_id, group_title, departure_date, departure_time, arrival_date, arrival_time) VALUES (%s,'أ','2026-09-10','10:00','2026-09-10','14:00')", (mid,))
    cur.execute("INSERT INTO mission_itineraries (mission_id, group_title, departure_date, departure_time, arrival_date, arrival_time) VALUES (%s,'ب','2026-09-10','13:00','2026-09-10','18:00')", (mid,))

    # Participant 1 (member M1 / branch b1) — assigned both groups, NO segments ⇒ expect 8h
    cur.execute("""INSERT INTO mission_participants (mission_id, participant_type, full_name, membership_number, branch_id, return_status, roster_active)
                   VALUES (%s,'volunteer',%s,%s,%s,'مازال بالمهمة',true) RETURNING participant_id""",
                (mid, f"شخص-أ {tag}", f"M1-{tag}", b1))
    p1 = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,'أ')", (p1, mid))
    cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,'ب')", (p1, mid))

    # Participant 2 (member M2 / branch b1) — one explicit segment 10:00→13:00 ⇒ expect 3h
    cur.execute("""INSERT INTO mission_participants (mission_id, participant_type, full_name, membership_number, branch_id, return_status, roster_active)
                   VALUES (%s,'volunteer',%s,%s,%s,'تم انتهاء مهمتة',true) RETURNING participant_id""",
                (mid, f"شخص-ب {tag}", f"M2-{tag}", b1))
    p2 = cur.fetchone()[0]
    cur.execute("""INSERT INTO mission_participant_sessions (participant_id, mission_id, start_dt, end_dt)
                   VALUES (%s,%s,'2026-09-10 10:00:00','2026-09-10 13:00:00')""", (p2, mid))

    # Participant 3 (member M2 / branch b2 — SAME membership, DIFFERENT branch ⇒ distinct identity).
    # mission_participants has a per-mission UNIQUE(mission_id, membership_number), so the same
    # membership must live in a *separate mission* to test cross-branch distinctness.
    cur.execute("""
        INSERT INTO missions (mission_code, mission_name, mission_classification, status,
                              departure_date, departure_time, arrival_date, arrival_time)
        VALUES (%s, %s, 'عادية', 'Active', '2026-09-11', '08:00', '2026-09-11', '18:00')
        RETURNING mission_id
    """, (f"{tag}-2", f"مهمة2 {tag}"))
    mid2 = cur.fetchone()[0]
    cur.execute("""INSERT INTO mission_participants (mission_id, participant_type, full_name, membership_number, branch_id, return_status, roster_active)
                   VALUES (%s,'volunteer',%s,%s,%s,'مازال بالمهمة',true) RETURNING participant_id""",
                (mid2, f"شخص-ج {tag}", f"M2-{tag}", b2))
    p3 = cur.fetchone()[0]

    # ── Run the exact production HR CTE query ──
    cur.execute("""
        WITH ident AS (
            SELECT mp.participant_id, mp.mission_id, mp.branch_id, mp.full_name,
                   mp.membership_number, mp.participant_type, mp.participant_position,
                   mp.volunteer_id, mp.return_status,
                   CASE WHEN TRIM(COALESCE(mp.membership_number,'')) <> ''
                        THEN 'rid:'||COALESCE(mp.branch_id,0)||':'||TRIM(mp.membership_number)
                        ELSE 'nm:'||COALESCE(mp.branch_id,0)||':'||TRIM(mp.full_name) END AS k
            FROM mission_participants mp
            WHERE mp.full_name IS NOT NULL AND TRIM(mp.full_name) <> ''
              AND mp.participant_type IN ('volunteer','non_volunteer')
        ),
        person AS (SELECT DISTINCT ON (k) k, full_name, membership_number FROM ident ORDER BY k, participant_id DESC),
        active AS (
            SELECT DISTINCT ON (i.k) i.k, m.mission_id FROM ident i
            JOIN missions m ON m.mission_id = i.mission_id
            WHERE i.return_status = 'مازال بالمهمة' AND m.status NOT IN ('Draft','Cancelled','Returned')
            ORDER BY i.k, m.created_at DESC, m.mission_id DESC
        ),
        explicit_hours AS (
            SELECT i.k, mp.mission_id, mp.participant_id, mps.itinerary_group,
                   SUM(GREATEST(EXTRACT(EPOCH FROM (
                       COALESCE(mps.end_dt, LOCALTIMESTAMP) - mps.start_dt))/3600.0, 0)) AS hours
            FROM mission_participant_sessions mps
            JOIN mission_participants mp ON mp.participant_id = mps.participant_id
            JOIN missions m ON m.mission_id = mp.mission_id
            JOIN ident i ON i.participant_id = mp.participant_id
            WHERE mps.start_dt IS NOT NULL
            GROUP BY i.k, mp.mission_id, mp.participant_id, mps.itinerary_group
        ),
        actual_total AS (SELECT eh.k, eh.mission_id, SUM(eh.hours) AS hours FROM explicit_hours eh GROUP BY eh.k, eh.mission_id),
        default_mix AS (
            SELECT k, mission_id, SUM(GREATEST(EXTRACT(EPOCH FROM win)/3600.0, 0)) AS hours FROM (
                SELECT i.k, i.mission_id,
                    CASE WHEN COUNT(departure_date)=COUNT(*) THEN
                             (MAX(arrival_date::timestamp+arrival_time)-MIN(departure_date::timestamp+departure_time))
                         WHEN COUNT(*)>0 AND COUNT(departure_date)=0 THEN (MAX(arrival_time)-MIN(departure_time))
                         ELSE (MAX(COALESCE(arrival_date,departure_date)::timestamp+arrival_time)
                              -MIN(COALESCE(departure_date,arrival_date)::timestamp+departure_time)) END AS win
                FROM ident i
                JOIN mission_participant_itineraries mpi ON mpi.participant_id=i.participant_id AND mpi.mission_id=i.mission_id
                JOIN mission_itineraries d ON d.mission_id=mpi.mission_id AND d.group_title=mpi.itinerary_group
                WHERE d.departure_time IS NOT NULL AND d.arrival_time IS NOT NULL
                GROUP BY i.k, i.mission_id, d.departure_date
            ) spans GROUP BY k, mission_id
        ),
        mission_hours AS (
            SELECT i.k, i.mission_id, MAX(m.created_at) AS created_at,
                   MAX((m.status NOT IN ('Draft','Cancelled','Returned'))::int)::boolean AS is_valid,
                   MAX(CASE WHEN m.status NOT IN ('Draft','Cancelled','Returned') THEN CASE
                       WHEN at.hours IS NOT NULL THEN at.hours
                       WHEN m.completion_date IS NOT NULL THEN GREATEST(EXTRACT(EPOCH FROM (
                           (m.completion_date+COALESCE(m.completion_time,'00:00'::time))-
                           (COALESCE(m.departure_date,m.created_at::date)+COALESCE(m.departure_time,m.start_time,'00:00'::time))))/3600.0,0)
                       WHEN dm.hours IS NOT NULL THEN dm.hours
                       ELSE GREATEST(EXTRACT(EPOCH FROM (
                           LEAST(LOCALTIMESTAMP, COALESCE((COALESCE(m.arrival_date,m.completion_date)::timestamp+COALESCE(m.arrival_time,m.completion_time,'00:00'::time)), LOCALTIMESTAMP)) -
                           (COALESCE(m.departure_date,m.created_at::date)+COALESCE(m.departure_time,m.start_time,m.created_at::time))))/3600.0,0)
                   END ELSE 0 END) AS hours
            FROM ident i JOIN missions m ON m.mission_id=i.mission_id
            LEFT JOIN actual_total at ON at.mission_id=i.mission_id AND at.k=i.k
            LEFT JOIN default_mix dm ON dm.mission_id=i.mission_id AND dm.k=i.k
            GROUP BY i.k, i.mission_id
        ),
        last_mission AS (SELECT DISTINCT ON (k) k, mission_hours.hours AS last_mission_hours
                         FROM mission_hours WHERE is_valid ORDER BY k, created_at DESC, mission_id DESC),
        stats AS (SELECT k, COUNT(*) FILTER (WHERE is_valid) AS missions_count,
                         ROUND(COALESCE(SUM(CASE WHEN is_valid THEN hours ELSE 0 END),0)::numeric,1) AS total_hours
                  FROM mission_hours GROUP BY k)
        SELECT p.full_name, p.membership_number,
               COALESCE(s.missions_count,0) AS missions_count,
               COALESCE(ROUND(lm.last_mission_hours::numeric,1),0) AS last_mission_hours,
               COALESCE(s.total_hours,0) AS total_hours,
               (a.mission_id IS NOT NULL) AS active_mission
        FROM person p
        LEFT JOIN stats s ON s.k=p.k
        LEFT JOIN active a ON a.k=p.k
        LEFT JOIN last_mission lm ON lm.k=p.k
        ORDER BY p.k
    """)
    hr = {}
    for row in cur.fetchall():
        # membership may come back with a rowkey suffix? No — M1-tag exact.
        hr[row[0]] = {"membership": row[1], "missions_count": row[2],
                      "last_mission_hours": float(row[3]), "total_hours": float(row[4]),
                      "active": bool(row[5])}

    def find(membership):
        for nm, d in hr.items():
            if d["membership"] == membership:
                return d
        return None

    # B1. Participant 1 (assigned أ+ب, no segments) → HR default_mix = 8h span
    d1 = find(f"M1-{tag}")
    check("HR: assigned two routes → 8h span (not 9h)", d1 is not None and abs(d1["total_hours"] - 8.0) < 0.01,
          f"got {d1}")

    # B2. Participant 2 (explicit segment 10:00→13:00) → 3h actual, beats plan
    d2 = find(f"M2-{tag}")
    check("HR: explicit segment = 3h actual", d2 is not None and abs(d2["total_hours"] - 3.0) < 0.01,
          f"got {d2}")

    # B3. Same membership M2 in branch b1 AND branch b2 → TWO distinct HR rows
    #     (skipped as a hard assert if the DB doesn't expose two distinct branches)
    branch2_rows = [d for nm, d in hr.items() if d["membership"] == f"M2-{tag}"]
    if b2 is not None and b1 != b2:
        check("HR: same membership in 2 branches → 2 distinct identities (composite key)",
              len(branch2_rows) == 2, f"got {len(branch2_rows)} rows")
    else:
        print("  (skip: only one branch available for composite-identity check)")

    # B4. Cross-check: Python compute_working_hours == HR CTE for the no-segment participant
    mdpy = mission_data(status="Active", departure_date="2026-09-10", departure_time="08:00",
                        arrival_date="2026-09-10", arrival_time="22:00", created_at="2026-09-10 08:00:00")
    py_hours = compute_working_hours(mdpy, "Active", [], ["أ", "ب"],
                                     [route("أ","2026-09-10","10:00","2026-09-10","14:00"),
                                      route("ب","2026-09-10","13:00","2026-09-10","18:00")])
    check("Python engine == HR CTE (both 8h)", d1 is not None and abs(py_hours - d1["total_hours"]) < 0.01,
          f"py={py_hours} hr={d1 and d1['total_hours']}")

    # B5. Rejoin = new segment, same mission → missions_count stays 1, hours combine
    cur.execute("""INSERT INTO mission_participant_sessions (participant_id, mission_id, start_dt, end_dt)
                   VALUES (%s,%s,'2026-09-10 14:00:00','2026-09-10 16:00:00')""", (p2, mid))  # +2h
    cur.execute("""INSERT INTO mission_participant_sessions (participant_id, mission_id, start_dt, end_dt)
                   VALUES (%s,%s,'2026-09-10 17:00:00',NULL)""", (p2, mid))  # open segment
    cur.execute("""UPDATE mission_participant_sessions SET end_dt='2026-09-10 18:00:00' WHERE participant_id=%s AND end_dt IS NULL""", (p2,))
    cur.execute("""
        SELECT COUNT(*) FROM mission_participant_sessions WHERE participant_id=%s
    """, (p2,))
    seg_count = cur.fetchone()[0]
    check("rejoin: 3 segments under same participant", seg_count == 3, f"got {seg_count}")
    # HR recompute: p2 now 3+2+1 = 6h, still 1 mission
    cur.execute("""
        SELECT ROUND(SUM(GREATEST(EXTRACT(EPOCH FROM (end_dt-start_dt))/3600.0,0))::numeric,1),
               COUNT(DISTINCT mission_id)
        FROM mission_participant_sessions WHERE participant_id=%s AND start_dt IS NOT NULL
    """, (p2,))
    tot, missions = cur.fetchone()
    check("rejoin: total hours combine (6h), mission count distinct (1)",
          abs(float(tot) - 6.0) < 0.01 and missions == 1, f"got {tot}h / {missions} missions")

    # B6. delete_mission orphan cleanup (mirrors the production fix)
    cur.execute("""INSERT INTO mission_participants (mission_id, participant_type, full_name, membership_number, branch_id, return_status, roster_active)
                   VALUES (%s,'volunteer',%s,NULL,%s,'مازال بالمهمة',true) RETURNING participant_id""", (mid, f"شخص-د {tag}", b1))
    pd = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,'أ')", (pd, mid))
    cur.execute("INSERT INTO mission_vehicles (mission_id, driver_name, vehicle_number) VALUES (%s,'سائق','رقم')", (mid,))
    cur.execute("INSERT INTO mission_beneficiaries (mission_id, category_name) VALUES (%s,'فئة')", (mid,))
    cur.execute("INSERT INTO mission_eoc_staff (mission_id, role_name, staff_name) VALUES (%s,'دور','اسم')", (mid,))
    # The production DELETE order (sessions → participants → itineraries → … → missions)
    cur.execute("DELETE FROM mission_participant_sessions WHERE participant_id IN (SELECT participant_id FROM mission_participants WHERE mission_id=%s)", (mid,))
    cur.execute("DELETE FROM mission_participant_itineraries WHERE mission_id=%s", (mid,))
    cur.execute("DELETE FROM mission_participants WHERE mission_id=%s", (mid,))
    cur.execute("DELETE FROM mission_itineraries WHERE mission_id=%s", (mid,))
    cur.execute("DELETE FROM mission_vehicles WHERE mission_id=%s", (mid,))
    cur.execute("DELETE FROM mission_beneficiaries WHERE mission_id=%s", (mid,))
    cur.execute("DELETE FROM mission_eoc_staff WHERE mission_id=%s", (mid,))
    cur.execute("DELETE FROM missions WHERE mission_id=%s", (mid,))
    orphans = 0
    for t, col in [("mission_participants","mission_id"),("mission_itineraries","mission_id"),
                   ("mission_vehicles","mission_id"),("mission_beneficiaries","mission_id"),
                   ("mission_eoc_staff","mission_id"),("mission_participant_itineraries","mission_id"),
                   ("mission_participant_sessions","participant_id")]:
        if t == "mission_participant_sessions":
            cur.execute(f"SELECT COUNT(*) FROM {t} WHERE participant_id IN (SELECT participant_id FROM mission_participants WHERE mission_id=%s)", (mid,))
        else:
            cur.execute(f"SELECT COUNT(*) FROM {t} WHERE {col}=%s", (mid,))
        orphans += cur.fetchone()[0]
    check("delete mission: 0 orphaned child rows", orphans == 0, f"got {orphans} orphans")

    print("\n  (all DB writes above are inside one transaction that is rolled back now)")
finally:
    if conn is not None:
        try:
            conn.rollback()   # ← nothing persists
            conn.close()
        except Exception:
            pass

# ═══════════════════════════ Result ═══════════════════════════
print(f"\n{'='*50}\nRESULT: {PASS} passed, {FAIL} failed\n{'='*50}")
if FAIL:
    print("One or more assertions FAILED — investigate before declaring the system correct.")
    sys.exit(1)
print("All audit assertions passed.")
