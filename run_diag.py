import os
from dotenv import load_dotenv
import psycopg
load_dotenv(r"C:\Users\mo7am\OneDrive\Work\EOC System\.env")
conn = psycopg.connect(os.getenv("DATABASE_URL"))
cur = conn.cursor()

print("=== MISSION COUNT & TIME-DATA COVERAGE ===")
cur.execute("""
  SELECT status,
         COUNT(*) AS missions,
         COUNT(completion_date) AS with_completion,
         COUNT(departure_date) AS with_departure,
         COUNT(departure_time) AS with_dep_time,
         COUNT(start_time) AS with_start_time,
         COUNT(completion_time) AS with_completion_time
  FROM missions
  GROUP BY status ORDER BY status
""")
for row in cur.fetchall():
    print(f"{row[0]:<12} missions={row[1]:<3} comp_date={row[2]:<3} dep_date={row[3]:<3} dep_time={row[4]:<3} start_time={row[5]:<3} comp_time={row[6]:<3}")

print()
print("=== VALID MISSIONS (raw hours formula per mission) ===")
cur.execute("""
  SELECT m.mission_id, m.mission_code, m.status,
         m.completion_date, m.completion_time,
         m.departure_date, m.departure_time, m.start_time,
         ROUND((EXTRACT(EPOCH FROM ((m.completion_date + COALESCE(m.completion_time,'00:00'::time)) -
           (COALESCE(m.departure_date, m.created_at::date) + COALESCE(m.departure_time, m.start_time, '00:00'::time))))/3600.0)::numeric,2) AS hrs
  FROM missions m
  WHERE m.status NOT IN ('Draft','Cancelled','Returned')
  ORDER BY m.mission_id
""")
for r in cur.fetchall():
    print(r)
conn.close()
