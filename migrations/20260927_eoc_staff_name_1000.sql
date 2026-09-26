-- ═══════════════════════════════════════════════════════════════════════════════
-- 🔠 توسيع خانة «مسؤول المتابعة» لـ 1000 حرف
-- ═══════════════════════════════════════════════════════════════════════════════
-- السبب: عمود mission_eoc_staff.staff_name كان VARCHAR(150)، والخانة دي بيتكتب
-- فيها الاسم + رقم الهاتف + ملاحظات المتابعة، فشارة الـ150 حرف كانت بتقصّ النص
-- (أو ترفضه) ⇒ معلومة متابعة بتضيع من الاستمارة.
--
-- الأثر: توسيع عمود نصي فقط (metadata-only في Postgres) — لا حذف ولا إعادة كتابة
-- بيانات، وكل القيم الحالية تفضل كما هي.
--
-- ملاحظة: نفس الأمر موجود في ensure_schema() بـ main.py (يُنفَّذ تلقائياً عند أي
-- إقلاع جديد) — والعملية idempotent، فتشغيلها هنا أو هناك أو في الاثنين آمن.
--
-- التشغيل:
--   psql "$DATABASE_URL" -f migrations/20260927_eoc_staff_name_1000.sql
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE mission_eoc_staff
    ALTER COLUMN staff_name TYPE VARCHAR(1000);

-- للتحقق:
--   SELECT column_name, data_type, character_maximum_length
--   FROM information_schema.columns
--   WHERE table_name = 'mission_eoc_staff' AND column_name = 'staff_name';
--   ⇒ المتوقع: character_maximum_length = 1000
