import os
import psycopg
from dotenv import load_dotenv
import sys

load_dotenv(r"C:\Users\mo7am\OneDrive\Work\EOC System\.env")
sys.path.insert(0, r"C:\Users\mo7am\OneDrive\Work\EOC System")
DB = os.getenv("DATABASE_URL")
src = open(r"C:\Users\mo7am\OneDrive\Work\EOC System\main.py", encoding="utf-8").read()

# ─────────────────────────────────────────────────────────────
# 1) Test compute_participant_status logic (pure function)
# ─────────────────────────────────────────────────────────────
def compute_participant_status(mission_status, return_status, periods):
    """Mirror of main.py implementation (pure logic check)."""
    if mission_status in ('Completed', 'مكتملة'): return 'تم انتهاء مهمتة'
    if return_status == 'تم انتهاء مهمتة':          return 'تم انتهاء مهمتة'
    if periods:
        return 'مازال بالمهمة' if any(not p['check_out_time'] for p in periods) else 'تم انتهاء مهمتة'
    return 'مازال بالمهمة'

checks = [
    # (label, mission_status, return_status, periods, expected)
    ("active + no periods -> ongoing", 'نشطة', 'مازال بالمهمة', [], 'مازال بالمهمة'),
    ("completed mission -> ended", 'Completed', 'مازال بالمهمة', [], 'تم انتهاء مهمتة'),
    ("return_status ended -> ended", 'نشطة', 'تم انتهاء مهمتة', [], 'تم انتهاء مهمتة'),
    ("open period -> ongoing", 'نشطة', 'مازال بالمهمة', [{'check_out_time': None}], 'مازال بالمهمة'),
    ("all closed periods -> ended", 'نشطة', 'مازال بالمهمة', [{'check_out_time': '18:00:00'}, {'check_out_time': '19:00:00'}], 'تم انتهاء مهمتة'),
]
fail = 0
for label, mst, rs, periods, exp in checks:
    got = compute_participant_status(mst, rs, periods)
    ok = got == exp
    print(f"[{'OK' if ok else 'FAIL'}] {label}: got={got} expected={exp}")
    if not ok: fail += 1

