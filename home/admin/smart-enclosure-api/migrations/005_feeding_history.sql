-- Start tracking at activation; do not invent overdue feedings from before release.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE enclosure_settings.feeding ADD COLUMN IF NOT EXISTS tracking jsonb;
UPDATE enclosure_settings.feeding SET tracking=jsonb_build_object(
    'salad', (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date::text,
    'bugs', (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date::text)
WHERE tracking IS NULL;
ALTER TABLE enclosure_settings.feeding ALTER COLUMN tracking SET NOT NULL;
CREATE TABLE IF NOT EXISTS enclosure_settings.feeding_history (
    food text NOT NULL CHECK (food IN ('salad', 'bugs')),
    scheduled_date date NOT NULL,
    completed_date date NOT NULL,
    completed_at timestamptz NOT NULL,
    PRIMARY KEY (food, completed_date),
    CHECK (scheduled_date <= completed_date)
);
CREATE INDEX IF NOT EXISTS feeding_history_recent ON enclosure_settings.feeding_history (completed_at DESC);
GRANT SELECT, INSERT ON enclosure_settings.feeding_history TO enclosure_history_app;
COMMIT;
