# check_eq_timing.py — من وقع إمتى؟ ووصل إمتى؟ — شغّله: python check_eq_timing.py
from db import get_connection

conn = get_connection()
cur = conn.cursor()
cur.execute("""
    SELECT occurred_at, created_at,
           created_at - occurred_at AS delay,
           magnitude, place
    FROM earthquake_intel
    ORDER BY eq_intel_id DESC
    LIMIT 15;
""")
print(f"{'حصل (وقت الزلزال)':<22}{'وصل النظام':<22}{'التأخير':<10}{'قوة':<6}المكان")
for occ, cre, dly, mag, pl in cur.fetchall():
    print(f"{str(occ):<22}{str(cre):<22}{str(dly):<10}{str(mag):<6}{pl}")

conn.close()
input("\nاضغط Enter للإغلاق...")
