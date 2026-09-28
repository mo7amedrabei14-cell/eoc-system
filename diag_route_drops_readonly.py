#!/usr/bin/env python3
"""READ-ONLY: تحليل أحداث الحفظ التي قلّت فيها صفوف خط السير (قبل → بعد)."""
import os
import re
import sys

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from db import get_connection  # noqa: E402

PAT = re.compile(r"خط سير\s*(\d+)\s*→\s*(\d+)")


def main():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT a.audit_id, a.created_at, a.mission_id, a.action, a.entity_id,
                       u.username, a.details->>'action_text'
                FROM audit_logs a
                LEFT JOIN users u ON u.user_id = a.user_id
                WHERE a.entity_type = 'mission'
                ORDER BY a.audit_id ASC
            """)
            events = []
            for aid, created, mid, action, eid, user, text in cur.fetchall():
                m = PAT.search(text or "")
                if not m:
                    continue
                before, after = int(m.group(1)), int(m.group(2))
                events.append((aid, created, mid, action, eid, user, before, after, text))

            drops = [e for e in events if e[7] < e[6]]
            print(f"total save events with counts: {len(events)}")
            print(f"events where routes decreased: {len(drops)}")
            print()
            print("== كل الأحداث التي نقص فيها خط السير ==")
            for e in drops:
                print(f"{e[0]:>7} | {e[1]} | m={e[2]} | {e[3]} | {e[5]} | routes {e[6]}→{e[7]}")
            print()

            wiped = [e for e in drops if e[7] == 0]
            print(f"== صفوف اختفت تمامًا (→0): {len(wiped)} ==")
            for e in wiped[-40:]:
                print(f"{e[0]:>7} | {e[1]} | m={e[2]} | {e[3]} | {e[5]}")
            print()

            # مهام عليها خط سير حاليًا 0 وكان عندها خط سير في الماضي
            cur.execute("SELECT mission_id FROM mission_itineraries GROUP BY mission_id")
            have_now = {r[0] for r in cur.fetchall()}
            hist = {}
            for e in events:
                hist.setdefault(e[2], []).append(e)
            lost_missions = sorted(mid for mid, evs in hist.items()
                                   if mid not in have_now and max(x[6] for x in evs) > 0)
            print(f"== مهام فقدت كل خط سيرها (كان >0 وصار 0 الآن): {len(lost_missions)} ==")
            for mid in lost_missions[-25:]:
                evs = hist[mid]
                print(f"mission={mid}")
                for e in evs[-4:]:
                    print(f"    {e[1]} | {e[3]} | {e[5]} | routes {e[6]}→{e[7]}")
            print()

            # توزيع الإجراءات على الانخفاضات
            cur2 = conn.cursor()
            cur2.execute("SELECT 1")
            from collections import Counter
            print("== توزيع الإجراءات على الأحداث التي فيها انخفاض ==", Counter(e[3] for e in drops))
            print("== توزيع المستخدمين ==", Counter(e[5] for e in drops))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
