"""Apply a migration SQL file to the database (idempotent migrations)."""
import sys, os, psycopg
from dotenv import load_dotenv

load_dotenv()

def main(path):
    if not os.path.exists(path):
        print(f"File not found: {path}")
        return 1
    conn = psycopg.connect(os.getenv("DATABASE_URL"))
    sql = open(path, encoding="utf-8").read()
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
        print(f"Applied: {path}")
        return 0
    except Exception as e:
        conn.rollback()
        print(f"FAILED: {e}")
        return 1
    finally:
        conn.close()

if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "migrations/20260907_participation_periods.sql"))
