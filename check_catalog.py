# check_catalog.py — فحص سريع للكتالوج — شغّله: python check_catalog.py
from db import get_connection

conn = get_connection()
cur = conn.cursor()

cur.execute("SELECT COUNT(*) FROM earthquake_catalog;")
print("العدد الكلي =", cur.fetchone()[0])

cur.execute("SELECT region_id, COUNT(*) FROM earthquake_catalog GROUP BY region_id ORDER BY 2 DESC;")
for rid, cnt in cur.fetchall():
    print(f"  {rid}: {cnt}")

cur.execute("SELECT MIN(occurred_at), MAX(occurred_at) FROM earthquake_catalog;")
mn, mx = cur.fetchone()
print("التغطية من", mn, "إلى", mx)

conn.close()
input("\nاضغط Enter للإغلاق...")
