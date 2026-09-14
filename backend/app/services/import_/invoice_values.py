"""Lossless multi-invoice CSV cells; ordinary single identifiers remain plain text."""

import json


def parse_invoice_cell(value: str) -> list[str]:
    if value.startswith("["):
        try:
            values = json.loads(value)
        except ValueError:
            pass
        else:
            if isinstance(values, list) and values and all(isinstance(item, str) and item.strip() for item in values):
                return list(dict.fromkeys(values))
    return [value] if value else []
