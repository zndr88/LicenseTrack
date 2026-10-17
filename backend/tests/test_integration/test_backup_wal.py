"""Backup, snapshot and restore with a WAL-mode database."""

import sqlite3
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
