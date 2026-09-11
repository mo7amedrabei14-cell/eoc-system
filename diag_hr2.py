# -*- coding: utf-8 -*-
"""Diagnostic step 2: broad-looking missions + dump one candidate deeply."""
import sys, datetime as dt
sys.path.insert(0, r"C:\Users\mo7am\OneDrive\Work\EOC System")
from db import get_connection
from main import assigned_span, compute_working_hours

conn = get_connection()
try:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT m.mission_id, m.mission_name, m.status, m.departure_date, m.arrival_date,
                   m.departure_time, m.arrival_time, m.created_at,
                   (SELECT COUNT(*) FROM mission_itineraries x WHERE x.mission_id = m.mission_id) AS itin_count
            FROM missions m
            WHERE m.status NOT IN ('Cancelled','Draft','Returned')
              AND (m.departure_date IS NOT NULL OR m.arrival_date IS NOT NULL)
            ORDER BY m.created_at DESC
            LIMIT 25
        """)
        rows = cur.fetchall()
        print(f"missions with dates: {len(rows)}")
        for r in rows:
            span = ''
            if r[3] and r[4]:
                d0 = r[3]; d1 = r[4]
                span = f"{(d1-d0).days}d"
            print(f"  #{r[0]} status={r[2]} dep={r[3]} arr={r[4]} span={span} itins={r[8]} created={r[7][:19]} :: {(r[1] or '')[:38]!r}")
finally:
    conn.close()