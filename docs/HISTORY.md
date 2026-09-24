# AWS sensor history

## Scope and current evidence

Local implementation only; no production migration, package installation, service
restart, deployment, or database write was performed for this feature.

Read-only AWS checks on 2026-09-16 confirmed PostgreSQL 15 and TimescaleDB 2.19.0,
with the legacy `public.sensor_data` hypertable still present. Its latest entries
are dated 2025-11-22. The old dashboard labels its temperatures Fahrenheit; the
current Pi contract explicitly uses Celsius and different sensor IDs. The new
`enclosure_history.readings` table preserves this boundary. No old readings are
deleted, converted, re-labeled, or presented as current-sensor history. Viewing the
older archive in this dashboard is a separate follow-up requiring verified units
and physical sensor mapping. No Node/Express or SQLite logger is reactivated.

Only the AWS repository changes. The existing Pi v1 snapshot includes timestamps,
health, labels, wiring identity, Celsius, humidity and pressure and needs no change.

## Data flow

Pi collector -> Pi /v1/sensors -> AWS gateway memory (existing poll)
                                      | every 10 seconds
                                      v
                         PostgreSQL / TimescaleDB
                                      | bounded day query
                                      v
                        /enclosure/history/temperatures
                                      | refresh today every 15 seconds
                                      v
                         debug.html temperature graph

The recorder never makes extra Pi requests. Browser visits are not required for
collection. The single existing gateway process owns one background recorder.
Keep uvicorn `--workers 1`; multi-worker collection is not supported by this design.

A sample is eligible only when the connection is fresh, collector is running and
that hardware sensor is enabled, healthy, and measured within the last 30 seconds.
The original measurement timestamp is stored separately from AWS collection time.
The primary key (measured_at, sensor_id) prevents duplicate cached measurements,
including after restarts. Store Celsius, relative humidity percent, hPa, label and
bus/multiplexer/channel. Simulation never writes to the database, even while a
browser is in simulation. Live collection continues independently of browser mode.

The graph defaults to today in America/New_York, supports any historical day and
C/F display, sensor visibility selection, point inspection, and a daily min/max
summary. Queries cover midnight to midnight in that timezone, including 23/25-hour
DST days; timestamps in PostgreSQL are timestamptz. Minute averages keep payloads
small and retain per-bucket min/max/sample counts. Raw samples remain stored.
No spike smoothing, zero-filling, or extrapolation. Empty minute buckets break
lines; interruptions shorter than a minute can be hidden by aggregation. A single
sample is shown as a dot. Current partial-minute averages update as readings arrive.
Normal visible lag is roughly Pi polling + 10s sampling + up to 15s API cache +
15s browser refresh. This is near real time, not a continuous streaming chart.

## Failure behavior and bounds

- Database writes run outside request handling. Each batch has a 3-second deadline;
  connections have a 1-second timeout and SQL has a 1.5-second statement timeout.
- One bounded batch per tick, no unbounded queue or memory growth. Failed batches
  are not spooled to disk; after recovery only eligible current readings resume.
  Database/Pi outages therefore leave honest gaps. This is not lossless archival.
- Reads have their own 3-second deadline and at most two concurrent queries,
  reserving the third pool connection for collection. Successful day responses
  cache for 15 seconds with at most eight entries. No all-history query is exposed.
- PostgreSQL failure does not disable live readings, relays, or schedules. History
  returns a sanitized 503, and its panel explains failure independently.
- Storage status is exposed through /state without querying the database:
  disabled / starting / waiting_for_fresh_readings / recording / unavailable,
  plus last sample attempt, eligible sensor count, last successful write.
- Browser history requests have a 4.5s abort deadline, no overlap, cancellation on
  mode/date changes, no background-tab polling. Completed past days are fetched
  once per selection; failures retry after 15s. Today follows midnight until the
  user selects another day. Retained charts are labeled when refresh fails.
- With no ENCLOSURE_HISTORY_DSN, storage is disabled and the rest of the gateway
  operates normally. The local simulation-only preview ignores even a configured
  DSN. The simulation UI hides hardware history rather than fabricating an archive.
- No raw exception/connection-string text is returned or logged by history code.

## Deployment plan -- explicit authorization required

Follow DEPLOYMENT_WORKFLOW.md, review/commit/push this release, and use the guarded
exact-commit updater. Do not simply copy the repository onto `/`.

1. Verify the server Git status and active release; back up the PostgreSQL database
   with pg_dump to a root-owned location outside Git and verify the backup exists.
2. Fast-forward the reviewed AWS source through the guarded updater, preserving
   its release/backup record. The updater does not activate runtime changes.
3. Install the updated pinned requirements in the AWS API venv. This adds asyncpg
   and timezone data. Do not change the Pi or enable the obsolete backend service.
