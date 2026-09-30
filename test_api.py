import os

import requests

# 🔒 لا توكنات مكتوبة في الكود: التوكن يُقرأ من البيئة فقط (توكن هنا كان يبقى في
#    تاريخ المستودع بعد انتهاء صلاحيته، وهو تسريب دائم لا داعي له).
#    الاستخدام:  EOC_TOKEN="<توكن من /token>" python test_api.py
token = (os.environ.get("EOC_TOKEN") or "").strip()
if not token:
    raise SystemExit(
        "مطلوب متغير البيئة EOC_TOKEN — احصل على توكن من POST /token ثم شغّل:\n"
        "  EOC_TOKEN=ey... python test_api.py"
    )
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