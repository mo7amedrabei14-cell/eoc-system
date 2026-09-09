#!/usr/bin/env python3
"""
Diagnostic: Trace ONE real participant lifecycle to find the exact DB row
that causes 'المتطوع في مهمة حاليًا' after LEAVE.
"""
import requests, json, psycopg2, os, sys
from datetime import datetime

BASE = "http://127.0.0.1:8099"
DB_URL = os.getenv("DATABASE_URL", "postgresql://neondb_owner:npg_Z2dEz2Y8o6k1@ep-wispy-rain-a5ememel-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require")

# ── 1. Login (OAuth2 form data) ──
print("=" * 70)
print("STEP 1: Login")
login = requests.post(f"{BASE}/token", data={"username": "admin", "password": "admin123"})
if login.status_code != 200:
    print(f"Login failed: {login.status_code} {login.text}")
    sys.exit(1)
token = login.json()["access_token"]
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
print(f"  Token obtained: {token[:20]}...")

# ── 2. Get branches and volunteers ──
print("\n" + "=" * 70)
print("STEP 2: Get branches and volunteers")
branches = requests.get(f"{BASE}/api/branches/locations", headers=headers).json()
branch_id = branches[0]["branch_id"] if branches else 19
print(f"  Using branch_id: {branch_id}")

volunteers = requests.get(f"{BASE}/api/volunteers/all", headers=headers).json()
if not volunteers:
    print("  No volunteers found!")
    sys.exit(1)

# Pick a volunteer that's not currently active
target_vol = None
for v in volunteers:
    mn = v.get("membership_number", "")
    if mn and mn.strip():
        target_vol = v
        break
if not target_vol:
    target_vol = volunteers[0]

membership = target_vol["membership_number"]
print(f"  Target volunteer: {target_vol.get('full_name', 'N/A')} membership={membership} branch={target_vol.get('branch_id')}")

# ── 3. Create Mission A with the participant (NO check_out_time → open session) ──
print("\n" + "=" * 70)
print("STEP 3: Create Mission A with participant (NO check_out_time)")
mission_a_payload = {
    "mission_name": "TEST_DIAG_MISSION_A",
    "mission_classification": "عادية",
    "status": "Draft",
    "disaster_type": "اختبار",
    "disaster_date": "2026-09-08",
    "governorate": "القاهرة",
    "center": "-testing",
    "departure_time": "08:00",
    "participants": [{
        "participant_type": "volunteer",
        "full_name": target_vol.get("full_name", "Test"),
        "participation_role": membership,
        "branch_id": target_vol.get("branch_id", branch_id),
        "assigned_itinerary": "خط السير الأساسي",
        "return_status": "مازال بالمهمة",
        "participation_periods": [{
            "session_date": "2026-09-08",
            "check_in_time": "09:00",
            "check_out_time": None
        }]
    }],
    "routes": [],
    "vehicles": [],
    "beneficiaries": [],
    "eoc_staff": []
}
resp_a = requests.post(f"{BASE}/api/missions", json=mission_a_payload, headers=headers)
print(f"  Create Mission A: {resp_a.status_code}")
if resp_a.status_code != 200:
    print(f"  Error: {resp_a.text}")
    sys.exit(1)
mission_a_id = resp_a.json()["mission_id"]
print(f"  Mission A ID: {mission_a_id}")

# ── 4. Query DB: get participant_id and session state ──
print("\n" + "=" * 70)
print("STEP 4: Query DB state AFTER mission creation (before LEAVE)")
conn = psycopg2.connect(DB_URL)
conn.autocommit = True
cur = conn.cursor()

cur.execute("""
    SELECT mp.participant_id, mp.membership_number, mp.branch_id, mp.return_status,
           s.session_id, s.mission_id, s.start_dt, s.end_dt, s.check_in_time, s.check_out_time
    FROM mission_participants mp
    LEFT JOIN mission_participant_sessions s ON s.participant_id = mp.participant_id AND s.mission_id = mp.mission_id
    WHERE mp.mission_id = %s
""", (mission_a_id,))
rows = cur.fetchall()
print(f"  Found {len(rows)} participant/session rows:")
for r in rows:
    pid, mn, bid, rs, sid, mid, sdt, edt, cit, cot = r
    print(f"    participant_id={pid} membership={mn} branch={bid} return_status='{rs}'")
    print(f"    session_id={sid} mission_id={mid} start_dt={sdt} end_dt={edt} check_in={cit} check_out={cot}")

if not rows:
    print("  ERROR: No participant found!")
    sys.exit(1)

