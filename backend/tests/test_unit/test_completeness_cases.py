"""Shared record completeness cases, also run by the in-browser demo
(frontend/src/demo/__tests__/sharedCases.test.js)."""

from datetime import date
from types import SimpleNamespace

import pytest

from app.services.license_service import compute_completeness
from tests.shared_cases import case_license, load_cases

CASES = load_cases("completeness_cases.json")


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda case: case["name"])
def test_shared_completeness_case(case):
    license_obj = case_license(case["license"], CASES["license_defaults"], date.today())
    documents = [SimpleNamespace(category=SimpleNamespace(value=category)) for category in case["documents"]]

    assert compute_completeness(license_obj, documents, case["mandatory_fields"]) == case["expected"]
