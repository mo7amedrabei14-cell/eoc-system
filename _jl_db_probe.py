"""Probe dev neondb state for the integration test setup (read-only + shows counts)."""
import sys

sys.path.insert(0, r"C:\Users\mo7am\OneDrive\Work\EOC System")
from db import get_connection

conn = get_connection()
try:
    with conn.cursor() as c:
        def table(name):
            c.execute(f"SELECT COUNT(*) FROM {name};")
            return c.fetchone()[0]

        print("missions:", table("missions"))
        print("branches:", table("branches"))
        print("users:", table("users"))
        print("volunteers:", table("volunteers"))
        print("mission_participants:", table("mission_participants"))
        print("mission_participant_sessions:", table("mission_participant_sessions"))
        print("mission_join_leave_entries:", table("mission_join_leave_entries"))

        c.execute("""
            SELECT indexname FROM pg_indexes
            WHERE indexname IN
              ('uq_mp_mission_membership','uq_mp_mission_user','uq_mp_mission_volunteer');
        """)
        print("unique indexes present:", [r[0] for r in c.fetchall()])

        c.execute("SELECT branch_id, branch_name FROM branches WHERE is_active = TRUE ORDER BY branch_id LIMIT 5;")
        print("active branches:", c.fetchall())

        c.execute("SELECT user_id, username, full_name FROM users ORDER BY user_id LIMIT 5;")
        print("users sample:", c.fetchall())

        c.execute("""SELECT user_id, username FROM users ORDER BY user_id LIMIT 1;""")
        r = c.fetchone()
        print("first_user:", r)

        c.execute("""
            SELECT v.volunteer_id, v.membership_number, v.branch_id, b.branch_name
            FROM volunteers v LEFT JOIN branches b ON b.branch_id = v.branch_id
            ORDER BY v.volunteer_id LIMIT 5;
        """)
        print("volunteers sample:", c.fetchall())
finally:
    conn.close()

# jwt availability for minting a token
try:
    import jwt
    print("pyjwt available:", jwt.__version__ if hasattr(jwt, '__version__') else 'yes')
except ImportError as e:
    print("pyjwt MISSING:", e)