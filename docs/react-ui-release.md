# React dashboard release

The reviewed React dashboard replaces the experimental application at /smart/.
Debug remains at /debug.html. Historical source/assets are retained for rollback;
the new index references only the current build. Build locally with npm ci and
npm run build in home/admin/smart-enclosure-frontend, then copy dist contents into
var/www/react-app/dist without deleting old assets. Commit those build artifacts.

## Runtime changes

- Pi relay_settings.py migrates relay_schedules additively with a name column and
  converts legacy auto rows to sun. Custom schedules are no longer overwritten
  by solar sync. The existing updater takes a consistent SQLite backup first.
- AWS 002_zone_metadata.sql grants the history app SELECT on sensor_attributes.
  This existing table contains physical IDs and zones, not relay names.
- Gateway exposes cached solar times, zone assignments and ranges up to 31 days.
  Records come from enclosure_history; the legacy archive is not migrated.
- nginx serves /smart/ and proxies /camera/ to the existing MediaMTX reader.
  Media transport remains WebRTC, so connectivity depends on the client's route
  to the Pi's advertised ICE candidates. The player reports connection errors.

## Activation

1. Commit and push both repositories. Record full commit IDs.
2. Stage each repository's reviewed updater outside its runtime checkout. Fetch
   origin, check disk/services/status, run dry-run, then apply the exact commit.
3. Deploy Pi first. Restart beardapi after source update; startup migrates SQLite,
   initializes GPIO, syncs sun-only rows, then immediately enforces schedules.
   Existing GPIO initialization briefly sets relays off during the restart.
4. Deploy AWS. Apply 002_zone_metadata.sql as postgres in smart_enclosure.
   Restart smart-enclosure-api. Run nginx -t before reloading nginx.
5. Verify clean Git and exact HEAD on both hosts, service health, source timestamps,
   database recording, zones, solar times, history ranges, /smart/, /debug.html,
   camera reader/signalling, and desktop/mobile UI. Do not toggle relays for tests.
6. Store runtime-verification.json alongside each generated release.json.

Rollback uses reviewed revert commits and the guarded updater. Preserve live
SQLite and event history; the added name column is backward compatible. Never
restore a database backup over live state as a routine UI rollback.
