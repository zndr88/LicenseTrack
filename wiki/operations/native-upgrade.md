# Native Linux upgrades

This procedure applies only to instances installed by LicenseTrack's native installer. Docker and Podman installations must use the [container upgrade guide](upgrade.md).

## Upgrade

Download and verify the target native release archive, then run its upgrade entrypoint:

```bash
sha256sum --check SHA256SUMS
tar -xzf licensetrack-native-<version>-linux-x86_64.tar.gz
cd licensetrack-native-<version>-linux-x86_64
sudo ./upgrade.sh
```

The upgrader refuses downgrades and same-version reinstalls. Existing secrets and configuration values are preserved; newly introduced native defaults are appended without replacing operator-managed values.

## Transaction sequence

The upgrader:

1. Verifies every file listed in the native release manifest.
2. Creates the candidate release and isolated Python environment while the current service is still running.
3. Stops LicenseTrack and its managed plugin processes.
4. Creates a restricted pre-upgrade archive under `/var/backups/licensetrack/upgrades`.
5. Runs the candidate Alembic migrations against a SQLite snapshot and checks database integrity.
6. Migrates the live database only after the snapshot migration succeeds.
7. Atomically switches `/opt/licensetrack/current` to the candidate release.
8. Starts the service and requires `/api/health` to report the exact target version.

The pre-upgrade archive includes:

- a WAL-consistent SQLite snapshot;
- the complete managed data directory, including documents and plugins;
- `/etc/licensetrack/licensetrack.env` and installation state;
- any document-storage directory configured outside the managed data root;
- a manifest recording the source version and restored paths.

Downtime begins when the old service stops and ends after the target health check passes.

## Automatic rollback

If the live migration, service startup, or version health check fails, the upgrader automatically:

1. Stops the candidate service.
2. Restores the pre-upgrade data and SQLite snapshot.
3. Restores the previous environment and install state.
4. Switches the active symlink back to the previous release.
5. Starts the previous release and verifies its health and version.

The command exits unsuccessfully after a successful rollback so monitoring and automation still report that the attempted upgrade failed.

Do not use `alembic downgrade` as an operational rollback procedure. Restore the matched application release and pre-upgrade data snapshot together.

## Post-upgrade checks

```bash
sudo licensetrack version
sudo licensetrack doctor
sudo licensetrack status
sudo journalctl -u licensetrack.service --since "15 minutes ago"
```

Then sign in and verify license listing, document access, settings, database backup listing, configured plugins, SMTP, and OIDC behavior.

## Existing manual or container deployments

A release installed manually from source has no `/etc/licensetrack/install.json`, so the upgrader cannot safely infer its database, storage, service, or configuration paths. Container volumes also have different ownership and lifecycle rules.

Do not fabricate an install-state file. Continue using the existing deployment method until a dedicated adoption or Docker-to-native migration command is available.
