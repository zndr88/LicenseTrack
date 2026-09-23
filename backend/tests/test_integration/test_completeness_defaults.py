"""Completeness defaults apply to newly created settings only, never on upgrade."""

import json

from alembic import command
from sqlalchemy import create_engine, text

from app.services.settings_service import invalidate_global_settings_cache
from tests.test_integration.test_settings_cleanup_migration import _alembic_config, _required_row

PRE_1_1_24_HEAD = "a5b6c7d8e9f0"
_ALL_OFF = {
    key: False
    for key in (
        "invoice", "eula", "entitlement", "purchaseOrder", "quote", "startDate", "endDate", "noticeDate",
        "contractNumber", "poNumber", "invoiceNumber", "contactEmail", "costCentre", "budgetOwnerEmail",
    )
}


async def test_new_settings_row_requires_po_budget_owner_and_invoice_number(test_app, auth_headers):
    resp = await test_app.get("/api/settings/global", headers=auth_headers)
    # This request creates and caches the settings row; do not leak it to later tests.
    invalidate_global_settings_cache()

    assert resp.status_code == 200, resp.text
    mandatory = resp.json()["mandatory_fields"]
    assert mandatory["poNumber"] is True
    assert mandatory["budgetOwnerEmail"] is True
    assert mandatory["invoiceNumber"] is True
    assert mandatory["contractNumber"] is False


def test_upgrade_keeps_an_existing_all_off_completeness_configuration(tmp_path, monkeypatch):
    database_path = tmp_path / "completeness.sqlite"
    config = _alembic_config(database_path, monkeypatch)
    command.upgrade(config, PRE_1_1_24_HEAD)
    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        _required_row(connection, "global_settings", id=1, mandatory_fields=json.dumps(_ALL_OFF))
    engine.dispose()

    command.upgrade(config, "head")

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with engine.begin() as connection:
        stored = connection.execute(text("SELECT mandatory_fields FROM global_settings WHERE id = 1")).scalar()
    engine.dispose()
    assert json.loads(stored) == _ALL_OFF
