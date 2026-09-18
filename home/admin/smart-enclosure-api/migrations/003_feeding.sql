-- Additive AWS-only settings. No changes to historical data or Pi schedules.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE SCHEMA IF NOT EXISTS enclosure_settings;
CREATE TABLE IF NOT EXISTS enclosure_settings.feeding (
    id boolean PRIMARY KEY DEFAULT TRUE CHECK (id),
    schedules jsonb NOT NULL,
    version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO enclosure_settings.feeding (id, schedules) VALUES (TRUE,
 '{"salad":{"enabled":false,"mode":"weekly","weekdays":[],"every_days":1,"start_date":null},
   "bugs":{"enabled":false,"mode":"weekly","weekdays":[],"every_days":1,"start_date":null}}'::jsonb)
ON CONFLICT (id) DO NOTHING;
GRANT USAGE ON SCHEMA enclosure_settings TO enclosure_history_app;
GRANT SELECT, UPDATE ON enclosure_settings.feeding TO enclosure_history_app;
COMMIT;
