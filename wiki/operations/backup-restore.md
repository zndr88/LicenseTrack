# Backup & restore

## What it is

Database Backup and Restore lets you create point-in-time snapshots of the LicenseTrack database and restore the database if something goes wrong.

!!! warning "Documents are not in the database backup"
    Uploaded documents are stored separately on disk and are **not** included in these database backup files. To protect attachments you must back up the document storage directory independently - see [Things to know](#things-to-know) below.

## How it works

### Database backups

LicenseTrack uses SQLite's built-in online backup API to capture the database. Rather than copying the live file - which could be mid-write - it opens a connection to the database and streams a consistent snapshot into a temporary file. This means a database backup taken while users are actively working will still be internally consistent. The snapshot is compressed into a timestamped zip archive named `license_lifecycle_backup_YYYYMMDD_HHMMSS.zip` and written to the configured database backup directory.

After every database backup, LicenseTrack prunes the database backup directory, keeping only the most recent N files. The number of files to keep is set in global settings. Files older than the retention count are deleted automatically.

The archive list on the admin page shows validated routine database backups,
portfolio-reset recovery archives, and document-restore safety archives from
the configured server backup directory. Each entry identifies its type, size,
and creation time.

### Scheduled database backups

LicenseTrack's background scheduler can run a database backup automatically each day at a configurable hour. The backup hour is set in global settings alongside the notification hour. The scheduler calculates which of the two fires next and sleeps until that time, rather than polling on a fixed interval.

### Manual database backups

An admin can trigger a database backup immediately from the admin page without waiting for the scheduled window.

### Database restore

Admins can restore from either:

- **This server** - select a validated archive already present in the configured
  backup directory.
- **This computer** - upload an off-host backup or recovery archive.

Server selection accepts an exact filename from the validated archive list.
Arbitrary paths, parent-directory references, symlinks, unlisted files, and
invalid archives are rejected.

Before overwriting a routine database backup, LicenseTrack validates the
candidate SQLite database and takes a WAL-consistent safety snapshot of the
current database using SQLite's backup API, named with a `pre_restore`
timestamp. It then replaces the live database file. Managed document files are
left unchanged.

A database-only restore preserves document records and configuration in the
database, but it does not guarantee that the referenced managed files are
present in the current storage path. If document storage has not yet been
restored, is unavailable, or is misconfigured, LicenseTrack keeps the metadata
visible and reports the affected files as missing or unavailable.

Portfolio-reset recovery and document-restore safety archives contain both a
database and managed documents. Before restoring either type, LicenseTrack
creates a fresh database-and-document safety archive in the configured backup
directory. It stages and validates archive paths, swaps only the managed
license, sourcing, procurement, and contract document directories, validates
and restores the database, and rolls the document swap back if database
restoration fails.

When `RESTART_AFTER_RESTORE=true`, LicenseTrack sends `SIGTERM` to its own
process after the response is sent so the process manager restarts it cleanly
against the restored database. Native installations normally return within
about 10 seconds; a brief connection failure while systemd starts the new
process is expected.

The restore event is written to the audit log before the database file is overwritten, using a separate database session, so the record is preserved even after the main session becomes unusable.

### Reset portfolio data

**Reset Portfolio Data** is an admin-only clean-start operation intended for
removing imports and test activity before a deployment goes live. It deletes
the entire operational portfolio, including current and historical licenses,
renewal and maintenance chains, sourcing requests and items, pending orders,
contracts, associated documents, document-processing results, webhook delivery
history, and prior audit events. Completed and cancelled sourcing and
pending-order history is included.

The reset preserves users, access settings, personal and global settings,
custom-field definitions, import mappings, API tokens, webhook endpoint
definitions, integration capabilities, Official Extension configuration, and
existing backup files. Custom-field values attached to deleted licenses are
removed. The public license reference sequence returns to `LT-REF-00001`;
internal database IDs are not reset.

Before any rows are deleted, LicenseTrack creates and verifies a recovery
archive in the configured backup directory. Unlike routine database backups,
this archive contains both a WAL-safe database snapshot and the managed license,
sourcing, procurement, and contract document directories. The reset is aborted
if the archive cannot be created. Recovery archives are named
`license_lifecycle_pre_portfolio_reset_<timestamp>.zip` and are not pruned by
routine database-backup retention.

After the reset, the old audit log is replaced by one
`system.portfolio_reset` event recording the administrator, recovery archive,
and deleted record counts. An administrator must review the affected counts and
type the exact `RESET PORTFOLIO` phrase before the action is enabled.

To undo a reset, open **Restore Database**, select the portfolio recovery
archive from the server list, review that it restores both database and
documents, and confirm. The upload option provides the same behavior when the
archive has first been copied off-host.

## Key concepts

- **WAL-safe snapshot** - a consistent copy of the database taken via SQLite's backup API, safe to use even when the database is under active write load.
- **Database backup retention** - the maximum number of database backup zip files kept on disk before older ones are pruned.
- **Safety snapshot** - a WAL-consistent copy of the current database file created automatically before any database restore begins, taken via SQLite's backup API so dirty WAL pages are always included.
- **Portfolio reset recovery archive** - a pre-reset archive containing both the database and managed portfolio documents, retained separately from routine database-backup pruning and directly restorable from the admin interface.
- **Document-restore safety archive** - a database-and-document snapshot created automatically before another database-and-document archive is restored.
- **`SIGTERM` restart** - the process signal sent to LicenseTrack after a restore when `RESTART_AFTER_RESTORE=true`, triggering a clean process restart under a process manager.

## Who can use it

Admins only.

## Things to know

!!! danger "Restore is irreversible"
    Database restore is irreversible once the restored database is in place. All database rows written between the backup's timestamp and the moment of restore will be gone. The safety snapshot created before overwrite is a raw `.db` file saved next to the database, not a numbered database backup - it will not appear in the database backup list and is not managed by the retention policy.

- The database backup covers the database file only. Uploaded documents (license attachments, contract files, sourcing documents, and procurement documents) are stored on the filesystem separately and are not included in the database backup zip. You must back up the document storage directory - shown in the Storage settings - independently using your own backup tooling. A warning banner on the database backup admin page makes this explicit.
- After a database-only restore, document counters distinguish records from currently available files. Missing files are warnings, not database corruption, and records are not deleted automatically.
- In Docker Compose and native deployment, database restore exits the backend process so the process manager can restart it. The native systemd service uses `Restart=always`, because a successful restore exits cleanly and is not considered a failure by systemd. An explicit `licensetrack stop` remains stopped. For direct local development, leave `RESTART_AFTER_RESTORE=false` to keep the backend running after restore. Users may need to sign in again if their restored database no longer matches the current session.
- The database backup directory must be writable by the LicenseTrack process. LicenseTrack attempts to create the configured directory, including missing parent directories, when a backup runs. If the process cannot create or write to that path, the backup fails.
- LicenseTrack verifies the integrity of a newly created database backup zip before returning success. If the zip is corrupt, it is deleted and the database backup is reported as failed.
- The database backup retention setting must be between 1 and 100. After each backup, older database backup zip files beyond that retention count are pruned automatically.
