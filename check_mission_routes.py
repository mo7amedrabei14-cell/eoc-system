import os, psycopg
from dotenv import load_dotenv
load_dotenv()
code = input("اكتب كود المهمة : ").strip()
conn = psycopg.connect(os.environ["DATABASE_URL"])
with conn.cursor() as cur:
    cur.execute("SELECT mission_id FROM missions WHERE mission_code = %s", (code,))
    row = cur.fetchone()
    if not row:
        print("❌ مفيش مهمة بالكود ده — اتأكد من الكود")
        input("اضغط Enter للإغلاق...")
        raise SystemExit
    mid = row[0]
    print(f"✅ mission_id = {mid}")
    cur.execute("""SELECT itinerary_id, group_title, route_from, route_to,
                          departure_date, departure_time, arrival_date, arrival_time
                   FROM mission_itineraries WHERE mission_id = %s ORDER BY itinerary_id""", (mid,))
    rows = cur.fetchall()
    if not rows:
        print("❌ القاعدة فاضية — الخط سير عمره ما اتحفظ (مشكلة إرسال)")
    else:
        print(f"✅ القاعدة فيها {len(rows)} صف — المشكلة في العرض عند الجوكر")
        for r in rows: print(r)
input("اضغط Enter للإغلاق...")
