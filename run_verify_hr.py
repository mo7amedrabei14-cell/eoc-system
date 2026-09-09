import os
import datetime
import psycopg
from dotenv import load_dotenv
load_dotenv(r"C:\Users\mo7am\OneDrive\Work\EOC System\.env")

# 🆕 (b) سقف القطاع المغلق في مهمة مكتملة — bug-fix D1 الصريح الذي لم يكن مقدَّراً سابقاً:
#   قطاع 09:00→19:00 في مهمة تنتهي 18:00 ⇒ 9س (لا 10س) — محرك Python AND استعلام HR الحقيقي.
import main as M
from db import get_connection

src = open(r"C:\Users\mo7am\OneDrive\Work\EOC System\main.py", encoding="utf-8").read()

# Locate the HR query: it starts right before 'WITH ident AS ('
idx = src.index("WITH ident AS (")
open_tri = src.rfind('cursor.execute("""', 0, idx)
start = open_tri + len('cursor.execute("""')
# closing triple-quote: the next '\n            """)' (Python close) after start
end_marker = '\n            """)' if '\n            """)' in src[start:] else '""")'
end = src.index('"")', start) + 2 if '"")' in src[start:] else start
# find the closing triple quote more robustly: search for the pattern """ on its own line,
# followed (on the same line) by either ')' or ', (now_ref ...' — the actual close is
#   """, (now_ref, now_ref, now_ref))
import re
m = re.search(r'\n\s+"""(?=[,\)]|,\(now_ref)', src[start:])
if not m:
    raise SystemExit("closing not found")
end = start + m.start() + 1  # include just before the triple quote
sql = src[start:end]

# keep only the executed SQL body: it begins with '\n                WITH'
s2 = sql[sql.index('WITH ident AS'):]

# The live-hours 'now' placeholders (COALESCE(%s::timestamp, LOCALTIMESTAMP)) are bound
# with params at run time; execute them here standalone as NULL → LOCALTIMESTAMP.
s2 = s2.replace('%s::timestamp', 'NULL::timestamp')

conn = get_connection()
cur = conn.cursor()
cur.execute(s2)
rows = cur.fetchall()
cols = [d[0] for d in cur.description]
ci = {c: i for i, c in enumerate(cols)}
print("COLUMNS:", cols)
print("=" * 70)
for r in rows:
    print(r)

# ═══════════════════════════════════════════════════════════════════════
# 🆕 (b) سقف القطاع المغلق في مهمة مكتملة = 9س لا 10س
# ═══════════════════════════════════════════════════════════════════════
print("=" * 70)
print("(b) closed-segment cap — Python engine AND HR SQL")
tag = "TESTHR-CAP-" + datetime.datetime.now().strftime('%H%M%S%f')
past = datetime.date.today() - datetime.timedelta(days=3)
ok = 0
try:
    cur.execute("""
        INSERT INTO missions (mission_code, mission_name, mission_classification, branch_id, status, created_at,
                              departure_date, departure_time, completion_date, completion_time)
        VALUES (%s, 'TESTHR_CAP', 'عادية', 19, 'Completed', NOW(), %s, '08:00', %s, '18:00')
        RETURNING mission_id
    """, (tag, past, past))
    mid = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_participants (mission_id, full_name, participant_type, branch_id, return_status, membership_number) VALUES (%s,%s,'volunteer',19,'تم انتهاء مهمتة',%s) RETURNING participant_id",
                (mid, 'TESTHR_CAP', tag))
    pid = cur.fetchone()[0]
    cur.execute("""INSERT INTO mission_participant_sessions (participant_id, mission_id, start_dt, end_dt)
                   VALUES (%s,%s, %s, %s)""",
                (pid, mid, f"{past} 09:00:00", f"{past} 19:00:00"))
    conn.commit()

    # Python: القطاع يُقصّ إلى نهاية المهمة 18:00 ⇒ 09:00→18:00 = 9س
    seg = [{"start_dt": f"{past} 09:00:00", "end_dt": f"{past} 19:00:00"}]
    md = {"departure_date": str(past), "departure_time": "08:00",
          "completion_date": str(past), "completion_time": "18:00",
          "created_at": f"{past} 08:00:00"}
    py = M.compute_working_hours(md, "Completed", seg, [], [], start_from_mission=True)
    good_py = abs(py - 9.0) < 1e-9
    if good_py: ok += 1
    print(f"  [{'OK' if good_py else 'FAIL'}] Python closed-cap = 9h (got {py})")

    # HR الحقيقي: نفس الصف عبر الاستعلام الكامل — explicit_hours يقصّ LEAST(end_dt, mission_end_ts)
    cur.execute(s2)
    hr_rows = cur.fetchall()
    rec = None
    for r in hr_rows:
        if r[ci['full_name']] == 'TESTHR_CAP':
            rec = r
            break
    if rec is None:
        print("  [FAIL] HR row missing for TESTHR_CAP")
    else:
        hh = float(rec[ci['total_hours']])
        good_hr = abs(hh - 9.0) < 1e-9
        if good_hr: ok += 1
        print(f"  [{'OK' if good_hr else 'FAIL'}] HR SQL closed-cap total = 9h (got {hh}); "
              f"last_mission_hours={rec[ci['last_mission_hours']]}")
except Exception as e:
    conn.rollback()
    print("  [FAIL] scenario crashed:", e)
finally:
    try:
        cur.execute("DELETE FROM mission_participant_sessions WHERE participant_id=%s", (pid,))
        cur.execute("DELETE FROM mission_participants WHERE participant_id=%s", (pid,))
        cur.execute("DELETE FROM mission_itineraries WHERE mission_id=%s", (mid,))
        cur.execute("DELETE FROM missions WHERE mission_id=%s", (mid,))
        conn.commit()
    except Exception:
        conn.rollback()
print(f"\n(b) result: {ok}/2 passed")
conn.close()
import sys
sys.exit(0 if ok == 2 else 1)
