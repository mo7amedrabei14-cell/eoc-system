import os
from dotenv import load_dotenv
import psycopg
load_dotenv(r"C:\Users\mo7am\OneDrive\Work\EOC System\.env")
conn = psycopg.connect(os.getenv("DATABASE_URL"))
cur = conn.cursor()

print("=== participants for each mission ===")
cur.execute("""
  SELECT mp.mission_id, mp.participant_id, mp.participant_type, mp.full_name,
         mp.return_status, mp.phase_name, mp.stay_type
  FROM mission_participants mp ORDER BY mp.mission_id, mp.participant_id
""")
for r in cur.fetchall():
    print(r)

print()
print("=== distinct mission statuses ===")
cur.execute("SELECT DISTINCT status FROM missions")
print(cur.fetchall())

print()
print("=== full mission row 55 (active-ish) ===")
cur.execute("SELECT * FROM missions WHERE mission_id=55")
cols=[d[0] for d in cur.description]
row=cur.fetchone()
for c,v in zip(cols,row):
    print(f"  {c}: {v}")
conn.close()
