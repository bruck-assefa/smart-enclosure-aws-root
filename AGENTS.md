# Smart Enclosure — AWS Application

## Purpose

This repository contains the AWS-hosted portion of the Smart Enclosure system.

The source code is edited locally on the Windows development machine.

The actual application is hosted on the AWS server.

The local Windows machine is ONLY a source-code development environment.

The complete application is not configured to run locally.

Do not attempt to verify application functionality using localhost, local Tailscale, local systemd, or other local runtime services.

## Source Code

All source-code changes should be made in this local Git repository.

Do not edit production source files over SSH unless I explicitly request it.

Git changes should be reviewed locally before deployment.

Never assume that successfully editing local source means the deployed application has changed.

## AWS Runtime

The AWS server is the real runtime environment for this repository.

SSH host:

```
aws-ec2
```

Use SSH when information from the actual runtime environment is needed.

Examples:

```
ssh aws-ec2 "tailscale status"
ssh aws-ec2 "systemctl --type=service --state=running"
ssh aws-ec2 "ps aux"
```

Do not interpret localhost, local Tailscale, local services, or network state on the Windows development machine as representing the AWS server.

## Repository Layout

This repository represents selected portions of the AWS server filesystem rather than a conventional single application directory.

Tracked paths may correspond to locations such as:

```
/etc/nginx/
/var/www/
/home/admin/smart-enclosure-backend/
/home/admin/smart-enclosure-frontend/
```

The local repository is a Git representation of these paths.

Do not assume that local filesystem paths are literal Windows equivalents of the production paths.

Do not copy or synchronize the repository root directly onto `/` on the AWS server.

Production deployment must use an explicitly defined deployment procedure.

## Related Raspberry Pi Backend

The enclosure-side backend exists in the other Git repository attached to this Codex project.

The Raspberry Pi runtime can be reached using:

```
ssh beardapi
```

The Raspberry Pi handles enclosure hardware and sensor functionality.

Changes to interfaces between AWS and the enclosure backend may require modifications in both repositories.

When modifying:

* API routes
* request formats
* response formats
* authentication behavior
* sensor data structures
* device identifiers

inspect the Raspberry Pi/backend repository for corresponding usage before considering the change complete.

## Remote Access Policy

By default, SSH access should be treated as read-only investigation.

It is acceptable to inspect:

* application logs
* running processes
* service status
* network status
* Tailscale status
* application configuration
* deployed source versions
* Git status
* filesystem layout
* nginx configuration

Do NOT without explicit approval:

* modify production files
* restart or stop services
* install or remove packages
* change nginx configuration
* modify systemd services
* run database migrations
* deploy code
* reboot the server
* delete files

## Testing

There is currently no supported local development environment for running the complete Smart Enclosure AWS application.

Do not attempt to start the complete application locally unless a local development environment is explicitly created in the future.

Local static analysis, unit tests, syntax checks, and other tests that do not require the production environment may still be run when supported by the repository.

When runtime verification is necessary, use the `aws-ec2` SSH host.

Unless explicitly authorized to deploy, runtime inspection must not modify the deployed application.

## Development Workflow

The expected workflow is:

1. Inspect the local repository.
2. Use SSH to inspect AWS when runtime information is required.
3. Use `beardapi` when Raspberry Pi runtime information is required.
4. Make source changes locally.
5. Review and test local changes where possible.
6. Do not deploy until explicitly instructed.
7. After deployment, verify behavior against the appropriate runtime environment.

Never treat the Windows development machine as the production runtime.

## Git and release consistency
- Commit and push reviewed local changes before deploying an exact commit.
- Server master must fast-forward to that release; never force-push or hard-reset.
- Use tools/update_checkout.py first in dry-run mode, then --apply only for an
  authorized deployment/reconciliation. Follow DEPLOYMENT_WORKFLOW.md.
- Keep the Pi database and distro-owned nginx parameter files outside Git.
- Preserve unexpected server edits; bring intentional source changes back locally.
- A source update does not restart a service. Follow the release-specific activation
  plan, verify runtime behavior, and record successful verification separately.
