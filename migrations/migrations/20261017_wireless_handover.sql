-- ============================================================================
-- 20261017_wireless_handover.sql — صفحة تسليم أجهزة لاسلكي
-- كل تسليم = صف مستقل (زي المهام) — لا يوجد batch.
-- Idempotent — آمن للتشغيل المتكرر.
-- ============================================================================
BEGIN;

-- عدّادات المخزون
CREATE TABLE IF NOT EXISTS wireless_inventory (
    device_type  VARCHAR(20) PRIMARY KEY CHECK (device_type IN ('TETRA','HUAWEI')),
    total_count  INTEGER NOT NULL DEFAULT 16 CHECK (total_count >= 0),
    updated_by   INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at   TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'Africa/Cairo')
);
INSERT INTO wireless_inventory (device_type, total_count) VALUES ('TETRA', 16) ON CONFLICT DO NOTHING;
INSERT INTO wireless_inventory (device_type, total_count) VALUES ('HUAWEI', 16) ON CONFLICT DO NOTHING;

-- النص الثابت
CREATE TABLE IF NOT EXISTS wireless_fixed_text (
    id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    content    TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'Africa/Cairo')
);

-- سجلات التسليم (كل صف = فورم مستقل)
CREATE TABLE IF NOT EXISTS wireless_handovers (
    handover_id       BIGSERIAL PRIMARY KEY,
    handover_code     VARCHAR(50),
    full_name         VARCHAR(200) NOT NULL,
    employee_number   VARCHAR(100),
    national_id       VARCHAR(50),
    department        VARCHAR(200),
    received_date     DATE NOT NULL,
    device_type       VARCHAR(20) NOT NULL CHECK (device_type IN ('MOTOROLA','HUAWEI')),
    device_serial     VARCHAR(100),
    task_description  TEXT,
    usage_duration    VARCHAR(100),
    execution_area    VARCHAR(200),
    row_status        VARCHAR(20) NOT NULL DEFAULT 'نشط' CHECK (row_status IN ('نشط','مُرجَع')),
    return_notes      TEXT,                              -- ملاحظات الإرجاع
    returned_at       TIMESTAMP WITHOUT TIME ZONE,
    returned_by       INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    notes             TEXT,
    created_by        INTEGER NOT NULL REFERENCES users(user_id),
    created_at        TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'Africa/Cairo'),
    updated_at        TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_wireless_handovers_created
    ON wireless_handovers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wireless_handovers_date
    ON wireless_handovers (received_date DESC);
CREATE INDEX IF NOT EXISTS idx_wireless_handovers_status
    ON wireless_handovers (row_status, device_type);

COMMIT;