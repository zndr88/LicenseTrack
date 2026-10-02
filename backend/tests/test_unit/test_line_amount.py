"""Shared line-amount cases, also run by the frontend (lineAmount.test.js)."""

import json
from decimal import Decimal
from pathlib import Path

import pytest

from app.services.license_service import calc_line_total, unit_price_from_total

CASES = json.loads(
    (Path(__file__).resolve().parents[1] / "fixtures" / "line_amount_cases.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", CASES["line_amount"], ids=lambda c: f"{c['quantity']!r}x{c['unit_price']!r}")
def test_shared_line_amount_case(case):
    result = calc_line_total(case["quantity"], case["unit_price"])
    if case["expected"] is None:
        assert result is None
    else:
        assert result == Decimal(case["expected"])


@pytest.mark.parametrize(
    "case", CASES["unit_price_from_total"], ids=lambda c: f"{c['total']!r}/{c['quantity']!r}"
)
def test_shared_unit_price_from_total_case(case):
    assert unit_price_from_total(case["total"], case["quantity"]) == case["expected"]


from tests.single_owner import find_definitions  # noqa: E402

APP = Path(__file__).resolve().parents[2] / "app"


def test_stored_line_total_is_only_touched_by_its_compatibility_owners():
    """The retired stored Line Total may only be declared, accepted for API
    compatibility, cleared for freeware, or recognized by CSV to warn."""
    assert find_definitions(
        APP,
        r"\btotal_po_price\b",
        owners={
            "models/license.py",
            "schemas/license.py",
            "schemas/pending_order.py",
            "services/license_write_service.py",
            "routes/csv_import.py",
            "services/csv_fields.py",
            "services/csv_importer.py",
            "services/conversion/license_converter.py",
            "services/sourcing_license_conversion_service.py",
            "services/pending_order_conversion_service.py",
        },
    ) == []
