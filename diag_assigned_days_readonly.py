#!/usr/bin/env python3
"""READ-ONLY: روابط أيام المشاركين (mission_participant_itineraries) هل فقدت مجموعاتها؟"""
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
            cur.execute("SELECT count(*) FROM mission_participant_itineraries")
            print("إجمالي روابط الأيام:", cur.fetchone()[0])

            # 1) مفاتيح أيام (غير JL) لا يقابلها أي صف خط سير في نفس المهمة = إسناد يتيم
            cur.execute("""
                SELECT count(*) FROM mission_participant_itineraries mpi
                WHERE mpi.itinerary_group NOT LIKE 'JL:%'
                  AND NOT EXISTS (
                      SELECT 1 FROM mission_itineraries mi
                      WHERE mi.mission_id = mpi.mission_id
                        AND mi.group_title = mpi.itinerary_group
                  )
            """)
            print("روابط أيام يتيمة (مجموعتها غير موجودة في خط سير المهمة):", cur.fetchone()[0])

            cur.execute("""
                SELECT mpi.mission_id, count(*) AS orphan_links,
                       (SELECT count(*) FROM mission_itineraries mi WHERE mi.mission_id = mpi.mission_id) AS mission_routes
                FROM mission_participant_itineraries mpi
                WHERE mpi.itinerary_group NOT LIKE 'JL:%'
                  AND NOT EXISTS (
                      SELECT 1 FROM mission_itineraries mi
                      WHERE mi.mission_id = mpi.mission_id
                        AND mi.group_title = mpi.itinerary_group
                  )
                GROUP BY mpi.mission_id
                ORDER BY 2 DESC
                LIMIT 15
            """)
            rows = cur.fetchall()
            print(f"مهام بها إسنادات يتيمة: {len(rows)}")
            for mid, orphan, routes in rows:
                print(f"   mission={mid} روابط يتيمة={orphan} مسارات المهمة الآن={routes}")

            # 2) مهام عندها مشاركون مخفيون (roster_active=false) — مخفيّة بعد حفظ
            cur.execute("SELECT count(*) FROM mission_participants WHERE roster_active = false")
            print("مشاركون مخفيون (roster_active=false):", cur.fetchone()[0])

            # 3) مجموعات خط سير لها إسنادات لكنها بلا عنوان (NULL/'' = legacy)
            cur.execute("""
                SELECT mi.mission_id, mi.itinerary_id, mi.group_title, count(mpi.participant_id)
                FROM mission_itineraries mi
                LEFT JOIN mission_participant_itineraries mpi
                       ON mpi.mission_id = mi.mission_id AND mpi.itinerary_group = mi.group_title
                WHERE mi.group_title IS NULL OR trim(mi.group_title) = ''
                GROUP BY 1,2,3
                ORDER BY 1 DESC LIMIT 10
            """)
            rows = cur.fetchall()
            print("صفوف خط سير بعنوان فارغ/NULL:", len(rows))
            for r in rows:
                print("   ", r)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
