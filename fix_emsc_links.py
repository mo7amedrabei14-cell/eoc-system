# fix_emsc_links.py — تعبئة روابط تفاصيل EMSC لكل الرصود القديمة (unid موجود أصلاً)
from db import get_connection
from psycopg.types.json import Jsonb

conn = get_connection()
cur = conn.cursor()
cur.execute("""
    SELECT eq_intel_id, external_id
    FROM earthquake_intel
    WHERE source = 'emsc'
      AND external_id LIKE 'emsc-%';
""")
rows = cur.fetchall()

n = 0
for eq_id, ext in rows:
    unid = str(ext)[5:]  # شيل السابقة emsc-
    if not unid:
        continue
    url = f"https://www.seismicportal.eu/eventdetails.html?unid={unid}"
    cur.execute("""
        UPDATE earthquake_intel
        SET raw = jsonb_set(COALESCE(raw, '{}'::jsonb), '{detail_url}', %s)
        WHERE eq_intel_id = %s;
    """, (Jsonb(url), eq_id))
    n += 1

conn.commit()
print(f"✅ تم تعبئة روابط التفاصيل لعدد {n} رصد من EMSC")
input("اضغط Enter للإغلاق...")
