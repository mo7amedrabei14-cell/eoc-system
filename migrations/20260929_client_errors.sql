-- ═══════════════════════════════════════════════════════════════════════════
-- 🧯 بلاغات أخطاء الواجهة (Client Errors) — تشخيص «الشاشة البيضا»
-- ───────────────────────────────────────────────────────────────────────────
-- الجذر: خطأ وقت *تحميل وحدة* في الواجهة (مثل مرجع قبل تعريفه — TDZ) كان يوقف
-- التطبيق كله بلا أي أثر على السيرفر: المستخدم يرى شاشة بيضا، ولا أحد يعرف
-- السبب ولا من أي جهاز. الآن الواجهة تُبلّغ عبر POST /api/client-errors
-- (بلا أو مع جلسة)، والسجل يبقى على السيرفر.
--
-- الجدول يُنشأ تلقائياً عند الإقلاع من ensure_client_errors_schema() في main.py
-- (نفس جدول user_workspace_items: مستوى خفيف منفصل بلا رفع SCHEMA_VERSION، لأن
-- رفع الإصدار يُعيد تشغيل الـ DDL الثقيل ويحجز أقفالاً على realtime_events).
-- هذا الملف للتوثيق/التطبيق اليدوي — آمن للإعادة (idempotent).
--
-- ⚠️ لا يُخزَّن هنا أي توكن ولا باراميترات رابط (يُحذف الـ query قبل التسجيل)،
--    وكل الحقول مقتوضة، والتجميع بالبصمة + اليوم يمنع النمو بلا حد.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS client_errors (
    error_id      BIGSERIAL PRIMARY KEY,
    fingerprint   VARCHAR(64)  NOT NULL,          -- sha256 مختصر (نوع + رسالة + أول سطر من الأثر)
    event_date    DATE         NOT NULL,          -- يوم الحدث بتوقيت القاهرة (أساس التجميع)
    occurrences   INTEGER      NOT NULL DEFAULT 1,
    kind          VARCHAR(40)  NOT NULL DEFAULT 'error',  -- error | unhandledrejection | boundary | module
    message       TEXT,
    stack         TEXT,
    url           VARCHAR(300),                   -- المسار فقط (بلا query/hash)
    user_agent    VARCHAR(300),
    app_revision  VARCHAR(120),
    boot_id       VARCHAR(64),
    user_id       INTEGER REFERENCES users(user_id) ON DELETE SET NULL,  -- NULL = خطأ قبل الدخول
    first_seen    TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Cairo'),
    last_seen     TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Cairo')
);

-- صف واحد لكل (بصمة، يوم) — ON CONFLICT DO UPDATE يزيد occurrences
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_errors_fingerprint_day
    ON client_errors (fingerprint, event_date);

-- للعرض السريع: الأحدث أولاً (GET /api/client-errors — للمالك فقط)
CREATE INDEX IF NOT EXISTS idx_client_errors_last_seen
    ON client_errors (last_seen DESC);

-- تنظيف يدوي (اختياري): سطور أقدم من ٩٠ يوماً
-- DELETE FROM client_errors WHERE event_date < (now() AT TIME ZONE 'Africa/Cairo')::date - 90;
