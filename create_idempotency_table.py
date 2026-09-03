import psycopg
from psycopg.types.json import Jsonb
import os

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    # fallback to the one in .env
    DATABASE_URL = "postgresql://neondb_owner:npg_9fBljI0GONbX@ep-wispy-star-b2qjtn71.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require"

def create_table():
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            # Check if table exists
            cur.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_schema = 'public'
                    AND table_name = 'idempotency_keys'
                );
            """)
            exists = cur.fetchone()[0]
            if exists:
                # Check if table has the correct schema, if not, alter it
                cur.execute("""
                    SELECT column_name, data_type, is_nullable
                    FROM information_schema.columns
                    WHERE table_name = 'idempotency_keys'
                    ORDER BY ordinal_position
                """)
                columns = cur.fetchall()
                # Expected columns: idempotency_key (varchar), response (jsonb), original_status (int), created_at (timestamptz)
                expected_columns = {
                    'idempotency_key': ('varchar', 'NO'),
                    'response': ('jsonb', 'YES'),  # Made nullable for processing state
                    'original_status': ('integer', 'YES'),  # Made nullable for processing state
                    'created_at': ('timestamp with time zone', 'NO')
                }

                # Check if we need to alter the table
                needs_alter = False
                if len(columns) != len(expected_columns):
                    needs_alter = True
                else:
                    for col in columns:
                        col_name = col[0]
                        data_type = col[1].lower()
                        is_nullable = col[2]
                        if col_name in expected_columns:
                            expected_type, expected_nullable = expected_columns[col_name]
                            if expected_type not in data_type or expected_nullable != is_nullable:
                                needs_alter = True
                                break
                        else:
                            needs_alter = True
                            break

                if needs_alter:
                    print("Table idempotency_keys exists but needs schema update...")
                    # Drop and recreate with correct schema
                    cur.execute("DROP TABLE IF EXISTS idempotency_keys CASCADE")
                    cur.execute("""
                        CREATE TABLE idempotency_keys (
                            idempotency_key VARCHAR(255) PRIMARY KEY,
                            response JSONB,
                            original_status INTEGER,
                            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                        );
                    """)
                    conn.commit()
                    print("Table idempotency_keys recreated with correct schema.")
                else:
                    print("Table idempotency_keys already exists with correct schema.")
                return
            # Create table
            cur.execute("""
                CREATE TABLE idempotency_keys (
                    idempotency_key VARCHAR(255) PRIMARY KEY,
                    response JSONB,
                    original_status INTEGER,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            """)
            conn.commit()
            print("Table idempotency_keys created successfully.")

if __name__ == "__main__":
    create_table()