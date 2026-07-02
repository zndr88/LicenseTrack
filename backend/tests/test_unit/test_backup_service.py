"""
Unit tests for app.services.backup_service.

Uses tmp_path (pytest built-in) for all filesystem operations and monkeypatch
to redirect get_db_path away from the dev environment.
"""

import os
import sqlite3
import zipfile
from pathlib import Path

import pytest

from app.services.backup_service import create_backup, prune_backups, restore_backup


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _make_db(path) -> None:
    """Create a minimal (empty) SQLite database file at *path*."""
    conn = sqlite3.connect(str(path))
    conn.close()


# ---------------------------------------------------------------------------
# 4a — create_backup produces a valid zip containing exactly one .db file
# ---------------------------------------------------------------------------

def test_create_backup_valid_zip(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    _make_db(db_path)
    backup_dir = tmp_path / "backups"
    monkeypatch.setattr("app.services.backup_service.get_db_path", lambda: db_path)

    result = create_backup(str(backup_dir))

    assert result.exists()
    assert result.suffix == ".zip"
    assert zipfile.is_zipfile(result)
    with zipfile.ZipFile(result) as zf:
        db_entries = [n for n in zf.namelist() if n.endswith(".db")]
        assert len(db_entries) == 1


# ---------------------------------------------------------------------------
# 4b — create_backup raises FileNotFoundError when the db is absent
# ---------------------------------------------------------------------------

def test_create_backup_missing_db(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.services.backup_service.get_db_path",
        lambda: tmp_path / "nonexistent.db",
    )

    with pytest.raises(FileNotFoundError):
        create_backup(str(tmp_path / "backups"))


# ---------------------------------------------------------------------------
# 4c — prune_backups keeps only the N most recent files
# ---------------------------------------------------------------------------

def test_prune_backups_keeps_n_most_recent(tmp_path):
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()

    files = []
    for i in range(5):
        f = backup_dir / f"license_lifecycle_backup_2024010{i + 1}_000000.zip"
        f.touch()
        os.utime(str(f), (i * 100, i * 100))   # i=0 → oldest, i=4 → newest
        files.append(f)

    prune_backups(str(backup_dir), keep=3)

    remaining = sorted(backup_dir.glob("license_lifecycle_backup_*.zip"))
    assert len(remaining) == 3
    assert set(remaining) == {files[2], files[3], files[4]}


# ---------------------------------------------------------------------------
# 4d — prune_backups on a missing directory does not raise
# ---------------------------------------------------------------------------

def test_prune_backups_missing_dir(tmp_path):
    prune_backups(str(tmp_path / "nonexistent"), keep=3)   # must not raise


# ---------------------------------------------------------------------------
# 4e — restore_backup replaces the live db file
# ---------------------------------------------------------------------------

def test_restore_backup_replaces_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    _make_db(db_path)
    backup_dir = tmp_path / "backups"
    monkeypatch.setattr("app.services.backup_service.get_db_path", lambda: db_path)

    # Take a backup of the clean db.
    zip_path = create_backup(str(backup_dir))

    # Mutate the live db so we can tell it was replaced after restore.
    conn = sqlite3.connect(str(db_path))
    conn.execute("CREATE TABLE test_marker (id INTEGER)")
    conn.commit()
    conn.close()

    restore_backup(zip_path)

    # The live db file must still exist after restore.
    assert db_path.exists()

    # A pre-restore safety copy must have been created alongside the db.
    safety_copies = list(tmp_path.glob("license_lifecycle_pre_restore_*.db"))
    assert len(safety_copies) == 1

    # The mutation must be gone (restored content predates it).
    conn = sqlite3.connect(str(db_path))
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    assert "test_marker" not in tables


# ---------------------------------------------------------------------------
# 4f — restore_backup raises ValueError when the zip contains no .db entry
# ---------------------------------------------------------------------------

def test_restore_backup_raises_no_db_entry(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    _make_db(db_path)
    monkeypatch.setattr("app.services.backup_service.get_db_path", lambda: db_path)

    bad_zip = tmp_path / "bad.zip"
    with zipfile.ZipFile(bad_zip, "w") as zf:
        zf.writestr("readme.txt", "not a database")

    with pytest.raises(ValueError):
        restore_backup(bad_zip)


# ---------------------------------------------------------------------------
# 4g — restore_backup removes stale -wal and -shm files (F4)
# ---------------------------------------------------------------------------

def test_restore_removes_wal_and_shm(tmp_path, monkeypatch):
    """
    restore_backup must delete db-wal and db-shm before replacing the database
    file. Without the fix, stale WAL pages can corrupt the restored database on
    restart because SQLite replays the old WAL against the freshly restored file.
    """
    db_path = tmp_path / "test.db"
    _make_db(db_path)
    backup_dir = tmp_path / "backups"
    monkeypatch.setattr("app.services.backup_service.get_db_path", lambda: db_path)

    # Take a clean backup
    zip_path = create_backup(str(backup_dir))

    # Mutate the db so we can confirm it was restored
    conn = sqlite3.connect(str(db_path))
    conn.execute("CREATE TABLE mutation_marker (id INTEGER)")
    conn.commit()
    conn.close()

    # Simulate stale WAL/SHM left behind by the async engine
    wal_path = Path(str(db_path) + "-wal")
    shm_path = Path(str(db_path) + "-shm")
    wal_path.write_bytes(b"stale wal data")
    shm_path.write_bytes(b"stale shm data")

    restore_backup(zip_path)

    # WAL and SHM must be gone after restore
    assert not wal_path.exists(), "-wal file should be removed by restore"
    assert not shm_path.exists(), "-shm file should be removed by restore"

    # The mutation must be gone (content from before the mutation was restored)
    conn = sqlite3.connect(str(db_path))
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    assert "mutation_marker" not in tables
