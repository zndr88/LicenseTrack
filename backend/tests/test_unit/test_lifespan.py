import asyncio

import pytest

import app.main as main_module


async def test_lifespan_runs_migrations_seed_and_scheduler(monkeypatch):
    calls: list[str] = []

    def fake_upgrade(_cfg, revision):
        calls.append(f"upgrade:{revision}")

    async def fake_seed():
        calls.append("seed")

    async def fake_scheduler():
        calls.append("scheduler")
        await asyncio.Event().wait()

    monkeypatch.setattr(main_module.alembic_command, "upgrade", fake_upgrade)
    monkeypatch.setattr("app.seed.seed", fake_seed)
    monkeypatch.setattr(main_module, "start_scheduler", fake_scheduler)
    monkeypatch.setattr(main_module.settings, "JWT_SECRET", "test-secret")
    monkeypatch.setattr(main_module.settings, "ADMIN_PASSWORD", "strong-password")

    async with main_module.lifespan(main_module.app):
        await asyncio.sleep(0)

    assert calls == ["upgrade:head", "seed", "scheduler"]


async def test_lifespan_exits_when_jwt_secret_is_default(monkeypatch):
    monkeypatch.setattr(main_module.alembic_command, "upgrade", lambda _cfg, _revision: None)
    monkeypatch.setattr(main_module.settings, "JWT_SECRET", "changeme")
    monkeypatch.setattr(main_module.settings, "ADMIN_PASSWORD", "strong-password")

    with pytest.raises(SystemExit):
        async with main_module.lifespan(main_module.app):
            pass


@pytest.mark.parametrize("weak_secret", ["", "password", "Secret", "  changeme  ", "your-secret-key"])
async def test_lifespan_exits_when_jwt_secret_is_blank_or_common(monkeypatch, weak_secret):
    monkeypatch.setattr(main_module.alembic_command, "upgrade", lambda _cfg, _revision: None)
    monkeypatch.setattr(main_module.settings, "JWT_SECRET", weak_secret)
    monkeypatch.setattr(main_module.settings, "ADMIN_PASSWORD", "strong-password")

    with pytest.raises(SystemExit):
        async with main_module.lifespan(main_module.app):
            pass
