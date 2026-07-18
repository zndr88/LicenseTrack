"""
CSV export helpers for pending orders.
"""

from __future__ import annotations

import csv
import io
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.pending_order import PendingOrder, PendingOrderStatus
from app.services.csv_safety import safe_csv_row


async def build_pending_orders_export_csv(db: AsyncSession) -> str:
    result = await db.execute(
        select(PendingOrder)
        .where(PendingOrder.status.in_([PendingOrderStatus.pending, PendingOrderStatus.invoice_received]))
        .options(selectinload(PendingOrder.items))
        .order_by(PendingOrder.created_at.desc())
    )
    orders = list(result.scalars().all())

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "PO Number",
            "Supplier",
            "Status",
            "Created Date",
            "PO Total Value",
            "Currency",
            "PO Line #",
            "Publisher",
            "Description",
            "Purchase Quantity",
            "Estimated Unit Price",
            "Estimated Line Total",
        ]
    )

    for order in orders:
        writer.writerows(safe_csv_row(row) for row in _build_export_rows(order))

    return output.getvalue()


def _build_export_rows(
    order: PendingOrder,
) -> list[list[str | int]]:
    items = order.items or []

    if not items:
        return [
            [
                order.po_number,
                order.supplier or "",
                order.status.value,
                order.created_at.date().isoformat() if order.created_at else "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
            ]
        ]

    rows: list[list[str | int]] = []
    for line_number, item in enumerate(items, start=1):
        currency = item.currency or "EUR"
        rows.append(
            [
                order.po_number,
                order.supplier or "",
                order.status.value,
                order.created_at.date().isoformat() if order.created_at else "",
                _format_total_po_value(items, currency),
                currency,
                line_number,
                item.publisher_name,
                item.software_description,
                item.quantity or "",
                item.estimated_unit_price or "",
                item.estimated_total_price or "",
            ]
        )

    return rows


def _format_total_po_value(items, currency: str) -> str:
    total = Decimal("0")
    has_total = False
    for item in items:
        if (item.currency or "EUR") != currency or not item.estimated_total_price:
            continue
        try:
            total += Decimal(str(item.estimated_total_price))
            has_total = True
        except (InvalidOperation, TypeError, ValueError):
            pass

    if not has_total:
        return ""

    return f"{total.quantize(Decimal('0.01'))}"
