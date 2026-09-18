# Feeding schedule release

Adds separate salad and bug schedules on AWS. Each may use selected weekdays or
an anchored interval of 1–365 calendar days. Days follow America/New_York; a food
can coincide with the other food. Both schedules start disabled. The dashboard
shows the plan, not a record of whether feeding has actually happened.

The new /enclosure/feeding GET and PUT routes never call the Pi. Existing relay,
camera and sensor contracts stay intact. Settings use the same explicit write
header/source convention as the existing settings API. A version comparison
rejects stale edits with HTTP 409. No new authentication system is introduced.

## Release and activation

1. Run gateway tests, frontend lint/build and browser checks with isolated feeding
   fixtures. Commit and push source and the static build. Check server state.
2. Stage the reviewed updater outside the checkout. Dry-run the exact commit and
   apply using DEPLOYMENT_WORKFLOW.md. Keep generated backups.
3. Run migrations/003_feeding.sql as postgres in smart_enclosure. This adds a new
   singleton settings table and only SELECT/UPDATE privileges for the app role.
   Its seed is idempotent and never overwrites an existing plan. It does not
   modify the history tables or the Pi database.
4. Restart smart-enclosure-api, then verify /feeding, connected sensor state,
   continued historical recording, and the rendered dashboard/settings.
   No Pi restart, relay commands, nginx change, or dependency install is needed.
5. Verify saving the unchanged disabled plan and reloading, without assigning a
   feeding routine for the user. Record runtime-verification.json next to release.json.

Rollback uses a reviewed revert commit for application code. Retain the settings
table and any user data; do not drop it or restore a database over live state.
