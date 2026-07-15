# Operations runbook

This runbook describes the baseline operational checks for a self-hosted Docker Compose deployment. It is not a managed-service SLA or a substitute for the operator's monitoring, database backup, document-storage backup, vulnerability-management, or incident-response process.

## Health monitoring

LicenseTrack exposes a health endpoint at:

```text
GET /api/health
```

A healthy response is HTTP 200 with a JSON body containing `status: "ok"` and the running version. Docker Compose also uses this endpoint for the container health check.

Minimum recommended monitors:

- Poll `https://<your-host>/api/health` at least every 1 to 5 minutes.
- Alert if the endpoint is unavailable, returns non-200, or times out.
- Alert if the Docker container is unhealthy or repeatedly restarting.
- Alert on low free disk space for the volume that stores `/data`.
- Alert on failed scheduled database backups or no recent database backup within the expected window.

Useful commands:

=== "Bash"

    ```bash
    docker compose ps
    docker compose logs --tail=200 license-lifecycle
    docker inspect --format='{{json .State.Health}}' <container-name-or-id>
    ```

=== "PowerShell"

    ```powershell
    docker compose ps
    docker compose logs --tail=200 license-lifecycle
    docker inspect --format='{{json .State.Health}}' <container-name-or-id>
    ```

## Log review

The application logs HTTP requests, startup failures, scheduler work, and unhandled server errors to container stdout/stderr. Docker Compose configures the `json-file` log driver with rotation.

Review logs for:

- repeated `500` responses;
- failed Alembic migrations at startup;
- database backup or restore failures;
- notification or SMTP delivery failures;
- OIDC discovery, callback, or token-validation failures;
- repeated failed login attempts or rate-limit responses;
- storage-path or upload-validation errors.

Operators should forward Docker logs to their normal log platform if centralized retention, search, or alerting is required.

## Database backup and document storage checks

LicenseTrack database backups are SQLite snapshots only. Uploaded documents are stored separately under `/data/storage`, so complete recovery requires backing up the full `/data` volume or an equivalent database-plus-storage snapshot.

Minimum recommended checks:

- Confirm scheduled database backups are enabled when required.
- Confirm new database backup files appear in the configured backup directory.
- Confirm database backup retention does not allow the disk to fill.
- Copy database backups or full-volume snapshots off host.
- Test restore in a non-production environment before go-live and after material upgrade changes.
- Include uploaded document storage in disaster-recovery testing.

See [Backup & restore](backup-restore.md) and the [Deployment guide](deployment.md) for database backup behavior and full-volume backup examples.

## Audit review

Admins can review and export audit history for authentication, settings, user, database backup, document, and data-changing actions.

Suggested periodic checks:

- Review failed login patterns.
- Review user, role, department-access, OIDC, SMTP, database backup, and storage-setting changes.
- Review restore events and failed database backup attempts.
- Confirm audit retention matches local policy.

## Vulnerability management

For every release candidate:

- Run the backend and frontend verification commands listed in the [project README](https://github.com/zndr88/LicenseTrack/blob/main/README.md) from the exact release commit.
- Retain dependency audit artifacts, SBOMs, Docker image scan output, build logs, release version, commit SHA, and any vulnerability triage notes.
- Triage dependency, base-image, and OS package findings before production rollout.
- Re-run scans after dependency updates, base image updates, or advisories affecting declared dependencies.

If Docker is unavailable on a local workstation, the verifier can skip image scanning for local development only. Final release evidence should include a Docker image build and at least one completed image scan.

## Upgrade checks

Use the full [upgrade guide](upgrade.md) for the step-by-step Docker Compose upgrade procedure.

Before upgrading:

- Back up the full `/data` volume or otherwise capture both database and uploaded documents.
- Confirm which Docker volume is mounted at `/data`.
- Confirm the target image was built and scanned from the release commit.
- Review release notes and configuration changes.
- Run the upgrade in a non-production environment if local policy requires it.
- Do not run `docker compose down -v` unless you intentionally want to delete persistent data.

After upgrading:

- Confirm `/api/health` is healthy.
- Confirm the container is not restarting.
- Review logs for migration errors.
- Log in with an admin account.
- Smoke-test license listing, document access, settings, database backup listing, and any configured SMTP/OIDC integrations.
- Confirm scheduled database backup and notification settings remain as expected.

## Incident response

**For an application outage:**

- Check container state and health.
- Review recent logs.
- Confirm disk space for `/data`.
- Confirm the reverse proxy can reach the container.
- Confirm recent configuration or image changes.
- Roll back to the previous known-good image if needed, preserving `/data`.

**For suspected data loss or corruption:**

- Stop writes by taking the application out of service.
- Preserve the current `/data` volume before attempting restore.
- Restore in a non-production environment first when possible.
- Restore from the most recent known-good database backup and document-storage snapshot.

**For suspected credential compromise:**

- Rotate `JWT_SECRET` and other affected credentials according to local policy.
- Review users, roles, OIDC settings, SMTP settings, and audit logs.
- Invalidate active access by restarting after secret rotation and requiring affected users to reauthenticate.
- Preserve logs and audit exports for investigation.
