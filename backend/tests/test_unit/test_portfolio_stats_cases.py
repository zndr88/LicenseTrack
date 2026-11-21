"""Shared portfolio statistics cases, also run by the in-browser demo
(frontend/src/demo/__tests__/sharedCases.test.js)."""

from datetime import date

import pytest

from app.services.license_service import compute_stats
from tests.shared_cases import case_license, load_cases

CASES = load_cases("portfolio_stats_cases.json")


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda case: case["name"])
def test_shared_portfolio_stats_case(case):
    today = date.today()
    licenses = [case_license(fields, CASES["license_defaults"], today) for fields in case["licenses"]]

    stats = compute_stats(licenses, {}, case.get("mandatory_fields", {}), notification_days=30)

    for key, expected in case["expected"].items():
        if key == "annual_cost_by_currency":
            assert {currency: round(amount, 2) for currency, amount in stats[key].items()} == {
                currency: float(amount) for currency, amount in expected.items()
            }
        else:
            assert stats[key] == expected, key
