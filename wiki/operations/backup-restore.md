# Backup & restore

## What it is

Database Backup and Restore lets you create point-in-time snapshots of the LicenseTrack database and restore the database if something goes wrong.

!!! warning "Documents are not in the database backup"
    Uploaded documents are stored separately on disk and are **not** included in these database backup files. To protect attachments you must back up the document storage directory independently — see [Things to know](#things-to-know) below.

## How it works

### Database backups

LicenseTrack uses SQLite's built-in online backup API to capture the database. Rather than copying the live file — which could be mid-write — it opens a connection to the database and streams a consistent snapshot into a temporary file. This means a database backup taken while users are actively working will still be internally consistent. The snapshot is compressed into a timestamped zip archive named `license_lifecycle_backup_YYYYMMDD_HHMMSS.zip` and written to the configured database backup directory.

After every database backup, LicenseTrack prunes the database backup directory, keeping only the most recent N files. The number of files to keep is set in global settings. Files older than the retention count are deleted automatically.

The database backup list on the admin page shows the ten most recently created database backups, sorted newest first, with each file's size and creation time.

### Scheduled database backups

LicenseTrack's background scheduler can run a database backup automatically each day at a configurable hour. The backup hour is set in global settings alongside the notification hour. The scheduler calculates which of the two fires next and sleeps until that time, rather than polling on a fixed interval.

### Manual database backups

An admin can trigger a database backup immediately from the admin page without waiting for the scheduled window.

### Database restore

To restore, an admin uploads a database backup zip from the admin page. Before overwriting anything, LicenseTrack takes a WAL-consistent safety snapshot of the current database using SQLite's backup API (the same approach as scheduled backups), named with a `pre_restore` timestamp, so you have a reliable fallback if the restore goes wrong. LicenseTrack then validates the zip contains a `.db` file, extracts it with path-traversal protection (stripping any directory components from the zip entry name), and replaces the live database file. Uploaded document files are not restored by this action. After the restore completes, LicenseTrack sends `SIGTERM` to its own process so the process manager restarts it cleanly against the restored database.

The restore event is written to the audit log before the database file is overwritten, using a separate database session, so the record is preserved even after the main session becomes unusable.

## Key concepts

- **WAL-safe snapshot** — a consistent copy of the database taken via SQLite's backup API, safe to use even when the database is under active write load.
- **Database backup retention** — the maximum number of database backup zip files kept on disk before older ones are pruned.
- **Safety snapshot** — a WAL-consistent copy of the current database file created automatically before any database restore begins, taken via SQLite's backup API so dirty WAL pages are always included.
- **`SIGTERM` restart** — the process signal sent to LicenseTrack after a restore to trigger a clean process restart.

## Who can use it

Admins only.

## Things to know

!!! danger "Restore is irreversible"
    Database restore is irreversible once the process restarts. All database rows written between the backup's timestamp and the moment of restore will be gone. The safety snapshot created before overwrite is a raw `.db` file saved next to the database, not a numbered database backup — it will not appear in the database backup list and is not managed by the retention policy.

- The database backup covers the database file only. Uploaded documents (license attachments, contract files, sourcing documents, and procurement documents) are stored on the filesystem separately and are not included in the database backup zip. You must back up the document storage directory — shown in the Storage settings — independently using your own backup tooling. A warning banner on the database backup admin page makes this explicit.
- A database restore requires the server process to restart. Any users currently logged in will be disconnected and will need to log in again. Plan restores for a low-activity window.
- The database backup directory must be writable by the LicenseTrack process. LicenseTrack attempts to create the configured directory, including missing parent directories, when a backup runs. If the process cannot create or write to that path, the backup fails.
- LicenseTrack verifies the integrity of a newly created database backup zip before returning success. If the zip is corrupt, it is deleted and the database backup is reported as failed.
- The database backup retention setting must be between 1 and 100. After each backup, older database backup zip files beyond that retention count are pruned automatically.