4. Review and explicitly apply `home/admin/smart-enclosure-api/migrations/001_history.sql`
   using psql -X -v ON_ERROR_STOP=1 against smart_enclosure as its database owner.
   It creates only a new schema/table/hypertable; it does not touch legacy tables.
   The SQL assumes the verified installed TimescaleDB extension.
5. Provision a dedicated non-superuser LOGIN role, e.g. enclosure_history_app,
   using an interactive/secure password mechanism, not a password in Git or shell
   history. Grant CONNECT on smart_enclosure, USAGE on enclosure_history, and
   SELECT, INSERT on enclosure_history.readings. Grant no schema/table creation,
   update, delete, or legacy-table access. Verify the existing local PostgreSQL
   authentication policy supports it without changing network exposure.
6. Create /etc/smart-enclosure/history.env root-owned mode 0600 outside Git.
   Set ENCLOSURE_HISTORY_DSN to the dedicated role's localhost PostgreSQL
   connection configuration; URL-encode credential characters if using a URI.
   Never paste its value into logs or a release report. systemd reads the file.
7. Install the reviewed smart-enclosure-api.service, daemon-reload, and restart
   only smart-enclosure-api. The optional EnvironmentFile enables the recorder.
   No nginx edit/reload is necessary: the existing /enclosure/ proxy covers this
   API and static /js/history.js is served from the existing web root.
8. Verify as below and record runtime verification separately from Git alignment.

No automatic retention/deletion policy is included. At eight healthy sensors,
10s sampling yields at most roughly 69,120 rows/day (25.2 million/year); sensor
failures and duplicate timestamps reduce this. Track chunk/index size, disk use,
backup duration and graph query time before choosing compression/retention.

## Required remote verification after authorized activation

- Confirm source commit, clean Git tree, active gateway unit, correct single worker,
  and history process logs without exposing environment values.
- Verify recorder reaches recording; SQL shows increasing collected_at values and
  original measured_at timestamps, Celsius values, and healthy configured sensors.
- Observe several 10s intervals, compare to /state, and verify unique keys. Verify
  unhealthy/disabled/stale records are absent and old tables remain unchanged.
- Load today's graph through actual bruck.gg and see updates without reloading.
  Check another day, an empty day, units, mobile and sensor visibility controls.
- Confirm simulation adds no synthetic history while hardware collection continues.
- Verify the dedicated database role can SELECT/INSERT through a real batch and
  cannot perform DDL/DELETE/UPDATE. Check index/Timescale chunk creation and plans.
- Test DB/Pi outage recovery only in a separately approved controlled test or a
  staging setup; do not stop production services as an incidental verification.
  Unit tests cover these failures without disrupting the enclosure.

Rollback: disable history by removing ENCLOSURE_HISTORY_DSN from the protected
configuration and restart the gateway under an authorized operation, or deploy a
reviewed revert commit through the normal fast-forward workflow. Preserve the new
table and all recordings; reverting application code requires no destructive SQL.

## Local verification

Use the AWS .test-venv with requirements.txt installed. Set PYTHONPATH to
home/admin/smart-enclosure-api, then run:

    python -m unittest discover -s home/admin/smart-enclosure-api/tests -v
    python -m unittest discover -s tests -v
    node tests/dashboard.spec.cjs
    git diff --check

The browser suite uses Playwright with every request intercepted; it never contacts
production. Python tests cover hardware freshness, simulation isolation, DST,
deduplication keys, DB failure/recovery, live-response independence, response cache,
and API error sanitization, alongside existing control/preview regressions.
Read-only VALUES-based aggregation was also checked on actual AWS PostgreSQL 15.
The new migration, privileges, real inserts and actual deployed graph still require
the authorized remote verification above; they have not been exercised remotely.

## Humidity and pressure graph selection

Both the main dashboard and debug history graph offer a Reading selector for
Temperature, Humidity (% RH), and Pressure (hPa). One metric is displayed at a
time with its own scale; temperature alone follows the Celsius/Fahrenheit setting.
Date/range and zone/sensor visibility controls continue to apply. Inspection,
accessibility labels, and the debug daily min/max summary follow the selection.
Missing values remain gaps rather than zeroes; zone averages count only sensors
with a finite value for the selected metric.

The existing recorder and NOT NULL database columns already retain all three
metrics. Day and range responses now include humidity_pct and pressure_hpa;
the day endpoint also includes minimum_/maximum_humidity_pct and
minimum_/maximum_pressure_hpa. Existing temperature response fields and URLs
remain compatible. No Pi changes, backfill, or database migration are required.

Validation: API unittest suite, frontend unit tests/lint/build, and intercepted
browser fixtures in tests/dashboard.spec.cjs and tests/history-metrics.cjs.
Deployment still requires authorization: commit/push the reviewed source and
built dashboard assets, follow DEPLOYMENT_WORKFLOW.md with the guarded updater,
and restart smart-enclosure-api to activate the expanded queries. Verify all
three metrics against AWS history and confirm recording continues. Local tests
do not verify deployed database contents or runtime behavior.
