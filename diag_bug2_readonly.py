#!/usr/bin/env python3
"""
READ-ONLY diagnostic: find the exact DB rows that make a volunteer look
"matjar في mission currently" AFTER they pressed LEAVE. SELECTs only, no writes.
Run via:  ! python diag_bug2_readonly.py
"""
import main
from main import get_connection

conn = get_connection()
conn.autocommit = True
cur = conn.cursor()

def section(t):
    print("\n" + "=" * 72)
    print(t)

# ── Q1: Volunteers with an OPEN session (end_dt IS NULL) in a NON-TERMINAL mission
#        → radar Branch A would fire → "في مهمة حاليًا" ──
section("Q1 — OPEN SESSION in active mission (radar Branch A: end_dt IS NULL)")
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
""")
rows = cur.fetchall()
print(f"COUNT: {len(rows)}")
for r in rows:
    print(f"  membership={r[0]!r} name={r[1]!r} branch={r[2]} pid={r[3]} mission_id={r[4]}")
    print(f"    mission='{r[5]}' status='{r[6]}' return_status='{r[7]}'")
    print(f"    session_id={r[8]} start_dt={r[9]} end_dt={r[10]}   <-- OPEN SEGMENT blocks radar")

# ── Q2: Volunteers with return_status='مازال بالمهمة' and ZERO sessions
#        → radar Branch B would fire (legacy fallback) ──
section("Q2 — STALE return_status + ZERO sessions (radar Branch B)")
cur.execute("""
    SELECT p.membership_number, p.full_name, p.branch_id, p.participant_id, p.mission_id,
           m.mission_name, m.status, p.return_status
    FROM mission_participants p
    JOIN missions m ON m.mission_id = p.mission_id
    WHERE p.return_status = 'مازال بالمهمة'
      AND m.status NOT IN ('Draft', 'Cancelled', 'Returned', 'Completed')
      AND p.membership_number IS NOT NULL AND TRIM(p.membership_number) <> ''
      AND NOT EXISTS (SELECT 1 FROM mission_participant_sessions s WHERE s.participant_id = p.participant_id)
    ORDER BY p.branch_id, p.membership_number
""")
rows2 = cur.fetchall()
print(f"COUNT: {len(rows2)}")
for r in rows2:
    print(f"  membership={r[0]!r} name={r[1]!r} branch={r[2]} pid={r[3]} mission_id={r[4]}")
    print(f"    mission='{r[5]}' status='{r[6]}' return_status='{r[7]}'   <-- stale status, no sessions")

# ── Q3: SUSPECT — return_status still 'مازال بالمهمة' but ALL sessions closed
#        (the "LEAVE saved end_dt but return_status went stale" pattern) ──
section("Q3 — STALE return_status while all sessions CLOSED (LEAVE-saved-end_dt-but-stale-status)")
cur.execute("""
    SELECT p.membership_number, p.full_name, p.branch_id, p.participant_id, p.mission_id,
           m.mission_name, m.status, p.return_status,
           (SELECT count(*) FROM mission_participant_sessions s WHERE s.participant_id=p.participant_id AND s.end_dt IS NULL) AS n_open,
           (SELECT count(*) FROM mission_participant_sessions s WHERE s.participant_id=p.participant_id) AS n_all
    FROM mission_participants p
    JOIN missions m ON m.mission_id = p.mission_id
    WHERE p.return_status = 'مازال بالمهمة'
      AND m.status NOT IN ('Draft', 'Cancelled', 'Returned', 'Completed')
      AND p.membership_number IS NOT NULL AND TRIM(p.membership_number) <> ''
      AND EXISTS (SELECT 1 FROM mission_participant_sessions s WHERE s.participant_id=p.participant_id)
    ORDER BY p.branch_id, p.membership_number
