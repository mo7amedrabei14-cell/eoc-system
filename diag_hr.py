# -*- coding: utf-8 -*-
"""Diagnostic: why does HR 'last mission hours' differ from the form's participant counter?
Reproduces the HR SQL's explicit_hours / default_mix logic vs compute_working_hours."""
import sys, datetime as dt
sys.path.insert(0, r"C:\Users\mo7am\OneDrive\Work\EOC System")
from db import get_connection
import main as M
from main import assigned_span

conn = get_connection()
try:
    with conn.cursor() as cur:
        # Missions having itinerary groups with >=2 distinct departure dates (multi-day signature)
        cur.execute("""
            SELECT DISTINCT mi.mission_id, m.mission_name, m.status, m.created_at,
                   (SELECT COUNT(*) FROM mission_itineraries x WHERE x.mission_id = mi.mission_id) AS itin_count,
                   (SELECT COUNT(DISTINCT x.departure_date) FROM mission_itineraries x WHERE x.mission_id = mi.mission_id) AS days
            FROM mission_itineraries mi
            JOIN missions m ON m.mission_id = mi.mission_id
            WHERE mi.departure_date IS NOT NULL
              AND m.status NOT IN ('Cancelled','Draft','Returned')
            ORDER BY m.created_at DESC
            LIMIT 30
        """)
        missions = cur.fetchall()
        print(f"Multi-day missions found: {len(missions)}")
        for mid, name, status, created, itin_count, days in missions:
            print(f"  mission #{mid} status={status} itins={itin_count} days={days} created={created} name={name[:40]!r}")
except Exception as e:
    print("ERR", e)
    sys.exit(1)
conn.close()