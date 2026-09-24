-- ============================================================================
-- Migration: field_operation_status as a real, persistent column on missions
-- Purpose (root-cause fix for "Field Operation Status resets to Active"):
--   The value used to live ONLY as a text marker "[حالة الميدان: …]" at the top
--   of missions.notes and was re-derived by parsing on every load. Any submit
--   that read the UI select before hydration rewrote the marker to "نشطة",
--   silently reverting "مكتملة" back to Active. This migration makes the value
--   a first-class column — the single source of truth that UI parsing can no
--   longer clobber.
-- Idempotent: safe to run multiple times.
-- ============================================================================

-- 1) Column + index (idempotent)
ALTER TABLE public.missions
    ADD COLUMN IF NOT EXISTS field_operation_status VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_missions_field_operation_status
    ON public.missions (field_operation_status);

-- 2) Backfill from the legacy "[حالة الميدان: …]" marker in notes,
--    keeping whatever the marker said (مكتملة → مكتملة, everything else → نشطة).
--    Rows with no marker (never touched) default to 'نشطة'.
UPDATE public.missions
SET field_operation_status = CASE
        WHEN notes ~ '\[حالة الميدان:\s*مكتملة\]' THEN 'مكتملة'
        WHEN notes ~ '\[حالة الميدان:' THEN 'نشطة'
        ELSE 'نشطة'
    END
WHERE field_operation_status IS NULL;

-- 3) Guard: rows must always carry an explicit value ('نشطة' or 'مكتملة').
ALTER TABLE public.missions
    DROP CONSTRAINT IF EXISTS missions_field_operation_status_check;
ALTER TABLE public.missions
    ADD CONSTRAINT missions_field_operation_status_check
    CHECK (field_operation_status IN ('نشطة', 'مكتملة'));

-- 4) Trigger: keep the value stable unless explicitly written.
--    - INSERT with NULL/''  → default 'نشطة'
--    - UPDATE that leaves it NULL/'' → keep the previously stored value
--      (this is the database-level guarantee: no caller can wipe it to NULL).
CREATE OR REPLACE FUNCTION missions_field_operation_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.field_operation_status IS NULL OR NEW.field_operation_status = '' THEN
        IF TG_OP = 'INSERT' THEN
            NEW.field_operation_status := 'نشطة';
        ELSE
            NEW.field_operation_status := COALESCE(OLD.field_operation_status, 'نشطة');
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_missions_field_operation_status_guard ON public.missions;
CREATE TRIGGER trg_missions_field_operation_status_guard
    BEFORE INSERT OR UPDATE OF field_operation_status ON public.missions
    FOR EACH ROW
    EXECUTE FUNCTION missions_field_operation_status_guard();

-- 5) Legacy marker repair (backward compatibility for old clients that still
--    render the status from the notes marker): if the mission is Completed and
--    the marker is missing, re-add it; if it is not Completed but the marker
--    says مكتملة, drop it. Run manually if old clients must keep reading notes.
-- UPDATE public.missions
-- SET notes = CASE
--         WHEN status IN ('Completed', 'مكتملة')
--              AND (notes IS NULL OR notes NOT LIKE '[حالة الميدان:%')
--             THEN '[حالة الميدان: مكتملة]' || COALESCE(E'\n' || notes, '')
--         WHEN status NOT IN ('Completed', 'مكتملة')
--              AND notes LIKE '[حالة الميدان: مكتملة]%'
--             THEN substr(notes, length('[حالة الميدان: مكتملة]') + 1)
--         ELSE notes
--     END;
