import json
import os
import shutil
import sqlite3
import stat
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

import logging

from app.config import settings as app_settings

logger = logging.getLogger("license_lifecycle.backup_service")

PORTFOLIO_STORAGE_DIRECTORIES = (
    "documents",
    "contracts",
    "sourcing_requests",
    "procurement_documents",
)
DATABASE_BACKUP_PREFIX = "license_lifecycle_backup_"
PORTFOLIO_RESET_ARCHIVE_PREFIX = "license_lifecycle_pre_portfolio_reset_"
RESTORE_SAFETY_ARCHIVE_PREFIX = "license_lifecycle_pre_document_restore_"


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


def _create_database_and_storage_archive(
    backup_location: str,
    storage_location: str,
    counts: dict[str, int],
    required_document_paths: list[str] | None = None,
    *,
    filename_prefix: str,
    archive_type: str,
) -> Path:
    db_path = get_db_path()
    if not db_path.exists():
        raise FileNotFoundError(f"Database file not found: {db_path}")

    backup_dir = Path(backup_location).resolve()
    backup_dir.mkdir(parents=True, exist_ok=True)
    storage_root = Path(storage_location).resolve()
    required_document_paths = required_document_paths or []

    for stored_path in required_document_paths:
        relative = Path(stored_path)
        unresolved_candidate = storage_root / relative
        candidate = unresolved_candidate.resolve()
        try:
            candidate.relative_to(storage_root)
        except ValueError:
            raise ValueError(f"Stored document path is outside the configured storage root: {stored_path}")
        if unresolved_candidate.is_symlink() or not candidate.is_file():
            raise FileNotFoundError(f"Stored document is unavailable for recovery archive: {stored_path}")

    timestamp = datetime.now(timezone.utc)
    filename_timestamp = timestamp.strftime("%Y%m%d_%H%M%S_%f")
    zip_path = backup_dir / f"{filename_prefix}{filename_timestamp}.zip"

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

        archived_files = 0
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(tmp_path, arcname=f"database/{db_path.name}")
            for directory_name in PORTFOLIO_STORAGE_DIRECTORIES:
                directory = (storage_root / directory_name).resolve()
                if directory.parent != storage_root or not directory.is_dir():
                    continue
                for stored_file in directory.rglob("*"):
                    if stored_file.is_symlink() or not stored_file.is_file():
                        continue
                    if stored_file.resolve() == zip_path:
                        continue
                    relative = stored_file.relative_to(storage_root)
                    zf.write(stored_file, arcname=f"storage/{relative.as_posix()}")
                    archived_files += 1

            manifest = {
                "archive_type": archive_type,
                "created_at": timestamp.isoformat(),
                "database_file": db_path.name,
                "portfolio_file_count": archived_files,
                "record_counts": counts,
                "required_document_count": len(set(required_document_paths)),
            }
            zf.writestr("portfolio_reset_manifest.json", json.dumps(manifest, indent=2, sort_keys=True))
    except Exception:
        zip_path.unlink(missing_ok=True)
        raise
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)

    with zipfile.ZipFile(zip_path, "r") as verify_zf:
        bad_file = verify_zf.testzip()
        if bad_file is not None:
            zip_path.unlink(missing_ok=True)
            raise RuntimeError(f"Reset archive integrity check failed: corrupt entry '{bad_file}'")

    logger.info(
        "Database-and-storage archive created: %s (%.1f KB)",
        zip_path.name,
        zip_path.stat().st_size / 1024,
    )
    return zip_path


def create_portfolio_reset_archive(
    backup_location: str,
    storage_location: str,
    counts: dict[str, int],
    required_document_paths: list[str] | None = None,
) -> Path:
    """
    Create a recovery archive before a portfolio reset.

    Unlike routine database backups, this archive contains both a WAL-safe
    SQLite snapshot and every file below LicenseTrack's managed portfolio
    storage directories. Configuration-only plugin storage is deliberately
    excluded because plugin configuration survives the reset.
    """
    return _create_database_and_storage_archive(
        backup_location,
        storage_location,
        counts,
        required_document_paths,
        filename_prefix=PORTFOLIO_RESET_ARCHIVE_PREFIX,
        archive_type="portfolio_reset_recovery",
    )


