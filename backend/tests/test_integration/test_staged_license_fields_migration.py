"""Upgrade and rollback coverage for staged procurement license fields."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.config import settings


BACKEND_ROOT = Path(__file__).resolve().parents[2]
PREVIOUS_REVISION = "9f2c4e6a8b1d"
STAGED_FIELDS_REVISION = "b7e4c2a19d6f"


def _alembic_config(database_path: Path, monkeypatch) -> Config:
    monkeypatch.setattr(
        settings,
        "DATABASE_URL",
        f"sqlite+aiosqlite:///{database_path.as_posix()}",
    )
    config = Config()
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    return config


def test_staged_license_fields_upgrade_and_rollback_real_previous_schema(tmp_path, monkeypatch):
    database_path = tmp_path / "staged-license-fields.sqlite"
    config = _alembic_config(database_path, monkeypatch)
    command.upgrade(config, PREVIOUS_REVISION)

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.connect() as connection:
        previous_tables = set(inspect(connection).get_table_names())
    assert {"custom_field_definitions", "sourcing_items"}.issubset(previous_tables)
    engine.dispose()

    command.upgrade(config, STAGED_FIELDS_REVISION)

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.connect() as connection:
        inspector = inspect(connection)
        custom_field_columns = {
            column["name"] for column in inspector.get_columns("custom_field_definitions")
        }
        sourcing_columns = {
            column["name"] for column in inspector.get_columns("sourcing_items")
        }
        tables = set(inspector.get_table_names())
    assert "carry_forward_on_renewal" in custom_field_columns
    assert {
        "license_metric",
        "portal_url",
        "quantity_per_unit",
        "sku_code",
        "notice_date",
        "purchase_date",
        "contract_number",
        "invoice_number",
        "external_ref",
        "cost_centre",
        "budget_owner_email",
        "secondary_contacts",
    }.issubset(sourcing_columns)
    assert "sourcing_item_custom_values" in tables
    engine.dispose()

    command.downgrade(config, PREVIOUS_REVISION)

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.connect() as connection:
        inspector = inspect(connection)
        custom_field_columns = {
            column["name"] for column in inspector.get_columns("custom_field_definitions")
        }
        sourcing_columns = {
            column["name"] for column in inspector.get_columns("sourcing_items")
        }
        tables = set(inspector.get_table_names())
    assert "carry_forward_on_renewal" not in custom_field_columns
    assert "license_metric" not in sourcing_columns
    assert "sourcing_item_custom_values" not in tables
    engine.dispose()