participant_id = rows[0][0]
session_id = rows[0][4]
print(f"\n  participant_id = {participant_id}")
print(f"  session_id = {session_id}")
print(f"  return_status = '{rows[0][3]}'")
print(f"  end_dt = {rows[0][6]}")

# ── 5. LEAVE the participant via /leave endpoint ──
print("\n" + "=" * 70)
print("STEP 5: LEAVE via /leave endpoint")
leave_payload = {
    "participant_id": participant_id,
    "leave_datetime": "2026-09-08 14:00",
    "client_now": "2026-09-08 14:00"
}
resp_leave = requests.post(f"{BASE}/api/missions/{mission_a_id}/leave", json=leave_payload, headers=headers)
print(f"  LEAVE response: {resp_leave.status_code}")
print(f"  LEAVE body: {resp_leave.text}")

# ── 6. Query DB: state AFTER LEAVE ──
print("\n" + "=" * 70)
print("STEP 6: Query DB state AFTER LEAVE")
cur.execute("""
    SELECT mp.participant_id, mp.membership_number, mp.branch_id, mp.return_status,
           s.session_id, s.mission_id, s.start_dt, s.end_dt, s.check_in_time, s.check_out_time
    FROM mission_participants mp
    LEFT JOIN mission_participant_sessions s ON s.participant_id = mp.participant_id AND s.mission_id = mp.mission_id
    WHERE mp.mission_id = %s
""", (mission_a_id,))
rows_after = cur.fetchall()
print(f"  Found {len(rows_after)} rows after LEAVE:")
for r in rows_after:
    pid, mn, bid, rs, sid, mid, sdt, edt, cit, cot = r
    print(f"    participant_id={pid} membership={mn} branch={bid} return_status='{rs}'")
    print(f"    session_id={sid} mission_id={mid} start_dt={sdt} end_dt={edt} check_in={cit} check_out={cot}")

# ── 7. Check for ANY open sessions across ALL missions for this participant ──
print("\n" + "=" * 70)
print("STEP 7: Check for open sessions across ALL missions")
cur.execute("""
    SELECT s.session_id, s.mission_id, s.start_dt, s.end_dt, s.check_out_time,
           mp.return_status, m.status as mission_status
    FROM mission_participant_sessions s
    JOIN mission_participants mp ON mp.participant_id = s.participant_id
    JOIN missions m ON m.mission_id = s.mission_id
    WHERE mp.membership_number = %s
      AND mp.branch_id IS NOT DISTINCT FROM %s
      AND s.end_dt IS NULL
""", (membership, target_vol.get("branch_id", branch_id)))
open_sessions = cur.fetchall()
print(f"  Open sessions (end_dt IS NULL) for {membership}: {len(open_sessions)}")
for os in open_sessions:
    print(f"    session_id={os[0]} mission_id={os[1]} start_dt={os[2]} end_dt={os[3]} return_status='{os[5]}' mission_status='{os[6]}'")

# ── 8. Run the EXACT radar query from resolve_participant_identity ──
print("\n" + "=" * 70)
print("STEP 8: Run EXACT radar query from resolve_participant_identity (line 730-757)")
cur.execute("""
    SELECT m.mission_name, COALESCE(b.branch_name, 'غير محدد')
    FROM mission_participants p
    JOIN missions m ON p.mission_id = m.mission_id
    LEFT JOIN branches b ON b.branch_id = p.branch_id
    WHERE LOWER(TRIM(p.membership_number)) = LOWER(%s)
      AND p.branch_id IS NOT DISTINCT FROM %s
      AND m.status NOT IN ('Draft', 'Cancelled', 'Returned', 'Completed')
      AND (
          EXISTS (
              SELECT 1 FROM mission_participant_sessions s
              WHERE s.participant_id = p.participant_id AND s.end_dt IS NULL
          )
          OR (
              p.return_status = 'مازال بالمهمة'
              AND NOT EXISTS (
                  SELECT 1 FROM mission_participant_sessions s
                  WHERE s.participant_id = p.participant_id
              )
          )
      )
      AND p.mission_id <> %s
    LIMIT 1;
""", (membership, target_vol.get("branch_id", branch_id), mission_a_id))
radar_result = cur.fetchone()
print(f"  Radar result (excluding mission {mission_a_id}): {radar_result}")
if radar_result:
    print(f"  *** BLOCKED: Mission '{radar_result[0]}' in branch '{radar_result[1]}' ***")
