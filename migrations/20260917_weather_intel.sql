-- 2026-09-17 — استخبارات الطقس (Weather Intelligence)
-- تنفيذ «جرانج الشفافية» للخطة المعتمدة:
--   *append-only مقيَّد بالتشغيل* — كل سجل إنتاج مرتبط بـ weather_runs.id، لا يُحدَّث ولا يُحذف،
--   فلا يتعارض تغيير المنهجية/النافذة/المصدر مع التاريخ السابق (نقطة 12).
--   weather_locations = مصدر الحقيقة (الـ 9 مدن أدناه seed فقط — الإضافة/التعطيل عبر الـAPI).
-- Idempotent — آمن للتشغيل المتكرر.

BEGIN;

-- ── 1) إعدادات المواقع (مصدر الحقيقة — لا hardcode في Python) ──────────────
CREATE TABLE IF NOT EXISTS weather_locations (
    id          BIGSERIAL PRIMARY KEY,
    name_ar     VARCHAR(100) NOT NULL UNIQUE,
    name_en     VARCHAR(100) NOT NULL,
    latitude    NUMERIC(9,6)  NOT NULL,
    longitude   NUMERIC(9,6)  NOT NULL,
    altitude_m  NUMERIC(8,2),
    region      VARCHAR(10),
    branch_id   INTEGER REFERENCES branches(branch_id),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'Africa/Cairo')
);

INSERT INTO weather_locations (name_ar, name_en, latitude, longitude, altitude_m, region)
VALUES
    ('القاهرة',     'Cairo',      30.0444, 31.2357, 23, 'hq'),
    ('الجيزة',      'Giza',       30.0131, 31.2089, 19, 'hq'),
    ('الإسكندرية',  'Alexandria', 31.2001, 29.9187,  7, 'hq'),
    ('المنيا',      'Minya',      28.1099, 30.7503, 47, 'saeed'),
    ('أسيوط',       'Assiut',     27.1809, 31.1837, 56, 'saeed'),
    ('سوهاج',       'Sohag',      26.5560, 31.6949, 61, 'saeed'),
    ('قنا',         'Qena',       26.1551, 32.7269, 75, 'saeed'),
    ('الأقصر',      'Luxor',      25.6872, 32.6396, 89, 'saeed'),
    ('أسوان',       'Aswan',      24.0889, 32.8998, 99, 'saeed')
ON CONFLICT (name_ar) DO NOTHING;

-- ── 2) السجل التاريخي الخام (ERA5 عبر Open-Meteo Archive) ───────────────────
CREATE TABLE IF NOT EXISTS weather_history_daily (
    id                  BIGSERIAL PRIMARY KEY,
    location_id         INTEGER NOT NULL REFERENCES weather_locations(id),
    record_date         DATE NOT NULL,
    tmax                NUMERIC(6,2),
    tmin                NUMERIC(6,2),
    precip_mm           NUMERIC(8,2),
    wind_max_kph        NUMERIC(7,2),
    wind_gusts_kph      NUMERIC(7,2),
    humidity_mean_pct   NUMERIC(6,2),
    cloud_cover_mean_pct NUMERIC(6,2),
    data_source         VARCHAR(50) NOT NULL DEFAULT 'era5-archive',
    created_at          TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'Africa/Cairo')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_weather_history_day
    ON weather_history_daily (location_id, record_date, data_source);
CREATE INDEX IF NOT EXISTS idx_weather_history_loc_date
    ON weather_history_daily (location_id, record_date);

-- ── 3) سجلات التشغيل (append-only — تأتي مع client_run_uuid لمنع الازدواج) ──
CREATE TABLE IF NOT EXISTS weather_runs (
    id                    BIGSERIAL PRIMARY KEY,
    client_run_uuid       UUID NOT NULL UNIQUE,
    run_date              DATE NOT NULL,
    target_date           DATE NOT NULL,
    status                VARCHAR(16) NOT NULL CHECK (status IN ('success','partial','failed')),
    total_locations       INTEGER NOT NULL DEFAULT 0,
    successful_locations  INTEGER NOT NULL DEFAULT 0,
    error_locations       INTEGER NOT NULL DEFAULT 0,
    error_details         JSONB,
    source_meta           JSONB,
    started_at            TIMESTAMP WITHOUT TIME ZONE,
    completed_at          TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'Africa/Cairo')
);
CREATE INDEX IF NOT EXISTS idx_weather_runs_target ON weather_runs (target_date DESC);

