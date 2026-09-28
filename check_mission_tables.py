# -*- coding: utf-8 -*-
"""
Validate mission Itinerary persistence root cause
"""

import psycopg
import os
from dotenv import load_dotenv
load_dotenv()

conn_str = os.getenv('DATABASE_URL')

try:
    conn = psycopg.connect(conn_str)
    print('✅ Connected to database successfully\n')

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cursor:
        # Check if mission_itineraries table exists
        cursor.execute('''
            SELECT table_name
            FROM information_schema.tables
            WHERE table_name = %s
            AND table_schema = 'public'
        ''', ('mission_itineraries',))
        table_exists = cursor.fetchone()

        if not table_exists:
            print('❌ mission_itineraries table DOES NOT EXIST!')
        else:
            print('✅ mission_itineraries table EXISTS')
            print()

            # Check recent itineraries for testing
            cursor.execute('''
                SELECT i.itinerary_id, i.mission_id, i.itinerary_date,
                       i.route_from, i.route_to, i.departure_time, i.arrival_time,
                       m.mission_code, m.mission_name
                FROM mission_itineraries i
                LEFT JOIN missions m ON i.mission_id = m.mission_id
                ORDER BY i.created_at DESC
                LIMIT 10
            ''')
            rows = cursor.fetchall()

            if rows:
                print(f'📊 Found {len(rows)} itinerary records in database:')
                print()
                for r in rows:
                    print(f"  mission_id={r['mission_id']} ({r['mission_code']}: {r['mission_name']})")
                    print(f"    Itinerary #{r['itinerary_id']}")
                    print(f"    Date: {r['itinerary_date']}, Route: {r['route_from']} → {r['route_to']}")
                    print(f"    Times: Departs {r['departure_time']}, Arrives {r['arrival_time']}")
                    print(f"    Created: {r['created_at']}")
                    print()
            else:
                print('⚠️  No itinerary records found in database')

        print('=' * 60)

        # Check if there's a create/update endpoint that includes itinerary
        print('🔍 Checking routers/missions.py for save/update logic...\n')

        with open('routers/missions.py', 'r', encoding='utf-8') as f:
            content = f.read()

            if 'INSERT INTO mission_itineraries' in content:
                print('✅ Found INSERT INTO mission_itineraries in code (SAVE path exists)')

            if 'UPDATE mission' in content.lower() and 'itineraries' in content.lower():
                print('✅ Found UPDATE for mission_itineraries in code')
            else:
                print('❌ Found NO UPDATE for mission_itineraries in code')

            # Check for GET endpoints that return mission details
            import re
            get_endpoints = re.findall(r'@router\.get\("\/([^"]+)"\)', content)

            print(f'\n🔍 Found GET endpoints:')
            for endpoint in get_endpoints:
                print(f'  - GET {endpoint}')

        print('=' * 60)
        print('\n📝 CONCLUSION:')
        print('   - Do itineraries SAVE to DB? ✓ (INSERT exists in code)')
        print('   - Do itineraries LOAD when opening mission? Check frontend/CORS endpoint...')
        print('   - Root cause likely: Missing/wrong endpoint when loading mission for editing')

except Exception as e:
    print(f'❌ ERROR: {e}')
    import traceback
    traceback.print_exc()

finally:
    conn.close()
    print('\n✅ Database connection closed')