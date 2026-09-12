-- ============================================================================
-- 20260912_jl_leave_closes_session.sql
-- القاعدة الأساسية للانضمام/الانفصال (JOIN/LEAVE): بمجرد تسجيل LEAVE لمشارك
-- يصبح متاحاً من جديد. لا تعتمد على حالة المهمة ولا على return_status ولا على
-- الـ UI — بل على حالة الجلسة الفعلية المحفوظة (end_dt محدد = خرج فعلًا،
-- end_dt IS NULL = لا يزال داخلًا وغير متاح).
--
-- هذا الملف يعكس قسم 6 من `20260905_participant_identity.sql` الذي أنشأ هذه
-- القيود الثلاثة (صفّ واحد لكل هوية داخل نفس المهمة). القاعدة الجديدة تتطلب
-- إمكانية فترتَي مشاركة مستقلتين لنفس الهوية في نفس المهمة (بعد LEAVE)،
-- وفترات متوازية عبر مهام مختلفة، فالقيود الفريدة أصبحت تمنع ذلك:
--
--   uq_mp_mission_membership  (mission_id, membership_number)  ← يُحذف
--   uq_mp_mission_volunteer   (mission_id, volunteer_id)       ← يُحذف
--   uq_mp_mission_user        (mission_id, user_id)            ← يُحذف
--
-- منع التكرار الآن يُدار على مستوى التطبيق (فترة الإسناد نفسها = تكرار حرفي)،
-- والرادار يمنع الجلسة المفتوحة الفعلية فقط — لا صفّ المشاركة نفسه.
--
-- لا تُمس: uq_mps_mission_participant_date_time (قيود الجلسات لكل participant_id)
--          و volunteers_membership_number_branch_unique (سجل المتطوع الرئيسي).
--
-- آمن للإعادة (idempotent) — كل حذف محمي بـ IF EXISTS.
-- ============================================================================

BEGIN;

-- ── 1) إزالة قيود الصف الواحد لكل هوية داخل نفس المهمة ──────────────────────
--    (منشأة في 20260905_participant_identity.sql قسم 6)
DROP INDEX IF EXISTS uq_mp_mission_membership;
DROP INDEX IF EXISTS uq_mp_mission_user;
DROP INDEX IF EXISTS uq_mp_mission_volunteer;

COMMIT;