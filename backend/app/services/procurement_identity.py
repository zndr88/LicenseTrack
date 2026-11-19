"""Canonical PO-number normalization. Stored in License.po_key and ProcurementDocument.shared_po_key."""

def normalize_po_number(value: str | None) -> str:
    return " ".join((value or "").split()).casefold()
