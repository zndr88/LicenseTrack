import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.pending_order import PendingOrderStatus
from app.services.pending_order_state import (
    OPEN_PENDING_ORDER_STATUSES,
    ensure_pending_order_editable,
    is_pending_order_open,
)
from tests.single_owner import find_definitions

APP = Path(__file__).resolve().parents[2] / "app"


def test_open_statuses_are_pending_and_invoice_received():
    assert OPEN_PENDING_ORDER_STATUSES == frozenset(
        {PendingOrderStatus.pending, PendingOrderStatus.invoice_received}
    )


@pytest.mark.parametrize("status", [PendingOrderStatus.pending, PendingOrderStatus.invoice_received])
def test_open_orders_are_editable(status):
    order = SimpleNamespace(status=status)
    assert is_pending_order_open(order)
    ensure_pending_order_editable(order)


@pytest.mark.parametrize("status", [PendingOrderStatus.converted, PendingOrderStatus.cancelled])
def test_closed_orders_are_rejected_with_409(status):
    order = SimpleNamespace(status=status)
    assert not is_pending_order_open(order)
    with pytest.raises(HTTPException) as exc:
        ensure_pending_order_editable(order, action="add lines to")
    assert exc.value.status_code == 409
    assert exc.value.detail == f"Cannot add lines to a {status.value} order"


def test_open_status_set_has_one_owner():
    pattern = (
        r"PendingOrderStatus\.pending,\s*PendingOrderStatus\.invoice_received"
        r"|PendingOrderStatus\.invoice_received,\s*PendingOrderStatus\.pending"
        r"|PendingOrderStatus\.converted,\s*PendingOrderStatus\.cancelled"
        r"|PendingOrderStatus\.cancelled,\s*PendingOrderStatus\.converted"
    )
    assert find_definitions(APP, pattern, owners={"services/pending_order_state.py"}) == []


def test_open_status_set_has_no_multiline_copy():
    """The line-based guard above can't see a set literal split over lines."""
    multiline = re.compile(
        r"PendingOrderStatus\.(pending|invoice_received|converted|cancelled)\s*,\s*"
        r"PendingOrderStatus\.(pending|invoice_received|converted|cancelled)"
    )
    hits = [
        path.relative_to(APP).as_posix()
        for path in sorted(APP.rglob("*.py"))
        if path.relative_to(APP).as_posix() != "services/pending_order_state.py"
        and multiline.search(path.read_text(encoding="utf-8"))
    ]
    assert hits == []
