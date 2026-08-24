"""
Unit tests for app.services.backup_service.

Uses tmp_path (pytest built-in) for all filesystem operations and monkeypatch
to redirect get_db_path away from the dev environment.
"""

import asyncio
import json
import os
import sqlite3
import zipfile
from pathlib import Path

import pytest

from app.services import backup_service
from app.services.backup_service import (
    create_backup,
    create_document_restore_safety_archive,
    create_portfolio_reset_archive,
    document_storage_reconciliation,
    inspect_backup_archive,
    list_server_backup_archives,
    prune_backups,
    resolve_server_backup_archive,
    restore_backup,
    restore_backup_archive,
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _make_db(path) -> None:
    """Create a minimal (empty) SQLite database file at *path*."""
    conn = sqlite3.connect(str(path))
    conn.close()


def _make_marker_db(path, marker: str) -> None:
    conn = sqlite3.connect(str(path))
    conn.execute("CREATE TABLE marker (value TEXT)")
    conn.execute("INSERT INTO marker (value) VALUES (?)", (marker,))
    conn.commit()
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


async def test_run_routine_backup_delegates_create_and_prune_to_thread(
    tmp_path,
    monkeypatch,
):
    created = tmp_path / "backup.zip"
    inner_calls = []
    thread_calls = []

    def fake_create_backup(location):
        inner_calls.append(("create", location))
        return created

    def fake_prune_backups(location, keep):
        inner_calls.append(("prune", location, keep))

    async def fake_to_thread(func, *args):
        thread_calls.append((func, args))
        return func(*args)

    monkeypatch.setattr(backup_service, "_routine_backup_lock", asyncio.Lock())
    monkeypatch.setattr(backup_service, "create_backup", fake_create_backup)
    monkeypatch.setattr(backup_service, "prune_backups", fake_prune_backups)
    monkeypatch.setattr(backup_service.asyncio, "to_thread", fake_to_thread)

    result = await backup_service.run_routine_backup(str(tmp_path), 3)

    assert result == created
    assert thread_calls == [
        (backup_service._create_and_prune_backup, (str(tmp_path), 3)),
    ]
    assert inner_calls == [
        ("create", str(tmp_path)),
        ("prune", str(tmp_path), 3),
    ]


async def test_run_routine_backup_propagates_worker_failure(tmp_path, monkeypatch):
    def fail_backup(_location):
        raise RuntimeError("backup failed")

    async def fake_to_thread(func, *args):
        return func(*args)

    monkeypatch.setattr(backup_service, "_routine_backup_lock", asyncio.Lock())
    monkeypatch.setattr(backup_service, "create_backup", fail_backup)
    monkeypatch.setattr(backup_service.asyncio, "to_thread", fake_to_thread)

    with pytest.raises(RuntimeError, match="backup failed"):
        await backup_service.run_routine_backup(str(tmp_path), 3)


async def test_run_routine_backup_serializes_concurrent_calls(tmp_path, monkeypatch):
    first_started = asyncio.Event()
    release_first = asyncio.Event()
    calls = []
    active_calls = 0
    max_active_calls = 0

    async def fake_to_thread(_func, location, keep):
        nonlocal active_calls, max_active_calls
        calls.append((location, keep))
        active_calls += 1
        max_active_calls = max(max_active_calls, active_calls)
        if len(calls) == 1:
            first_started.set()
            await release_first.wait()
        active_calls -= 1
        return tmp_path / f"backup-{len(calls)}.zip"

    monkeypatch.setattr(backup_service, "_routine_backup_lock", asyncio.Lock())
    monkeypatch.setattr(backup_service.asyncio, "to_thread", fake_to_thread)

    first = asyncio.create_task(backup_service.run_routine_backup(str(tmp_path), 2))
    await first_started.wait()
    second = asyncio.create_task(backup_service.run_routine_backup(str(tmp_path), 2))
    await asyncio.sleep(0)

    assert calls == [(str(tmp_path), 2)]

    release_first.set()
    await asyncio.gather(first, second)

    assert len(calls) == 2
    assert max_active_calls == 1


def test_create_portfolio_reset_archive_includes_database_documents_and_manifest(
    tmp_path,
    monkeypatch,
):
    db_path = tmp_path / "licenses.db"
    _make_db(db_path)
    storage = tmp_path / "storage"
    document = storage / "documents" / "7" / "eula.pdf"
    document.parent.mkdir(parents=True)
    document.write_bytes(b"eula")
    attachment = storage / "attachments" / "contracts" / "9" / "agreement.pdf"
    attachment.parent.mkdir(parents=True)
    attachment.write_bytes(b"agreement")
    plugin_file = storage / "plugins" / "kept.bin"
    plugin_file.parent.mkdir(parents=True)
    plugin_file.write_bytes(b"plugin")
    monkeypatch.setattr("app.services.backup_service.get_db_path", lambda: db_path)

    archive = create_portfolio_reset_archive(
        str(tmp_path / "backups"),
        str(storage),
        {"licenses": 1},
        ["documents/7/eula.pdf", "attachments/contracts/9/agreement.pdf"],
    )

    with zipfile.ZipFile(archive) as zf:
        names = zf.namelist()
        assert "database/licenses.db" in names
        assert "storage/documents/7/eula.pdf" in names
        assert "storage/attachments/contracts/9/agreement.pdf" in names
        assert "storage/plugins/kept.bin" not in names
        manifest = json.loads(zf.read("portfolio_reset_manifest.json"))
        assert manifest["archive_type"] == "portfolio_reset_recovery"
        assert manifest["record_counts"] == {"licenses": 1}
        assert manifest["required_document_count"] == 2


def test_create_portfolio_reset_archive_rejects_missing_required_document(
    tmp_path,
    monkeypatch,
):
    db_path = tmp_path / "licenses.db"
    _make_db(db_path)
    monkeypatch.setattr("app.services.backup_service.get_db_path", lambda: db_path)

    with pytest.raises(FileNotFoundError):
        create_portfolio_reset_archive(
            str(tmp_path / "backups"),
            str(tmp_path / "storage"),
            {"documents": 1},
            ["documents/7/missing.pdf"],
        )


def test_server_archive_listing_and_resolution_are_typed_and_path_safe(
    tmp_path,
):
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    database = tmp_path / "source.db"
    _make_db(database)
    routine = backup_dir / "license_lifecycle_backup_20260724_010203.zip"
    recovery = backup_dir / "license_lifecycle_pre_portfolio_reset_20260724_010204_000001.zip"
    with zipfile.ZipFile(routine, "w") as zf:
        zf.write(database, "licenses.db")
    with zipfile.ZipFile(recovery, "w") as zf:
        zf.write(database, "database/licenses.db")
        zf.writestr(
            "portfolio_reset_manifest.json",
            json.dumps({"archive_type": "portfolio_reset_recovery"}),
        )

    archives = list_server_backup_archives(str(backup_dir))

    assert {item["archive_type"] for item in archives} == {
        "database_backup",
        "portfolio_reset_recovery",
    }
    assert next(item for item in archives if item["filename"] == recovery.name)["includes_documents"] is True
    assert resolve_server_backup_archive(str(backup_dir), routine.name) == routine
    assert resolve_server_backup_archive(str(backup_dir), recovery.name) == recovery


def test_server_archive_resolution_rejects_untrusted_selections(tmp_path):
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    outside = tmp_path / "license_lifecycle_backup_outside.zip"
    unlisted = backup_dir / "manually_named_backup.zip"
    invalid = backup_dir / "license_lifecycle_backup_invalid.zip"
    symlink = backup_dir / "license_lifecycle_backup_symlink.zip"
    for archive in (outside, unlisted):
        with zipfile.ZipFile(archive, "w") as zf:
            zf.writestr("licenses.db", b"database placeholder")
    invalid.write_text("not a zip", encoding="utf-8")
    symlink.symlink_to(outside)

    with pytest.raises(ValueError):
        resolve_server_backup_archive(str(backup_dir), "../outside.zip")
    with pytest.raises(ValueError):
        resolve_server_backup_archive(str(backup_dir), str(outside.resolve()))
    with pytest.raises(ValueError):
        resolve_server_backup_archive(str(backup_dir), "/tmp/outside.zip")
    with pytest.raises(ValueError):
        resolve_server_backup_archive(str(backup_dir), r"C:\backups\outside.zip")
    with pytest.raises(ValueError):
        resolve_server_backup_archive(str(backup_dir), "unsupported.txt")
    with pytest.raises(ValueError):
        resolve_server_backup_archive(str(backup_dir), "\x00invalid.zip")
    with pytest.raises(FileNotFoundError):
        resolve_server_backup_archive(str(backup_dir), "license_lifecycle_backup_missing.zip")
    with pytest.raises(FileNotFoundError):
        resolve_server_backup_archive(str(backup_dir), unlisted.name)
    with pytest.raises(FileNotFoundError):
        resolve_server_backup_archive(str(backup_dir), invalid.name)
    with pytest.raises(FileNotFoundError):
        resolve_server_backup_archive(str(backup_dir), symlink.name)


def test_document_recovery_archive_restores_database_and_managed_storage(
    tmp_path,
    monkeypatch,
):
    live_db = tmp_path / "live.db"
    target_db = tmp_path / "target.db"
    _make_marker_db(live_db, "current")
    _make_marker_db(target_db, "recovered")
    storage = tmp_path / "storage"
    current_document = storage / "documents" / "1" / "current.txt"
    current_document.parent.mkdir(parents=True)
    current_document.write_text("current", encoding="utf-8")
    monkeypatch.setattr("app.services.backup_service.get_db_path", lambda: live_db)

    safety_archive = create_document_restore_safety_archive(
        str(tmp_path / "backups"),
        str(storage),
        {"documents": 1},
        ["documents/1/current.txt"],
    )
    recovery_archive = tmp_path / "recovery.zip"
    with zipfile.ZipFile(recovery_archive, "w") as zf:
        zf.write(target_db, "database/live.db")
        zf.writestr(
            "portfolio_reset_manifest.json",
            json.dumps({"archive_type": "portfolio_reset_recovery"}),
        )
        zf.writestr("storage/documents/9/recovered.txt", "recovered")

    result = restore_backup_archive(
        recovery_archive,
        storage_location=str(storage),
        safety_archive=safety_archive,
    )

    connection = sqlite3.connect(str(live_db))
    marker = connection.execute("SELECT value FROM marker").fetchone()[0]
    connection.close()
    assert marker == "recovered"
    assert result == {
        "archive_type": "portfolio_reset_recovery",
        "restored_documents": True,
    }
    assert not current_document.exists()
    assert (storage / "documents" / "9" / "recovered.txt").read_text(encoding="utf-8") == "recovered"


def test_document_storage_reconciliation_counts_available_and_missing_files(tmp_path, monkeypatch):
    db_path = tmp_path / "licenses.db"
    storage = tmp_path / "storage"
    stored = storage / "documents" / "1" / "available.pdf"
    stored.parent.mkdir(parents=True)
    stored.write_bytes(b"%PDF-1.4")
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("CREATE TABLE documents (filename TEXT NOT NULL)")
        connection.execute("CREATE TABLE procurement_documents (filename TEXT NOT NULL)")
        connection.execute("CREATE TABLE sourcing_quote_documents (filename TEXT NOT NULL)")
        connection.execute("CREATE TABLE contract_documents (filename TEXT NOT NULL)")
        connection.execute("INSERT INTO documents (filename) VALUES (?)", ("documents/1/available.pdf",))
        connection.execute("INSERT INTO contract_documents (filename) VALUES (?)", ("contracts/1/missing.pdf",))
        connection.commit()
    finally:
        connection.close()
    monkeypatch.setattr("app.services.backup_service.get_db_path", lambda: db_path)

    assert document_storage_reconciliation(str(storage)) == {
        "document_records": 2,
        "available_files": 1,
        "missing_files": 1,
        "unavailable_files": 0,
    }


def test_document_recovery_rolls_storage_back_when_database_is_invalid(
    tmp_path,
    monkeypatch,
):
    live_db = tmp_path / "live.db"
    _make_marker_db(live_db, "current")
    storage = tmp_path / "storage"
    current_document = storage / "documents" / "1" / "current.txt"
    current_document.parent.mkdir(parents=True)
    current_document.write_text("current", encoding="utf-8")
    monkeypatch.setattr("app.services.backup_service.get_db_path", lambda: live_db)
    safety_archive = create_document_restore_safety_archive(
        str(tmp_path / "backups"),
        str(storage),
        {"documents": 1},
        ["documents/1/current.txt"],
    )
    invalid_archive = tmp_path / "invalid-recovery.zip"
    with zipfile.ZipFile(invalid_archive, "w") as zf:
        zf.writestr("database/live.db", b"not sqlite")
        zf.writestr(
            "portfolio_reset_manifest.json",
            json.dumps({"archive_type": "portfolio_reset_recovery"}),
        )
        zf.writestr("storage/documents/9/bad.txt", "bad")

    with pytest.raises(ValueError):
        restore_backup_archive(
            invalid_archive,
            storage_location=str(storage),
            safety_archive=safety_archive,
        )

    connection = sqlite3.connect(str(live_db))
    marker = connection.execute("SELECT value FROM marker").fetchone()[0]
    connection.close()
    assert marker == "current"
    assert current_document.read_text(encoding="utf-8") == "current"
    assert not (storage / "documents" / "9" / "bad.txt").exists()


def test_recovery_archive_rejects_unsafe_storage_entries(tmp_path):
    database = tmp_path / "source.db"
    _make_db(database)
    archive = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.write(database, "database/source.db")
        zf.writestr(
            "portfolio_reset_manifest.json",
            json.dumps({"archive_type": "portfolio_reset_recovery"}),
        )
        zf.writestr("storage/../escape.txt", "escape")

    assert inspect_backup_archive(archive)["includes_documents"] is True
    with pytest.raises(ValueError):
        restore_backup_archive(
            archive,
            storage_location=str(tmp_path / "storage"),
            safety_archive=archive,
        )


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
