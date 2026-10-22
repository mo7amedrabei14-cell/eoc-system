#!/usr/bin/env python3
"""
One-time cleanup: correct stale return_status for rostered participants with no sessions.

Only participants selected by the explicit eligibility query below are eligible:
- mission is operational (not Draft/Cancelled/Returned/Completed),
- membership number is present,
- return_status is 'مازال بالمهمة',
- no participant sessions exist.

The update is scoped to those selected participant IDs and is committed only after
the resulting statuses have been verified. Run with: python cleanup_stale_return_status.py
"""
from main import get_connection


def main() -> None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT p.participant_id, p.membership_number, p.full_name, p.branch_id,
                       p.return_status, m.mission_id, m.mission_name, m.status
                FROM mission_participants p
                JOIN missions m ON m.mission_id = p.mission_id
                WHERE p.return_status = 'مازال بالمهمة'
                  AND m.status NOT IN ('Draft', 'Cancelled', 'Returned', 'Completed')
                  AND p.membership_number IS NOT NULL
                  AND TRIM(p.membership_number) <> ''
                  AND NOT EXISTS (
                      SELECT 1
                      FROM mission_participant_sessions s
                      WHERE s.participant_id = p.participant_id
                  )
                ORDER BY p.participant_id
                """
            )
            stale = cur.fetchall()
            print(f"Found {len(stale)} participant(s) eligible for cleanup.")

            if not stale:
                print("Nothing to fix.")
                conn.rollback()
                return

            selected_ids = [row[0] for row in stale]
            print("Eligible participants:")
            for row in stale:
                print(
                    f"  pid={row[0]} membership={row[1]!r} name={row[2]!r} "
                    f"branch={row[3]} status={row[4]!r} mission={row[5]}"
                )

            # Critical guard: update only the IDs explicitly selected above.
            # Re-check the status and missing-session conditions to avoid overwriting
            # a participant who changed while this maintenance script was running.
            cur.execute(
                """
                UPDATE mission_participants AS p
                SET return_status = 'في الانتظار'
                WHERE p.participant_id = ANY(%s)
                  AND p.return_status = 'مازال بالمهمة'
                  AND p.membership_number IS NOT NULL
                  AND TRIM(p.membership_number) <> ''
                  AND EXISTS (
                      SELECT 1
                      FROM missions m
                      WHERE m.mission_id = p.mission_id
                        AND m.status NOT IN ('Draft', 'Cancelled', 'Returned', 'Completed')
                  )
                  AND NOT EXISTS (
                      SELECT 1
                      FROM mission_participant_sessions s
                      WHERE s.participant_id = p.participant_id
                  )
                RETURNING p.participant_id
                """,
                (selected_ids,),
            )
            updated_ids = [row[0] for row in cur.fetchall()]

            if updated_ids:
                cur.execute(
                    """
                    SELECT participant_id, membership_number, full_name, return_status
                    FROM mission_participants
                    WHERE participant_id = ANY(%s)
                    ORDER BY participant_id
                    """,
                    (updated_ids,),
                )
                after = cur.fetchall()
                invalid = [row for row in after if row[3] != "في الانتظار"]
                if invalid or len(after) != len(updated_ids):
                    raise RuntimeError(
                        "Post-update verification failed; transaction will be rolled back."
                    )

            conn.commit()
            print(f"\nFixed {len(updated_ids)} participant(s): return_status → 'في الانتظار'.")
            print("\nVerified after update:")
            for row in after if updated_ids else []:
                print(
                    f"  pid={row[0]} membership={row[1]!r} "
                    f"name={row[2]!r} return_status={row[3]!r}"
                )
            if len(updated_ids) < len(selected_ids):
                print(
                    f"Note: {len(selected_ids) - len(updated_ids)} participant(s) "
                    "were not updated, likely because their data changed during the run."
                )
            print("\nDONE.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