# ─────────────────────────────────────────────────────────────
# 2) DB integration test — inherited hours + override cumulatif
# ─────────────────────────────────────────────────────────────
conn = psycopg.connect(DB)
cur = conn.cursor()
cleanup_sqls = []
try:
    # ── clean any leftover test rows from prior runs ──
    cur.execute("DELETE FROM mission_participant_sessions WHERE notes IN ('override-test','إنهاء المشاركة') AND participant_id IN (SELECT participant_id FROM mission_participants WHERE full_name LIKE 'TEST_OPEN_%')")
    cur.execute("DELETE FROM mission_participant_itineraries WHERE mission_id IN (SELECT mission_id FROM missions WHERE mission_code LIKE 'TEST-OPEN-%')")
    cur.execute("DELETE FROM mission_participants WHERE full_name LIKE 'TEST_OPEN_%'")
    cur.execute("DELETE FROM missions WHERE mission_code LIKE 'TEST-OPEN-%'")
    conn.commit()
    import time as _t
    code = 'TEST-OPEN-' + _t.strftime('%H%M%S')

    # ── Open mission: 2 days, 2 participants ──
    cur.execute("""
        INSERT INTO missions (mission_code, mission_name, mission_classification, branch_id, status, exit_date, departure_date, arrival_date, completion_date)
        VALUES (%s, 'TEST_OPEN_MULTIDAY', 'مفتوحة', 19, 'Active', CURRENT_DATE, CURRENT_DATE, CURRENT_DATE, NULL)
        RETURNING mission_id
    """, (code,))
    open_id = cur.fetchone()[0]

    # day 1: window 08:00 -> 14:00 (6h), day 2: 09:00 -> 17:00 (8h)
    cur.execute("INSERT INTO mission_itineraries (mission_id, group_title, route_to, departure_time, arrival_time) VALUES (%s,'اليوم الأول','A','08:00','14:00')", (open_id,))
    cur.execute("INSERT INTO mission_itineraries (mission_id, group_title, route_to, departure_time, arrival_time) VALUES (%s,'اليوم الأول','B','09:00','13:00')", (open_id,))
    cur.execute("INSERT INTO mission_itineraries (mission_id, group_title, route_to, departure_time, arrival_time) VALUES (%s,'اليوم الثاني','A','09:00','17:00')", (open_id,))
    cur.execute("INSERT INTO mission_itineraries (mission_id, group_title, route_to, departure_time, arrival_time) VALUES (%s,'اليوم الثاني','B','10:00','16:00')", (open_id,))

    # participant P1 assigned to BOTH days → inherited = 6 + 8 = 14h
    cur.execute("""
        INSERT INTO mission_participants (mission_id, full_name, participant_type, branch_id, assigned_itinerary, return_status, phase_name, stay_type)
        VALUES (%s,'TEST_OPEN_P1','volunteer',19,'','مازال بالمهمة','اليوم الأول','ذهاب وعودة') RETURNING participant_id
    """, (open_id,))
    p1 = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,'اليوم الأول')", (p1, open_id))
    cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,'اليوم الثاني')", (p1, open_id))

    # participant P2 assigned to day 1 only + explicit completed override (2h) → explicit wins = 2h
    cur.execute("""
        INSERT INTO mission_participants (mission_id, full_name, participant_type, branch_id, return_status)
        VALUES (%s,'TEST_OPEN_P2','volunteer',19,'تم انتهاء مهمتة') RETURNING participant_id
    """, (open_id,))
    p2 = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,'اليوم الأول')", (p2, open_id))
    cur.execute("INSERT INTO mission_participant_sessions (participant_id, mission_id, session_date, check_in_time, check_out_time, notes) VALUES (%s,%s,CURRENT_DATE,'10:00','12:00','override-test')", (p2, open_id))

    conn.commit()
    print("\nTest data inserted: open mission %s (P1=%s, P2=%s)" % (open_id, p1, p2))

    # ── Run HR query (robust extraction like run_verify_hr.py) ──
    idx = src.index("WITH ident AS (")
    open_tri = src.rfind('cursor.execute("""', 0, idx)
    hr_start = open_tri + len('cursor.execute("""')
    import re as _re
    m = _re.search(r'\n\s+"""\)', src[hr_start:])
    if not m:
        raise SystemExit("HR closing not found")
    hr = src[hr_start:hr_start + m.start() + 1]
    hr = hr[hr.index('WITH ident AS'):]
    cur.execute(hr)
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]
    idx = {c: i for i, c in enumerate(cols)}
    for r in rows:
        if r[idx['full_name']] and 'TEST_' in r[idx['full_name']]:
            print(f"HR {r[idx['full_name']]}: hours={r[idx['total_hours']]} missions={r[idx['missions_count']]} active={r[idx['active_mission']]}")

    # findings
    p1row = next((r for r in rows if r[idx['full_name']] == 'TEST_OPEN_P1'), None)
    p2row = next((r for r in rows if r[idx['full_name']] == 'TEST_OPEN_P2'), None)
    p1_exp = 14  # inherited: day1 6h + day2 8h
    p2_exp = 2   # explicit override

    print(f"\n[{'OK' if p1row and float(p1row[idx['total_hours']]) == p1_exp else 'FAIL'}] P1 inherited hours: {p1row[idx['total_hours']] if p1row else '??'} (expected {p1_exp})")
    print(f"[{'OK' if p2row and float(p2row[idx['total_hours']]) == p2_exp else 'FAIL'}] P2 override hours: {p2row[idx['total_hours']] if p2row else '??'} (expected {p2_exp})")

    # ── Test committed status rule at save: P1 manually ended via return_status?  ──
    # verify radar-release: P1 return_status should be مازال until ended.
    cur.execute("SELECT return_status FROM mission_participants WHERE participant_id = %s", (p1,))
    print(f"[{'OK' if cur.fetchone()[0] == 'مازال بالمهمة' else 'FAIL'}] P1 still active (radar-blocked)")

finally:
    # حذف كل صفوف الاختبار بالكود (سحوب آمن، يعمل حتى لو فشل insert)
    try:
        cur.execute("DELETE FROM missions WHERE mission_code LIKE 'TEST-OPEN-%'")
        cur.execute("DELETE FROM mission_participants WHERE full_name LIKE 'TEST_OPEN_%'")
        cur.execute("DELETE FROM mission_participant_itineraries WHERE mission_id IN (SELECT mission_id FROM missions WHERE mission_code LIKE 'TEST-OPEN-%')")
        conn.commit()
    except Exception as e:
        conn.rollback(); print("cleanup warn:", e)
    conn.close()
    print("\nCleanup done.")

