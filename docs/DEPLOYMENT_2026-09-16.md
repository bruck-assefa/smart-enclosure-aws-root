# Deployment — 2026-09-16

Release: 20260916T0628Z. Deployment explicitly authorized by the user.

## Activated
- Pi: main.py, sensor_collector.py, sensor_worker.py, sensor_contract.py,
  sensor_simulator.py, requirements.txt; restarted beardapi.service.
- Pi's installed systemd unit and database were preserved. Existing APScheduler
  3.11.2 and Astral 3.2 already met requirements; no Pi package install was needed.
- AWS: new Python gateway at /home/admin/smart-enclosure-api, dedicated venv,
  enabled smart-enclosure-api.service (admin, loopback TCP 8011).
- AWS required python3.11-venv and its four supporting packages; installed without
  upgrading other OS packages. Gateway requirements installed into its venv.
- nginx site validated with nginx -t, then reloaded. Existing enabled-site symlink preserved.
- Published debug.html and js/enclosure.js.
- No PostgreSQL migration or data edits. Old Express/Vite services remain inactive.

## Verification
- All 14 deployed file hashes match local source; see adjacent manifest JSON.
- Pi and gateway active, zero automatic restarts during verification.
- Pi sensor snapshots responded in ~6–7 ms after initial request.
- Healthy sensor timestamps advanced across spaced samples despite failing channels.
- Observed sensors 0, 1, 2, 3, 6 healthy; 4, 5, 7 reported device_read_error.
  Positions 8–15 remain disabled, matching the reviewed inventory policy.
- Both actual remote Tailscale clients report Running at completion. Pi initially
  reported NeedsLogin; connection was restored during deployment without this agent
  changing Tailscale credentials or configuration.
- AWS-to-Pi request returned 200 in ~53 ms.
- Public live and simulation state endpoints returned 200 in ~79–87 ms from AWS.
- Browser verified live connection, 16 health cards, diagnostics, simulation scenarios,
  disabled physical controls in simulation and enabled controls with fresh live state.
- No physical relay toggle or schedule write was issued as a verification test.
- Camera HTTP page returned 200; video/media playback was not independently tested.
- The old Pi process did not exit gracefully: systemd applied its existing 90-second
  stop timeout and killed it before starting the new application. New startup succeeded.
  The application's existing startup/scheduler database and relay behavior remains.

## Rollback material
Pi: /home/pi/enclosure-deployments/20260916T0628Z/
- before.tar.gz: prior application/config files
- installed-beardapi.service: preserved actual service
- enclosure-backup.db: consistent pre-deployment SQLite backup
- packages-before.txt and working-tree-before.patch

AWS: /root/enclosure-deployments/20260916T0628Z/
- before.tar.gz: actual previous nginx site and debug.html
- working-tree-before.patch: prior uncommitted changes
- stage/: uploaded deployment files

If rollback is needed, restore the backed-up application/dashboard/nginx files and
restart/reload only the affected services. Do not blindly restore SQLite over newer
runtime events or overwrite databases from the local repository. Stop/disable the new
AWS gateway only if reverting its nginx route. Retain backups and review changes made
since this deployment before restoring. Both original live checkouts had uncommitted
changes; Git HEAD alone is not a complete rollback source.

## Remaining scope
State cache is in memory. Historical PostgreSQL collection and user authentication
are not implemented in this release. Hardware failures still need physical diagnosis.
