"""Upgrade and rollback coverage for removal of inert persisted settings."""

import json
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Boolean, Integer, JSON, Numeric, String, Text, create_engine, inspect, text

from app.config import settings


BACKEND_ROOT = Path(__file__).resolve().parents[2]
PRE_CLEANUP_REVISION = "8a9b0c1d2e3f"
CLEANUP_REVISION = "9f2c4e6a8b1d"


def _alembic_config(database_path: Path, monkeypatch) -> Config:
    monkeypatch.setattr(
        settings,
        "DATABASE_URL",
        f"sqlite+aiosqlite:///{database_path.as_posix()}",
    )
    config = Config()
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    return config


def _required_row(connection, table: str, **overrides) -> None:
    """Insert a row at an older revision without coupling to the current ORM."""
    values = dict(overrides)
    for column in inspect(connection).get_columns(table):
        name = column["name"]
        if name in values or column["nullable"] or column["default"] is not None:
            continue
        column_type = column["type"]
        if isinstance(column_type, JSON):
            values[name] = json.dumps({})
        elif isinstance(column_type, Boolean):
            values[name] = False
        elif isinstance(column_type, Integer):
            values[name] = 1
        elif isinstance(column_type, Numeric):
            values[name] = "1"
        elif isinstance(column_type, (String, Text)):
            values[name] = ""
        else:
            raise AssertionError(f"No fixture value for {table}.{name} ({column_type!r})")

    names = list(values)
    connection.execute(
        text(
            f"INSERT INTO {table} ({', '.join(names)}) "
            f"VALUES ({', '.join(':' + name for name in names)})"
        ),
        values,
    )


def test_settings_cleanup_preserves_active_values_and_has_safe_rollback(tmp_path, monkeypatch):
    database_path = tmp_path / "settings-cleanup.sqlite"
    config = _alembic_config(database_path, monkeypatch)
    command.upgrade(config, PRE_CLEANUP_REVISION)

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        _required_row(
            connection,
            "users",
            id=7,
            username="migration-user",
            email="migration@example.com",
            hashed_password="not-used",
            auth_provider="local",
            role="viewer",
            is_active=True,
            allow_downloads=True,
            is_break_glass_admin=False,
            must_change_password=False,
            security_version=0,
        )
        _required_row(
            connection,
            "user_settings",
            id=3,
            user_id=7,
            visible_in_list=json.dumps({"publisher": False}),
            visible_in_detail=json.dumps({"supplier": True}),
            notification_days=91,
            manager_email="obsolete-user-value@example.com",
            theme="dark",
            display_currency="USD",
            column_order=json.dumps(["publisher", "software"]),
            saved_views=json.dumps([{"name": "Mine"}]),
            renewal_workbench_columns=json.dumps({"days": False}),
            sidebar_collapsed=True,
            number_format_locale="de-DE",
            ui_size="large",
            date_format="YYYY-MM-DD",
            time_format="12h",
            time_zone="Europe/Brussels",
        )
        _required_row(
            connection,
            "global_settings",
            id=1,
            mandatory_fields=json.dumps({"invoice": True}),
            auth_method="obsolete-auth-value",
            session_timeout=47,
            password_min_length=15,
            notification_days=45,
            notice_notification_days=12,
            manager_email="active-manager@example.com",
            backup_keep=22,
        )
    engine.dispose()

    command.upgrade(config, CLEANUP_REVISION)

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        user_columns = {column["name"] for column in inspect(connection).get_columns("user_settings")}
        global_columns = {column["name"] for column in inspect(connection).get_columns("global_settings")}
        assert {"notification_days", "manager_email"}.isdisjoint(user_columns)
        assert "auth_method" not in global_columns

        user_values = connection.execute(
            text(
                "SELECT theme, display_currency, number_format_locale, ui_size, "
                "date_format, time_format, time_zone FROM user_settings WHERE id = 3"
            )
        ).one()
        assert user_values == (
            "dark",
            "USD",
            "de-DE",
            "large",
            "YYYY-MM-DD",
            "12h",
            "Europe/Brussels",
        )

        global_values = connection.execute(
            text(
                "SELECT session_timeout, password_min_length, notification_days, "
                "notice_notification_days, manager_email, backup_keep "
                "FROM global_settings WHERE id = 1"
            )
        ).one()
        assert global_values == (47, 15, 45, 12, "active-manager@example.com", 22)
    engine.dispose()

    command.downgrade(config, PRE_CLEANUP_REVISION)

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        user_columns = {column["name"] for column in inspect(connection).get_columns("user_settings")}
        global_columns = {column["name"] for column in inspect(connection).get_columns("global_settings")}
        assert {"notification_days", "manager_email"}.issubset(user_columns)
        assert "auth_method" in global_columns

        restored_defaults = connection.execute(
            text(
                "SELECT notification_days, manager_email FROM user_settings WHERE id = 3"
            )
        ).one()
        assert restored_defaults == (30, "")
        assert connection.execute(
            text("SELECT auth_method FROM global_settings WHERE id = 1")
        ).scalar_one() == "mfa"

        active_values = connection.execute(
            text("SELECT notification_days, manager_email FROM global_settings WHERE id = 1")
        ).one()
        assert active_values == (45, "active-manager@example.com")
    engine.dispose()
