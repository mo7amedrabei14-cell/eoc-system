import sys
sys.path.insert(0, 'C:/Users/mo7am/OneDrive/Work/EOC System')
from db import get_connection
import json

# Get connection and check if mission exists
conn = get_connection()
try:
    with conn.cursor() as cur:
        # Check if our test mission exists
        cur.execute("""
            SELECT mission_id, mission_name, status 
            FROM missions 
            WHERE mission_name = %s
            ORDER BY mission_id DESC 
            LIMIT 1
        """, ("Test Mission for QA",))
        row = cur.fetchone()
        if row:
            print(f"Mission found: ID={row[0]}, Name={row[1]}, Status={row[2]}")
        else:
            print("Test mission not found in database")
            
        # Also check recent missions
        cur.execute("""
            SELECT mission_id, mission_name, status 
            FROM missions 
            ORDER BY mission_id DESC 
            LIMIT 5
        """)
        rows = cur.fetchall()
        print("\nRecent missions:")
        for r in rows:
            print(f"  ID={r[0]}, Name={r[1]}, Status={r[2]}")
finally:
    conn.close()
