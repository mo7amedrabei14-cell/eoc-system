BEGIN;

-- ─────────────────────────────────────────────────────────────
-- المحرك الموحد (Unified Mission Engine) — 2026-09-07
-- المبدأ: مهمة واحدة بلا محركين منفصلين (عادية/مفتوحة) — خط السير اختياري
-- ويُبنى تدريجياً (بلا خط → أساسي → أيام متعددة) والمهمة تبقى نفسها.
--   • mission_itineraries.route_from → «من» كحقل منفصل (إلى [to] منفصل كذلك).
--   • mission_participant_sessions.session_date لم يعد NOT NULL → إصلاح جذري
--     لـ HTTP 500 عند «تسجيل الانفصال» لطريق الـ drop (كان يُرسل NULL تاريخ).
-- Idempotent — يمكن تطبيقه أكثر من مرة بأمان.
-- ─────────────────────────────────────────────────────────────

-- 1) من/إلى كحقلين منفصلين: route_from (نقطة الانطلاق)
ALTER TABLE mission_itineraries ADD COLUMN IF NOT EXISTS route_from VARCHAR(255);

-- 2) الإصلاح الجذري للـ 500: session_date لم يعد فرضاً
ALTER TABLE mission_participant_sessions ALTER COLUMN session_date DROP NOT NULL;

COMMIT;