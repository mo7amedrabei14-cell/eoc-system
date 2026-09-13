from dotenv import load_dotenv
load_dotenv()
from db import get_connection

conn = get_connection()
cur = conn.cursor()
cur.execute("""
    SELECT u.user_id, u.username, u.full_name, r.role_name
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN roles r ON r.role_id = ur.role_id
    WHERE u.is_active = TRUE
    ORDER BY r.role_name
    LIMIT 40;
""")
for r in cur.fetchall():
    print(r)
conn.close()