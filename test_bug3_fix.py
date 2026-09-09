#!/usr/bin/env python3
"""Regression test for Bug #3: audit log + realtime event timestamps must be Cairo local (UTC+3), not DB UTC."""
import sys
from main import get_connection
from audit import create_audit_log
from realtime import create_realtime_event

conn = get_connection(); conn.autocommit = True; cur = conn.cursor()

# Baseline: DB now() (UTC) vs Cairo local
cur.execute("SELECT now(), (now() AT TIME ZONE 'Africa/Cairo')")
db_utc, cairo = cur.fetchone()
print(f"DB UTC now    : {db_utc}")
print(f"Cairo local now: {cairo}")

# Insert a throwaway audit log row + realtime event via the real functions
res = create_audit_log(cur, user_id=None, action="TEST_FIX_9", entity_type="mission", entity_id=None,
                       details={"action_text": "test"}, realtime=False)
res_rt = create_realtime_event(cur, event_type="mission", action="TEST_FIX_9", actor_user_id=None,
                               mission_id=None, details={"action_text": "test"})
conn.commit()

alog_created = res[1]
revent_created = res_rt[1]
print(f"\naudit_logs.created_at      : {alog_created}")
print(f"realtime_events.created_at : {revent_created}")

# Expect both within ~2 min of Cairo local now
import datetime as dt
delta_a = abs(alog_created - cairo.replace(tzinfo=None))
delta_r = abs(revent_created - cairo.replace(tzinfo=None))

ok = (delta_a.total_seconds() < 120) and (delta_r.total_seconds() < 120)
print(f"\naudit delta from Cairo now : {delta_a.total_seconds():.0f}s")
print(f"rt event delta from Cairo  : {delta_r.total_seconds():.0f}s")

# Also assert they are ~3h ahead of DB UTC (Cairo in DST)
utc_delta_a = (alog_created - db_utc.replace(tzinfo=None)).total_seconds() / 3600
utc_delta_r = (revent_created - db_utc.replace(tzinfo=None)).total_seconds() / 3600
print(f"audit vs DB UTC            : {utc_delta_a:+.1f} h (expect +3)")
print(f"rt event vs DB UTC         : {utc_delta_r:+.1f} h (expect +3)")

# Cleanup throwaway rows
cur.execute("DELETE FROM audit_logs WHERE action = 'TEST_FIX_9'")
cur.execute("DELETE FROM realtime_events WHERE action = 'TEST_FIX_9'")
conn.commit(); cur.close(); conn.close()

if ok and abs(utc_delta_a - 3) < 0.5 and abs(utc_delta_r - 3) < 0.5:
    print("\n✅ ALL PASSED — audit & realtime now record Cairo local time")
    sys.exit(0)
else:
    print("\n❌ FAILED")
    sys.exit(1)