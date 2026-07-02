from __future__ import annotations

from typing import Any


FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def escape_csv_formula(value: Any) -> Any:
    """Prefix spreadsheet-formula-looking text cells with an apostrophe."""
    if not isinstance(value, str):
        return value
    stripped = value.lstrip()
    if stripped.startswith(FORMULA_PREFIXES):
        return f"'{value}"
    return value


def safe_csv_row(values: list[Any]) -> list[Any]:
    return [escape_csv_formula(value) for value in values]
