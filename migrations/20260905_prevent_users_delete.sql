-- ============================================================================
-- 20260905_prevent_users_delete.sql
-- درع وقائي: منع أي حذف لصفوف من جدول users في قاعدة الإنتاج.
--
-- السياق: تدقيق شامل (5/9/2026) أثبت أن:
--   - لا يوجد كود/endpoint/migration في المشروع يمس جدول users.
--   - كل المستخدمين الثمانية (الأدلاء 1,3,10,11,12,13,14,15) مطابقون تماماً
--     لأقدم وأحدث نسخ احتياطية في المشروع (git 26/8 و Data Base.sql 5/9).
--   - الفجوات 2,4,5,6,7,8,9 سابقة على أقدم backup ولا أثر لها في أي مصدر.
--
-- هذا الملف يثبّت الحماية: أي محاولة DELETE على users تُرفض فوراً —
-- حتى من SQL يدوي على أداة Neon. لا يحذف شيئاً، ولا يغيّر أي
-- user / password / role / permission.
--
-- آمن للإعادة (idempotent): DROP TRIGGER IF EXISTS قبل الإنشاء.
-- ============================================================================

BEGIN;

-- 1) دالة الحظر تعمل في نفس قاعدة البيانات على مستوى الخادم
CREATE OR REPLACE FUNCTION prevent_users_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'محظور: لا يمكن حذف مستخدمين من جدول users';
END
$$;

-- 2) إزالة أي نسخة قديمة ثم تركيب الدعامة على جدول المستخدمين
DROP TRIGGER IF EXISTS trg_prevent_users_delete ON users;

CREATE TRIGGER trg_prevent_users_delete
BEFORE DELETE ON users
FOR EACH ROW EXECUTE FUNCTION prevent_users_delete();

COMMIT;