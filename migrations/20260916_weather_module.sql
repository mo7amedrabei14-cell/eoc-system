-- 2026-09-16 — وحدة الطقس (Weather Module)
-- جدول توقعات الورديات الثلاث (morning/evening/night) لكل محافظة/فرع.
-- سطر واحد = (تاريخ الوردية، الوردية، المحافظة) مع 12 عموداً عددياً: 6 مقاييس × (صغرى min / عظمى max).
-- Idempotent — آمن للتشغيل المتكرر.

BEGIN;

CREATE TABLE IF NOT EXISTS weather_forecasts (
    id            BIGSERIAL PRIMARY KEY,
    forecast_date DATE NOT NULL,
    shift         VARCHAR(10) NOT NULL CHECK (shift IN ('morning', 'evening', 'night')),
    branch_id     INTEGER NOT NULL REFERENCES branches(branch_id),
    temp_min      NUMERIC(6,2),
    temp_max      NUMERIC(6,2),
    wind_min      NUMERIC(6,2),
    wind_max      NUMERIC(6,2),
    rain_min      NUMERIC(6,2),
    rain_max      NUMERIC(6,2),
    humidity_min  NUMERIC(6,2),
    humidity_max  NUMERIC(6,2),
    clouds_min    NUMERIC(6,2),
    clouds_max    NUMERIC(6,2),
    aqi_min       NUMERIC(6,2),
    aqi_max       NUMERIC(6,2),
    entered_by    INTEGER NOT NULL REFERENCES users(user_id),
    created_at    TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'Africa/Cairo'),
    updated_at    TIMESTAMP WITHOUT TIME ZONE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_weather_forecast_shift_branch
    ON weather_forecasts (forecast_date, shift, branch_id);

CREATE INDEX IF NOT EXISTS idx_weather_forecasts_date
    ON weather_forecasts (forecast_date);

CREATE INDEX IF NOT EXISTS idx_weather_forecasts_branch
    ON weather_forecasts (branch_id);

COMMIT;