# ─────────────────────────────────────────────────────────────
# 3) Normal-mission override + HR cumulative across missions
# ─────────────────────────────────────────────────────────────
conn = psycopg.connect(DB)
cur = conn.cursor()
try:
    # cleanup leftovers for this identity
    cur.execute("DELETE FROM mission_participant_sessions WHERE participant_id IN (SELECT participant_id FROM mission_participants WHERE full_name LIKE 'TEST_CUM_%')")
    cur.execute("DELETE FROM mission_participant_itineraries WHERE participant_id IN (SELECT participant_id FROM mission_participants WHERE full_name LIKE 'TEST_CUM_%')")
    cur.execute("DELETE FROM mission_participants WHERE full_name LIKE 'TEST_CUM_%'")
    cur.execute("DELETE FROM missions WHERE mission_code LIKE 'TEST-CUM-%'")
    conn.commit()

    # Normal mission: spans 10:00 -> 18:00 (8h), 2 participants
    cur.execute("""
        INSERT INTO missions (mission_code, mission_name, mission_classification, branch_id, status, departure_date, departure_time, arrival_date, arrival_time, completion_date, completion_time)
        VALUES ('TEST-CUM-1', 'TEST_NORMAL', 'عادية', 19, 'Completed', CURRENT_DATE, '10:00', CURRENT_DATE, '18:00', CURRENT_DATE, '18:00')
        RETURNING mission_id
    """)
    n_id = cur.fetchone()[0]
    for nm in ('TEST_CUM_A', 'TEST_CUM_B'):
        cur.execute("INSERT INTO mission_participants (mission_id, full_name, participant_type, branch_id, return_status) VALUES (%s,%s,'volunteer',19,'تم انتهاء مهمتة')", (n_id, nm))
    # A gets early-leave override 10:00->12:00 (2h)
    cur.execute("SELECT participant_id FROM mission_participants WHERE mission_id=%s AND full_name='TEST_CUM_A'", (n_id,))
    nA = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_participant_sessions (participant_id, mission_id, session_date, check_in_time, check_out_time, notes) VALUES (%s,%s,CURRENT_DATE,'10:00','12:00','early-leave')", (nA, n_id))
    conn.commit()

    # Open mission: same person TEST_CUM_A assigned 1 day (6h) → cumulative = 2 + 6 = 8h
    cur.execute("""
        INSERT INTO missions (mission_code, mission_name, mission_classification, branch_id, status, exit_date, departure_date, arrival_date, completion_date)
        VALUES ('TEST-CUM-2', 'TEST_OPEN2', 'مفتوحة', 19, 'Active', CURRENT_DATE, CURRENT_DATE, CURRENT_DATE, CURRENT_DATE)
        RETURNING mission_id
    """)
    o_id = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_itineraries (mission_id, group_title, route_to, departure_time, arrival_time) VALUES (%s,'اليوم الأول','A','08:00','14:00')", (o_id,))
    cur.execute("INSERT INTO mission_participants (mission_id, full_name, participant_type, branch_id, return_status) VALUES (%s,'TEST_CUM_A','volunteer',19,'مازال بالمهمة') RETURNING participant_id", (o_id,))
    oA = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,'اليوم الأول')", (oA, o_id))
    conn.commit()

    cur.execute(hr)
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]
    idx = {c: i for i, c in enumerate(cols)}
    for r in rows:
        if r[idx['full_name']] and 'TEST_CUM_' in r[idx['full_name']]:
            print(f"HR {r[idx['full_name']]}: hours={r[idx['total_hours']]} missions={r[idx['missions_count']]} active={r[idx['active_mission']]}")

    arow = next((r for r in rows if r[idx['full_name']] == 'TEST_CUM_A'), None)
    brow = next((r for r in rows if r[idx['full_name']] == 'TEST_CUM_B'), None)
    # A: normal override 2h + open inherited 6h = 8h cumulative
    cum_ok = arow and float(arow[idx['total_hours']]) == 8.0
    print(f"[{'OK' if cum_ok else 'FAIL'}] A cumulative across missions (normal 2h + open 6h): {arow[idx['total_hours']] if arow else '??'} (expected 8)")
    # B: no override → normal mission duration 8h
    b_ok = brow and float(brow[idx['total_hours']]) == 8.0
    print(f"[{'OK' if b_ok else 'FAIL'}] B normal mission duration: {brow[idx['total_hours']] if brow else '??'} (expected 8)")
    # open mission A active
    print(f"[{'OK' if arow and arow[idx['active_mission']] else 'FAIL'}] A active in open mission")

finally:
    cur.execute("DELETE FROM mission_participant_sessions WHERE participant_id IN (SELECT participant_id FROM mission_participants WHERE full_name LIKE 'TEST_CUM_%')")
    cur.execute("DELETE FROM mission_participant_itineraries WHERE participant_id IN (SELECT participant_id FROM mission_participants WHERE full_name LIKE 'TEST_CUM_%')")
    cur.execute("DELETE FROM mission_participants WHERE full_name LIKE 'TEST_CUM_%'")
    cur.execute("DELETE FROM missions WHERE mission_code LIKE 'TEST-CUM-%'")
    conn.commit()
    conn.close()

print("\n=========== SUMMARY ===========")
print(f"Status-logic failures: {fail}")