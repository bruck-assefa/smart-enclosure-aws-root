# Keep a relay off

In Enclosure settings → Relay settings, select **Keep off (schedule disabled)**
for the infrared bulb's relay and save. Verify the overview reports both
**Keep off · schedule disabled** and physical state **OFF**.

The Pi saves `mode: "off"` in the existing relay schedule row, immediately
commands the output off, and continues enforcing off at startup and on each
scheduler check. Manual turn-on returns HTTP 409 while disabled. Solar updates
leave disabled relays alone; the saved on/off times and device name are retained.
Choose sunrise/sunset or a custom schedule and save to resume scheduling. Normal
scheduler timing applies when resuming. Other relay schedules are unaffected.

A failed or timed-out save is not confirmation that the physical output is off;
check refreshed enclosure state. The setting is software control, not electrical
isolation.

## Release and verification

Follow DEPLOYMENT_WORKFLOW.md in both repositories. Review, commit and push all
release changes before an explicitly authorized deployment. This feature builds
on the pending Pi relay scheduler changes and their timing configuration; include
those dependencies in the reviewed release. No new schema migration is required.

Deploy and activate the Pi backend first, then the AWS gateway and frontend.
An older Pi does not enforce the off mode, so do not expose it through the UI
before the Pi update is active. Do not roll back the Pi to an older scheduler
while any relay is in off mode: older code ignores the mode and may energize it.

After deployment, with authorization to operate the selected output, save Keep
off on the infrared relay, verify OFF immediately and after a scheduler interval,
and verify a manual on request is rejected. Confirm other relays continue their
schedules. Record runtime verification separately; local tests mock GPIO and do
not establish physical state.