-- ── 4) لقطات التوقعات (append-only — كل جلب صف جديد بلا إتلاف السابق، نقطة 10) ──
CREATE TABLE IF NOT EXISTS weather_forecast_snapshots (
    id                   BIGSERIAL PRIMARY KEY,
    weather_run_id       INTEGER NOT NULL REFERENCES weather_runs(id),
    location_id          INTEGER NOT NULL REFERENCES weather_locations(id),
    target_date          DATE NOT NULL,
    data_source          VARCHAR(50) NOT NULL DEFAULT 'open-meteo-forecast',
    fetched_at           TIMESTAMP WITHOUT TIME ZONE,
    raw_json             JSONB,
    tmax                 NUMERIC(6,2),
    tmin                 NUMERIC(6,2),
    precip_mm            NUMERIC(8,2),
    precip_prob_pct      NUMERIC(5,2),
    wind_max_kph         NUMERIC(7,2),
    wind_gusts_kph       NUMERIC(7,2),
    humidity_mean_pct    NUMERIC(6,2),
    cloud_cover_mean_pct NUMERIC(6,2),
    weather_code         INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_weather_snapshot
    ON weather_forecast_snapshots (weather_run_id, location_id, target_date);
CREATE INDEX IF NOT EXISTS idx_weather_snap_loc_date
    ON weather_forecast_snapshots (location_id, target_date);

-- ── 5) إحصاءات الخط المرجعي (مرتبطة بالتشغيل — المنهجية محفوظة داخل كل صف، نقطة 12) ──
CREATE TABLE IF NOT EXISTS weather_statistics (
    id                  BIGSERIAL PRIMARY KEY,
    weather_run_id      INTEGER NOT NULL REFERENCES weather_runs(id),
    location_id         INTEGER NOT NULL REFERENCES weather_locations(id),
    target_date         DATE NOT NULL,
    metric              VARCHAR(32) NOT NULL,
    history_source      VARCHAR(50) NOT NULL DEFAULT 'era5-reanalysis',
    window_days         INTEGER NOT NULL,
    methodology_version VARCHAR(16) NOT NULL DEFAULT 'v1',
    period_start        DATE,
    period_end          DATE,
    sample_count        INTEGER NOT NULL,
    mean                NUMERIC(10,3),
    median              NUMERIC(10,3),
    min                 NUMERIC(10,3),
    max                 NUMERIC(10,3),
    p10                 NUMERIC(10,3),
    p25                 NUMERIC(10,3),
    p75                 NUMERIC(10,3),
    p90                 NUMERIC(10,3),
    stddev              NUMERIC(10,3),
    computed_at         TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'Africa/Cairo')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_weather_stat
    ON weather_statistics (weather_run_id, location_id, target_date, metric);

-- ── 6) سجلات التكرار الشفافة (مقام = المشاهدات الصالحة فعلًا، نقطة 8/9) ──────
CREATE TABLE IF NOT EXISTS weather_frequencies (
    id                  BIGSERIAL PRIMARY KEY,
    weather_run_id      INTEGER NOT NULL REFERENCES weather_runs(id),
    location_id         INTEGER NOT NULL REFERENCES weather_locations(id),
    target_date         DATE NOT NULL,
    metric              VARCHAR(32) NOT NULL,
    threshold_value     NUMERIC(10,3) NOT NULL,
    threshold_unit      VARCHAR(16),
    threshold_desc_ar   VARCHAR(200),
    qualifying_count    INTEGER NOT NULL,
    total_count         INTEGER NOT NULL,
    frequency_pct       NUMERIC(7,4),
    period_start        DATE,
    period_end          DATE,
    methodology         VARCHAR(64),
    computed_at         TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'Africa/Cairo')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_weather_freq
    ON weather_frequencies (weather_run_id, location_id, target_date, metric, threshold_value);

