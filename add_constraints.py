import os
import psycopg
from db import get_connection

def add_constraints():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            # 1. Ensure missions.mission_code is unique and not null
            try:
                cur.execute("""
                    ALTER TABLE missions
                    ADD CONSTRAINT missions_mission_code_unique UNIQUE (mission_code);
                """)
                print("Added unique constraint on missions.mission_code")
            except psycopg.errors.DuplicateObject:
                print("Unique constraint on missions.mission_code already exists")
            except Exception as e:
                print(f"Error adding unique constraint on missions.mission_code: {e}")

            # 2. Ensure missions.mission_code is not null
            try:
                cur.execute("""
                    ALTER TABLE missions
                    ALTER COLUMN mission_code SET NOT NULL;
                """)
                print("Set missions.mission_code to NOT NULL")
            except Exception as e:
                print(f"Error setting missions.mission_code NOT NULL: {e}")

            # 3. Ensure local_news.news_link is unique and not null
            try:
                cur.execute("""
                    ALTER TABLE local_news
                    ADD CONSTRAINT local_news_news_link_unique UNIQUE (news_link);
                """)
                print("Added unique constraint on local_news.news_link")
            except psycopg.errors.DuplicateObject:
                print("Unique constraint on local_news.news_link already exists")
            except Exception as e:
                print(f"Error adding unique constraint on local_news.news_link: {e}")

            try:
                cur.execute("""
                    ALTER TABLE local_news
                    ALTER COLUMN news_link SET NOT NULL;
                """)
                print("Set local_news.news_link to NOT NULL")
            except Exception as e:
                print(f"Error setting local_news.news_link NOT NULL: {e}")

            # 4. Ensure global_disasters.news_link is unique and not null
            try:
                cur.execute("""
                    ALTER TABLE global_disasters
                    ADD CONSTRAINT global_disasters_news_link_unique UNIQUE (news_link);
                """)
                print("Added unique constraint on global_disasters.news_link")
            except psycopg.errors.DuplicateObject:
                print("Unique constraint on global_disasters.news_link already exists")
            except Exception as e:
                print(f"Error adding unique constraint on global_disasters.news_link: {e}")

            try:
                cur.execute("""
                    ALTER TABLE global_disasters
                    ALTER COLUMN news_link SET NOT NULL;
                """)
                print("Set global_disasters.news_link to NOT NULL")
            except Exception as e:
                print(f"Error setting global_disasters.news_link NOT NULL: {e}")

            # 5. Ensure ai_news.news_link is unique and not null
            try:
                cur.execute("""
                    ALTER TABLE ai_news
                    ADD CONSTRAINT ai_news_news_link_unique UNIQUE (news_link);
                """)
                print("Added unique constraint on ai_news.news_link")
            except psycopg.errors.DuplicateObject:
                print("Unique constraint on ai_news.news_link already exists")
            except Exception as e:
                print(f"Error adding unique constraint on ai_news.news_link: {e}")

            try:
                cur.execute("""
                    ALTER TABLE ai_news
                    ALTER COLUMN news_link SET NOT NULL;
                """)
                print("Set ai_news.news_link to NOT NULL")
            except Exception as e:
                print(f"Error setting ai_news.news_link NOT NULL: {e}")

            # 6. Add foreign key constraints for mission-related tables
            # mission_itineraries.mission_id -> missions.mission_id
            try:
                cur.execute("""
                    ALTER TABLE mission_itineraries
                    ADD CONSTRAINT mission_itineraries_mission_id_fkey
                    FOREIGN KEY (mission_id) REFERENCES missions(mission_id) ON DELETE CASCADE;
                """)
                print("Added foreign key constraint on mission_itineraries.mission_id")
            except psycopg.errors.DuplicateObject:
                print("Foreign key constraint on mission_itineraries.mission_id already exists")
            except Exception as e:
                print(f"Error adding foreign key constraint on mission_itineraries.mission_id: {e}")

            # mission_vehicles.mission_id -> missions.mission_id
            try:
                cur.execute("""
                    ALTER TABLE mission_vehicles
                    ADD CONSTRAINT mission_vehicles_mission_id_fkey
                    FOREIGN KEY (mission_id) REFERENCES missions(mission_id) ON DELETE CASCADE;
                """)
                print("Added foreign key constraint on mission_vehicles.mission_id")
            except psycopg.errors.DuplicateObject:
                print("Foreign key constraint on mission_vehicles.mission_id already exists")
            except Exception as e:
                print(f"Error adding foreign key constraint on mission_vehicles.mission_id: {e}")

            # mission_participants.mission_id -> missions.mission_id
            try:
                cur.execute("""
                    ALTER TABLE mission_participants
                    ADD CONSTRAINT mission_participants_mission_id_fkey
                    FOREIGN KEY (mission_id) REFERENCES missions(mission_id) ON DELETE CASCADE;
                """)
                print("Added foreign key constraint on mission_participants.mission_id")
            except psycopg.errors.DuplicateObject:
                print("Foreign key constraint on mission_participants.mission_id already exists")
            except Exception as e:
                print(f"Error adding foreign key constraint on mission_participants.mission_id: {e}")

            # mission_beneficiaries.mission_id -> missions.mission_id
            try:
                cur.execute("""
                    ALTER TABLE mission_beneficiaries
                    ADD CONSTRAINT mission_beneficiaries_mission_id_fkey
                    FOREIGN KEY (mission_id) REFERENCES missions(mission_id) ON DELETE CASCADE;
                """)
                print("Added foreign key constraint on mission_beneficiaries.mission_id")
            except psycopg.errors.DuplicateObject:
                print("Foreign key constraint on mission_beneficiaries.mission_id already exists")
            except Exception as e:
                print(f"Error adding foreign key constraint on mission_beneficiaries.mission_id: {e}")

            # mission_eoc_staff.mission_id -> missions.mission_id
            try:
                cur.execute("""
                    ALTER TABLE mission_eoc_staff
                    ADD CONSTRAINT mission_eoc_staff_mission_id_fkey
                    FOREIGN KEY (mission_id) REFERENCES missions(mission_id) ON DELETE CASCADE;
                """)
                print("Added foreign key constraint on mission_eoc_staff.mission_id")
            except psycopg.errors.DuplicateObject:
                print("Foreign key constraint on mission_eoc_staff.mission_id already exists")
            except Exception as e:
                print(f"Error adding foreign key constraint on mission_eoc_staff.mission_id: {e}")

            # 7. Add foreign key constraints for local_news? Not really, but we have branch_id
            # local_news.branch_id -> branches.branch_id
            try:
                cur.execute("""
                    ALTER TABLE local_news
                    ADD CONSTRAINT local_news_branch_id_fkey
                    FOREIGN KEY (branch_id) REFERENCES branches(branch_id);
                """)
                print("Added foreign key constraint on local_news.branch_id")
            except psycopg.errors.DuplicateObject:
                print("Foreign key constraint on local_news.branch_id already exists")
            except Exception as e:
                print(f"Error adding foreign key constraint on local_news.branch_id: {e}")

            # 8. Add foreign key constraints for global_disasters? Not really.

            # 9. Add foreign key constraints for ai_news? Not really.

            # 10. Add foreign key constraints for earthquake tables? They don't have mission_id.

            conn.commit()
            print("All constraints added successfully.")
    except Exception as e:
        print(f"Error during constraint addition: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    add_constraints()