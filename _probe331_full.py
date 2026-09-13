import json, urllib.request
from dotenv import load_dotenv
load_dotenv()
from auth import create_access_token

token = create_access_token(1)
url = "https://eoc-system-b12f.vercel.app/api/missions/331?client_now=2026-09-13T10%3A00"
req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
with urllib.request.urlopen(req, timeout=30) as resp:
    data = json.loads(resp.read().decode("utf-8"))

with open("_mission331.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("saved. participants:", len(data["participants"]))
for p in data["participants"]:
    print(p["participant_id"], repr(p["full_name"]), "wh=", p["working_hours"],
          "start_from_mission=", p["start_from_mission"],
          "assigned_days=", json.dumps(p["assigned_days"], ensure_ascii=False),
          "periods=", len(p["participation_periods"]),
          "branch_id=", p["branch_id"],
          "type=", p["participant_type"])
print("vehicles:", json.dumps(data.get("vehicles"), ensure_ascii=False))
print("beneficiaries:", json.dumps(data.get("beneficiaries"), ensure_ascii=False))
print("eoc_staff:", json.dumps(data.get("eoc_staff"), ensure_ascii=False))