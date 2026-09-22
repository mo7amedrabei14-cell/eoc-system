-- 2026-09-20 — Add Youth Monitoring status and action
-- New status: "مكتملة (تم المراجعة من فريق إدارة الشباب)"
-- Backend endpoint for Youth Monitoring workflow action

BEGIN;

-- Add new status value by allowing it in the status column (no CHECK constraint exists)
-- The status column is VARCHAR(50), so we just need to ensure the backend handles it

-- Create a table to track Youth Monitoring actions (audit trail)
CREATE TABLE IF NOT EXISTS public.mission_youth_monitoring (
    id BIGSERIAL PRIMARY KEY,
    mission_id INTEGER NOT NULL REFERENCES public.missions(mission_id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES public.users(user_id),
    action_text TEXT NOT NULL DEFAULT 'تم الرصد من فريق إدارة الشباب',
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'Africa/Cairo')
);

CREATE INDEX IF NOT EXISTS idx_mission_youth_monitoring_mission_id
    ON public.mission_youth_monitoring (mission_id);

COMMIT;