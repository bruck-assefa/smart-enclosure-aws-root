# Manual enclosure events release

Adds a persistent AWS event log for Feeding, Cleaning, Bulb change and Other.
Events are created only by explicit user submissions. Feeding schedules, sensor
collection and hardware actions never generate events automatically.

The dashboard supports adding now or at an inspected chart time, backdating,
editing, confirmed deletion, keyboard-selectable markers and a range-specific
list. Notes remain available without sensor samples or a connected Pi. Event
loading failures do not suppress temperature history. Events use exact UTC
instants, independently of temperature aggregation, and America/New_York entry
and display. Nonexistent DST times are rejected; repeated hours are selectable.
Entries are minute-resolution, up to 2000 characters, and cannot be future-dated.

The new regular PostgreSQL table enclosure_history.events is not a hypertable
and has no retention policy. Deletion retains a tombstone for recovery. UUIDs
make creation retries idempotent; versions prevent stale updates/deletes.
GET /enclosure/events accepts the same inclusive calendar-day range (up to 31
days) as history. POST/PUT/DELETE require the existing explicit hardware-source
and X-Enclosure-Control convention and are disabled in simulation-only mode.
No new authentication scheme or Raspberry Pi API changes are introduced.
Queries fail visibly above 2000 events rather than silently omitting notes.

## Validation

- From home/admin/smart-enclosure-api, run python -m unittest discover -s tests -v.
- In the frontend, run npm ci, npm run lint, npm test and npm run build.
- Run tests/events-browser.cjs with Node and Playwright available via NODE_PATH.
  It intercepts every application request with fixtures and reads the static
  build; no local application runtime or Pi connection is used.
- Browser coverage includes manual add, reload persistence, marker selection
  without readings, editing, failure draft retention, mobile layout, deletion
  and event-fetch failures, with a browser timezone different from the enclosure.

## Deployment

1. Review source and tests. Copy the built index.html and new assets to
   var/www/react-app/dist, retaining old hashed assets for existing browsers.
2. Commit and push the exact release. Follow DEPLOYMENT_WORKFLOW.md: fetch on
   AWS, inspect status/services/disk, stage the reviewed updater outside the
   checkout, and dry-run before applying the exact commit.
3. Back up smart_enclosure using pg_dump -Fc and verify the backup inventory.
   Apply migrations/004_events.sql as postgres using psql -v ON_ERROR_STOP=1.
   This is additive and changes no existing rows or Pi database.
4. Restart smart-enclosure-api. Validate nginx with nginx -t, then reload it
   for the /enclosure/ request-body limit increase from 2 KiB to 16 KiB.
   Existing routes retain their own application-level limits.
5. Verify connected state, fresh readings, continued history recording and the
   public dashboard. Create an explicitly labelled deployment-test event, read
   it back in its historical range, edit and delete it, and verify it no longer
   appears. Test a note exceeding the previous proxy limit. Do not change the
   feeding plan or operate hardware.
6. Verify server HEAD and a clean checkout. Write runtime-verification.json
   beside the updater's release.json, including backup, source commit, service
   PIDs, timestamps, API/browser results and limitations.

Rollback uses a reviewed revert release and service activation. Preserve the
events table, including tombstones and user notes; do not drop it or restore an
old database over newer data. A source update alone does not restart the API.
