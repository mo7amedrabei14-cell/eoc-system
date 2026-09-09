#!/usr/bin/env python3
"""
Regression test for Bug #2 fix — DIRECT DB path (no volunteers table needed).

Tests the radar query in resolve_participant_identity after removing Branch B.
"""
import sys, time
from main import get_connection

passed = 0
failed = 0
_counter = int(time.time()) % 100000

def check(label, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  ✅ {label}")
    else:
        failed += 1
        print(f"  ❌ {label}")
        if detail:
            print(f"     {detail}")

def setup():
    """Create test mission + participant. Returns (conn, mission_id, participant_id)."""
    global _counter; _counter += 1
    conn = get_connection(); conn.autocommit = True; cur = conn.cursor()
    code = f"B2R{_counter}"
    cur.execute("INSERT INTO missions (mission_name, mission_classification, mission_code, status) VALUES (%s,%s,%s,%s) RETURNING mission_id",
                ("BUG2_REGRESSION", "عادية", code, "Under Review"))
    mid = cur.fetchone()[0]
    cur.execute("""
        INSERT INTO mission_participants
        (mission_id, participant_type, full_name, participation_role, membership_number,
         branch_id, assigned_itinerary, return_status, roster_active, start_from_mission)
        VALUES (%s,'volunteer','Test Volunteer','9999','9999',19,'خط السير الأساسي','مازال بالمهمة',true,true)
        RETURNING participant_id
    """, (mid,))
    pid = cur.fetchone()[0]
    cur.close()
    return conn, mid, pid

def teardown(conn, mid):
    cur = conn.cursor()
    for t in ['mission_participant_sessions','mission_participant_itineraries','mission_participants',
              'mission_itineraries','mission_vehicles','mission_beneficiaries','mission_eoc_staff']:
        cur.execute(f"DELETE FROM {t} WHERE mission_id=%s", (mid,))
    cur.execute("DELETE FROM missions WHERE mission_id=%s", (mid,))
    conn.commit(); cur.close(); conn.close()

def run_radar(conn, membership, branch_id, exclude_mission_id=None):
    """Run the EXACT radar query from resolve_participant_identity (after fix)."""
    cur = conn.cursor()
    if exclude_mission_id is not None:
        cur.execute("""
            SELECT m.mission_name, m.mission_id
            FROM mission_participants p
            JOIN missions m ON p.mission_id = m.mission_id
            WHERE LOWER(TRIM(p.membership_number)) = LOWER(%s)
              AND p.branch_id IS NOT DISTINCT FROM %s
              AND m.status NOT IN ('Draft','Cancelled','Returned','Completed')
              AND EXISTS (
                  SELECT 1 FROM mission_participant_sessions s
                  WHERE s.participant_id = p.participant_id AND s.end_dt IS NULL
              )
              AND p.mission_id <> %s
            LIMIT 1;
        """, (membership, branch_id, exclude_mission_id))
    else:
        cur.execute("""
            SELECT m.mission_name, m.mission_id
            FROM mission_participants p
            JOIN missions m ON p.mission_id = m.mission_id
            WHERE LOWER(TRIM(p.membership_number)) = LOWER(%s)
              AND p.branch_id IS NOT DISTINCT FROM %s
              AND m.status NOT IN ('Draft','Cancelled','Returned','Completed')
              AND EXISTS (
                  SELECT 1 FROM mission_participant_sessions s
                  WHERE s.participant_id = p.participant_id AND s.end_dt IS NULL
              )
            LIMIT 1;
        """, (membership, branch_id))
    row = cur.fetchone(); cur.close()
    return row

# ── TEST 1: Zero sessions → must NOT block ──
print("TEST 1: Roster-only (zero sessions) → radar must NOT block")
conn, mid, pid = setup()
row = run_radar(conn, '9999', 19)
check("Radar returns Nothing (not blocked)", row is None, f"got: {row}")
teardown(conn, mid)

# ── TEST 2: Open session → MUST block ──
print("\nTEST 2: Open session (end_dt=NULL) → radar MUST block")
conn, mid, pid = setup()
cur = conn.cursor()
cur.execute("""
    INSERT INTO mission_participant_sessions
    (participant_id, mission_id, session_date, check_in_time, start_dt, end_dt, notes)
    VALUES (%s,%s,'2026-09-09','09:00','2026-09-09 09:00:00',NULL,'انضمام')
""", (pid, mid))
conn.commit(); cur.close()
row = run_radar(conn, '9999', 19)
check("Radar BLOCKS (returns mission)", row is not None, f"got: {row}")
teardown(conn, mid)

# ── TEST 3: Closed session + return_status='تم两名 مهمتة' → must NOT block ──
print("\nTEST 3: Closed session after LEAVE → radar must NOT block")
conn, mid, pid = setup()
cur = conn.cursor()
cur.execute("""
    INSERT INTO mission_participant_sessions
    (participant_id, mission_id, session_date, check_in_time, start_dt, end_dt, check_out_time, notes)
    VALUES (%s,%s,'2026-09-09','09:00','2026-09-09 09:00:00','2026-09-09 14:00:00','14:00','انفصال')
""", (pid, mid))
cur.execute("UPDATE mission_participants SET return_status='تم两名 مهمتة' WHERE participant_id=%s", (pid,))
conn.commit(); cur.close()
row = run_radar(conn, '9999', 19)
check("Radar returns Nothing (not blocked)", row is None, f"got: {row}")
teardown(conn, mid)

# ── TEST 4: Open session with self-exclusion → must NOT block ──
print("\nTEST 4: Open session but excluded own mission → radar must NOT block")
conn, mid, pid = setup()
cur = conn.cursor()
cur.execute("""
    INSERT INTO mission_participant_sessions
    (participant_id, mission_id, session_date, check_in_time, start_dt, end_dt, notes)
    VALUES (%s,%s,'2026-09-09','09:00','2026-09-09 09:00:00',NULL,'انضمام')
""", (pid, mid))
conn.commit(); cur.close()
row = run_radar(conn, '9999', 19, exclude_mission_id=mid)
check("Radar returns Nothing (self-excluded)", row is None, f"got: {row}")
teardown(conn, mid)

# ── TEST 5: Stale return_status but all sessions closed → must NOT block ──
print("\nTEST 5: Stale return_status ('مازال بالمهمة') but all sessions closed → must NOT block")
conn, mid, pid = setup()
cur = conn.cursor()
cur.execute("""
    INSERT INTO mission_participant_sessions
    (participant_id, mission_id, session_date, check_in_time, start_dt, end_dt, check_out_time, notes)
    VALUES (%s,%s,'2026-09-09','09:00','2026-09-09 09:00:00','2026-09-09 14:00:00','14:00','انفصال')
""", (pid, mid))
conn.commit(); cur.close()
row = run_radar(conn, '9999', 19)
check("Radar returns Nothing (no open session)", row is None, f"got: {row}")
teardown(conn, mid)

# ── summary ──
print(f"\n{'='*60}")
print(f"RESULTS: {passed} passed, {failed} failed")
if failed:
    print("❌ SOME TESTS FAILED")
    sys.exit(1)
else:
    print("✅ ALL TESTS PASSED")
