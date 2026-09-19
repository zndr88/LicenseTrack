"""Lossless, unambiguous multi-invoice CSV cells."""

import json


INVOICE_LIST_PREFIX = "LT-INVOICES:"


def _normalize_invoice_values(values: list[object]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for item in values:
        if not isinstance(item, str):
            raise ValueError("Invoice number lists may contain only text values")
        invoice_number = item.strip()
        if not invoice_number:
            continue
        if invoice_number not in seen:
            normalized.append(invoice_number)
            seen.add(invoice_number)
    return normalized


def _parse_invoice_list(value: str) -> list[str]:
    try:
        values = json.loads(value)
    except ValueError as exc:
        raise ValueError("Invoice number list must contain valid JSON") from exc
    if not isinstance(values, list):
        raise ValueError("Invoice number list must be a JSON array")
    return _normalize_invoice_values(values)


def serialize_invoice_cell(invoice_numbers: list[str] | None, invoice_number: str) -> str:
    """Encode multiple invoice identifiers without colliding with literal text."""
    if len(invoice_numbers or []) > 1:
        return INVOICE_LIST_PREFIX + json.dumps(invoice_numbers, ensure_ascii=False)
    return invoice_number


def parse_invoice_cell(value: str) -> list[str]:
    """Parse current exports and unambiguous legacy multi-invoice exports."""
    if value.startswith(INVOICE_LIST_PREFIX):
        return _parse_invoice_list(value.removeprefix(INVOICE_LIST_PREFIX))

    if value.startswith("["):
        try:
            values = json.loads(value)
        except ValueError:
            return [value]
        else:
            # Before 1.1.23 exports used a bare array only when at least two
            # identifiers existed. A one-item array is now preserved literally.
            if isinstance(values, list) and len(values) > 1:
                return _normalize_invoice_values(values)
    return [value] if value else []
