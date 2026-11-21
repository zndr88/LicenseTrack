"""Loader for the JSON case files the in-browser demo also runs.

The files in tests/fixtures describe licenses with the camelCase names of the
API and give dates as whole-day offsets from today, so the same case works in
Python and in JavaScript on any day.
"""

import json
import re
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

from app.models.license import LicenseType, MaintenanceCoverage

_FIXTURES = Path(__file__).resolve().parent / "fixtures"
_DATE_FIELDS = frozenset({"startDate", "endDate", "noticeDate", "maintenanceStartDate", "maintenanceEndDate"})


def load_cases(file_name: str) -> dict:
    return json.loads((_FIXTURES / file_name).read_text(encoding="utf-8"))


def _snake(name: str) -> str:
    return re.sub(r"(?<!^)([A-Z])", r"_\1", name).lower()


def case_license(fields: dict, defaults: dict, today: date) -> SimpleNamespace:
    """A stand-in License built from a case's camelCase fields."""
    merged = {"id": 1, **defaults, **fields}
    values = {}
    for key, value in merged.items():
        if key in _DATE_FIELDS and value is not None:
            value = today + timedelta(days=value)
        values[_snake(key)] = value
    values["license_type"] = LicenseType(values["license_type"])
    if values.get("maintenance_coverage") is not None:
        values["maintenance_coverage"] = MaintenanceCoverage(values["maintenance_coverage"])
    return SimpleNamespace(**values)
