"""🔎 قراءة فقط: الأدوار، صلاحيات mission.*، وكم مستخدم لكل دور.
   الغرض: معرفة «الصلاحيات المقصودة» قبل فرض أي بوابة أمنية (بلا أي كتابة)."""
from db import get_connection

c = get_connection()
try:
    with c.cursor() as cur:
        cur.execute("SELECT role_id, role_name FROM roles ORDER BY role_id")
        roles = cur.fetchall()
        print("=== roles ===")
        for r in roles:
            cur.execute("SELECT COUNT(*) FROM user_roles WHERE role_id = %s", (r[0],))
            print(f"  role_id={r[0]:<3} {r[1]:<28} users={cur.fetchone()[0]}")

        print("\n=== permissions ===")
        cur.execute("SELECT permission_id, permission_code FROM permissions ORDER BY permission_id")
        for p in cur.fetchall():
            print(f"  {p[0]:<3} {p[1]}")

        print("\n=== mission.* / users.* grants per role ===")
        cur.execute("""
            SELECT r.role_name, p.permission_code
            FROM role_permissions rp
            JOIN roles r ON r.role_id = rp.role_id
            JOIN permissions p ON p.permission_id = rp.permission_id
            WHERE p.permission_code LIKE 'mission.%' OR p.permission_code LIKE 'users.%'
            ORDER BY r.role_id, p.permission_code
        """)
        for row in cur.fetchall():
            print(f"  {row[0]:<28} {row[1]}")

        print("\n=== users by role name (role column vs user_roles) ===")
        cur.execute("""
            SELECT COALESCE(r.role_name,'(no role)') AS rn, COUNT(*)
            FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.user_id
            LEFT JOIN roles r ON r.role_id = ur.role_id
            GROUP BY 1 ORDER BY 2 DESC
        """)
        for row in cur.fetchall():
            print(f"  {row[0]:<28} {row[1]}")

        print("\n=== role_inheritance ===")
        cur.execute("SELECT child_role_id, parent_role_id FROM role_inheritance ORDER BY 1")
        rows = cur.fetchall()
        print("  ", rows if rows else "(none)")

        print("\n=== rbac summary (has any mission.* grant) ===")
        cur.execute("""
            SELECT DISTINCT r.role_name FROM role_permissions rp
            JOIN roles r ON r.role_id = rp.role_id
            JOIN permissions p ON p.permission_id = rp.permission_id
            WHERE p.permission_code LIKE 'mission.%' ORDER BY 1
        """)
        print("  ", [row[0] for row in cur.fetchall()])
finally:
    c.close()