def create_document_restore_safety_archive(
    backup_location: str,
    storage_location: str,
    counts: dict[str, int],
    required_document_paths: list[str] | None = None,
) -> Path:
    """Capture the current database and managed documents before restoring both."""
    return _create_database_and_storage_archive(
        backup_location,
        storage_location,
        counts,
        required_document_paths,
        filename_prefix=RESTORE_SAFETY_ARCHIVE_PREFIX,
        archive_type="document_restore_safety",
    )


def inspect_backup_archive(zip_path: Path) -> dict:
    """Validate a backup zip and report its restore semantics."""
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            bad_file = zf.testzip()
            if bad_file is not None:
                raise ValueError(f"Backup archive contains a corrupt entry: {bad_file}")
            db_files = [name for name in zf.namelist() if name.lower().endswith(".db")]
            if not db_files:
                raise ValueError("No .db file found inside the backup zip.")

            archive_type = "database_backup"
            manifest = {}
            if "portfolio_reset_manifest.json" in zf.namelist():
                try:
                    manifest = json.loads(zf.read("portfolio_reset_manifest.json"))
                except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                    raise ValueError("Backup archive manifest is invalid.") from exc
                archive_type = str(manifest.get("archive_type") or "")
                if archive_type not in {"portfolio_reset_recovery", "document_restore_safety"}:
                    raise ValueError("Backup archive type is not supported.")

            return {
                "archive_type": archive_type,
                "includes_documents": archive_type
                in {"portfolio_reset_recovery", "document_restore_safety"},
                "manifest": manifest,
            }
    except zipfile.BadZipFile as exc:
        raise ValueError("File is not a valid zip archive.") from exc


def list_server_backup_archives(backup_location: str) -> list[dict]:
    """List restorable archives from the configured server backup directory."""
    backup_dir = Path(backup_location).resolve()
    if not backup_dir.is_dir():
        return []

    candidates = {
        *backup_dir.glob(f"{DATABASE_BACKUP_PREFIX}*.zip"),
        *backup_dir.glob(f"{PORTFOLIO_RESET_ARCHIVE_PREFIX}*.zip"),
        *backup_dir.glob(f"{RESTORE_SAFETY_ARCHIVE_PREFIX}*.zip"),
    }
    archives = []
    for path in candidates:
        if path.is_symlink() or not path.is_file() or path.parent.resolve() != backup_dir:
            continue
        try:
            info = inspect_backup_archive(path)
        except ValueError:
            logger.warning("Skipping invalid server backup archive: %s", path.name)
            continue
        archives.append(
            {
                "filename": path.name,
                "size_bytes": path.stat().st_size,
                "created_at": path.stat().st_mtime,
                "archive_type": info["archive_type"],
                "includes_documents": info["includes_documents"],
            }
        )
    return sorted(archives, key=lambda item: item["created_at"], reverse=True)


def resolve_server_backup_archive(backup_location: str, filename: str) -> Path:
    """Resolve an exact allow-listed server archive filename without path access."""
    if not filename or Path(filename).name != filename or not filename.lower().endswith(".zip"):
        raise ValueError("Invalid server backup filename.")
    allowed = {item["filename"] for item in list_server_backup_archives(backup_location)}
    if filename not in allowed:
        raise FileNotFoundError("Server backup archive was not found.")
    backup_dir = Path(backup_location).resolve()
    resolved = (backup_dir / filename).resolve()
    if resolved.parent != backup_dir:
        raise ValueError("Invalid server backup filename.")
    return resolved


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

    staged_db = None
    with zipfile.ZipFile(zip_path, "r") as zf:
        db_files = [name for name in zf.namelist() if name.lower().endswith(".db")]
        if not db_files:
            raise ValueError("No .db file found inside the backup zip.")
        entry_name = db_files[0]
        with tempfile.NamedTemporaryFile(
            suffix=".db",
            prefix=".restore-candidate-",
            dir=db_path.parent,
            delete=False,
        ) as staged_file:
            staged_db = Path(staged_file.name)
            with zf.open(entry_name) as source:
                shutil.copyfileobj(source, staged_file)

    try:
        candidate_connection = sqlite3.connect(str(staged_db))
        try:
            integrity_result = candidate_connection.execute("PRAGMA integrity_check").fetchone()
        finally:
            candidate_connection.close()
        if not integrity_result or integrity_result[0] != "ok":
            raise ValueError("Backup database failed SQLite integrity validation.")
    except sqlite3.DatabaseError as exc:
        staged_db.unlink(missing_ok=True)
        raise ValueError("Backup database is not a valid SQLite database.") from exc

    try:
        # Safety snapshot before overwrite - WAL-consistent via
        # sqlite3.Connection.backup() so dirty WAL pages are checkpointed into
        # the snapshot before we unlink them.
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
        staged_db.replace(db_path)
    finally:
        staged_db.unlink(missing_ok=True)

    logger.info("Restore complete. Safety snapshot saved as %s", safety_copy.name)


