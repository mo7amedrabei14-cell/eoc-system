BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Mission Start checkbox + Mission Creation DateTime
--   • start_from_mission (boolean, default TRUE) — «يُحسب من بداية
--     المهمة» لكل مشارك: TRUE = planned START من بداية المهمة،
--     FALSE = من بداية مساره المحدد. PURE switch — بلا شروط تواريخ.
--   • creation_datetime (timestamp بدون منطقة زمنية) — تاريخ/وقت
--     إنشاء المهمة (إصدار المستخدم، ليس created_at التلقائي).
-- Idempotent — يمكن تطبيقه أكثر من مرة بأمان.
-- ─────────────────────────────────────────────────────────────

-- 1) المفتاح النقي: بداية كل مشارك (يرث TRUE للاستمارات القائمة)
ALTER TABLE mission_participants
    ADD COLUMN IF NOT EXISTS start_from_mission boolean NOT NULL DEFAULT true;

-- 2) تاريخ/وقت إنشاء المهمة (يُكتب مرة واحدة عند أول إنشاء، يُعدَّله المالك فقط)
ALTER TABLE missions
    ADD COLUMN IF NOT EXISTS creation_datetime timestamp without time zone;

-- 3) Backfill لمرة واحدة (حارس IS NULL يمنع تكرار الكتابة فوق تعديلات المالك):
--    أفضل تخمين = أول سجل «إنشاء مهمة» في audit_logs، وإلا created_at.
UPDATE missions m
SET creation_datetime = COALESCE(
    (SELECT MIN(al.created_at) FROM audit_logs al
      WHERE al.action = 'إنشاء مهمة' AND al.entity_type = 'mission'
        AND al.entity_id::bigint = m.mission_id::bigint),
    m.created_at)
WHERE m.creation_datetime IS NULL;

COMMIT;