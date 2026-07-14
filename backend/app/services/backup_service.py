import sqlite3
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

import logging

from app.config import settings as app_settings

logger = logging.getLogger("license_lifecycle.backup_service")


def get_db_path() -> Path:
    """Resolve the SQLite database file path from the DATABASE_URL env var."""
    db_url = app_settings.DATABASE_URL
    raw = db_url.replace("sqlite+aiosqlite:///", "").replace("sqlite:///", "")
    return Path(raw).resolve()


def create_backup(backup_location: str) -> Path:
    """
    Create a WAL-safe consistent snapshot of the SQLite database in a timestamped
    .zip archive. Uses sqlite3.Connection.backup() so the snapshot is always
    internally consistent regardless of WAL state.

    Returns the path to the created zip file.
    Raises if the db file cannot be found, the backup dir cannot be created,
    or the resulting zip fails an integrity check.
    """
    db_path = get_db_path()
    if not db_path.exists():
        raise FileNotFoundError(f"Database file not found: {db_path}")

    backup_dir = Path(backup_location).resolve()
    backup_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = f"license_lifecycle_backup_{timestamp}.zip"
    zip_path = backup_dir / zip_name

    logger.info("Creating backup in %s", backup_location)

    # Capture a WAL-safe consistent snapshot via sqlite3.Connection.backup(),
    # then add the snapshot to the zip rather than the live .db file.
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
            tmp_path = Path(tmp.name)

        src_conn = sqlite3.connect(str(db_path))
        dst_conn = sqlite3.connect(str(tmp_path))
        try:
            src_conn.backup(dst_conn)
        finally:
            dst_conn.close()
            src_conn.close()

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(tmp_path, arcname=db_path.name)
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)

    # Verify the zip is not corrupted before returning it.
    with zipfile.ZipFile(zip_path, "r") as verify_zf:
        bad_file = verify_zf.testzip()
        if bad_file is not None:
            zip_path.unlink(missing_ok=True)
            raise RuntimeError(f"Backup integrity check failed: corrupt entry '{bad_file}'")

    logger.info("Backup created: %s (%.1f KB)", zip_path.name, zip_path.stat().st_size / 1024)
    return zip_path


def prune_backups(backup_location: str, keep: int) -> None:
    """Delete oldest backups, keeping only the most recent `keep` files."""
    backup_dir = Path(backup_location).resolve()
    if not backup_dir.exists():
        return
    backups = sorted(
        backup_dir.glob("license_lifecycle_backup_*.zip"),
        key=lambda p: p.stat().st_mtime,
    )
    to_delete = backups[:-keep] if keep > 0 else []
    for old in to_delete:
        old.unlink(missing_ok=True)
    if to_delete:
        logger.info("Pruned %d old backup(s) from %s", len(to_delete), backup_location)


def restore_backup(zip_path: Path) -> None:
    """
    Replace the live database with the one inside the zip.
    Creates a safety snapshot of the current db first.
    """
    db_path = get_db_path()

    logger.warning("Restoring backup from %s - current DB will be overwritten", zip_path.name)

    # Safety snapshot before overwrite - WAL-consistent via sqlite3.Connection.backup()
    # so dirty WAL pages are checkpointed into the snapshot before we unlink them.
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safety_copy = db_path.with_name(f"license_lifecycle_pre_restore_{timestamp}.db")
    _snap_src = sqlite3.connect(str(db_path))
    _snap_dst = sqlite3.connect(str(safety_copy))
    try:
        _snap_src.backup(_snap_dst)
    finally:
        _snap_dst.close()
        _snap_src.close()

    # Remove stale WAL and SHM files before replacing the database.
    # If these survive the file swap, SQLite replays them against the freshly
    # restored database on the next connection, silently corrupting it.
    Path(str(db_path) + "-wal").unlink(missing_ok=True)
    Path(str(db_path) + "-shm").unlink(missing_ok=True)

    with zipfile.ZipFile(zip_path, "r") as zf:
        names = zf.namelist()
        db_files = [n for n in names if n.endswith(".db")]
        if not db_files:
            raise ValueError("No .db file found inside the backup zip.")

        entry_name = db_files[0]
        safe_name = Path(entry_name).name  # strips any directory components

        if not safe_name or safe_name != Path(safe_name).name:
            raise ValueError(f"Unsafe zip entry name rejected: '{entry_name}'")

        # Extract safely: read content and write to a controlled destination path
        # rather than calling zf.extract() which does not sanitise path components
        # on Python < 3.12.
        dest_path = db_path.parent / safe_name
        with zf.open(entry_name) as src, open(dest_path, "wb") as dst:
            dst.write(src.read())

        if dest_path != db_path:
            dest_path.replace(db_path)

    logger.info("Restore complete. Safety snapshot saved as %s", safety_copy.name)
