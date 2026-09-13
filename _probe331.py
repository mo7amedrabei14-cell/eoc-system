import json, urllib.request
from dotenv import load_dotenv
load_dotenv()

from auth import create_access_token
from db import get_connection

token = create_access_token(1)  # OWNER mrabea.x

url = "https://eoc-system-b12f.vercel.app/api/missions/331?client_now=2026-09-13T10%3A00"
req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8", "replace")
        print("STATUS:", resp.status)
        print("LEN:", len(body))
        print("FIRST 1200:", body[:1200])
        try:
            data = json.loads(body)
            print("\nKEYS:", list(data.keys()))
            print("\nROUTES:", json.dumps(data.get("routes"), ensure_ascii=False))
            print("\nPARTICIPANTS:")
            for p in data.get("participants", []):
                print(json.dumps(p, ensure_ascii=False)[:500])
            print("\nJOIN_LEAVE:", json.dumps(data.get("join_leave_entries"), ensure_ascii=False))
            print("\nSTATUS FIELD:", data.get("status"))
            print("\nNOTES:", data.get("notes"))
        except Exception as e:
            print("JSON parse error:", e)
except urllib.error.HTTPError as e:
    print("HTTP ERROR:", e.code)
    print(e.read().decode("utf-8", "replace")[:800])
except Exception as e:
    print("ERROR:", repr(e))