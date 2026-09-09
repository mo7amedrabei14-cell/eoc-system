#!/usr/bin/env python3
"""
Verify Bug #2 fix: run the UPDATED radar query (without Branch B) against
the actual production data to confirm it no longer blocks roster-only participants.
Run via:  python verify_bug2_fix.py
"""
from main import get_connection

conn = get_connection(); conn.autocommit = True; cur = conn.cursor()

print("=" * 70)
print("BEFORE FIX — old radar (with Branch B): would these participants block?")
print("=" * 70)

# The 3 stuck participants from mission 226
for mn, bid, pid in [('250', 19, 597), ('725', 19, 595), ('418', 29, 596)]:
    # OLD radar (Branch B included):
    cur.execute("""
        SELECT m.mission_name, m.mission_id
        FROM mission_participants p
        JOIN missions m ON p.mission_id = m.mission_id
        WHERE LOWER(TRIM(p.membership_number)) = LOWER(%s)
          AND p.branch_id IS NOT DISTINCT FROM %s
          AND m.status NOT IN ('Draft','Cancelled','Returned','Completed')
          AND (
              EXISTS (SELECT 1 FROM mission_participant_sessions s
                      WHERE s.participant_id = p.participant_id AND s.end_dt IS NULL)
              OR (
                  p.return_status = 'مازال بالمهمة'
                  AND NOT EXISTS (SELECT 1 FROM mission_participant_sessions s
                                  WHERE s.participant_id = p.participant_id)
              )
          )
        LIMIT 1;
    """, (mn, bid))
    old = cur.fetchone()
    print(f"  membership={mn!r} branch={bid} pid={pid}: OLD radar → {'BLOCKED: ' + str(old) if old else 'not blocked'}")

print()
print("=" * 70)
print("AFTER FIX — new radar (Branch B removed): do they still block?")
print("=" * 70)

for mn, bid, pid in [('250', 19, 597), ('725', 19, 595), ('418', 29, 596)]:
    # NEW radar (no Branch B):
    cur.execute("""
        SELECT m.mission_name, m.mission_id
        FROM mission_participants p
        JOIN missions m ON p.mission_id = m.mission_id
        WHERE LOWER(TRIM(p.membership_number)) = LOWER(%s)
          AND p.branch_id IS NOT DISTINCT FROM %s
          AND m.status NOT IN ('Draft','Cancelled','Returned','Completed')
          AND EXISTS (SELECT 1 FROM mission_participant_sessions s
                      WHERE s.participant_id = p.participant_id AND s.end_dt IS NULL)
        LIMIT 1;
    """, (mn, bid))
    new = cur.fetchone()
    print(f"  membership={mn!r} branch={bid} pid={pid}: NEW radar → {'BLOCKED: ' + str(new) if new else '✅ NOT blocked'}")

# Also verify pid=598 (properly LEAVEd participant) is still not blocked
print()
print("=" * 70)
print("CONTROL — pid=598 (properly LEAVEd) must still NOT block")
print("=" * 70)
cur.execute("""
    SELECT m.mission_name, p.return_status,
           EXISTS(SELECT 1 FROM mission_participant_sessions s
                  WHERE s.participant_id = p.participant_id AND s.end_dt IS NULL) AS open_seg
    FROM mission_participants p
    JOIN missions m ON p.mission_id = m.mission_id
    WHERE p.participant_id = 598
""")
r = cur.fetchone()
if r:
    print(f"  mission='{r[0]}' return_status='{r[1]}' open_seg={r[2]}")
    print(f"  → {'BLOCKED (wrong!)' if r[2] else '✅ NOT blocked (correct)'}")

cur.close(); conn.close()