else:
    print(f"  *** NOT BLOCKED: Radar returned nothing ***")

# ── 9. Also check WITHOUT the mission_id exclusion (create_mission path) ──
print("\n" + "=" * 70)
print("STEP 9: Radar query WITHOUT mission exclusion (create_mission path)")
cur.execute("""
    SELECT m.mission_name, m.mission_id, m.status, COALESCE(b.branch_name, 'غير محدد')
    FROM mission_participants p
    JOIN missions m ON p.mission_id = m.mission_id
    LEFT JOIN branches b ON b.branch_id = p.branch_id
    WHERE LOWER(TRIM(p.membership_number)) = LOWER(%s)
      AND p.branch_id IS NOT DISTINCT FROM %s
      AND m.status NOT IN ('Draft', 'Cancelled', 'Returned', 'Completed')
      AND (
          EXISTS (
              SELECT 1 FROM mission_participant_sessions s
              WHERE s.participant_id = p.participant_id AND s.end_dt IS NULL
          )
          OR (
              p.return_status = 'مازال بالمهمة'
              AND NOT EXISTS (
                  SELECT 1 FROM mission_participant_sessions s
                  WHERE s.participant_id = p.participant_id
              )
          )
      )
    LIMIT 5;
""", (membership, target_vol.get("branch_id", branch_id)))
all_radar = cur.fetchall()
print(f"  All matching rows (no mission exclusion): {len(all_radar)}")
for ar in all_radar:
    print(f"    mission='{ar[0]}' id={ar[1]} status='{ar[2]}' branch='{ar[3]}'")

# ── 10. Show ALL mission_participants rows for this membership ──
print("\n" + "=" * 70)
print("STEP 10: ALL mission_participants rows for this membership across ALL missions")
cur.execute("""
    SELECT mp.participant_id, mp.mission_id, mp.membership_number, mp.branch_id,
           mp.return_status, m.mission_name, m.status
    FROM mission_participants mp
    JOIN missions m ON m.mission_id = mp.mission_id
    WHERE LOWER(TRIM(mp.membership_number)) = LOWER(%s)
      AND mp.branch_id IS NOT DISTINCT FROM %s
    ORDER BY mp.mission_id
""", (membership, target_vol.get("branch_id", branch_id)))
all_parts = cur.fetchall()
print(f"  Total participant rows: {len(all_parts)}")
for ap in all_parts:
    print(f"    pid={ap[0]} mission_id={ap[1]} membership={ap[2]} branch={ap[3]} return_status='{ap[4]}' mission='{ap[5]}' status='{ap[6]}'")

# ── 11. Show ALL session rows for this participant across ALL missions ──
print("\n" + "=" * 70)
print("STEP 11: ALL session rows for this participant across ALL missions")
cur.execute("""
    SELECT s.session_id, s.participant_id, s.mission_id, s.start_dt, s.end_dt,
           s.check_in_time, s.check_out_time, s.itinerary_group
    FROM mission_participant_sessions s
    WHERE s.participant_id = %s
    ORDER BY s.mission_id, s.start_dt
""", (participant_id,))
all_sessions = cur.fetchall()
print(f"  Total session rows: {len(all_sessions)}")
for ss in all_sessions:
    print(f"    sid={ss[0]} pid={ss[1]} mid={ss[2]} start={ss[3]} end={ss[4]} check_in={ss[5]} check_out={ss[6]} group={ss[7]}")

# ── 12. Cleanup ──
print("\n" + "=" * 70)
print("STEP 12: Cleanup test data")
cur.execute("DELETE FROM mission_participant_sessions WHERE mission_id = %s", (mission_a_id,))
cur.execute("DELETE FROM mission_participant_itineraries WHERE mission_id = %s", (mission_a_id,))
cur.execute("DELETE FROM mission_participants WHERE mission_id = %s", (mission_a_id,))
cur.execute("DELETE FROM mission_itineraries WHERE mission_id = %s", (mission_a_id,))
cur.execute("DELETE FROM mission_vehicles WHERE mission_id = %s", (mission_a_id,))
cur.execute("DELETE FROM mission_beneficiaries WHERE mission_id = %s", (mission_a_id,))
cur.execute("DELETE FROM mission_eoc_staff WHERE mission_id = %s", (mission_a_id,))
cur.execute("DELETE FROM missions WHERE mission_id = %s", (mission_a_id,))
print(f"  Cleaned up mission {mission_a_id}")

cur.close()
conn.close()
print("\n" + "=" * 70)
print("DIAGNOSIS COMPLETE")
