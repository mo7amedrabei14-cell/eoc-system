BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Segments المشاركة (Join/Leave) — إعادة تصميم فترة المشاركة
-- المبدأ: ITINERARY = الافتراضي، JOIN/LEAVE = استثناءات.
-- mission_participant_sessions أصبح مخزن الـ segments الداخلية:
--   • start_dt / end_dt (timestamp كامل) → دعم المبيت (overnight).
--   • itinerary_group → تثبيت الـ segment على يوم/مسار في المهمات المفتوحة.
-- mission_itineraries: تواريخ كاملة (departure_date/arrival_date) لكل يوم.
-- Idempotent — يمكن تطبيقه أكثر من مرة بأمان.
-- ─────────────────────────────────────────────────────────────

-- 1) mission_itineraries: تواريخ الانطلاق والوصول لكل مسار/يوم (مهمة مفتوحة)
ALTER TABLE mission_itineraries
    ADD COLUMN IF NOT EXISTS departure_date date;
ALTER TABLE mission_itineraries
    ADD COLUMN IF NOT EXISTS arrival_date date;

-- 1b) mission_participants: إخفاء مُزالي الاستمارة مع حفظ سجلهم (الرادار/HR)
--    roster_active = false يعني: شارك فعلاً (له segments) ثم أُزيل من الاستمارة،
--    يُبقى سجله للـ HR ولا يظهر في القائمة بعد الآن.
ALTER TABLE mission_participants
    ADD COLUMN IF NOT EXISTS roster_active boolean NOT NULL DEFAULT true;

-- 2) mission_participant_sessions = مخزن الـ segments
ALTER TABLE mission_participant_sessions
    ADD COLUMN IF NOT EXISTS itinerary_group varchar(150); -- المهمة المفتوحة: اليوم/المسار
ALTER TABLE mission_participant_sessions
    ADD COLUMN IF NOT EXISTS start_dt timestamp;           -- بداية كاملة (دعم المبيت)
ALTER TABLE mission_participant_sessions
    ADD COLUMN IF NOT EXISTS end_dt timestamp;             -- NULL = مفتوح/جارٍ

-- 3) Backfill الصفوف القديمة: start_dt/end_dt من session_date + الأوقات
--    (إذا انتهى قبل البدء ⇒ اليوم التالي، أي مبيت)
UPDATE mission_participant_sessions
SET start_dt = session_date + check_in_time,
    end_dt   = session_date + check_out_time
    + CASE WHEN check_out_time IS NOT NULL AND check_out_time < check_in_time
           THEN interval '1 day' ELSE interval '0' END
WHERE start_dt IS NULL
  AND session_date IS NOT NULL
  AND check_in_time IS NOT NULL;

COMMIT;
