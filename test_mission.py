import sys
sys.path.insert(0, 'C:/Users/mo7am/OneDrive/Work/EOC System')
import requests
from db import get_connection
from auth import create_access_token
import json

# Get owner user and create token
conn = get_connection()
try:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT u.user_id 
            FROM users u 
            JOIN user_roles ur ON ur.user_id = u.user_id 
            JOIN roles r ON r.role_id = ur.role_id 
            WHERE UPPER(r.role_name) = 'OWNER' AND u.is_active = true 
            ORDER BY u.user_id LIMIT 1
        """)
        row = cur.fetchone()
        if row:
            user_id = row[0]
            token = create_access_token(user_id)
            print(f"Got token for user {user_id}")
            
            # Test API access
            API = 'http://127.0.0.1:8000'
            headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
            
            # Create mission with all required fields
            mission_data = {
                "mission_name": "Test Mission for QA",
                "mission_classification": "عادية",
                "branch_id": 6,
                "mission_type": "",
                "mission_location": "",
                "responsible_person": "",
                "data_source": "",
                "status": "Draft",
                "departure_date": "2026-09-20",
                "departure_time": "08:00",
                "arrival_date": "2026-09-20",
                "arrival_time": "18:00",
                "exit_date": "2026-09-20",
                "completion_date": "2026-09-20",
                "start_time": "08:00",
                "completion_time": "18:00",
                "notes": "Test mission for QA purposes",
                "eoc_staff": [
                    {"role_name": "مسؤول المتابعة", "staff_name": "متتبع"},
                    {"role_name": "المشرف", "staff_name": "مشرف"},
                    {"role_name": "الجوكر", "staff_name": "جوكر"},
                    {"role_name": "معبئ الاستمارة", "staff_name": "معبئ"}
                ],
                "participants": [
                    {
                        "participant_type": "volunteer",
                        "full_name": "مشارك اختبار",
                        "participation_role": "",
                        "participant_position": "ميداني",
                        "branch_id": 6,
                        "assigned_itinerary": "",
                        "return_status": "مازال بالمهمة",
                        "phase_name": "اليوم الأول",
                        "stay_type": "ذهاب وعودة",
                        "assigned_days": [],
                        "start_from_mission": True
                    }
                ]
            }
            
            print("Creating mission...")
            response = requests.post(f'{API}/api/missions', headers=headers, json=mission_data)
            print(f"Status: {response.status_code}")
            
            if response.status_code == 200 or response.status_code == 201:
                try:
                    response_data = response.json()
                    mission_id = response_data.get("mission_id")
                    print(f"Mission created successfully with ID: {mission_id}")
                    print(f"Response: {json.dumps(response_data, ensure_ascii=False, indent=2)}")
                except Exception as e:
                    print(f"Could not parse JSON response: {e}")
                    print(f"Raw response: {response.content}")
            else:
                print(f"Failed to create mission: {response.text}")
        else:
            print("No owner user found")
finally:
    conn.close()
