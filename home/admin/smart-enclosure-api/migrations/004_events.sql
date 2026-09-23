-- Manual events only. Retain independently of sensor readings and feeding plans.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS enclosure_history.events (
    id uuid PRIMARY KEY,
    occurred_at timestamptz NOT NULL,
    category text NOT NULL CHECK (category IN ('feeding','cleaning','bulb_change','other')),
    note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS events_occurred_at_idx ON enclosure_history.events (occurred_at, id)
    WHERE deleted_at IS NULL;
GRANT USAGE ON SCHEMA enclosure_history TO enclosure_history_app;
GRANT SELECT, INSERT, UPDATE ON enclosure_history.events TO enclosure_history_app;
COMMIT;
