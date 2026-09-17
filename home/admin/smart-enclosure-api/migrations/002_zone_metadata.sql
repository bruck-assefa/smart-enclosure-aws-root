-- Read-only access to existing physical sensor-to-zone assignments.
-- Run as database owner; no sensor metadata or historical readings are changed.
BEGIN;
GRANT USAGE ON SCHEMA public TO enclosure_history_app;
GRANT SELECT ON public.sensor_attributes TO enclosure_history_app;
COMMIT;