""")
rows3 = cur.fetchall()
print(f"COUNT: {len(rows3)}")
for r in rows3:
    print(f"  membership={r[0]!r} name={r[1]!r} branch={r[2]} pid={r[3]} mission_id={r[4]}")
    print(f"    mission='{r[5]}' status='{r[6]}' return_status='{r[7]}' n_open={r[8]} n_all={r[9]}")

# ── Q4: For Q3 suspects — full session rows (prove end_dt / check_out_time) ──
if rows3:
    section("Q4 — session rows for Q3 suspects")
    for r in rows3[:10]:
        pid = r[3]
        cur.execute("""
            SELECT s.session_id, s.mission_id, s.start_dt, s.end_dt, s.check_in_time, s.check_out_time, s.notes
            FROM mission_participant_sessions s WHERE s.participant_id=%s ORDER BY s.start_dt NULLS LAST
        """, (pid,))
        for x in cur.fetchall():
            print(f"  membership={r[0]} pid={pid}: session_id={x[0]} mission_id={x[1]} start={x[2]} end={x[3]} check_in={x[4]} check_out={x[5]} notes={x[6]!r}")

# ── Q5: scale gauge ──
section("Q5 — totals")
cur.execute("SELECT count(*) FROM mission_participant_sessions WHERE end_dt IS NULL")
print(f"  total OPEN sessions: {cur.fetchone()[0]}")
cur.execute("SELECT count(*) FROM mission_participant_sessions")
print(f"  total sessions: {cur.fetchone()[0]}")
cur.execute("SELECT status, count(*) FROM missions GROUP BY status ORDER BY 2 DESC")
print("  missions by status:", cur.fetchall())

# ── Q6: THE EXACT radar query (main.py:730-757) run for each Q2 participant,
#        excluding their own mission (as update_mission does). Proves the block. ──
if rows2:
    section("Q6 — EXACT radar query (main.py:730-757) per participant (exclude own mission)")
    for r in rows2:
        mn, bid, pid = r[0], r[2], r[3]
        cur.execute("""
            SELECT m.mission_name, m.mission_id, COALESCE(b.branch_name,'غير محدد')
            FROM mission_participants p
            JOIN missions m ON p.mission_id = m.mission_id
            LEFT JOIN branches b ON b.branch_id = p.branch_id
            WHERE LOWER(TRIM(p.membership_number)) = LOWER(%s)
              AND p.branch_id IS NOT DISTINCT FROM %s
              AND m.status NOT IN ('Draft','Cancelled','Returned','Completed')
              AND (
                  EXISTS (SELECT 1 FROM mission_participant_sessions s WHERE s.participant_id=p.participant_id AND s.end_dt IS NULL)
                  OR (p.return_status='مازال بالمهمة' AND NOT EXISTS (SELECT 1 FROM mission_participant_sessions s WHERE s.participant_id=p.participant_id))
              )
              AND p.mission_id <> %s
            LIMIT 1;
        """, (mn, bid, r[4]))
        radar = cur.fetchone()
        print(f"  membership={mn!r} branch={bid} pid={pid} -> radar returns: {radar}")
        print(f"      >>> BLOCKS adding to another mission: {radar is not None}")

# ── Q7: the single session row in the whole DB + every mission_participants row (context) ──
section("Q7 — full context: all sessions + all participant rows")
cur.execute("SELECT session_id, participant_id, mission_id, start_dt, end_dt, check_out_time, notes FROM mission_participant_sessions")
for x in cur.fetchall():
    print(f"  session: sid={x[0]} pid={x[1]} mission={x[2]} start={x[3]} end={x[4]} check_out={x[5]} notes={x[6]!r}")
cur.execute("""
    SELECT p.participant_id, p.mission_id, p.membership_number, p.full_name, p.participation_role,
           p.branch_id, p.return_status, p.roster_active, m.status
    FROM mission_participants p JOIN missions m ON m.mission_id=p.mission_id
    ORDER BY p.mission_id
""")
for x in cur.fetchall():
    print(f"  participant: pid={x[0]} mission={x[1]} membership={x[2]!r} name={x[3]!r} role={x[4]!r} branch={x[5]} return_status={x[6]!r} roster_active={x[7]} mission_status={x[8]}")

cur.close(); conn.close()
print("\nREAD-ONLY DIAGNOSTIC COMPLETE")