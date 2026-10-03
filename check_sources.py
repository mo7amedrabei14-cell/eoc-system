from db import get_connection
conn = get_connection()
cur = conn.cursor()
cur.execute("SELECT source, COUNT(*) FROM earthquake_intel GROUP BY source;")
for s, c in cur.fetchall():
    print(f"{s}: {c}")
input("اضغط Enter للإغلاق...")
