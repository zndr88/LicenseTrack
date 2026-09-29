"""Single owner of PO line numbers.

Every writer that creates a record with a PO number, or changes a PO number,
calls ``sync_license_line`` or ``sync_order_lines`` afterwards. Both are
idempotent: calling them when nothing changed does nothing.

Numbers are issued from ``po_line_register`` (one row per issued number, never
deleted), so "next free" is always highest ever issued on that PO plus one and
a number is never reused.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License
from app.models.pending_order import PendingOrder
from app.models.po_line import PoLineRegister
from app.models.sourcing import SourcingItem, SourcingStatus
from app.services.audit_service import log_event
from app.services.procurement_identity import normalize_po_number

_MAX_ATTEMPTS = 5


async def _next_free_number(db: AsyncSession, po_key: str) -> int:
    highest = await db.scalar(select(func.max(PoLineRegister.line_number)).where(PoLineRegister.po_key == po_key))
    return (highest or 0) + 1


async def _is_free(db: AsyncSession, po_key: str, number: int) -> bool:
    taken = await db.scalar(
        select(PoLineRegister.id).where(PoLineRegister.po_key == po_key, PoLineRegister.line_number == number)
    )
    return taken is None


async def allocate_line(db: AsyncSession, po_number: str, *, requested: int | None = None) -> PoLineRegister:
    """Issue a line number on *po_number*: *requested* if it is free, else highest ever + 1."""
    po_key = normalize_po_number(po_number)
    if not po_key:
        raise ValueError("A PO line needs a PO number")
    for _attempt in range(_MAX_ATTEMPTS):
        if requested is not None and requested > 0 and await _is_free(db, po_key, requested):
            number = requested
        else:
            number = await _next_free_number(db, po_key)
        row = PoLineRegister(po_key=po_key, po_number=" ".join(po_number.split()), line_number=number)
        try:
            async with db.begin_nested():
                db.add(row)
                await db.flush()
            return row
        except IntegrityError:
            requested = None  # another writer took it; fall back to the next free number
    raise RuntimeError(f"Could not allocate a PO line on {po_number!r}")


async def plan_new_lines(
    db: AsyncSession, requests: list[tuple[str, int | None]]
) -> list[int | None]:
    """The line each new record would get, in order, without writing anything.

    Mirrors ``allocate_line`` so an import preview matches what the import
    writes: a requested number is kept when free, otherwise the next free
    number (highest ever + 1) is used. A blank PO number gets no line (None).
    """
    keys = {normalize_po_number(po_number) for po_number, _requested in requests} - {""}
    used: dict[str, set[int]] = {key: set() for key in keys}
    if keys:
        rows = await db.execute(
            select(PoLineRegister.po_key, PoLineRegister.line_number).where(PoLineRegister.po_key.in_(keys))
        )
        for po_key, number in rows.all():
            used[po_key].add(number)
    planned: list[int | None] = []
    for po_number, requested in requests:
        po_key = normalize_po_number(po_number)
        if not po_key:
            planned.append(None)
            continue
        taken = used[po_key]
        number = requested if requested is not None and requested > 0 and requested not in taken else max(taken, default=0) + 1
        taken.add(number)
        planned.append(number)
    return planned


async def _audit(db: AsyncSession, text: str, *, target_type: str, target_id: int | None, label: str) -> None:
    await log_event(
        db,
        "po_line.assigned",
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        target_label=label,
        detail=text,
    )


async def sync_license_line(db: AsyncSession, license_obj: License, *, requested: int | None = None) -> None:
    """Make *license_obj* hold a line on its own PO (single-record rules)."""
    po_key = normalize_po_number(license_obj.po_number)
    current = license_obj.po_line
    if not po_key:
        license_obj.po_line = None
        return
    if current is not None and current.po_key == po_key:
        return
    source_item = None
    if license_obj.source_sourcing_item_id is not None:
        source_item = await db.get(SourcingItem, license_obj.source_sourcing_item_id)
    if source_item is not None and source_item.po_line is not None and source_item.po_line.po_key == po_key:
        license_obj.po_line = source_item.po_line
        return
    keep = current.line_number if current is not None else None
    line = await allocate_line(db, license_obj.po_number, requested=requested if requested is not None else keep)
    license_obj.po_line = line
    moved = f" (moved from line {keep})" if keep is not None and keep != line.line_number else ""
    await _audit(
        db,
        f"PO line {line.line_number} assigned on {line.po_number}{moved}",
        target_type="license",
        target_id=license_obj.id,
        label=license_obj.software_description or "",
    )


async def sync_order_lines(db: AsyncSession, order: PendingOrder) -> None:
    """Make every live line of *order* hold a number on the order's PO (whole-order rules)."""
    po_key = normalize_po_number(order.po_number)
    items = sorted(
        (item for item in order.items if item.status != SourcingStatus.cancelled),
        key=lambda item: (item.po_line.line_number if item.po_line is not None else 10**9, item.id or 0),
    )
    if not po_key:
        for item in items:
            item.po_line = None
        return
    moving = [item for item in items if item.po_line is not None and item.po_line.po_key != po_key]
    if moving:
        all_free = True
        for item in moving:
            if not await _is_free(db, po_key, item.po_line.line_number):
                all_free = False
                break
        for item in moving:
            old = item.po_line.line_number
            item.po_line = await allocate_line(db, order.po_number, requested=old if all_free else None)
            await _audit(
                db,
                f"PO line {item.po_line.line_number} assigned on {order.po_number} "
                f"(moved from line {old} after PO number change)",
                target_type="pending_order",
                target_id=order.id,
                label=order.po_number or "",
            )
    for item in items:
        if item.po_line is None:
            item.po_line = await allocate_line(db, order.po_number)
            await _audit(
                db,
                f"PO line {item.po_line.line_number} assigned on {order.po_number}",
                target_type="pending_order",
                target_id=order.id,
                label=order.po_number or "",
            )
