> Deployment update: this implementation was deployed on 2026-09-16. See the AWS repository docs/DEPLOYMENT_2026-09-16.md for verified results and rollback locations. The original review plan below is retained as implementation history.

# Current-state gateway and simulation — implementation review

Status: local changes only. No deployment, service restart, production configuration
change or database migration has been performed.

## Scope
This implements sensor isolation, health reporting, simulation, diagnostics and
AWS current-state caching. It does not revive the old React/Express application.
It does not yet collect PostgreSQL history, change existing history, add an
authentication system or repair Tailscale.

## Architecture
Pi hardware child -> supervised memory snapshot -> GET /v1/sensors
-> AWS Python background collector -> cached GET /enclosure/state -> debug.html.

Browser reads never contact the Pi synchronously. A single AWS refresh concurrently
fetches sensors, relays and schedules. Each request has a 2.5-second total deadline
and a 128 KiB response cap. Invalid responses retain the last accepted snapshot.
Refresh is every 5 seconds on success, backing off to 60 seconds on failures.
Requests and background tasks are canceled on shutdown.
Run one gateway worker: multiple workers would create independent collectors.

AWS retains state in memory only. Cold start is explicitly unavailable until a
valid response arrives. Sensor timestamps come from the Pi, never AWS poll time.
Reading age continues increasing during outages. The schema rejects a legacy
/sensors response, synthetic data on the live input, and future timestamps.
Clock synchronization on both machines is required.

## Files
- home/admin/smart-enclosure-api/app.py: new FastAPI/httpx application.
- sensor_contract.py and sensor_simulator.py: vendored from the Pi repository.
- preview.py: explicit isolated source-development preview.
- etc/systemd/system/smart-enclosure-api.service: proposed startup unit.
- etc/nginx/sites-available/bruck.gg: adds same-origin /enclosure/ proxy.
- var/www/bruck.gg/debug.html and js/enclosure.js: current dashboard.
- tests/dashboard.spec.cjs: fully intercepted browser regression tests.

Production proposal: Python venv, port 8011 bound to 127.0.0.1, service user admin.
The existing api.bruck.gg/pi routes and camera proxy remain for compatibility.
The legacy Express/Vite services remain untouched and are not dependencies.

## API and mode safety
GET /state?source=hardware returns cached source state plus connection health and
cached relay/schedule state. GET /state?source=simulation&scenario=... generates
isolated synthetic state without changing collection mode.
Set ENCLOSURE_SIMULATION=1 to expose scenarios; the proposed unit enables it.
Set ENCLOSURE_LIVE=0 to disable all live collection and physical commands.
The preview constructs these flags explicitly and cannot be enabled by a query.

Scenarios: healthy, sensor_error, stale, intermittent, mux_offline, pi_offline.
Synthetic readings never enter a database. No automatic live-to-synthetic fallback.
The browser shows a permanent simulation banner and disables physical controls/camera.

Control endpoints require source=hardware and X-Enclosure-Control: 1, fresh cached
relay/schedule state and a single in-flight command. Commands are not automatically
retried. A failed request is reported as outcome unknown; it may have reached the Pi.
These checks prevent accidental simulation controls and browser cross-origin simple
requests; they are NOT user authentication. The existing public unauthenticated
Pi proxy also remains. Auth/access control needs separate review before expanding access.

The dashboard uses one completion-scheduled poll with a 4.5-second deadline,
backoff, mode-change cancellation and visibility handling. It never polls I2C scans.
Sensor diagnostics show all configured positions, wiring, freshness, error and
failure count. Last good readings remain labeled; absent values are not zero.
Hardware errors identify affected paths, not a proven faulty physical component.
Unsaved schedule edits survive refresh. The camera loads only on request.

## Supported local simulation development
This is an explicitly isolated preview, not a reproduction of either remote runtime.
Use Python 3.11+ and create a local venv; install only this gateway's requirements.
From home/admin/smart-enclosure-api:
```
python -m uvicorn preview:app --host 127.0.0.1 --port 8011
```
Open http://127.0.0.1:8011/debug.html?source=simulation.
No Pi connection, GPIO import or database access occurs. This tests software behavior,
not remote Tailscale, GPIO, nginx or production performance.

## Tests
From home/admin/smart-enclosure-api:
```
python -m unittest discover -s tests -v
```
Tests use HTTPX MockTransport and FastAPI TestClient, not real network services.
From the AWS repository, with Playwright installed and a browser available:
```
node tests/dashboard.spec.cjs
```
Every browser HTTP request is intercepted; the test never contacts production.
Run the Pi standard-library test suite separately and compare the two vendored files.
Do not install the Pi hardware requirements on Windows for these tests.

## Proposed deployment sequence — requires explicit authorization
1. Preserve/review uncommitted live Pi and AWS files. Do not blanket-copy either repo.
2. Resolve or explicitly accept existing Tailscale outage for initial simulation-only use.
3. Deploy the reviewed Pi Python changes and missing APScheduler/Astral declarations;
   preserve database, existing environment and service settings. Restart requires approval.
4. Verify /v1/sensors independently, real freshness and bad-sensor isolation.
5. Provision the new AWS gateway venv/service at its documented path; install requirements.
6. Confirm port 8011 is free and the admin service user can read its files.
7. Validate/start the gateway, then nginx configuration and reload, only when authorized.
   Keep sites-enabled as the existing symlink; preserve the tracked symlink representation (Windows may materialize only its target text).
8. Publish debug.html and js/enclosure.js together after gateway readiness.
9. Verify same-origin requests, outage behavior, simulation isolation and controls.
   Device-control testing needs an explicitly approved physical test.
10. Rollback should restore the preserved deployed dashboard/Pi source and nginx config,
    not blindly use old Git HEADs (both production checkouts have uncommitted changes).

Remote checks still needed: Linux process termination/driver behavior; healthy sensor
progress during failures; actual hardware inventory; Tailscale routing; Pi/AWS clocks;
systemd sandbox/permissions; nginx syntax and routing; elapsed response times; camera.
Existing relay startup can affect outputs and daily sun sync overwrites custom times.

## Remaining limits
The collector cannot repair electrical faults. One bus owner serializes hardware reads;
a bad channel can add bounded collection delay even though cached HTTP stays responsive.
If a process cannot be killed, collection stops rather than creating competing bus owners.
State is not durable across restart. Long-term PostgreSQL ingestion is a later stage.
The old dashboard's continuous scan is intentionally removed. The second mux is disabled
by default to match deployed behavior; confirm it before enabling.
