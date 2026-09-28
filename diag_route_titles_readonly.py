#!/usr/bin/env python3
"""READ-ONLY: توزيع group_title في mission_itineraries + محاكاة عرض الواجهة."""
import os
import sys

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from db import get_connection  # noqa: E402


def main():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COALESCE(group_title, '<NULL>') AS gt, count(*),
                       count(DISTINCT mission_id)
                FROM mission_itineraries
                GROUP BY 1 ORDER BY 2 DESC LIMIT 40
            """)
            print("== توزيع group_title ==")
            for gt, n, missions in cur.fetchall():
                print(f"  {gt!r}: rows={n} missions={missions}")
            print()

            cur.execute("""
                SELECT mission_id, count(*) AS total,
                       count(*) FILTER (WHERE group_title = 'خط السير الأساسي') AS basic,
                       count(*) FILTER (WHERE group_title IS DISTINCT FROM 'خط السير الأساسي') AS custom
                FROM mission_itineraries
                GROUP BY mission_id
                HAVING count(*) > 0 AND count(*) FILTER (WHERE group_title = 'خط السير الأساسي') = 0
                ORDER BY mission_id DESC
            """)
            rows = cur.fetchall()
            print(f"== مهام عندها مسارات لكن بلا أي صف «خط السير الأساسي» (تظهر فاضية في الواجهة): {len(rows)} ==")
            for mid, total, basic, custom in rows[:20]:
                print(f"  mission={mid} total={total} custom={custom}")
            print()

            cur.execute("""
                SELECT count(*) FROM mission_itineraries WHERE route_to IS NULL OR route_to = ''
            """)
            print("صفوف بلا route_to:", cur.fetchone()[0])
            cur.execute("""
                SELECT count(*) FROM mission_itineraries
                WHERE COALESCE(route_from,'')='' AND COALESCE(route_to,'')=''
                  AND departure_date IS NULL AND departure_time IS NULL
                  AND arrival_date IS NULL AND arrival_time IS NULL
            """)
            print("صفوف فارغة تمامًا:", cur.fetchone()[0])
            print()

            print("== أمثلة على الصفوف ==")
            cur.execute("""
                SELECT mission_id, COALESCE(group_title,'<NULL>'), route_from, route_to,
                       departure_date, departure_time, arrival_date, arrival_time
                FROM mission_itineraries ORDER BY itinerary_id DESC LIMIT 15
            """)
            for r in cur.fetchall():
                print("  ", r)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
