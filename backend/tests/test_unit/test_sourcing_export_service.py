"""
Unit tests for sourcing_export_service.build_sourcing_export_csv.
"""

import csv
import io
import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

from app.models.sourcing import SourcingStatus


def _make_item(**kwargs) -> MagicMock:
    defaults = dict(
        id=1,
        sourcing_request_id=10,
        publisher_name="Acme",
        software_description="Widget Pro",
        quantity=5,
        estimated_unit_price=None,
        estimated_total_price="1000.00",
        currency="EUR",
        supplier="SupplierCo",
        contact_email="vendor@example.com",
        status=SourcingStatus.sourcing,
        renewal_for_license_id=None,
        created_at=datetime(2026, 1, 15),
    )
    defaults.update(kwargs)
    item = MagicMock()
    for k, v in defaults.items():
        setattr(item, k, v)
    return item


@pytest.mark.asyncio
async def test_build_sourcing_export_csv_returns_csv_with_header():
    """Output is a non-empty string parseable as CSV with the correct header."""
    db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = []
    db.execute.return_value = mock_result

    from app.services.sourcing_export_service import build_sourcing_export_csv
    result = await build_sourcing_export_csv(db)

    assert isinstance(result, str)
    rows = list(csv.reader(io.StringIO(result)))
    assert rows[0][0] == "Sourcing Request ID"
    assert rows[0][1] == "Sourcing Line ID"
    assert rows[0][4] == "Publisher"


@pytest.mark.asyncio
async def test_build_sourcing_export_csv_includes_item_data():
    """Each active sourcing item appears as a data row."""
    item = _make_item(id=42, publisher_name="Adobe", renewal_for_license_id=None)
    db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [item]
    db.execute.return_value = mock_result

    from app.services.sourcing_export_service import build_sourcing_export_csv
    result = await build_sourcing_export_csv(db)

    rows = list(csv.reader(io.StringIO(result)))
    assert len(rows) == 2  # header + 1 item
    assert rows[1][0] == "10"
    assert rows[1][1] == "42"
    assert rows[1][4] == "Adobe"


@pytest.mark.asyncio
async def test_build_sourcing_export_csv_resolves_predecessor_license():
    """Items with renewal_for_license_id get license_ref from the predecessor license."""
    item = _make_item(id=10, renewal_for_license_id=99)
    predecessor = MagicMock()
    predecessor.id = 99
    predecessor.license_ref = "L-2024-099"
    predecessor.external_ref = "EXT-099"

    db = AsyncMock()
    call_count = 0

    def execute_side_effect(stmt):
        nonlocal call_count
        call_count += 1
        mock_result = MagicMock()
        if call_count == 1:
            mock_result.scalars.return_value.all.return_value = [item]
        else:
            mock_result.scalars.return_value.all.return_value = [predecessor]
        return mock_result

    db.execute.side_effect = execute_side_effect

    from app.services.sourcing_export_service import build_sourcing_export_csv
    result = await build_sourcing_export_csv(db)

    rows = list(csv.reader(io.StringIO(result)))
    assert rows[1][2] == "L-2024-099"  # License Ref column (index 2)
    assert rows[1][3] == "EXT-099"     # External Ref column (index 3)
