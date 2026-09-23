"""Upgrade coverage for per-currency high-value thresholds."""

import json

from alembic import command
from sqlalchemy import create_engine, text

from tests.test_integration.test_settings_cleanup_migration import _alembic_config, _required_row

PRE_THRESHOLDS_REVISION = "a7b8c9d0e1f2"
THRESHOLDS_REVISION = "b2c3d4e5f6a8"


def _seed(connection, *, threshold: str, admin_currency: str | None) -> None:
    _required_row(
        connection,
        "users",
        id=1,
        username="admin",
        email="admin@example.com",
        hashed_password="not-used",
        auth_provider="local",
        role="admin",
        is_active=True,
        allow_downloads=True,
        is_break_glass_admin=False,
        must_change_password=False,
        security_version=0,
    )
    if admin_currency is not None:
        _required_row(connection, "user_settings", id=1, user_id=1, display_currency=admin_currency)
    _required_row(connection, "global_settings", id=1, high_value_threshold=threshold)


def _thresholds(database_path) -> dict:
    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        raw = connection.execute(text("SELECT high_value_thresholds FROM global_settings WHERE id = 1")).scalar()
    engine.dispose()
    return json.loads(raw)


def test_upgrade_maps_old_threshold_to_the_admin_display_currency(tmp_path, monkeypatch):
    database_path = tmp_path / "thresholds.sqlite"
    config = _alembic_config(database_path, monkeypatch)
    command.upgrade(config, PRE_THRESHOLDS_REVISION)
    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        _seed(connection, threshold="75000.00", admin_currency="SEK")
    engine.dispose()

    command.upgrade(config, THRESHOLDS_REVISION)

    assert _thresholds(database_path) == {"SEK": "75000"}


def test_upgrade_falls_back_to_eur_without_user_settings(tmp_path, monkeypatch):
    database_path = tmp_path / "thresholds-default.sqlite"
    config = _alembic_config(database_path, monkeypatch)
    command.upgrade(config, PRE_THRESHOLDS_REVISION)
    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        _seed(connection, threshold="50000", admin_currency=None)
    engine.dispose()

    command.upgrade(config, THRESHOLDS_REVISION)
    command.downgrade(config, PRE_THRESHOLDS_REVISION)
    command.upgrade(config, THRESHOLDS_REVISION)

    assert _thresholds(database_path) == {"EUR": "50000"}
