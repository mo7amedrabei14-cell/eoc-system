import json
from dotenv import load_dotenv
load_dotenv()
from auth import create_access_token, get_user_role, get_effective_permissions, get_user_branches
from db import get_connection

user_id = 1  # OWNER mrabea.x
token = create_access_token(user_id)
role = get_user_role(user_id)
permissions = get_effective_permissions(role["role_id"])

# OWNER: is_global_admin True + all branches
conn = get_connection()
cur = conn.cursor()
cur.execute("SELECT branch_id, branch_name, has_geographic_scope FROM branches WHERE is_active = TRUE ORDER BY branch_id;")
branches = [{"branch_id": r[0], "branch_name": r[1], "has_geographic_scope": r[2]} for r in cur.fetchall()]
cur.execute("SELECT full_name, username FROM users WHERE user_id = %s", (user_id,))
full_name, username = cur.fetchone()
conn.close()

user = {
    "user_id": user_id, "full_name": full_name, "username": username,
    "role": role["role_name"], "permissions": permissions,
    "branches": branches, "is_global_admin": True,
}

seed = {"access_token": token, "user": user}
with open("_seed.json", "w", encoding="utf-8") as f:
    json.dump(seed, f, ensure_ascii=False)
print("seed saved", len(token), len(branches), "branches")