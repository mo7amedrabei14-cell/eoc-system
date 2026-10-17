-- ============================================================================
-- 20261018_wireless_handover_v2.sql
-- تسليم أجهزة لاسلكي — v2: رأس التسليم + أجهزة متعددة
-- يُبقي wireless_handovers القديم للتاريخ وينقل بياناته.
-- Idempotent — آمن للتشغيل المتكرر.
-- ============================================================================
BEGIN;

-- ── 1) رأس التسليم (بيانات المستلم مرة واحدة) ──
CREATE TABLE IF NOT EXISTS wireless_deliveries (
    delivery_id       BIGSERIAL PRIMARY KEY,
    delivery_code     VARCHAR(50) UNIQUE,
    full_name         VARCHAR(200) NOT NULL,
    employee_number   VARCHAR(100),
    national_id       VARCHAR(50),
    department        VARCHAR(200),
    received_date     DATE NOT NULL,
    task_description  TEXT,
    usage_duration    VARCHAR(100),
    execution_area    VARCHAR(200),
    general_notes     TEXT,
    status            VARCHAR(20) NOT NULL DEFAULT 'مسلَّم' CHECK (status IN ('مسلَّم','مُرجَع')),
    returned_at       TIMESTAMP WITHOUT TIME ZONE,
    returned_by       INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    return_notes      TEXT,
    created_by        INTEGER NOT NULL REFERENCES users(user_id),
    created_at        TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'Africa/Cairo'),
    updated_at        TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_wireless_deliveries_created
    ON wireless_deliveries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wireless_deliveries_date
    ON wireless_deliveries (received_date DESC);
CREATE INDEX IF NOT EXISTS idx_wireless_deliveries_status
    ON wireless_deliveries (status);

-- ── 2) الأجهزة (كل جهاز سطر مستقل) ──
CREATE TABLE IF NOT EXISTS wireless_delivery_devices (
    device_row_id     BIGSERIAL PRIMARY KEY,
    delivery_id       BIGINT NOT NULL REFERENCES wireless_deliveries(delivery_id) ON DELETE CASCADE,
    device_type       VARCHAR(20) NOT NULL CHECK (device_type IN ('MOTOROLA','HUAWEI')),
    device_serial     VARCHAR(100),
    accessories       TEXT,
    device_condition  VARCHAR(20) NOT NULL DEFAULT 'سليم' CHECK (device_condition IN ('سليم','مستعمل','تالف')),
    device_notes      TEXT,
    created_at        TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'Africa/Cairo')
);

CREATE INDEX IF NOT EXISTS idx_wireless_devices_delivery
    ON wireless_delivery_devices (delivery_id);
CREATE INDEX IF NOT EXISTS idx_wireless_devices_type
    ON wireless_delivery_devices (device_type);

-- ── 3) نقل البيانات من wireless_handovers القديم (لو موجود وفيه بيانات) ──
DO $$
DECLARE
    old_row RECORD;
    new_delivery_id BIGINT;
    old_code TEXT;
BEGIN
    -- ننقل فقط إذا كان الجدول القديم موجوداً
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wireless_handovers') THEN
        FOR old_row IN SELECT * FROM wireless_handovers LOOP
            old_code := COALESCE(old_row.handover_code, '#WH-OLD-' || old_row.handover_id::text);

            -- تحقق من عدم النقل مسبقاً
            IF NOT EXISTS (SELECT 1 FROM wireless_deliveries WHERE delivery_code = old_code) THEN
                INSERT INTO wireless_deliveries (
                    delivery_code, full_name, employee_number, national_id, department,
                    received_date, task_description, usage_duration, execution_area,
                    general_notes, status, return_notes, returned_at, returned_by,
                    created_by, created_at, updated_at
                ) VALUES (
                    old_code, old_row.full_name, old_row.employee_number, old_row.national_id,
                    old_row.department, old_row.received_date, old_row.task_description,
                    old_row.usage_duration, old_row.execution_area, old_row.notes,
                    CASE WHEN old_row.row_status = 'مُرجَع' THEN 'مُرجَع' ELSE 'مسلَّم' END,
                    old_row.return_notes, old_row.returned_at, old_row.returned_by,
                    old_row.created_by, old_row.created_at, old_row.updated_at
                ) RETURNING delivery_id INTO new_delivery_id;

                INSERT INTO wireless_delivery_devices (
                    delivery_id, device_type, device_serial, accessories,
                    device_condition, device_notes
                ) VALUES (
                    new_delivery_id, old_row.device_type, old_row.device_serial,
                    NULL, 'سليم', NULL
                );
            END IF;
        END LOOP;
    END IF;
END $$;

COMMIT;