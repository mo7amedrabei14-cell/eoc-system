from db import get_connection

conn = get_connection()
cur = conn.cursor()
cur.execute("""
    SELECT q.eq_intel_id, q.source, q.magnitude, q.place,
           q.created_at AS حفظ_الرصد,
           r.created_at AS حفظ_الإشعار,
           (r.event_id IS NOT NULL) AS فيه_إشعار
    FROM earthquake_intel q
    LEFT JOIN realtime_events r
      ON r.event_type = 'eq_intel' AND r.entity_id = q.eq_intel_id
    ORDER BY q.eq_intel_id DESC
    LIMIT 15;
""")
for r in cur.fetchall():
    print(f"id={r[0]} | {r[1]} | قوة {r[2]} | {r[3][:40] if r[3] else ''}")
    print(f"   الرصد اتسجل: {r[4]}")
    print(f"   الإشعار: {'✅ اتسجل ' + str(r[5]) if r[6] else '❌ مفيش إشعار (مش مستاهل البوابة)'}")
    print("─" * 60)
input("اضغط Enter للإغلاق...")
