import os
import psycopg
from db import get_connection

def execute_alter_table(statement, success_msg, error_msg_prefix):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(statement)
            conn.commit()
            print(success_msg)
    except psycopg.errors.DuplicateObject as e:
        # Constraint or index already exists
        print(f"{error_msg_prefix}: already exists")
    except Exception as e:
        print(f"{error_msg_prefix}: {e}")
        conn.rollback()
    finally:
        conn.close()

def add_constraints():
    # 1. missions.mission_code unique and not null
    execute_alter_table(
        """
        ALTER TABLE missions
        ADD CONSTRAINT missions_mission_code_unique UNIQUE (mission_code);
        """,
        "Added unique constraint on missions.mission_code",
        "Error adding unique constraint on missions.mission_code"
    )
    execute_alter_table(
        """
        ALTER TABLE missions
        ALTER COLUMN mission_code SET NOT NULL;
        """,
        "Set missions.mission_code to NOT NULL",
        "Error setting missions.mission_code NOT NULL"
    )

    # 2. local_news.news_link unique and not null
    execute_alter_table(
        """
        ALTER TABLE local_news
        ADD CONSTRAINT local_news_news_link_unique UNIQUE (news_link);
        """,
        "Added unique constraint on local_news.news_link",
        "Error adding unique constraint on local_news.news_link"
    )
    execute_alter_table(
        """
        ALTER TABLE local_news
        ALTER COLUMN news_link SET NOT NULL;
        """,
        "Set local_news.news_link to NOT NULL",
        "Error setting local_news.news_link NOT NULL"
    )

    # 3. global_disasters.news_link unique and not null
    execute_alter_table(
        """
        ALTER TABLE global_disasters
        ADD CONSTRAINT global_disasters_news_link_unique UNIQUE (news_link);
        """,
        "Added unique constraint on global_disasters.news_link",
        "Error adding unique constraint on global_disasters.news_link"
    )
    execute_alter_table(
        """
        ALTER TABLE global_disasters
        ALTER COLUMN news_link SET NOT NULL;
        """,
        "Set global_disasters.news_link to NOT NULL",
        "Error setting global_disasters.news_link NOT NULL"
    )

    # 4. ai_news.news_link unique and not null
    execute_alter_table(
        """
        ALTER TABLE ai_news
        ADD CONSTRAINT ai_news_news_link_unique UNIQUE (news_link);
        """,
        "Added unique constraint on ai_news.news_link",
        "Error adding unique constraint on ai_news.news_link"
    )
    execute_alter_table(
        """
        ALTER TABLE ai_news
        ALTER COLUMN news_link SET NOT NULL;
        """,
        "Set ai_news.news_link to NOT NULL",
        "Error setting ai_news.news_link NOT NULL"
    )

    # 5. Foreign key constraints for mission-related tables
    fk_statements = [
        ("mission_itineraries", "mission_id", "missions", "mission_id"),
        ("mission_vehicles", "mission_id", "missions", "mission_id"),
        ("mission_participants", "mission_id", "missions", "mission_id"),
        ("mission_beneficiaries", "mission_id", "missions", "mission_id"),
        ("mission_eoc_staff", "mission_id", "missions", "mission_id"),
        ("local_news", "branch_id", "branches", "branch_id"),
    ]

    for table, column, ref_table, ref_column in fk_statements:
        constraint_name = f"{table}_{column}_fkey"
        execute_alter_table(
            f"""
            ALTER TABLE {table}
            ADD CONSTRAINT {constraint_name}
            FOREIGN KEY ({column}) REFERENCES {ref_table}({ref_column}) ON DELETE CASCADE;
            """,
            f"Added foreign key constraint on {table}.{column}",
            f"Error adding foreign key constraint on {table}.{column}"
        )

if __name__ == "__main__":
    add_constraints()