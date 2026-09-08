"""Regression coverage for the relationship-integrity repair migrations."""

import json
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
        "is_retired": False,
        "is_completeness_exempt": False,
        "renewal_notifications_enabled": True,
        "has_maintenance": False,
    }
    values.update(overrides)
    # This helper intentionally inserts rows before the repair migration in
    # upgrade tests; newer ORM-only columns are not present at that revision.
    existing_columns = {column["name"] for column in inspect(connection).get_columns("licenses")}
    values = {key: value for key, value in values.items() if key in existing_columns}
    names = list(values)
    encoded_values = [
        json.dumps(value) if isinstance(value, list) else getattr(value, "value", value)
        for value in (values[name] for name in names)
    ]
    statement = text(
        f"INSERT INTO licenses ({', '.join(names)}) "
        f"VALUES ({', '.join(':' + name for name in names)})"
    )
    connection.execute(statement, dict(zip(names, encoded_values)))
    return int(connection.execute(text("SELECT last_insert_rowid()")).scalar_one())


def _foreign_key_by_column(inspector, table: str) -> dict[str, dict]:
    return {
        foreign_key["constrained_columns"][0]: foreign_key
        for foreign_key in inspector.get_foreign_keys(table)
        if len(foreign_key["constrained_columns"]) == 1
    }


def test_scheduled_retirement_preserves_parentless_maintenance_and_round_trips(tmp_path, monkeypatch):
    database_path = tmp_path / "scheduled-retirement.sqlite"
    config = _alembic_config(database_path, monkeypatch)
    # Start at the 1.1.17 revision to exercise the reported upgrade path.
    command.upgrade(config, "b7e4c2a19d6f")
    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    original = {}
    expected = {}
    with engine.begin() as connection:
        parent_id = _insert_license(connection, license_type=LicenseType.perpetual)
        dates = connection.execute(text(
            "SELECT DATE('now', 'localtime', '-1 day'), DATE('now', 'localtime'), "
            "DATE('now', 'localtime', '+30 days')"
        )).one()
        for end_date in [None, *dates]:
            for license_type, parent, legacy in [
                (LicenseType.subscription, None, False),
                (LicenseType.maintenance, parent_id, False),
                (LicenseType.maintenance, None, True),
                (LicenseType.maintenance, None, False),
            ]:
                for retired in [False, True]:
                    parentless = license_type == LicenseType.maintenance and parent is None and not legacy
                    if parentless and not retired:
                        continue  # This state is already forbidden by the pre-upgrade CHECK.
                    license_id = _insert_license(
                        connection,
                        license_type=license_type,
                        parent_license_id=parent,
                        is_legacy_unlinked_maintenance=legacy,
                        is_retired=retired,
                        end_date=end_date,
                    )
                    original[license_id] = (retired, parent, legacy, end_date)
                    scheduled = retired and end_date in dates[1:] and not parentless
                    expected[license_id] = (retired and not scheduled, scheduled, parent, legacy, end_date)

    def assert_rows(scheduled):
        with engine.connect() as connection:
            columns = "is_retired, " + ("retirement_scheduled, " if scheduled else "")
            rows = connection.execute(text(
                f"SELECT id, {columns}parent_license_id, is_legacy_unlinked_maintenance, end_date "
                "FROM licenses WHERE id != :parent_id"
            ), {"parent_id": parent_id}).all()
            assert {row[0]: tuple(row[1:]) for row in rows} == (expected if scheduled else original)
            assert connection.execute(text("PRAGMA integrity_check")).scalar_one() == "ok"
            assert connection.execute(text("PRAGMA foreign_key_check")).all() == []

    try:
        command.upgrade(config, "e2f3a4b5c6d7")
        assert_rows(scheduled=True)
        with engine.begin() as connection:
            with pytest.raises(IntegrityError, match="ck_license_maintenance_has_parent"):
                _insert_license(connection, license_type=LicenseType.maintenance)
        command.downgrade(config, "b7e4c2a19d6f")
        assert_rows(scheduled=False)
        command.upgrade(config, "head")
        assert_rows(scheduled=True)
    finally:
        engine.dispose()


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


def test_legacy_unlinked_maintenance_constraint_states(tmp_path, monkeypatch):
    database_path = tmp_path / "legacy-unlinked.sqlite"
    command.upgrade(_alembic_config(database_path, monkeypatch), "head")

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        connection.execute(text("PRAGMA foreign_keys=ON"))
        parent_id = _insert_license(
            connection,
            software_description="Eligible Parent",
            license_type=LicenseType.perpetual,
            maintenance_coverage=MaintenanceCoverage.unknown,
        )
        legacy_id = _insert_license(
            connection,
            software_description="Legacy Maintenance",
            license_type=LicenseType.maintenance,
            maintenance_coverage=MaintenanceCoverage.not_applicable,
            is_legacy_unlinked_maintenance=True,
        )
        assert legacy_id > parent_id

        with pytest.raises(IntegrityError):
            _insert_license(
                connection,
                software_description="Unflagged Parentless Maintenance",
                license_type=LicenseType.maintenance,
                maintenance_coverage=MaintenanceCoverage.not_applicable,
            )
        with pytest.raises(IntegrityError):
            _insert_license(
                connection,
                software_description="Linked Flagged Maintenance",
                license_type=LicenseType.maintenance,
                maintenance_coverage=MaintenanceCoverage.not_applicable,
                parent_license_id=parent_id,
                is_legacy_unlinked_maintenance=True,
            )
        with pytest.raises(IntegrityError):
            _insert_license(
                connection,
                software_description="Flagged Non Maintenance",
                license_type=LicenseType.subscription,
                is_legacy_unlinked_maintenance=True,
            )
    engine.dispose()
