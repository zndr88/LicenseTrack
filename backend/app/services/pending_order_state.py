"""Single owner for "is this pending order still open?".

Open orders (pending, invoice received) can gain lines, be edited and be
converted. Converted and cancelled orders are closed. Every check, query
filter and lock uses the definitions here.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pending_order import PendingOrder, PendingOrderStatus

OPEN_PENDING_ORDER_STATUSES: frozenset[PendingOrderStatus] = frozenset(
    {PendingOrderStatus.pending, PendingOrderStatus.invoice_received}
)


def is_pending_order_open(order: PendingOrder) -> bool:
    return order.status in OPEN_PENDING_ORDER_STATUSES


def ensure_pending_order_editable(order: PendingOrder, *, action: str = "modify") -> None:
    """Raise 409 when the order is converted or cancelled."""
    if not is_pending_order_open(order):
        status = getattr(order.status, "value", order.status)
        raise HTTPException(status_code=409, detail=f"Cannot {action} a {status} order")


async def lock_open_pending_order(
    db: AsyncSession,
    order: PendingOrder,
    *,
    closed_detail: str = "Pending order has already been converted",
) -> None:
    """Claim the order with a conditional UPDATE so a concurrent close loses.

    Raises 409 with *closed_detail* when the order is no longer open.
    """
    lock_result = await db.execute(
        update(PendingOrder)
        .where(PendingOrder.id == order.id)
        .where(PendingOrder.status.in_(OPEN_PENDING_ORDER_STATUSES))
        .values(notes=order.notes)
        .execution_options(synchronize_session=False)
    )
    try:
        await db.flush()
    except InvalidRequestError as exc:
        raise HTTPException(status_code=409, detail=closed_detail) from exc
    if lock_result.rowcount == 0:
        raise HTTPException(status_code=409, detail=closed_detail)
