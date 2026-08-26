BEGIN;

ALTER TABLE mission_participants
    ADD COLUMN IF NOT EXISTS participant_type VARCHAR(20)
    NOT NULL DEFAULT 'volunteer';

ALTER TABLE mission_participants
    ADD COLUMN IF NOT EXISTS non_volunteer_full_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS non_volunteer_phone VARCHAR(50);

ALTER TABLE mission_participants
    ALTER COLUMN volunteer_id DROP NOT NULL;

ALTER TABLE mission_participants
    DROP CONSTRAINT IF EXISTS mission_participants_type_check;

ALTER TABLE mission_participants
    ADD CONSTRAINT mission_participants_type_check
    CHECK (
        (participant_type = 'volunteer'
            AND volunteer_id IS NOT NULL
            AND non_volunteer_full_name IS NULL
            AND non_volunteer_phone IS NULL)
        OR
        (participant_type = 'non_volunteer'
            AND volunteer_id IS NULL
            AND non_volunteer_full_name IS NOT NULL)
    );

DROP INDEX IF EXISTS mission_participants_one_open_attendance;

CREATE UNIQUE INDEX mission_participants_one_open_attendance
    ON mission_participants (mission_id, volunteer_id)
    WHERE participant_type = 'volunteer'
      AND check_out_at IS NULL;

CREATE INDEX IF NOT EXISTS mission_participants_mission_type_index
    ON mission_participants (mission_id, participant_type);

COMMIT;
