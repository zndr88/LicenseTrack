"""Backup, snapshot and restore with a WAL-mode database."""

import sqlite3
import tempfile
import zipfile
from contextlib import closing
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

from app.config import settings
from app.services import backup_service

ALEMBIC_DIR = Path(__file__).resolve().parents[2] / "alembic"


@pytest.fixture
def live_db(tmp_path, monkeypatch):
    """A migrated database at head, in WAL mode, used as the live app database."""
    path = tmp_path / "data" / "licenses.db"
    path.parent.mkdir()
    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite+aiosqlite:///{path.as_posix()}")
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_DIR))
    command.upgrade(config, "head")
    # Close every connection explicitly: on Windows an open handle stops
    # restore from replacing the file.
    with closing(sqlite3.connect(path)) as conn:
        assert conn.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
        conn.execute("CREATE TABLE wal_marker (v TEXT NOT NULL)")
        conn.commit()
    return path


def _open_with_uncheckpointed_row(path: Path, value: str) -> sqlite3.Connection:
    """Write *value* and keep the connection open so it stays only in the -wal file."""
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA wal_autocheckpoint=0")
    conn.execute("DELETE FROM wal_marker")
    conn.execute("INSERT INTO wal_marker (v) VALUES (?)", (value,))
    conn.commit()
    assert Path(str(path) + "-wal").stat().st_size > 0
    return conn


def _marker(path: Path) -> str:
    with closing(sqlite3.connect(path)) as conn:
        return conn.execute("SELECT v FROM wal_marker").fetchone()[0]


def test_copy_includes_rows_still_in_the_wal_file(live_db, tmp_path):
    writer = _open_with_uncheckpointed_row(live_db, "only-in-wal")
    try:
        target = tmp_path / "copy.db"
        backup_service._copy_sqlite_database(live_db, target)
        assert _marker(target) == "only-in-wal"
    finally:
        writer.close()


def test_backup_archive_includes_rows_still_in_the_wal_file(live_db, tmp_path):
    writer = _open_with_uncheckpointed_row(live_db, "only-in-wal")
    try:
        archive = backup_service.create_backup(str(tmp_path / "backups"))
    finally:
        writer.close()
    extracted = tmp_path / "extracted"
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(extracted)
    (db_file,) = list(extracted.glob("*.db"))
    assert _marker(db_file) == "only-in-wal"


async def test_restore_replaces_wal_database_and_leaves_no_stray_files(live_db, tmp_path):
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.database import configure_sqlite_connections

    writer = _open_with_uncheckpointed_row(live_db, "backup-content")
    try:
        archive = backup_service.create_backup(str(tmp_path / "backups"))
        writer.execute("UPDATE wal_marker SET v = 'after-backup'")
        writer.commit()
    finally:
        writer.close()

    safety_copy = backup_service.restore_backup(archive)

    assert _marker(live_db) == "backup-content"
    assert _marker(safety_copy) == "after-backup"
    leftovers = sorted(p.name for p in live_db.parent.iterdir() if ".restore-candidate-" in p.name)
    assert leftovers == []

    engine = create_async_engine(f"sqlite+aiosqlite:///{live_db.as_posix()}")
    configure_sqlite_connections(engine.sync_engine)
    try:
        async with engine.begin() as conn:
            assert (await conn.exec_driver_sql("PRAGMA journal_mode")).scalar_one() == "wal"
            assert (await conn.exec_driver_sql("PRAGMA integrity_check")).scalar_one() == "ok"
            await conn.exec_driver_sql("INSERT INTO wal_marker (v) VALUES ('written-after-restore')")
    finally:
        await engine.dispose()


def test_inspecting_an_archive_leaves_no_stray_files(live_db, tmp_path, monkeypatch):
    # inspect_backup_archive stages the database in the system temp folder, so
    # point that at a folder under tmp_path where the test can see any litter.
    staging = tmp_path / "staging"
    staging.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(staging))
    archive = backup_service.create_backup(str(tmp_path / "backups"))
    before = set(tmp_path.rglob("*"))
    backup_service.inspect_backup_archive(archive)
    new_files = {p for p in set(tmp_path.rglob("*")) - before if p.name.endswith(("-wal", "-shm"))}
    assert new_files == set()
    assert list(staging.iterdir()) == []
