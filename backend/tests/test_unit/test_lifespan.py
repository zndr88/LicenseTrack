import asyncio

import pytest

import app.main as main_module
from app.services import schema_upgrade


async def test_lifespan_runs_migrations_seed_and_scheduler(monkeypatch):
    calls: list[str] = []

    def fake_snapshot():
        calls.append("snapshot")
        return None

    def fake_upgrade(_cfg, revision):
        calls.append(f"upgrade:{revision}")

    async def fake_seed():
        calls.append("seed")

    async def fake_scheduler():
        calls.append("scheduler")
        await asyncio.Event().wait()

    monkeypatch.setattr(schema_upgrade, "create_pre_migration_snapshot", fake_snapshot)
    monkeypatch.setattr(schema_upgrade.alembic_command, "upgrade", fake_upgrade)
    monkeypatch.setattr("app.seed.seed", fake_seed)
    monkeypatch.setattr(main_module, "start_scheduler", fake_scheduler)
    monkeypatch.setattr(main_module.settings, "JWT_SECRET", "test-secret")
    monkeypatch.setattr(main_module.settings, "ADMIN_PASSWORD", "strong-password")

    async with main_module.lifespan(main_module.app):
        await asyncio.sleep(0)

    assert calls == ["snapshot", "upgrade:head", "seed", "scheduler"]


async def test_lifespan_exits_when_jwt_secret_is_default(monkeypatch):
    monkeypatch.setattr(schema_upgrade, "create_pre_migration_snapshot", lambda: None)
    monkeypatch.setattr(schema_upgrade.alembic_command, "upgrade", lambda _cfg, _revision: None)
    monkeypatch.setattr(main_module.settings, "JWT_SECRET", "changeme")
    monkeypatch.setattr(main_module.settings, "ADMIN_PASSWORD", "strong-password")

    with pytest.raises(SystemExit):
        async with main_module.lifespan(main_module.app):
            pass


@pytest.mark.parametrize("weak_secret", ["", "password", "Secret", "  changeme  ", "your-secret-key"])
async def test_lifespan_exits_when_jwt_secret_is_blank_or_common(monkeypatch, weak_secret):
    monkeypatch.setattr(schema_upgrade, "create_pre_migration_snapshot", lambda: None)
    monkeypatch.setattr(schema_upgrade.alembic_command, "upgrade", lambda _cfg, _revision: None)
    monkeypatch.setattr(main_module.settings, "JWT_SECRET", weak_secret)
    monkeypatch.setattr(main_module.settings, "ADMIN_PASSWORD", "strong-password")

    with pytest.raises(SystemExit):
        async with main_module.lifespan(main_module.app):
            pass


async def test_lifespan_does_not_migrate_when_snapshot_fails(monkeypatch):
    upgrades: list[str] = []

    def failing_snapshot():
        raise OSError("disk full")

    monkeypatch.setattr(schema_upgrade, "create_pre_migration_snapshot", failing_snapshot)
    monkeypatch.setattr(schema_upgrade.alembic_command, "upgrade", lambda _cfg, revision: upgrades.append(revision))

    with pytest.raises(OSError):
        async with main_module.lifespan(main_module.app):
            pass

    assert upgrades == []


async def test_lifespan_skips_upgrade_when_startup_migrations_are_off(monkeypatch):
    calls: list[str] = []

    async def schema_current(_engine):
        calls.append("check")
        return True

    async def fake_seed():
        calls.append("seed")

    async def fake_scheduler():
        await asyncio.Event().wait()

    monkeypatch.setattr(main_module.settings, "RUN_MIGRATIONS_ON_STARTUP", False)
    monkeypatch.setattr(schema_upgrade, "upgrade_schema", lambda: calls.append("upgrade"))
    monkeypatch.setattr(main_module, "schema_is_current", schema_current)
    monkeypatch.setattr("app.seed.seed", fake_seed)
    monkeypatch.setattr(main_module, "start_scheduler", fake_scheduler)
    monkeypatch.setattr(main_module.settings, "JWT_SECRET", "test-secret")
    monkeypatch.setattr(main_module.settings, "ADMIN_PASSWORD", "strong-password")

    async with main_module.lifespan(main_module.app):
        await asyncio.sleep(0)

    assert calls == ["check", "seed"]


async def test_lifespan_refuses_to_start_on_outdated_schema_when_startup_migrations_are_off(monkeypatch):
    async def schema_behind(_engine):
        return False

    monkeypatch.setattr(main_module.settings, "RUN_MIGRATIONS_ON_STARTUP", False)
    monkeypatch.setattr(main_module, "schema_is_current", schema_behind)

    with pytest.raises(main_module.SchemaNotCurrentError):
        async with main_module.lifespan(main_module.app):
            pass
