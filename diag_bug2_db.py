#!/usr/bin/env python3
"""
DIAGNOSTIC — Bug #2 exact trace.

Part A: Find REAL rows in the live DB that look "stuck" (false-active).
Part B: Reproduce LEAVE via the EXACT SQL the /leave endpoint runs (main.py:2038-2040, 2081-2083).
Part C: Run the EXACT radar query (main.py:730-757) and show which condition fires.
"""
import os, psycopg2

DB_URL = os.getenv("DATABASE_URL", "postgresql://neondb_owner:npg_Z2dEz2Y8o6k1@ep-wispy-rain-a5ememel-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require")
conn = psycopg2.connect(DB_URL)
conn.autocommit = True
cur = conn.cursor()

def section(t):
    print("\n" + "=" * 72)
    print(t)
    print("=" * 72)

# ──────────────────────────────────────────────
section("PART A — FIND REAL VOLUNTEERS WHO ARE OPEN-SESSION IN ACTIVE MISSION")
cur.execute("""
    SELECT p.membership_number, p.full_name, p.branch_id, p.participant_id, p.mission_id,
           m.mission_name, m.status, p.return_status, s.session_id, s.start_dt, s.end_dt
    FROM mission_participants p
    JOIN missions m ON m.mission_id = p.mission_id
    JOIN mission_participant_sessions s ON s.participant_id = p.participant_id AND s.mission_id = p.mission_id
    WHERE s.end_dt IS NULL
      AND m.status NOT IN ('Draft', 'Cancelled', 'Returned', 'Completed')
      AND p.membership_number IS NOT NULL AND TRIM(p.membership_number) <> ''
    ORDER BY p.branch_id, p.membership_number
    LIMIT 20
""")
stuck = cur.fetchall()
print(f"Volunteers with an OPEN session (end_dt IS NULL) in a non-terminal mission: {len(stuck)}")
for r in stuck:
    print(f"  membership={r[0]} name={r[1]} branch={r[2]}")
    print(f"    pid={r[3]} mission_id={r[4]} mission='{r[5]}' status='{r[6]}' return_status='{r[7]}'")
    print(f"    session_id={r[8]} start_dt={r[9]} end_dt={r[10]}   <-- OPEN SESSION")

# ──────────────────────────────────────────────
section("PART B — REPRODUCE: pick first stuck volunteer, execute LEAVE exactly as /leave does")
if not stuck:
    print("No stuck volunteer found. Creating a test record via direct SQL...")
    # Create a mission + participant + open session to mimic the form path
    cur.execute("INSERT INTO missions (mission_name, mission_classification, status, mission_code) VALUES (%s,%s,%s,%s) RETURNING mission_id",
                ("TEST_DIAG_B2", "عادية", "Draft", "TDIAG2"))
    mid = cur.fetchone()[0]
    cur.execute("""
        INSERT INTO mission_participants (mission_id, participant_type, full_name, participation_role, membership_number, branch_id, assigned_itinerary, return_status, roster_active, start_from_mission)
        VALUES (%s, 'volunteer', 'Diagnostic Volunteer', '99999', '99999', 1, 'خط السير الأساسي', 'مازال بالمهمة', true, true)
        RETURNING participant_id
    """, (mid,))
    pid = cur.fetchone()[0]
    cur.execute("""
        INSERT INTO mission_participant_sessions (participant_id, mission_id, session_date, check_in_time, check_out_time, start_dt, end_dt, notes)
        VALUES (%s, %s, '2026-09-08', '09:00', NULL, '2026-09-08 09:00:00', NULL, 'انضمام')
    """, (pid, mid))
    # mark mission active (under_review-ish)
    cur.execute("UPDATE missions SET status = 'Under Review' WHERE mission_id = %s", (mid,))
    stuck = [( '99999', 'Diagnostic Volunteer', 1, pid, mid, 'TEST_DIAG_B2', 'Under Review', 'مازال بالمهمة',
               cur.lastrowid if False else None, '2026-09-08 09:00', None )]
    # re-fetch session_id
    cur.execute("SELECT session_id, start_dt, end_dt FROM mission_participant_sessions WHERE participant_id = %s", (pid,))
    srow = cur.fetchone()
    stuck = [('99999', 'Diagnostic Volunteer', 1, pid, mid, 'TEST_DIAG_B2', 'Under Review', 'مازال بالمهمة', srow[0], srow[1], srow[2])]

pid = stuck[0][3]
sid = stuck[0][8]
mid = stuck[0][4]

print(f"Chosen volunteer: pid={pid} session_id={sid} mission_id={mid}")

