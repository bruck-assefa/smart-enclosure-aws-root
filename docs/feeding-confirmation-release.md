# Feeding confirmations release

Adds POST /enclosure/feeding/complete with food, version and enclosure date.
The existing write-intent and simulation guards apply. No Pi contract changes.
A locked settings row and transaction record completion and advance tracking
atomically; stale versions/dates and repeated confirmations return 409.
Reads include overdue dates and the latest 100 confirmations. All confirmations
are retained in PostgreSQL, independently of the manual events log.

Unconfirmed feedings carry forward indefinitely, including days with no visits.
Multiple missed occurrences of one food merge into one outstanding feeding.
Confirmation clears that food through today. Future occurrences retain the
original weekdays/interval anchor. Tracking begins on migration day, avoiding
historical backfill. Editing a food resets its pending schedule from today;
unchanged foods retain pending work, and today's confirmations remain complete.
History survives schedule changes and disabling. The seven-day preview shows
today's outstanding work and future routine dates; future carryover depends on
whether the user confirms today's feeding.

## Authorized deployment procedure

Follow DEPLOYMENT_WORKFLOW.md. Build frontend and stage index/assets under
var/www/react-app/dist, retaining prior hashed assets. Review, commit and push
before deploying that exact commit with the updater dry-run then apply.
Back up the database and apply migrations/005_feeding_history.sql as postgres
with ON_ERROR_STOP, after migration 003. The migration is additive and rerunnable.
Restart smart-enclosure-api only during an authorized release. No Pi changes.
Verify GET feeding, confirm an actual feeding only with the user's agreement,
verify persistence and history after reload, and check sensor/events health.
Record runtime verification separately. Roll back code via a reviewed revert;
retain tracking and history tables and user data.

Local validation: gateway unittest suite; frontend lint, unit tests and build;
intercepted browser fixtures, with no application server or hardware access.
