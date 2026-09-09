#!/usr/bin/env python3
"""
DIAGNOSTIC — Bug #2 "المتطوع في مهمة حاليًا" after LEAVE.

Models the repo's own regression harness (run_draft_lifecycle.py):
- boots uvicorn on a thread using `main`,
- drives the REAL API endpoints exactly as the frontend does,
- inspects actual DB rows via get_connection(),
- runs the EXACT radar query the backend uses,
- deletes its own test rows at the end.

Only ONE volunteer lifecycle is traced, and its exact DB state is printed.
"""
import datetime, json, os, sys, threading, time
import uvicorn
import requests
import main
from main import get_connection
from auth import create_access_token

PORT = 8101
BASE = f"http://127.0.0.1:{PORT}"

def start_server():
    config = uvicorn.Config(main.app, host="127.0.0.1", port=PORT, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(50):
        try:
            requests.get(f"{BASE}/docs", timeout=1)
            return
        except Exception:
            time.sleep(0.2)
    raise RuntimeError("Server did not start")

def section(t):
    print("\n" + "=" * 70)
    print(t)
    print("=" * 70)

def norm_dt(v):
    return None if v is None else str(v)[:16]

# ── boot ──
print("Starting server...")
start_server()
print("Server up.")

# ── auth: log in through /token with a real user ──
conn0 = get_connection()
conn0.autocommit = True
c0 = conn0.cursor()
c0.execute("SELECT username FROM users WHERE is_active = TRUE ORDER BY user_id LIMIT 1")
urow = c0.fetchone()
username = urow[0] if urow else "admin"
c0.execute("SELECT r.role_name FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.user_id LEFT JOIN roles r ON r.role_id=ur.role_id WHERE u.username=%s", (username,))
role_row = c0.fetchone()
print(f"Login user: {username}  role: {role_row[0] if role_row else '?'}")
c0.close(); conn0.close()

login = requests.post(f"{BASE}/token", data={"username": username, "password": "admin123"})
if login.status_code != 200:
    # try a few known fallback passwords
    for pw in ("admin", "Admin@123", "password", "123456"):
        login = requests.post(f"{BASE}/token", data={"username": username, "password": pw})
        if login.status_code == 200:
            print(f"  used password fallback: {pw!r}")
            break
if login.status_code != 200:
    print(f"LOGIN FAILED: {login.status_code} {login.text}")
    sys.exit(1)
TOKEN = login.json()["access_token"]
H = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
print("Token OK:", TOKEN[:16], "...")

# ── pick a volunteer ──
vols = requests.get(f"{BASE}/api/volunteers/all", headers=H).json()
vol = None
for v in vols:
    if v.get("membership_number") and str(v["membership_number"]).strip():
        vol = v
        break
if not vol:
    print("No volunteer found"); sys.exit(1)
membership = str(vol["membership_number"]).strip()
branch_id = vol["branch_id"]
name = vol["full_name"]
print(f"\nChosen volunteer: {name}  membership={membership}  branch={branch_id}")

# ── create Mission A with this volunteer (NO check_out_time → open segment) ──
section("STEP 1 — Create Mission A (Draft, volunteer, NO check_out_time)")
payload_a = {
    "mission_name": "TEST_BUG2_MISSION_A",
    "mission_classification": "عادية",
    "status": "Draft",
    "disaster_type": "اختبار",
    "disaster_date": "2026-09-08",
    "governorate": "القاهرة",
    "center": "-diag",
    "departure_time": "08:00",
    "participants": [{
        "participant_type": "volunteer",
        "full_name": name,
        "participation_role": membership,
        "branch_id": branch_id,
        "assigned_itinerary": "خط السير الأساسي",
        "return_status": "مازال بالمهمة",
        "participation_periods": [{
            "session_date": "2026-09-08",
            "check_in_time": "09:00",
            "check_out_time": None
        }]
    }],
    "routes": [], "vehicles": [], "beneficiaries": [], "eoc_staff": []
}
ra = requests.post(f"{BASE}/api/missions", json=payload_a, headers=H)
print(f"  create mission A: {ra.status_code}")
if ra.status_code != 200:
    print("  BODY:", ra.text[:500]); sys.exit(1)
midA = ra.json()["mission_id"]
print(f"  mission A id = {midA}")

def db_state(mid, label):
    conn = get_connection(); conn.autocommit = True
    cur = conn.cursor()
    cur.execute("""
        SELECT mp.participant_id, mp.membership_number, mp.branch_id, mp.return_status,
               s.session_id, s.mission_id, s.start_dt, s.end_dt, s.check_in_time, s.check_out_time
        FROM mission_participants mp
        LEFT JOIN mission_participant_sessions s
          ON s.participant_id = mp.participant_id AND s.mission_id = mp.mission_id
        WHERE mp.mission_id = %s AND mp.roster_active = true
    """, (mid,))
    rows = cur.fetchall()
    print(f"  [{label}] rows={len(rows)}")
    for r in rows:
        print(f"    participant_id={r[0]} membership={r[1]} branch={r[2]} return_status='{r[3]}'")
        print(f"    session_id={r[4]} mission_id={r[5]} start_dt={norm_dt(r[6])} end_dt={norm_dt(r[7])} check_in={r[8]} check_out={r[9]}")
        open_ = "OPEN" if r[7] is None else "CLOSED"
        print(f"    >>> segment is {open_}")
    return rows

section("STEP 2 — DB state AFTER mission A creation (BEFORE LEAVE)")
rowsA = db_state(midA, "after create")
pidA = rowsA[0][0]
sidA = rowsA[0][4]
print(f"  participant_id={pidA}  session_id={sidA}")

# ── JOIN through the real endpoint (frontend "انضمام" button) ──
section("STEP 3 — JOIN via POST /api/missions/{id}/join (frontend button)")
rj = requests.post(f"{BASE}/api/missions/{midA}/join",
                   json={"participant_id": pidA, "join_datetime": "2026-09-08 09:00",
                         "client_now": "2026-09-08 09:00"}, headers=H)
print(f"  join: {rj.status_code} {rj.text[:200]}")
rowsJ = db_state(midA, "after join")

# ── LEAVE through the real endpoint (frontend "انفصال" button) ──
section("STEP 4 — LEAVE via POST /api/missions/{id}/leave (frontend button)")
rl = requests.post(f"{BASE}/api/missions/{midA}/leave",
                   json={"participant_id": pidA, "leave_datetime": "2026-09-08 14:00",
                         "client_now": "2026-09-08 14:00"}, headers=H)
print(f"  leave: {rl.status_code} {rl.text[:200]}")
rowsL = db_state(midA, "after leave")

# ── THE EXACT RADAR QUERY (main.py:730-757) ──
section("STEP 5 — EXACT radar query from resolve_participant_identity (line 730-757)")
conn = get_connection(); conn.autocommit = True
cur = conn.cursor()
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
""", (membership, branch_id, midA))
blocked = cur.fetchone()
print(f"  Radar result (exclude mission A): {blocked}")
if blocked:
    print(f"  *** BLOCKED — missions '{blocked[0]}' branch '{blocked[1]}' ***")
else:
    print("  *** NOT BLOCKED — radar returned nothing ***")

# Also verify by actually CREATING Mission B with the same volunteer (real API)
section("STEP 6 — Actually attempt to add same volunteer to Mission B (real API)")
payload_b = {
    "mission_name": "TEST_BUG2_MISSION_B",
    "mission_classification": "عادية",
    "status": "Draft",
    "disaster_type": "اختبار",
    "disaster_date": "2026-09-09",
    "governorate": "القاهرة",
    "center": "-diag",
    "departure_time": "08:00",
    "participants": [{
        "participant_type": "volunteer",
        "full_name": name,
        "participation_role": membership,
        "branch_id": branch_id,
        "assigned_itinerary": "خط السير الأساسي",
        "return_status": "مازال بالمهمة",
        "participation_periods": []
    }],
    "routes": [], "vehicles": [], "beneficiaries": [], "eoc_staff": []
}
rb = requests.post(f"{BASE}/api/missions", json=payload_b, headers=H)
print(f"  create mission B: {rb.status_code}")
print(f"  body: {rb.text[:300]}")

# ── also try the update path (re-save mission A after LEAVE) ──
section("STEP 7 — Re-save Mission A (update_mission) after LEAVE, with the volunteer still listed")
payload_a2 = dict(payload_a)
payload_a2["participants"][0]["participation_periods"] = [{
    "session_date": "2026-09-08",
    "check_in_time": "09:00",
    "check_out_time": "14:00"
}]
ru = requests.put(f"{BASE}/api/missions/{midA}", json=payload_a2, headers=H)
print(f"  update mission A: {ru.status_code}  {ru.text[:300]}")
rowsU = db_state(midA, "after re-save")

# ── final radar check after re-save ──
section("STEP 8 — EXACT radar query AGAIN after re-save of mission A")
cur.execute("""
    SELECT m.mission_name, p.mission_id, m.status, p.return_status,
           EXISTS(SELECT 1 FROM mission_participant_sessions s
                  WHERE s.participant_id = p.participant_id AND s.end_dt IS NULL) AS open_seg,
           (SELECT count(*) FROM mission_participant_sessions s WHERE s.participant_id = p.participant_id) AS n_sessions
    FROM mission_participants p
    JOIN missions m ON m.mission_id = p.mission_id
    WHERE LOWER(TRIM(p.membership_number)) = LOWER(%s)
      AND p.branch_id IS NOT DISTINCT FROM %s
    ORDER BY p.mission_id
""", (membership, branch_id))
for r in cur.fetchall():
    branchA = bool(r[4])
    branchB = (r[3] == 'مازال بالمهمة' and r[5] == 0)
    print(f"  mission_id={r[1]} status='{r[2]}' return_status='{r[3]}' open_seg={r[4]} n_sessions={r[5]}"
          f"  BranchA(open seg)={branchA} BranchB(stale,0sess)={branchB}"
          f"  {'RADAR WOULD BLOCK' if (branchA or branchB) and r[2] not in ('Draft','Cancelled','Returned','Completed') else 'ok'}")

# ── cleanup test data ──
section("STEP 9 — Cleanup")
for mid in (midA, rb.json().get("mission_id") if rb.status_code == 200 else None):
    if not mid: continue
    cur.execute("DELETE FROM mission_participant_sessions WHERE mission_id=%s", (mid,))
    cur.execute("DELETE FROM mission_participant_itineraries WHERE mission_id=%s", (mid,))
    cur.execute("DELETE FROM mission_participants WHERE mission_id=%s", (mid,))
    cur.execute("DELETE FROM mission_itineraries WHERE mission_id=%s", (mid,))
    cur.execute("DELETE FROM mission_vehicles WHERE mission_id=%s", (mid,))
    cur.execute("DELETE FROM mission_beneficiaries WHERE mission_id=%s", (mid,))
    cur.execute("DELETE FROM mission_eoc_staff WHERE mission_id=%s", (mid,))
    cur.execute("DELETE FROM missions WHERE mission_id=%s", (mid,))
    print(f"  deleted test mission {mid}")
cur.close(); conn.close()
print("\nDIAGNOSTIC COMPLETE")