#!/usr/bin/env python3
"""
One-time cleanup: fix participants with return_status='مازال بالمهمة' and zero sessions.
These participants were rostered but never JOINed — their return_status is stale.
Sets them to 'في الانتظار' (pending) so they're no longer blocked by the radar.
Run via:  python cleanup_stale_return_status.py
"""
from main import get_connection

conn = get_connection(); conn.autocommit = True; cur = conn.cursor()

# Show BEFORE state
cur.execute("""
    SELECT p.participant_id, p.membership_number, p.full_name, p.branch_id,
           p.return_status, m.mission_id, m.mission_name, m.status
    FROM mission_participants p
    JOIN missions m ON m.mission_id = p.mission_id
    WHERE p.return_status = 'مازال بالمهمة'
      AND m.status NOT IN ('Draft', 'Cancelled', 'Returned', 'Completed')
      AND p.membership_number IS NOT NULL AND TRIM(p.membership_number) <> ''
      AND NOT EXISTS (SELECT 1 FROM mission_participant_sessions s WHERE s.participant_id = p.participant_id)
""")
stale = cur.fetchall()
print(f"Found {len(stale)} participant(s) with stale return_status + zero sessions:")
for r in stale:
    print(f"  pid={r[0]} membership={r[1]!r} name={r[2]!r} branch={r[3]} return_status={r[4]!r} mission={r[5]}")

if not stale:
    print("Nothing to fix.")
    cur.close(); conn.close()
    return

# Fix
cur.execute("""
    UPDATE mission_participants SET return_status = 'في الانتظار'
    WHERE return_status = 'مازال بالمهمة'
      AND NOT EXISTS (SELECT 1 FROM mission_participant_sessions s WHERE s.participant_id = mission_participants.participant_id)
""")
print(f"\nFixed {cur.rowcount} participant(s): return_status → 'في الانتظار'")

# Show AFTER state
cur.execute("""
    SELECT p.participant_id, p.membership_number, p.full_name, p.return_status
    FROM mission_participants p
    WHERE p.participant_id = ANY(%s)
""", ([r[0] for r in stale],))
print("\nAfter fix:")
for r in cur.fetchall():
    print(f"  pid={r[0]} membership={r[1]!r} name={r[2]!r} return_status={r[3]!r}")

cur.close(); conn.close()
print("\nDONE. These participants can now be added to other missions.")
