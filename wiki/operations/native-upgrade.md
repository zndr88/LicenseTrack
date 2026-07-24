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
3. Stops LicenseTrack and its managed Official Extension processes.
4. Creates a restricted pre-upgrade archive under `/var/backups/licensetrack/upgrades`.
5. Runs the candidate Alembic migrations against a SQLite snapshot and checks database integrity.
6. Migrates the live database only after the snapshot migration succeeds.
7. Atomically switches `/opt/licensetrack/current` to the candidate release.
8. Refreshes the managed systemd unit and operator CLI from the target release.
9. Starts the service and requires `/api/health` to report the exact target version.

The pre-upgrade archive includes:

- a WAL-consistent SQLite snapshot;
- the complete managed data directory, including documents and Official Extension packages;
- `/etc/licensetrack/licensetrack.env` and installation state;
- the managed `/usr/local/bin/licensetrack` operator wrapper when present;
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

## Operator-initiated rollback

After a successful native upgrade, an administrator can deliberately return to
the version captured by its pre-upgrade backup:

```bash
sudo licensetrack rollback
```

The default archive is the `last_upgrade_backup` recorded in
`/etc/licensetrack/install.json`. To select a different archive, first place it
under the configured upgrade-backup directory and pass its full path:

```bash
sudo licensetrack rollback \
  --backup /var/backups/licensetrack/upgrades/licensetrack-pre-upgrade-<version>-<timestamp>.tar.gz
```

The command displays the current and target versions and requires you to type
`ROLLBACK <target-version>`. For non-interactive automation, `--yes` accepts
that confirmation. Use it only after independently confirming the archive and
target version.

Before making changes, the rollback command verifies that:

- the archive is inside this installation's configured upgrade-backup directory;
- the archived installation paths match the current managed installation;
- the target version is older and its immutable release directory is still installed;
- the archived configuration, database path, and backup manifest agree;
- the SQLite snapshot passes an integrity check; and
- all archive paths and external-storage entries are safe to restore.

The service is stopped only after validation and confirmation. LicenseTrack
then creates a separate `licensetrack-pre-rollback-*` safety archive of the
current version, restores the selected application data and configuration,
switches the active release, starts the service, and requires the target version
to pass `/api/health`. New-format archives also restore the operator wrapper
that belonged to the target installation, so commands do not dispatch into a
mismatched release after rollback.

If the manual rollback fails after restoration begins, LicenseTrack uses the
pre-rollback safety archive to recover the version that was active when the
command started. `--no-start` is available for maintenance situations where the
restored service must remain stopped; in that mode, no post-restore health check
is possible.

!!! warning
    A rollback replaces the database, documents, Official Extension data, configuration,
    and configured external document storage with their archived state. Changes
    made after the selected archive was created are not retained in the rolled-
    back instance. Preserve the automatically created pre-rollback safety
    archive until the rollback has been fully accepted.

## Post-upgrade checks

```bash
sudo licensetrack version
sudo licensetrack doctor
sudo licensetrack status
sudo journalctl -u licensetrack.service --since "15 minutes ago"
```

Then sign in and verify license listing, document access, settings, database backup listing, configured Official Extensions, SMTP, and OIDC behavior.

When upgrading from 1.1.0 or earlier, a browser may still hold the old SPA shell
under its previous cache policy. If the health endpoint reports the new version
but the interface still looks or behaves like the old release, perform one hard
refresh or clear that site's cached files. Releases from 1.1.1 onward require
the SPA shell to revalidate, so this should be a one-time transition.

## Existing manual or container deployments

A release installed manually from source has no `/etc/licensetrack/install.json`, so the upgrader cannot safely infer its database, storage, service, or configuration paths. Container volumes also have different ownership and lifecycle rules.

Do not fabricate an install-state file. Continue using the existing deployment method until a dedicated adoption or Docker-to-native migration command is available.
