-- Daily, concurrency-safe wireless handover reference counter.
-- The application also creates this table during its idempotent schema bootstrap.
BEGIN;

CREATE TABLE IF NOT EXISTS public.wireless_delivery_daily_counters (
    reference_date DATE PRIMARY KEY,
    last_number   INTEGER NOT NULL CHECK (last_number >= 1),
    updated_at    TIMESTAMP WITHOUT TIME ZONE NOT NULL
                  DEFAULT (now() AT TIME ZONE 'Africa/Cairo')
);

COMMIT;
