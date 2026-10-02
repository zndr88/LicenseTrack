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
