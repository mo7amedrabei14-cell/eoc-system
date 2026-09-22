-- 2026-09-21 — Add notes column to mission_participants table
-- For volunteer observation notes

BEGIN;

-- Add notes column to mission_participants table
ALTER TABLE public.mission_participants
    ADD COLUMN IF NOT EXISTS notes TEXT;

COMMIT;