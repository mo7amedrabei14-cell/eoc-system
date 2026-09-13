BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Supervisors Handover (تسليم وتسلم مشرفين)
--   سجل تسليم يومي واحد لكل تاريخ (الصفاحية: مالك/مدير/مشرف/أدمن).
--   • handover_date  — فريد (سجل واحد لكل يوم).
--   • shift_matrix JSONB — 12 خلية {shift}_{dept}
--     (shifts: night|morning|evening × depts: relief|youth|resources|case).
--   • created_by/updated_by — فاعل/معدِّل السجل.
-- Idempotent — يمكن تطبيقه أكثر من مرة بأمان (مطابق لكتلة ensure_schema في main.py).
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS handover_log (
    handover_id         BIGSERIAL PRIMARY KEY,
    handover_date       DATE NOT NULL,
    local_news_count    INTEGER NOT NULL DEFAULT 0,
    global_news_count   INTEGER NOT NULL DEFAULT 0,
    forms_count         INTEGER NOT NULL DEFAULT 0,
    issues_text         TEXT NOT NULL DEFAULT '',
    tetra_count         INTEGER NOT NULL DEFAULT 0,
    huawei_count        INTEGER NOT NULL DEFAULT 0,
    new_equipment_count INTEGER NOT NULL DEFAULT 0,
    shift_matrix        JSONB NOT NULL DEFAULT '{}'::jsonb,
    follow_ups_text     TEXT NOT NULL DEFAULT '',
    created_by          INTEGER NOT NULL REFERENCES users(user_id),
    created_at          TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'Africa/Cairo'),
    updated_by          INTEGER REFERENCES users(user_id),
    updated_at          TIMESTAMP WITHOUT TIME ZONE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_handover_log_date
    ON handover_log (handover_date);

CREATE INDEX IF NOT EXISTS idx_handover_log_created_by
    ON handover_log (created_by);

COMMIT;