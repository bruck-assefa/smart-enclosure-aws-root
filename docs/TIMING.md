# Enclosure timing configuration

Edit **home/admin/smart-enclosure-api/timing.json** in the AWS repository.
Every setting has a descriptive name, a `seconds` value and an explanation.
Fractional seconds are supported. Existing intervals and deadlines retain their
initial values. The scheduled relay switch delay defaults to 1 second. Retry
delays double on failures up to the configured maximum.

From the AWS repository, run:

```sh
python3 tools/sync_timing.py
python3 tools/sync_timing.py --check
```

The Pi repository defaults to the sibling `../backend` directory. Use
`--backend /path/to/backend` with either command if it is elsewhere.
The command validates finite durations (positive except the optional relay switch
delay, which also accepts zero) and key polling/freshness
relationships, then generates:

- AWS API `timing_config.py`
- Pi backend `timing_config.py`
- Frontend `src/timing.js` (seconds converted to milliseconds at timer call sites)

Generated files are committed, but must not be edited by hand. `--check` detects
missing or stale copies without writing. Both repositories must be available
for this release check. No runtime request to another machine is needed to load
configuration; the Pi continues scheduling independently if AWS is unreachable.

## Choosing values

Live reading latency combines Pi collection, AWS polling and browser polling,
plus hardware and network time. Adjust all three deliberately. Sensor reads
share a worker, so slow reads can add to other sensors' latency. Freshness
thresholds need headroom beyond normal polling and request durations; the
validator catches obvious conflicts but cannot predict network/hardware latency.
Failure backoff can deliberately exceed freshness thresholds, marking data stale.

Schedule confirmation timeout is the browser's maximum wait for a matching
readback, not a delay before writing. The Pi request timeout bounds both reads
and writes; a timeout leaves the command outcome uncertain. The relay schedule
check now uses an interval timer (60 seconds by default), measured from service
startup rather than the wall-clock minute boundary. Startup still checks schedules
immediately. Saving an active schedule waits for the next scheduled check to
change outputs; saving Keep off commands that output off immediately.

`relay_switch_delay` sets the minimum gap between actual scheduled relay changes,
for both ON and OFF transitions. The default is **1 second**; `0` disables
staggering. Fractional values are supported, up to 10 seconds. With all four
relays due, they switch in order 1, 2, 3, 4 at approximately 0, 1, 2, 3 seconds.
Relays already in the desired state are skipped. Three gaps must fit within
`relay_schedule_check_interval`; generation rejects conflicting settings.

The Pi waits asynchronously, allowing sensor collection and HTTP requests to
continue. It rereads the schedule, current time, and physical relay state after
each wait. Checks cannot overlap, and shutdown cancels pending waits before GPIO
cleanup. Manual test commands remain immediate. Startup schedule restoration
also staggers, so startup may take up to three gaps longer. GPIO initialization
and shutdown cleanup retain their existing behavior; this setting only governs
scheduled transitions. Activate this behavior by deploying the Pi changes,
including `relay_scheduler.py` and regenerated `timing_config.py`, and restarting
beardapi. Verify physical transition spacing on the Pi during an authorized
runtime check; local tests use fake relay callbacks, never GPIO.

This file covers live sensor collection, gateway polling/retries, relay schedule
checks, dashboard polling/confirmation/request deadlines, freshness thresholds,
and historical sampling. Database query/lock limits, chart bucket sizes, calendar
jobs (daily sunrise calculation), CSS animations and legacy debug-page timers are
outside this configuration's scope.

## Release and activation

1. Edit the authoritative JSON; run sync and `--check`.
2. Review/test and commit/push changes in **both** repositories. Record both commits.
3. Follow each repository's DEPLOYMENT_WORKFLOW.md: exact commit, checkout tool
   dry run, and authorized apply. The Pi allowlist includes `timing_config.py`.
4. Build/deploy the frontend using the existing frontend release procedure;
   settings are included in the built JavaScript. Source updates alone do not
   update the served bundle.
5. With deployment authorization, restart the AWS API and Pi backend to load
   their generated constants. Reload the browser to load the new bundle.
6. Verify readings, save confirmation and scheduler behavior on AWS/Pi, and
   record runtime verification separately.

Editing JSON alone has no runtime effect. This change does not deploy or restart
services. Keep the generated files and their corresponding source changes in
one release per repository; do not deploy the new imports without their files.