print("\n▶ BEFORE LEAVE:")
cur.execute("SELECT session_id, start_dt, end_dt, check_out_time FROM mission_participant_sessions WHERE participant_id=%s", (pid,))
for r in cur.fetchall(): print(f"  session_id={r[0]} start_dt={r[1]} end_dt={r[2]} check_out_time={r[3]}")
cur.execute("SELECT return_status FROM mission_participants WHERE participant_id=%s", (pid,))
print(f"  return_status='{cur.fetchone()[0]}'")

# ── The EXACT LEAVE SQL (main.py:2030-2040 + 2081-2083) ──
print("\n▶ EXECUTING LEAVE — exact SQL from main.py:2030-2040 (find open seg) + 2038-2040 (close) + 2081-2083 (return_status)")
cur.execute("SELECT session_id, start_dt FROM mission_participant_sessions WHERE participant_id=%s AND end_dt IS NULL ORDER BY start_dt NULLS LAST LIMIT 1", (pid,))
open_seg = cur.fetchone()
if open_seg:
    cur.execute("UPDATE mission_participant_sessions SET end_dt=%s, check_out_time=%s WHERE session_id=%s",
                ("2026-09-08 14:00", "14:00", open_seg[0]))
    print(f"  Closed session {open_seg[0]}: end_dt=2026-09-08 14:00, check_out_time=14:00")
cur.execute("UPDATE mission_participants SET return_status='تم انتهاء مهمتة' WHERE participant_id=%s", (pid,))
print("  Set return_status='تم انتهاء مهمتة'")

print("\n▶ AFTER LEAVE:")
cur.execute("SELECT session_id, start_dt, end_dt, check_out_time FROM mission_participant_sessions WHERE participant_id=%s", (pid,))
for r in cur.fetchall(): print(f"  session_id={r[0]} start_dt={r[1]} end_dt={r[2]} check_out_time={r[3]}")
cur.execute("SELECT return_status FROM mission_participants WHERE participant_id=%s", (pid,))
print(f"  return_status='{cur.fetchone()[0]}'")

# ──────────────────────────────────────────────
section("PART C — THE EXACT RADAR QUERY (main.py:730-757) after LEAVE")
cur.execute("""
    SELECT m.mission_name, m.mission_id, m.status, COALESCE(b.branch_name,'غير محدد'),
           p.return_status,
           EXISTS(SELECT 1 FROM mission_participant_sessions s WHERE s.participant_id=p.participant_id AND s.end_dt IS NULL) AS open_seg,
           (SELECT count(*) FROM mission_participant_sessions s WHERE s.participant_id=p.participant_id) AS n_sessions
    FROM mission_participants p
    JOIN missions m ON m.mission_id=p.mission_id
    LEFT JOIN branches b ON b.branch_id=p.branch_id
    WHERE LOWER(TRIM(p.membership_number)) = LOWER(%s)
      AND p.branch_id IS NOT DISTINCT FROM %s
      AND m.status NOT IN ('Draft','Cancelled','Returned','Completed')
""", (stuck[0][0], stuck[0][2]))
rows = cur.fetchall()
print(f"Matching rows (status NOT terminal): {len(rows)}")
for r in rows:
    print(f"  mission='{r[0]}' id={r[1]} status='{r[2]}' branch='{r[3]}' return_status='{r[4]}'")
    print(f"    open_seg(end_dt IS NULL)={r[5]}  n_sessions={r[6]}")
    # Branch A firing?
    ba = bool(r[5])
    bb = (r[4]=='مازال بالمهمة' and r[6]==0)
    print(f"    Branch A (open seg) fires: {ba}")
    print(f"    Branch B (no sess + stale status) fires: {bb}")
    print(f"    >>> RADAR WOULD BLOCK: {ba or bb}")

# ──────────────────────────────────────────────
section("PART D — CHECK: does return_status stay stale in the participant row?")
cur.execute("""
    SELECT p.participant_id, p.mission_id, p.return_status, s.session_id, s.start_dt, s.end_dt, s.check_out_time
    FROM mission_participants p
    LEFT JOIN mission_participant_sessions s ON s.participant_id=p.participant_id AND s.mission_id=p.mission_id
    WHERE p.participant_id = %s
""", (pid,))
for r in cur.fetchall():
    print(f"  pid={r[0]} mission_id={r[1]} return_status='{r[2]}' sid={r[3]} start={r[4]} end={r[5]} checkout={r[6]}")

# cleanup test rows if created
if stuck[0][0] == '99999':
    cur.execute("DELETE FROM mission_participant_sessions WHERE participant_id=%s", (pid,))
    cur.execute("DELETE FROM mission_participant_itineraries WHERE participant_id=%s", (pid,))
    cur.execute("DELETE FROM mission_participants WHERE participant_id=%s", (pid,))
    cur.execute("DELETE FROM missions WHERE mission_id=%s", (mid,))
    print("\n  Cleaned up synthetic test rows.")

cur.close(); conn.close()
print("\nDIAGNOSTIC COMPLETE")