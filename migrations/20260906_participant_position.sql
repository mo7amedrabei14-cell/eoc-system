BEGIN;

-- ─────────────────────────────────────────────────────────────
-- صفة المشارك (Participant Designation) — حقل مخصص لغير المتطوعين
--    المتطوع يُعرف برقم العضوية (participation_role) — لا يتأثر هذا
--    الملف ببيانات المتطوعين إطلاقاً.
--    غير المتطوع: صفة المشارك (المنصب/المسمى) إلزامية — حقل منفصل
--    تماماً عن رقم العضوية حتى لا يختلطا بعد الآن.
-- ─────────────────────────────────────────────────────────────

-- 1) العمود الجديد
ALTER TABLE mission_participants
    ADD COLUMN IF NOT EXISTS participant_position VARCHAR(100);

-- 2) نقل البيانات القديمة: صفات غير المتطوعين كانت تُحفظ سابقاً داخل
--    participation_role (نفس العمود الذي يحوي رقم عضوية المتطوع) —
--    ننسخها للعمود الجديد ولا نمسح الأصل حتى لا نكسر الهوية التاريخية.
UPDATE mission_participants
SET participant_position = participation_role
WHERE participant_type = 'non_volunteer'
  AND (participant_position IS NULL OR TRIM(participant_position) = '')
  AND participation_role IS NOT NULL AND TRIM(participation_role) <> '';

COMMIT;