def _safe_recovery_member(info: zipfile.ZipInfo) -> PurePosixPath:
    name = info.filename
    path = PurePosixPath(name)
    file_type = (info.external_attr >> 16) & 0o170000
    if (
        not name
        or "\\" in name
        or path.is_absolute()
        or ".." in path.parts
        or file_type == stat.S_IFLNK
    ):
        raise ValueError(f"Unsafe recovery archive entry: {name!r}")
    return path


def _stage_recovery_documents(zip_path: Path, storage_root: Path, token: str) -> Path:
    staging_root = storage_root / f".restore-staging-{token}"
    staging_root.mkdir(parents=False, exist_ok=False)
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            for info in zf.infolist():
                path = _safe_recovery_member(info)
                if len(path.parts) < 2 or path.parts[0] != "storage":
                    continue
                if path.parts[1] not in PORTFOLIO_STORAGE_DIRECTORIES:
                    raise ValueError(f"Unsupported recovery storage directory: {path.parts[1]!r}")
                relative = Path(*path.parts[1:])
                target = (staging_root / relative).resolve()
                if os.path.commonpath([str(staging_root), str(target)]) != str(staging_root):
                    raise ValueError(f"Unsafe recovery archive entry: {info.filename!r}")
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info, "r") as source, target.open("wb") as destination:
                    shutil.copyfileobj(source, destination)
        return staging_root
    except Exception:
        shutil.rmtree(staging_root, ignore_errors=True)
        raise


def _restore_managed_documents(
    zip_path: Path,
    storage_location: str,
    safety_archive: Path,
) -> None:
    storage_root = Path(storage_location).resolve()
    storage_root.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex
    staging_root = _stage_recovery_documents(zip_path, storage_root, token)
    moved_current: list[tuple[Path, Path]] = []
    installed_targets: list[Path] = []

    try:
        for directory_name in PORTFOLIO_STORAGE_DIRECTORIES:
            target = storage_root / directory_name
            current_backup = storage_root / f".restore-current-{token}-{directory_name}"
            staged = staging_root / directory_name
            if target.is_symlink():
                raise ValueError(f"Managed storage directory must not be a symlink: {directory_name}")
            if target.exists():
                target.rename(current_backup)
                moved_current.append((target, current_backup))
            if staged.exists():
                staged.rename(target)
                installed_targets.append(target)

        try:
            restore_backup(zip_path)
        except Exception:
            restore_backup(safety_archive)
            raise
    except Exception:
        for target in installed_targets:
            shutil.rmtree(target, ignore_errors=True)
        for target, current_backup in reversed(moved_current):
            if current_backup.exists():
                current_backup.rename(target)
        raise
    else:
        for _target, current_backup in moved_current:
            shutil.rmtree(current_backup, ignore_errors=True)
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)


def restore_backup_archive(
    zip_path: Path,
    *,
    storage_location: str,
    safety_archive: Path | None = None,
) -> dict:
    """Restore a routine database backup or a database-and-document recovery archive."""
    info = inspect_backup_archive(zip_path)
    if not info["includes_documents"]:
        restore_backup(zip_path)
    else:
        if safety_archive is None:
            raise ValueError("A current database-and-document safety archive is required.")
        _restore_managed_documents(zip_path, storage_location, safety_archive)
    return {
        "archive_type": info["archive_type"],
        "restored_documents": info["includes_documents"],
    }
