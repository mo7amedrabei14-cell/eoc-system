import traceback
from db import get_connection

SQL = """
SELECT eq_intel_id, source, external_id, occurred_at, magnitude,
       depth_km, place, latitude, longitude, distance_km,
       sound_alert, created_at, hist_max_mag, hist_window_count, hist_scanned_at,
       COALESCE(
           CASE WHEN source = 'usgs' AND external_id <> ''
                THEN 'https://earthquake.usgs.gov/earthquakes/eventpage/' || external_id END,
           CASE WHEN source = 'emsc' AND external_id LIKE 'emsc-%'
                THEN 'https://www.seismicportal.eu/eventdetails.html?unid=' || substring(external_id from 6) END,
           CASE WHEN source = 'emsc' THEN raw->>'detail_url' END
       ) AS detail_url
FROM earthquake_intel
ORDER BY occurred_at DESC NULLS LAST, eq_intel_id DESC
LIMIT %s;
"""

conn = None
try:
    conn = get_connection()
    with conn.cursor() as cur:
        cur.execute(SQL, (500,))
        rows = cur.fetchall()
        print("عدد الصفوف:", len(rows))
        for row in rows[:3]:
            print(f"id={row[0]} | {row[1]} | قوة {row[4]} | {row[6]} | رابط: {row[15]}")
except Exception:
    traceback.print_exc()
finally:
    if conn:
        conn.close()

input("اضغط Enter للإغلاق...")
