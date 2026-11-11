"""Schema upgrade owner: snapshot, upgrade, and the is-current check."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import settings
from app.services import schema_upgrade

ALEMBIC_DIR = Path(__file__).resolve().parents[2] / "alembic"


def test_upgrade_schema_snapshots_before_upgrading(monkeypatch, tmp_path):
    calls: list[str] = []
    snapshot = tmp_path / "pre-upgrade.db"
    monkeypatch.setattr(schema_upgrade, "create_pre_migration_snapshot", lambda: calls.append("snapshot") or snapshot)
    monkeypatch.setattr(schema_upgrade.alembic_command, "upgrade", lambda _cfg, rev: calls.append(f"upgrade:{rev}"))

    assert schema_upgrade.upgrade_schema() == snapshot
    assert calls == ["snapshot", "upgrade:head"]


def test_upgrade_schema_does_not_upgrade_when_snapshot_fails(monkeypatch):
    upgrades: list[str] = []

    def failing_snapshot():
        raise OSError("disk full")

    monkeypatch.setattr(schema_upgrade, "create_pre_migration_snapshot", failing_snapshot)
    monkeypatch.setattr(schema_upgrade.alembic_command, "upgrade", lambda _cfg, rev: upgrades.append(rev))

    with pytest.raises(OSError):
        schema_upgrade.upgrade_schema()
    assert upgrades == []


def test_upgrade_schema_reraises_migration_failure(monkeypatch):
    def failing_upgrade(_cfg, _rev):
        raise RuntimeError("bad migration")

    monkeypatch.setattr(schema_upgrade, "create_pre_migration_snapshot", lambda: None)
    monkeypatch.setattr(schema_upgrade.alembic_command, "upgrade", failing_upgrade)

    with pytest.raises(RuntimeError, match="bad migration"):
        schema_upgrade.upgrade_schema()


def _migrate(database: Path, monkeypatch, revision: str) -> None:
    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite+aiosqlite:///{database.as_posix()}")
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_DIR))
    command.upgrade(config, revision)


async def test_schema_is_current_true_at_head(tmp_path, monkeypatch):
    database = tmp_path / "current.db"
    _migrate(database, monkeypatch, "head")
    engine = create_async_engine(f"sqlite+aiosqlite:///{database.as_posix()}")
    try:
        assert await schema_upgrade.schema_is_current(engine) is True
    finally:
        await engine.dispose()


async def test_schema_is_current_false_when_behind(tmp_path, monkeypatch):
    database = tmp_path / "behind.db"
    _migrate(database, monkeypatch, "head")
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_DIR))
    command.downgrade(config, "-1")
    engine = create_async_engine(f"sqlite+aiosqlite:///{database.as_posix()}")
    try:
        assert await schema_upgrade.schema_is_current(engine) is False
    finally:
        await engine.dispose()


async def test_schema_is_current_false_for_empty_database(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'empty.db').as_posix()}")
    try:
        assert await schema_upgrade.schema_is_current(engine) is False
    finally:
        await engine.dispose()
