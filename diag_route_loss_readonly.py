#!/usr/bin/env python3
"""READ-ONLY تشخيص ضياع خط السير.

لا يكتب أي شيء في القاعدة — استعلامات SELECT فقط.
الهدف: تحديد *متى* و*بأي إجراء* و*من أي مستخدم* انخفض عدد صفوف
mission_itineraries إلى صفر (الملاحظة المسجلة في details).
"""
import os
import sys

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from db import get_connection  # noqa: E402


def q(cur, sql, params=None):
    cur.execute(sql, params or ())
    return cur.fetchall()


def main():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            print("== إجمالي الحالة الحالية ==")
            print("missions:", q(cur, "SELECT count(*) FROM missions")[0][0])
            print("mission_itineraries:", q(cur, "SELECT count(*) FROM mission_itineraries")[0][0])
            print("missions with >=1 route:",
                  q(cur, "SELECT count(DISTINCT mission_id) FROM mission_itineraries")[0][0])
            print()

            print("== أحداث سُجّلت وفيها انخفاض خط السير (خط سير N→M) ==")
            rows = q(cur, """
                SELECT a.audit_id, a.created_at, a.mission_id, a.action,
                       u.username, a.details->>'action_text'
                FROM audit_logs a
                LEFT JOIN users u ON u.user_id = a.user_id
                WHERE a.details->>'action_text' LIKE '%%خط سير%%'
                ORDER BY a.audit_id DESC
                LIMIT 60
            """)
            for r in rows:
                text = r[5] or ""
                flag = ""
                try:
                    seg = text.split("خط سير")[1].split(",")[0].strip()
                    before, after = [int(x) for x in seg.split("→")]
                    if after == 0 and before > 0:
                        flag = "   <<< ⚠️ WIPED"
                    elif after < before:
                        flag = "   <<< نقص"
                except Exception:
                    flag = ""
                print(f"{r[0]:>7} | {r[1]} | mission={r[2]} | {r[3]} | {r[4]}{flag}")
                if flag:
                    print("           ", text)
            print()

            print("== مهام عليها خط سير الآن (آخر 20 إنشاءً) ==")
            rows = q(cur, """
                SELECT m.mission_id, m.mission_code, m.status, m.created_at,
                       (SELECT count(*) FROM mission_itineraries i WHERE i.mission_id = m.mission_id) AS routes,
                       (SELECT count(*) FROM mission_participant_sessions s WHERE s.mission_id = m.mission_id) AS segments
                FROM missions m
                ORDER BY m.mission_id DESC
                LIMIT 20
            """)
            for r in rows:
                print(f"mission={r[0]} code={r[1]} status={r[2]} created={r[3]} routes={r[4]} segments={r[5]}")
            print()

            print("== آخر 30 حدث تعديل على المهام (لرؤية تسلسل الإجراءات) ==")
            rows = q(cur, """
                SELECT a.audit_id, a.created_at, a.mission_id, a.action, u.username,
                       left(coalesce(a.details->>'action_text',''), 160)
                FROM audit_logs a
                LEFT JOIN users u ON u.user_id = a.user_id
                WHERE a.entity_type = 'mission'
                ORDER BY a.audit_id DESC
                LIMIT 30
            """)
            for r in rows:
                print(f"{r[0]:>7} | {r[1]} | m={r[2]} | {r[3]} | {r[4]} | {r[5]}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