-- ── 7) النتائج اليومية (مرتبطة بالتشغيل + بـ snapshot المستخدم، نقطة 10) ────
CREATE TABLE IF NOT EXISTS weather_assessments (
    id                  BIGSERIAL PRIMARY KEY,
    weather_run_id      INTEGER NOT NULL REFERENCES weather_runs(id),
    location_id         INTEGER NOT NULL REFERENCES weather_locations(id),
    target_date         DATE NOT NULL,
    forecast_snapshot_id INTEGER REFERENCES weather_forecast_snapshots(id),
    anomalies           JSONB,
    hazards             JSONB,
    ai_assessment       TEXT,
    ai_assessment_json  JSONB,
    ai_model            VARCHAR(64),
    ai_status           VARCHAR(16) CHECK (ai_status IN ('success','error','skipped')),
    ai_error            TEXT,
    generated_at        TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'Africa/Cairo')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_weather_assessment
    ON weather_assessments (weather_run_id, location_id, target_date);
CREATE INDEX IF NOT EXISTS idx_weather_assess_loc_date
    ON weather_assessments (location_id, target_date);

-- ── 8) العتبات والأعداد القابلة للضبط (قيم فنية افتراضية — ليست عتبات EOC رسمية، نقطة 5) ──
CREATE TABLE IF NOT EXISTS weather_intel_config (
    key             VARCHAR(64) PRIMARY KEY,
    value           VARCHAR(255) NOT NULL,
    unit            VARCHAR(16),
    description_ar  VARCHAR(300),
    source          VARCHAR(200) NOT NULL DEFAULT 'قيمة افتراضية فنية قابلة للتعديل — ليست عتبة EOC رسمية',
    updated_at      TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'Africa/Cairo')
);

INSERT INTO weather_intel_config (key, value, unit, description_ar) VALUES
    ('hazard.tmax_high_c',            '40',           '°C',   'موجّه حرارة مرتفعة (الحرارة العظمى المتوقعة تبلغ أو تتجاوز)'),
    ('hazard.tmin_low_c',             '5',            '°C',   'برودة (الحرارة الصغرى المتوقعة تنخفض إلى أو دون)'),
    ('hazard.precip_heavy_mm',        '10',           'mm',   'أمطار غزيرة (الهطول المتوقع يبلغ أو يتجاوز)'),
    ('hazard.wind_high_kph',          '40',           'كم/س', 'رياح قوية (الرياح القصوى المتوقعة تبلغ أو تتجاوز)'),
    ('hazard.wind_gusts_high_kph',    '60',           'كم/س', 'هبات رياح قوية (محسوبة فقط عند توفر حقل الهبات)'),
    ('hazard.thunderstorm_codes',     '95,96,99',     '',     'رعد (أكواد WMO للتوقعات فقط — لا خط تاريخي)'),
    ('hazard.fog_codes',              '45,48',        '',     'ضباب (فئة WMO لتوقعات اليوم فقط — لا خط تاريخي)'),
    ('freq.tmax_ge',                  '40',           '°C',   'أيام تبلغ/تتجاوز فيها الحرارة العظمى هذه القيمة'),
    ('freq.tmin_le',                  '5',            '°C',   'أيام تنخفض فيها الحرارة الصغرى إلى هذه القيمة أو أقل'),
    ('freq.precip_ge',                '10',           'mm',   'أيام يبلغ/يتجاوز فيها الهطول هذه القيمة'),
    ('freq.wind_ge',                  '40',           'كم/س', 'أيام تتجاوز فيها الرياح القصوى هذه القيمة'),
    ('stats.metrics',                 'tmax,tmin,precip,wind,humidity', '', 'المقاييس النشطة للخط المرجعي'),
    ('history.window_days',           '3',            'يوم',  'نافذة الأيام حول تاريخ الهدف عبر كل السنوات (0 = مطابقة اليوم بالضبط)'),
    ('stats.min_samples',             '20',           '',     'الحد الأدنى للمشاهدات الصالحة لتصنيف الشذوذ والتكرار'),
    ('visibility.degraded_m',         '5000',         'm',    'حدّ الرؤية الضعيفة — مفعّل فقط عند توفّر حقل رؤية فعلي (ERA5 لا يوفره)')
ON CONFLICT (key) DO NOTHING;

COMMIT;