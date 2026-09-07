BEGIN;

-- ─────────────────────────────────────────────────────────────
-- جداول فترات المشاركة (Participation Periods) — مهمات مفتوحة
-- الجدول mission_participant_sessions موجود مسبقاً (مفرغ).
-- نربطه بالمهمة مباشرة ونضمن سلامة البيانات. الملف Idempotent.
-- ─────────────────────────────────────────────────────────────

-- 1) FK participant → سلامة البيانات (بشرط عدم وجوده)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mps_participant') THEN
        ALTER TABLE mission_participant_sessions
            ADD CONSTRAINT fk_mps_participant
            FOREIGN KEY (participant_id) REFERENCES mission_participants(participant_id) ON DELETE CASCADE;
    END IF;
END $$;

-- 2) عمود mission_id (قد يكون موجوداً مسبقاً)
ALTER TABLE mission_participant_sessions
    ADD COLUMN IF NOT EXISTS mission_id INT;

UPDATE mission_participant_sessions mps
SET mission_id = mp.mission_id
FROM mission_participants mp
WHERE mps.participant_id = mp.participant_id
  AND mps.mission_id IS NULL;

ALTER TABLE mission_participant_sessions
    ALTER COLUMN mission_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mps_mission ON mission_participant_sessions(mission_id);

-- 3) FK mission_id (بشرط عدم وجوده)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mps_mission') THEN
        ALTER TABLE mission_participant_sessions
            ADD CONSTRAINT fk_mps_mission
            FOREIGN KEY (mission_id) REFERENCES missions(mission_id) ON DELETE CASCADE;
    END IF;
END $$;

-- 4) مفتاح فريد يشمل mission_id (حذف القديم إن وُجد، ثم إنشاء الجديد)
ALTER TABLE mission_participant_sessions
    DROP CONSTRAINT IF EXISTS mission_participant_sessions_participant_id_session_date_ch_key;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_mps_mission_participant_date_time') THEN
        ALTER TABLE mission_participant_sessions
            ADD CONSTRAINT uq_mps_mission_participant_date_time
            UNIQUE (mission_id, participant_id, session_date, check_in_time);
    END IF;
END $$;

COMMIT;
