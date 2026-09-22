import requests

token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxNiIsImV4cCI6MTc5MDAyNjAxOH0.Yj9FT8mHOF7tN2MM20xPZal1O30ZdH-aeGpjH8sj8jA"
headers = {"Authorization": f"Bearer {token}"}

print("Testing /api/dashboard/stats:")
try:
    r = requests.get("http://localhost:8000/api/dashboard/stats", headers=headers)
    print(f"Status: {r.status_code}")
    print(f"Response: {r.json()}")
except Exception as e:
    print(f"Error: {e}")

print("\nTesting /api/branches/locations:")
try:
    r = requests.get("http://localhost:8000/api/branches/locations", headers=headers)
    print(f"Status: {r.status_code}")
    print(f"Response: {r.json()}")
except Exception as e:
    print(f"Error: {e}")

print("\nTesting /api/missions:")
try:
    r = requests.get("http://localhost:8000/api/missions", headers=headers)
    print(f"Status: {r.status_code}")
    print(f"Response: {r.json()[:2] if isinstance(r.json(), list) else r.json()}")
except Exception as e:
    print(f"Error: {e}")