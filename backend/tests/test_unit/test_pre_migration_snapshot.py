import os
import sqlite3
from datetime import datetime, timedelta

import pytest
from alembic import command
from alembic.script import ScriptDirectory

from app.services import backup_service


def _previous_revision() -> str:
    script = ScriptDirectory.from_config(backup_service._alembic_config())
    head = script.get_revision(script.get_current_head())
    return head.down_revision


def _use_database(monkeypatch, db_path):
    monkeypatch.setattr(backup_service.app_settings, "DATABASE_URL", f"sqlite+aiosqlite:///{db_path.as_posix()}")


def test_snapshot_taken_when_schema_is_behind(tmp_path, monkeypatch):
    db_path = tmp_path / "licenses.db"
    command.upgrade(backup_service._alembic_config(db_path), _previous_revision())
    _use_database(monkeypatch, db_path)

    snapshot = backup_service.create_pre_migration_snapshot()

    assert snapshot is not None and snapshot.exists()
    assert snapshot.parent == tmp_path / "pre-upgrade"
    assert backup_service.validate_database_file(snapshot) == _previous_revision()
    # The source database is left untouched at its old revision.
    assert backup_service.current_schema_revision(db_path) == _previous_revision()


def test_no_snapshot_when_schema_is_current(tmp_path, monkeypatch):
    db_path = tmp_path / "licenses.db"
    command.upgrade(backup_service._alembic_config(db_path), "head")
    _use_database(monkeypatch, db_path)

    assert backup_service.create_pre_migration_snapshot() is None
    assert not (tmp_path / "pre-upgrade").exists()


def test_no_snapshot_for_a_new_install(tmp_path, monkeypatch):
    _use_database(monkeypatch, tmp_path / "missing.db")
    assert backup_service.create_pre_migration_snapshot() is None


def test_keeps_only_the_newest_snapshots(tmp_path, monkeypatch):
    db_path = tmp_path / "licenses.db"
    command.upgrade(backup_service._alembic_config(db_path), _previous_revision())
    _use_database(monkeypatch, db_path)
    snapshot_dir = tmp_path / "pre-upgrade"
    snapshot_dir.mkdir()
    old_snapshots = []
    for index in range(4):
        old = snapshot_dir / f"licenses_pre_upgrade_old{index}_2020010{index + 1}_000000.db"
        old.write_bytes(b"old")
        # Give each old snapshot a distinct, clearly older modification time.
        stamp = 1_577_836_800 + index * 86_400  # 2020-01-01 plus index days
        os.utime(old, (stamp, stamp))
        old_snapshots.append(old)

    snapshot = backup_service.create_pre_migration_snapshot(keep=3)

    remaining = set(snapshot_dir.glob("licenses_pre_upgrade_*.db"))
    assert len(remaining) == 3
    assert snapshot in remaining
    assert remaining == {snapshot, old_snapshots[3], old_snapshots[2]}


class _SteppingClock:
    """Stand-in for ``datetime`` whose ``now()`` advances a minute per call."""

    def __init__(self):
        self._moment = datetime(2026, 1, 1, 12, 0, 0)

    def now(self):
        self._moment += timedelta(minutes=1)
        return self._moment


def _dump(db_path) -> list[str]:
    # The SQLite backup API bumps the header's change counter, so compare the
    # full logical content (schema and rows) rather than raw bytes.
    connection = sqlite3.connect(db_path)
    try:
        return list(connection.iterdump())
    finally:
        connection.close()


def _snapshots(tmp_path):
    return sorted((tmp_path / "pre-upgrade").glob("*.db"))


