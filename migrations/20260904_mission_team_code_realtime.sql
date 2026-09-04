BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1) كود الفريق/الإدارة على مستوى المهمة (مستقل عن المشاركين)
--    مطلوب في متطلبات realtime #3: حقل واحد مستقل عن جدول المشاركين
-- ─────────────────────────────────────────────────────────────
ALTER TABLE missions
    ADD COLUMN IF NOT EXISTS team_code VARCHAR(100) DEFAULT '';

-- ─────────────────────────────────────────────────────────────
-- 2) فيد الأحداث اللحظية (Realtime Events)
--    جدول خفيف مخصص للإشعارات والتحديثات اللحظية:
--    - event_id = watermark تصاعدي (incremental polling بدون فول لود)
--    - target_user_id = المستلم المقصود (حسب user_id من الـ backend)
--    - mission_id = يسمح للمتطوع بمعرفة إذا كانت المهمة تخصه دون لواد كامل
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS realtime_events (
    event_id       BIGSERIAL PRIMARY KEY,
    event_type     TEXT NOT NULL,
    action         TEXT NOT NULL,
    actor_user_id  INTEGER,
    target_user_id INTEGER,
    mission_id     INTEGER,
    details        JSONB,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS realtime_events_id_idx
    ON realtime_events (event_id);

CREATE INDEX IF NOT EXISTS realtime_events_mission_idx
    ON realtime_events (mission_id, event_id);

COMMIT;