"""Upgrade and rollback coverage for custom-field renewal behavior."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.config import settings


BACKEND_ROOT = Path(__file__).resolve().parents[2]
PREVIOUS_REVISION = "b7e4c2a19d6f"
RENEWAL_BEHAVIOR_REVISION = "da1b2c3d4e5f"


def _alembic_config(database_path: Path, monkeypatch) -> Config:
    monkeypatch.setattr(
        settings,
        "DATABASE_URL",
        f"sqlite+aiosqlite:///{database_path.as_posix()}",
    )
    config = Config()
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    return config


def test_custom_field_renewal_behavior_upgrade_and_rollback(tmp_path, monkeypatch):
    database_path = tmp_path / "custom-field-renewal-behavior.sqlite"
    config = _alembic_config(database_path, monkeypatch)
    command.upgrade(config, PREVIOUS_REVISION)

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        connection.execute(text(
            "INSERT INTO custom_field_definitions "
            "(name, field_key, field_type, display_order, carry_forward_on_renewal) VALUES "
            "('Blank field', 'cf_blank_field', 'text', 0, 0), "
            "('Copied field', 'cf_copied_field', 'text', 1, 1)"
        ))
    engine.dispose()

    command.upgrade(config, RENEWAL_BEHAVIOR_REVISION)

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        columns = {column["name"] for column in inspect(connection).get_columns("custom_field_definitions")}
        behaviors = dict(connection.execute(text(
            "SELECT name, renewal_behavior FROM custom_field_definitions ORDER BY display_order"
        )).all())
        connection.execute(text(
            "UPDATE custom_field_definitions SET renewal_behavior = 'hide' WHERE name = 'Blank field'"
        ))
    assert "renewal_behavior" in columns
    assert "carry_forward_on_renewal" not in columns
    assert behaviors == {"Blank field": "clear", "Copied field": "copy"}
    engine.dispose()

    command.downgrade(config, PREVIOUS_REVISION)

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.connect() as connection:
        columns = {column["name"] for column in inspect(connection).get_columns("custom_field_definitions")}
        carry_values = dict(connection.execute(text(
            "SELECT name, carry_forward_on_renewal FROM custom_field_definitions ORDER BY display_order"
        )).all())
    assert "carry_forward_on_renewal" in columns
    assert "renewal_behavior" not in columns
    assert carry_values == {"Blank field": 0, "Copied field": 1}
    engine.dispose()
