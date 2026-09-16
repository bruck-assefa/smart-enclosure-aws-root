-- Apply explicitly as database owner to smart_enclosure after backup/review.
-- Additive: existing public.sensor_data and all legacy tables remain untouched.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE SCHEMA IF NOT EXISTS enclosure_history;
CREATE TABLE IF NOT EXISTS enclosure_history.readings (
    measured_at timestamptz NOT NULL,
    sensor_id text NOT NULL,
    collected_at timestamptz NOT NULL,
    label text NOT NULL,
    bus smallint NOT NULL,
    mux text NOT NULL,
    channel smallint NOT NULL CHECK (channel BETWEEN 0 AND 7),
    temperature_c double precision NOT NULL,
    humidity_pct double precision NOT NULL,
    pressure_hpa double precision NOT NULL,
    PRIMARY KEY (measured_at, sensor_id)
);
-- TimescaleDB is already installed on AWS. Retain raw data; no deletion policy.
SELECT create_hypertable('enclosure_history.readings', 'measured_at',
    chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);
COMMIT;
-- Grant only USAGE on enclosure_history and SELECT, INSERT on readings to a
-- dedicated LOGIN role provisioned separately. No application DDL privileges.
