import pytest

from app.services.import_.invoice_values import (
    INVOICE_LIST_PREFIX,
    parse_invoice_cell,
    serialize_invoice_cell,
)


def test_multi_invoice_cells_use_a_versioned_prefix_and_normalize_values():
    value = serialize_invoice_cell([" INV-1 ", "INV-2", "INV-1"], "INV-1")

    assert value == 'LT-INVOICES:[" INV-1 ", "INV-2", "INV-1"]'
    assert parse_invoice_cell(value) == ["INV-1", "INV-2"]


def test_legacy_multi_invoice_arrays_remain_importable():
    assert parse_invoice_cell('["INV-1", "INV-2"]') == ["INV-1", "INV-2"]


def test_single_item_json_looking_invoice_identifier_is_preserved_literally():
    assert parse_invoice_cell('["INV-1"]') == ['["INV-1"]']


def test_prefixed_invoice_cells_reject_non_text_members():
    with pytest.raises(ValueError, match="only text values"):
        parse_invoice_cell(INVOICE_LIST_PREFIX + '["INV-1", 2]')
