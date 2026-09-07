BEGIN;

-- ─────────────────────────────────────────────────────────────
-- جدول تخصيص الأيام للمشارك (Multi-day Assignment) — مهمات مفتوحة
-- "المشارك يرث ساعات اليوم المخصص افتراضياً"، وتخصيص أيام متعددة
-- لِكل مشارك يُحفظ هنا (صف لكل يوم). الملف Idempotent بالكامل.
-- ─────────────────────────────────────────────────────────────

-- 1) الجدول نفسه (إن لم يكن موجوداً)
CREATE TABLE IF NOT EXISTS mission_participant_itineraries (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    participant_id  BIGINT NOT NULL,
    mission_id      INTEGER NOT NULL,
    itinerary_group VARCHAR(150) NOT NULL
);

-- 2) FK participant (بشرط عدم وجوده)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mpi_participant') THEN
        ALTER TABLE mission_participant_itineraries
            ADD CONSTRAINT fk_mpi_participant
            FOREIGN KEY (participant_id) REFERENCES mission_participants(participant_id) ON DELETE CASCADE;
    END IF;
END $$;

-- 3) FK mission (بشرط عدم وجوده)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mpi_mission') THEN
        ALTER TABLE mission_participant_itineraries
            ADD CONSTRAINT fk_mpi_mission
            FOREIGN KEY (mission_id) REFERENCES missions(mission_id) ON DELETE CASCADE;
    END IF;
END $$;

-- 4) فهرس المسح حسب المهمة
CREATE INDEX IF NOT EXISTS idx_mpi_mission ON mission_participant_itineraries(mission_id);

-- 5) منع تكرار نفس اليوم لنفس المشارك في نفس المهمة
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_mpi_participant_group') THEN
        ALTER TABLE mission_participant_itineraries
            ADD CONSTRAINT uq_mpi_participant_group
            UNIQUE (participant_id, itinerary_group);
    END IF;
END $$;

COMMIT;