-- 2026-09-23 — AI News Bot: permanent observation timestamp on every record
-- Adds ai_news.observed_at (timestamp, Cairo local time — same convention as other timestamp columns).
-- New bot inserts get observed_at = save time (default applied in backend INSERT via COALESCE),
-- historical rows are backfilled from created_at so every old record keeps its observation moment.
-- The column is kept permanently in storage: no rotation, no purge.

BEGIN;

ALTER TABLE public.ai_news
    ADD COLUMN IF NOT EXISTS observed_at timestamp without time zone;

-- رجّع توقيت الرصد للسجلات القديمة من created_at (نفس لحظة حفظ الخبر أصلاً)
UPDATE public.ai_news
   SET observed_at = created_at
 WHERE observed_at IS NULL
   AND created_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_news_observed_at ON public.ai_news (observed_at);

COMMIT;
