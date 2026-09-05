-- ============================================================================
-- 20260905_participant_identity.sql
-- الجذر الحقيقي لمشكلة حساب المشاركين (#4):
-- المشارك كان مُعرَّفاً بمجرد اسم/صفة نصية (full_name / participation_role)
-- بلا أي ربط فعلي بمتطوع أو برقم عضوية موحّد، فكان الحساب يعتمد على مطابقة
-- النصوص وينتج تكراراً وخلطاً بين الأشخاص والمهام.
--
-- العلاقة الصحيحة المطلوبة:
--     Mission → Mission Participant → Volunteer → Active Mission → Participation Hours
--
-- هذا الملف:
--   1) يضيف أعمدة الهوية الحقيقية إلى mission_participants:
--      volunteer_id (FK volunteers) — user_id (FK users, لو المتطوع له حساب) — membership_number
--   2) يبني (backfill) الهوية من البيانات التاريخية الموجودة
--      (رقم العضوية = participation_role للمتطوعين، ثم الربط بجدول volunteers)
--   3) يحذف التكرارات التاريخية (نفس الهوية داخل نفس المهمة > مرة واحدة)
--   4) يضيف قيوداً تمنع تكرار تكليف نفس الشخص لنفس المهمة في المستقبل
--
-- آمن للإعادة (idempotent) — كل إضافة محمية بـ IF NOT EXISTS / IF EXISTS.
-- ============================================================================

BEGIN;

-- ── 1) أعمدة الهوية على المشاركات ───────────────────────────────────────────
ALTER TABLE mission_participants
    ADD COLUMN IF NOT EXISTS volunteer_id BIGINT REFERENCES volunteers(volunteer_id) ON DELETE SET NULL;
ALTER TABLE mission_participants
    ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE mission_participants
    ADD COLUMN IF NOT EXISTS membership_number VARCHAR(50) DEFAULT '';

-- ── 2) Backfill: رقم العضوية من participation_role (المتطوع عنده رقم / غير المتطوع صفته) ──
UPDATE mission_participants
SET membership_number = TRIM(participation_role)
WHERE COALESCE(TRIM(membership_number), '') = ''
  AND COALESCE(TRIM(participation_role), '') <> '';

-- ── 3) Backfill: ربط المشارك بسجل المتطوع عبر رقم العضوية الموحّد (نفس الفرع أولاً) ──
UPDATE mission_participants mp
SET volunteer_id = v.volunteer_id
FROM volunteers v
WHERE mp.volunteer_id IS NULL
  AND mp.membership_number <> ''
  AND LOWER(TRIM(v.membership_number)) = LOWER(TRIM(mp.membership_number))
  AND (mp.branch_id IS NULL OR v.branch_id IS NULL OR v.branch_id = mp.branch_id);

-- ── 4) Backfill: user_id = حساب دخول المتطوع إن وُجد (username = رقم العضوية) ──
UPDATE mission_participants mp
SET user_id = u.user_id
FROM users u
JOIN volunteers v ON v.volunteer_id = mp.volunteer_id
WHERE mp.user_id IS NULL
  AND mp.volunteer_id IS NOT NULL
  AND LOWER(TRIM(u.username)) = LOWER(TRIM(v.membership_number));

-- ── 5) إزالة التكرارات التاريخية (نفس الهوية داخل نفس المهمة) ────────────────
--    نحتفظ بالصف الأحدث، ويفضَّل الصف الذي لا يزال "مازال بالمهمة".
WITH ranked AS (
    SELECT participant_id,
           ROW_NUMBER() OVER (
               PARTITION BY mission_id, membership_number
               ORDER BY (return_status = 'مازال بالمهمة') DESC, participant_id DESC
           ) AS rn
    FROM mission_participants
    WHERE membership_number <> ''
)
DELETE FROM mission_participants
WHERE participant_id IN (SELECT participant_id FROM ranked WHERE rn > 1);

-- ── 6) قيود منع التكرار مستقبلاً (لا يمكن تكليف نفس الشخص لنفس المهمة مرتين) ──
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_mission_membership
    ON mission_participants (mission_id, membership_number)
    WHERE membership_number <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_mission_volunteer
    ON mission_participants (mission_id, volunteer_id)
    WHERE volunteer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_mission_user
    ON mission_participants (mission_id, user_id)
    WHERE user_id IS NOT NULL;

-- ── 7) فهرسة الربط: بحث سريع عن مهمة المتطوع الحالية (رادار التتبع + القوة البشرية) ──
CREATE INDEX IF NOT EXISTS idx_mp_volunteer_status
    ON mission_participants (volunteer_id, return_status)
    WHERE volunteer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mp_membership_status
    ON mission_participants (membership_number, return_status)
    WHERE membership_number <> '';

COMMIT;