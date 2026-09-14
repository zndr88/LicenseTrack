"""Canonical text normalization shared by Python and SQLite procurement lookups."""

def normalize_po_number(value: str | None) -> str:
    return " ".join((value or "").split()).casefold()
