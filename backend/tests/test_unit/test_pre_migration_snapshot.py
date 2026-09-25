import os

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
