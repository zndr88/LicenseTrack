"""Upgrade and rollback coverage for custom-field sourcing visibility."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.config import settings


BACKEND_ROOT = Path(__file__).resolve().parents[2]
PREVIOUS_REVISION = "e2f3a4b5c6d7"
SOURCING_VISIBILITY_REVISION = "f3a4b5c6d7e8"


def _alembic_config(database_path: Path, monkeypatch) -> Config:
    monkeypatch.setattr(
        settings,
        "DATABASE_URL",
        f"sqlite+aiosqlite:///{database_path.as_posix()}",
    )
    config = Config()
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    return config


def test_custom_field_sourcing_visibility_upgrade_and_rollback(tmp_path, monkeypatch):
    database_path = tmp_path / "custom-field-sourcing-visibility.sqlite"
    config = _alembic_config(database_path, monkeypatch)
    command.upgrade(config, PREVIOUS_REVISION)

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        connection.execute(text(
            "INSERT INTO custom_field_definitions "
            "(name, field_key, field_type, display_order, renewal_behavior) VALUES "
            "('Invoice date', 'cf_invoice_date', 'date', 0, 'clear')"
        ))
    engine.dispose()

    command.upgrade(config, SOURCING_VISIBILITY_REVISION)

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.connect() as connection:
        columns = {column["name"] for column in inspect(connection).get_columns("custom_field_definitions")}
        show_on_sourcing = connection.scalar(text(
            "SELECT show_on_sourcing_forms FROM custom_field_definitions WHERE field_key = 'cf_invoice_date'"
        ))
    assert "show_on_sourcing_forms" in columns
    assert show_on_sourcing == 1
    engine.dispose()

    command.downgrade(config, PREVIOUS_REVISION)

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.connect() as connection:
        columns = {column["name"] for column in inspect(connection).get_columns("custom_field_definitions")}
    assert "show_on_sourcing_forms" not in columns
    engine.dispose()
