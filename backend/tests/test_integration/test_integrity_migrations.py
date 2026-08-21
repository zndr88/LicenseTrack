"""Regression coverage for the relationship-integrity repair migrations."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.models.license import License, LicenseMetric, LicenseType, MaintenanceCoverage


BACKEND_ROOT = Path(__file__).resolve().parents[2]
PRE_REPAIR_REVISION = "3c4d5e6f7a81"


def _alembic_config(database_path: Path, monkeypatch) -> Config:
    monkeypatch.setattr(
        settings,
        "DATABASE_URL",
        f"sqlite+aiosqlite:///{database_path.as_posix()}",
    )
    # A programmatic config avoids Alembic's fileConfig() call mutating the
    # process-wide logging registry and making later caplog tests order-dependent.
    config = Config()
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    return config


def _insert_license(connection, **overrides) -> int:
    values = {
        "publisher_name": "Migration Publisher",
        "software_description": "Migration License",
        "license_type": LicenseType.subscription,
        "license_metric": LicenseMetric.per_user,
        "quantity": "1",
        "quantity_per_unit": "1",
        "sku_code": "",
        "unit_price": "10",
        "total_po_price": "10",
        "currency": "EUR",
        "contract_number": "",
        "po_number": "",
        "procurement_reference": "",
        "invoice_number": "",
        "invoice_numbers": [],
        "contact_email": "",
        "supplier": "",
        "cost_centre": "",
        "budget_owner_email": "",
        "secondary_contacts": [],
        "maintenance_coverage": MaintenanceCoverage.not_applicable,
    }
    values.update(overrides)
    result = connection.execute(License.__table__.insert().values(**values))
    return int(result.inserted_primary_key[0])


def _foreign_key_by_column(inspector, table: str) -> dict[str, dict]:
    return {
        foreign_key["constrained_columns"][0]: foreign_key
        for foreign_key in inspector.get_foreign_keys(table)
        if len(foreign_key["constrained_columns"]) == 1
    }


def test_integrity_migrations_create_canonical_foreign_keys(tmp_path, monkeypatch):
    database_path = tmp_path / "fresh-integrity.sqlite"
    command.upgrade(_alembic_config(database_path, monkeypatch), "head")

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        connection.execute(text("PRAGMA foreign_keys=ON"))
        inspector = inspect(connection)
        license_fks = _foreign_key_by_column(inspector, "licenses")
        procurement_fks = _foreign_key_by_column(inspector, "procurement_documents")

        assert license_fks["contract_id"]["referred_table"] == "contracts"
        assert license_fks["pending_order_id"]["referred_table"] == "pending_orders"
        assert license_fks["predecessor_id"]["referred_table"] == "licenses"
        assert license_fks["parent_license_id"]["referred_table"] == "licenses"
        assert license_fks["parent_license_id"]["options"]["ondelete"] == "SET NULL"
        assert procurement_fks["license_id"]["referred_table"] == "licenses"

        license_id = _insert_license(connection)
        with pytest.raises(IntegrityError):
            connection.execute(
                text("UPDATE licenses SET contract_id = 999999 WHERE id = :license_id"),
                {"license_id": license_id},
            )

    engine.dispose()


def test_integrity_migration_upgrades_existing_rows_and_parent_delete_behavior(tmp_path, monkeypatch):
    database_path = tmp_path / "upgrade-integrity.sqlite"
    config = _alembic_config(database_path, monkeypatch)
    command.upgrade(config, PRE_REPAIR_REVISION)

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        connection.execute(text("PRAGMA foreign_keys=ON"))
        parent_id = _insert_license(
            connection,
            software_description="Migration Parent",
            license_type=LicenseType.perpetual,
            maintenance_coverage=MaintenanceCoverage.unknown,
        )
        child_id = _insert_license(
            connection,
            software_description="Migration Maintenance",
            license_type=LicenseType.maintenance,
            maintenance_coverage=MaintenanceCoverage.not_applicable,
            parent_license_id=parent_id,
        )
    engine.dispose()

    command.upgrade(config, "head")

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        connection.execute(text("PRAGMA foreign_keys=ON"))
        stored = connection.execute(
            select(License.id, License.parent_license_id, License.is_retired).where(
                License.id.in_([parent_id, child_id])
            )
        ).all()
        assert len(stored) == 2

        connection.execute(
            text("UPDATE licenses SET is_retired = 1 WHERE id = :child_id"),
            {"child_id": child_id},
        )
        connection.execute(
            text("DELETE FROM licenses WHERE id = :parent_id"),
            {"parent_id": parent_id},
        )
        child_parent_id = connection.execute(
            text("SELECT parent_license_id FROM licenses WHERE id = :child_id"),
            {"child_id": child_id},
        ).scalar_one()
        assert child_parent_id is None

    engine.dispose()
