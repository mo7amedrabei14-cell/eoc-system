BEGIN;

ALTER TABLE mission_participants
    ALTER COLUMN branch_id DROP NOT NULL;

UPDATE mission_participants
SET branch_id = NULL,
    participation_role = '',
    membership_number = ''
WHERE participant_type = 'non_volunteer'
  AND (branch_id IS NOT NULL
       OR COALESCE(participation_role, '') <> ''
       OR COALESCE(membership_number, '') <> '');

COMMIT;
