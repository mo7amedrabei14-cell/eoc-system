-- ============================================================================
-- 20260929_workspace_server_side.sql
-- حالة العمل على السيرفر: مسودات الاستمارات + طابور الإرسال المعلّق
-- ============================================================================
-- الجذر: كانت المسودات وطابور الإرسال محفوظة في localStorage على جهاز واحد
-- فقط ⇒ مع فريق يعمل من أكثر من 7 أجهزة، أي جهاز آخر لا يرى الشغل غير المُرسَل،
-- وضياع الجهاز/المتصفح/البيانات المحلية = ضياع الشغل نهائياً.
--
-- الحل: مصدر الحقيقة هو قاعدة البيانات (لكل مستخدم)، والنسخة المحلية تصبح
--        مجرد مخزن مؤقت يعمل عند انقطاع الشبكة فقط.
--
-- آمن للإعادة (idempotent) بالكامل.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_workspace_items (
    item_id     BIGSERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    kind        VARCHAR(20) NOT NULL CHECK (kind IN ('draft', 'pending_save')),
    scope       VARCHAR(250) NOT NULL,
    payload     JSONB NOT NULL,
    meta        JSONB,
    updated_at  TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Cairo')
);

-- صف واحد لكل (مستخدم، نوع، نطاق) — الحفظ upsert
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_user_kind_scope
    ON public.user_workspace_items (user_id, kind, scope);

CREATE INDEX IF NOT EXISTS idx_workspace_user_kind
    ON public.user_workspace_items (user_id, kind);

COMMIT;