def test_repeated_attempts_keep_the_first_snapshot(tmp_path, monkeypatch):
    # A failed upgrade restarts the container; every restart must reuse the
    # first (clean) snapshot instead of pruning it with newer copies.
    db_path = tmp_path / "licenses.db"
    command.upgrade(backup_service._alembic_config(db_path), _previous_revision())
    _use_database(monkeypatch, db_path)
    monkeypatch.setattr(backup_service, "datetime", _SteppingClock())
    original_dump = _dump(db_path)

    first = backup_service.create_pre_migration_snapshot(keep=3)
    # A half-run migration may leave schema changes behind between attempts.
    connection = sqlite3.connect(db_path)
    connection.execute("CREATE TABLE half_run_migration_leftover (id INTEGER)")
    connection.commit()
    connection.close()
    later = [backup_service.create_pre_migration_snapshot(keep=3) for _ in range(3)]

    assert _snapshots(tmp_path) == [first]
    assert later == [first, first, first]
    assert _dump(first) == original_dump


def test_unknown_revision_is_not_snapshotted(tmp_path, monkeypatch):
    # A database from a newer release (rolled-back image) must not trigger a
    # snapshot, so the genuine rollback point from the earlier upgrade survives.
    db_path = tmp_path / "licenses.db"
    command.upgrade(backup_service._alembic_config(db_path), _previous_revision())
    _use_database(monkeypatch, db_path)
    genuine = backup_service.create_pre_migration_snapshot()
    genuine_bytes = genuine.read_bytes()
    connection = sqlite3.connect(db_path)
    connection.execute("UPDATE alembic_version SET version_num = 'zzfuture123'")
    connection.commit()
    connection.close()

    for _ in range(4):
        assert backup_service.create_pre_migration_snapshot(keep=1) is None

    assert _snapshots(tmp_path) == [genuine]
    assert genuine.read_bytes() == genuine_bytes


class _FailingBackupConnection:
    def __init__(self, connection):
        self._connection = connection

    def backup(self, *_args, **_kwargs):
        raise sqlite3.OperationalError("database or disk is full")

    def __getattr__(self, name):
        return getattr(self._connection, name)


def test_failed_copy_leaves_no_partial_snapshot(tmp_path, monkeypatch):
    db_path = tmp_path / "licenses.db"
    command.upgrade(backup_service._alembic_config(db_path), _previous_revision())
    _use_database(monkeypatch, db_path)
    real_connect = sqlite3.connect
    monkeypatch.setattr(
        backup_service.sqlite3, "connect", lambda *args, **kwargs: _FailingBackupConnection(real_connect(*args, **kwargs))
    )

    with pytest.raises(sqlite3.OperationalError):
        backup_service.create_pre_migration_snapshot()

    assert _snapshots(tmp_path) == []


def test_database_name_with_glob_characters(tmp_path, monkeypatch):
    db_path = tmp_path / "licenses[prod].db"
    command.upgrade(backup_service._alembic_config(db_path), _previous_revision())
    _use_database(monkeypatch, db_path)
    snapshot_dir = tmp_path / "pre-upgrade"
    snapshot_dir.mkdir()
    old = snapshot_dir / "licenses[prod]_pre_upgrade_old0_20200101_000000.db"
    old.write_bytes(b"old")
    os.utime(old, (1_577_836_800, 1_577_836_800))

    snapshot = backup_service.create_pre_migration_snapshot(keep=1)

    assert snapshot is not None and snapshot.exists()
    assert not old.exists()


def test_retention_ignores_files_outside_the_naming_convention(tmp_path, monkeypatch):
    db_path = tmp_path / "licenses.db"
    command.upgrade(backup_service._alembic_config(db_path), _previous_revision())
    _use_database(monkeypatch, db_path)
    snapshot_dir = tmp_path / "pre-upgrade"
    snapshot_dir.mkdir()
    unrelated = [
        snapshot_dir / "licenses_pre_upgrade_manual-copy.db",
        snapshot_dir / "licenses_pre_upgrade_keep_me.db",
    ]
    for path in unrelated:
        path.write_bytes(b"mine")
        os.utime(path, (1_577_836_800, 1_577_836_800))

    backup_service.create_pre_migration_snapshot(keep=1)

    assert all(path.exists() for path in unrelated)
