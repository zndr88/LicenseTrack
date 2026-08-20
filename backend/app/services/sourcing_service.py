from collections.abc import Iterable
from datetime import date
from decimal import ROUND_HALF_EVEN, Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.license import License, LicenseType, MaintenanceCoverage
from app.models.pending_order import PendingOrder
from app.models.reference_data import Organization
from app.models.sourcing import SourcingItem, SourcingRequest, SourcingStatus
from app.schemas.sourcing import SourcingItemCreate, SourcingRequestCreate, SourcingRequestUpdate
from app.services.lifecycle_rules import clear_pending_renewal_if_current
from app.services.money import MoneyParseError, parse_money
from app.services.reference_data_service import (
    resolve_organization,
    resolve_procurement_reference_fields,
)


_IDENTITY_UNSET = object()


def sourcing_item_predecessor_ids(item: SourcingItem) -> list[int]:
    predecessor_ids = []
    seen = set()
    for predecessor_id in [item.renewal_for_license_id, *(item.coterm_predecessor_ids or [])]:
        if predecessor_id is None or predecessor_id in seen:
            continue
        seen.add(predecessor_id)
        predecessor_ids.append(predecessor_id)
    return predecessor_ids


def clean_procurement_identity(value: str | None) -> str | None:
    """Trim free-form procurement identity values while preserving display casing."""
    cleaned = (value or "").strip()
    return cleaned or None


def procurement_identities_match(left: str | None, right: str | None) -> bool:
    return (clean_procurement_identity(left) or "").casefold() == (
        clean_procurement_identity(right) or ""
    ).casefold()


def _common_nonblank_identity(values: list[str | None]) -> str | None:
    cleaned = [clean_procurement_identity(value) for value in values]
    if not cleaned or any(value is None for value in cleaned):
        return None
    first = cleaned[0]
    return first if all(procurement_identities_match(first, value) for value in cleaned[1:]) else None


def synchronize_open_request_identity(
    request: SourcingRequest,
    *,
    supplier: str | None | object = _IDENTITY_UNSET,
    supplier_id: int | None | object = _IDENTITY_UNSET,
    contact_email: str | None | object = _IDENTITY_UNSET,
) -> None:
    """Apply request-owned supplier context to every open compatibility line."""
    supplier_changed = False
    if supplier is not _IDENTITY_UNSET:
        normalized_supplier = clean_procurement_identity(supplier)
        supplier_changed = not procurement_identities_match(request.supplier, normalized_supplier) or (
            supplier_id is not _IDENTITY_UNSET and request.supplier_id != supplier_id
        )
        request.supplier = normalized_supplier
    if supplier_id is not _IDENTITY_UNSET:
        supplier_changed = supplier_changed or request.supplier_id != supplier_id
        request.supplier_id = supplier_id

    if contact_email is not _IDENTITY_UNSET:
        request.contact_email = clean_procurement_identity(contact_email)
    elif supplier_changed:
        request.contact_email = None

    for item in request.items:
        if item.status == SourcingStatus.sourcing:
            item.supplier = request.supplier
            item.supplier_id = request.supplier_id
            item.contact_email = request.contact_email


async def _resolve_request_supplier(db: AsyncSession, request: SourcingRequest) -> None:
    if request.supplier:
        supplier = await resolve_organization(db, request.supplier, role="supplier", create_if_missing=True)
        request.supplier = supplier.name
        request.supplier_id = supplier.id
    else:
        request.supplier_id = None


async def _resolve_supplier_candidate(
    db: AsyncSession,
    value: str | None,
) -> tuple[str | None, int | None]:
    cleaned = clean_procurement_identity(value)
    if cleaned is None:
        return None, None
    supplier = await resolve_organization(db, cleaned, role="supplier", create_if_missing=True)
    return supplier.name, supplier.id


async def resolve_sourcing_item_references(db: AsyncSession, item: SourcingItem) -> SourcingItem:
    data = {
        "publisher_name": item.publisher_name,
        "supplier": item.supplier,
    }
    await resolve_procurement_reference_fields(db, data, publisher_required=True)
    item.publisher_name = data["publisher_name"]
    item.publisher_id = data["publisher_id"]
    item.supplier = data["supplier"]
    item.supplier_id = data["supplier_id"]
    return item


async def apply_sourcing_item_update(
    db: AsyncSession,
    item: SourcingItem,
    request: SourcingRequest | None,
    update_data: dict,
) -> None:
    """Apply a line edit while keeping request-owned identity atomic."""
    supplier = update_data.pop("supplier", _IDENTITY_UNSET)
    contact_email = update_data.pop("contact_email", _IDENTITY_UNSET)
    if "publisher_name" in update_data:
        publisher_data = {"publisher_name": update_data["publisher_name"]}
        await resolve_procurement_reference_fields(db, publisher_data, publisher_required=True)
        update_data["publisher_name"] = publisher_data["publisher_name"]
        item.publisher_id = publisher_data["publisher_id"]
    if request is not None:
        await _resolve_request_supplier(db, request)
    supplier_id = None
    if supplier is not _IDENTITY_UNSET:
        supplier_data = {"supplier": supplier}
        await resolve_procurement_reference_fields(db, supplier_data)
        supplier = supplier_data["supplier"] or None
        supplier_id = supplier_data["supplier_id"]
    for field, value in update_data.items():
        setattr(item, field, value)

    if request is None:
        if supplier is not _IDENTITY_UNSET:
            item.supplier = clean_procurement_identity(supplier)
            item.supplier_id = supplier_id
        if contact_email is not _IDENTITY_UNSET:
            item.contact_email = clean_procurement_identity(contact_email)
        elif supplier is not _IDENTITY_UNSET:
            item.contact_email = None
        return

    synchronize_open_request_identity(
        request,
        supplier=supplier,
        supplier_id=supplier_id if supplier is not _IDENTITY_UNSET else _IDENTITY_UNSET,
        contact_email=contact_email,
    )


async def apply_sourcing_request_update(db: AsyncSession, request: SourcingRequest, update_data: dict) -> None:
    supplier = update_data.pop("supplier", _IDENTITY_UNSET)
    contact_email = update_data.pop("contact_email", _IDENTITY_UNSET)
    if "notes" in update_data:
        request.notes = update_data["notes"]
    await _resolve_request_supplier(db, request)
    supplier_id = request.supplier_id
    if supplier is not _IDENTITY_UNSET:
        supplier_data = {"supplier": supplier}
        await resolve_procurement_reference_fields(db, supplier_data)
        supplier = supplier_data["supplier"] or None
        supplier_id = supplier_data["supplier_id"]
    synchronize_open_request_identity(
        request,
        supplier=supplier,
        supplier_id=supplier_id if supplier is not _IDENTITY_UNSET else _IDENTITY_UNSET,
        contact_email=contact_email,
    )


async def apply_sourcing_request_workflow_update(
    db: AsyncSession,
    request: SourcingRequest,
    payload: SourcingRequestUpdate,
) -> list[int]:
    """Apply request metadata and requested open-line edits in one transaction."""
    assert_sourcing_request_editable(request)
    request_data = payload.model_dump(by_alias=False, exclude_unset=True, exclude={"items"})
    requested_items = payload.items or []
    items_by_id = {item.id: item for item in request.items}
    requested_ids = [item_update.id for item_update in requested_items]
    if len(requested_ids) != len(set(requested_ids)):
        raise HTTPException(status_code=422, detail="A sourcing request line can only be updated once")

    for item_id in requested_ids:
        item = items_by_id.get(item_id)
        if item is None:
            raise HTTPException(status_code=404, detail=f"Sourcing item {item_id} was not found in this request")
        assert_sourcing_item_editable(item)

    await apply_sourcing_request_update(db, request, request_data)
    for item_update in requested_items:
        item = items_by_id[item_update.id]
        update_data = item_update.model_dump(
            by_alias=False,
            exclude_unset=True,
            exclude={"id"},
        )
        if update_data.get("license_type", item.license_type) == LicenseType.freeware:
            update_data["estimated_unit_price"] = None
            update_data["estimated_total_price"] = None
        await apply_sourcing_item_update(db, item, request, update_data)

    await db.flush()
    return requested_ids


def is_direct_freeware_item(item: SourcingItem) -> bool:
    if item.license_type != LicenseType.freeware:
        return False
    if item.maintenance_coverage != MaintenanceCoverage.included:
        return True
    try:
        return not bool(parse_money(item.maintenance_cost))
    except MoneyParseError:
        return True


def assert_sourcing_item_editable(item: SourcingItem) -> None:
    """Reject mutations to sourcing items once the sourcing workflow is converted."""
    if item.status == SourcingStatus.converted or item.pending_order_id is not None:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Cannot modify a converted sourcing item")
    if item.status == SourcingStatus.cancelled:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Cannot modify a cancelled sourcing item")
    request = getattr(item, "sourcing_request", None)
    if request is not None and request.status == SourcingStatus.converted:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Cannot modify an item in a converted sourcing request")
    if request is not None and request.status == SourcingStatus.cancelled:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Cannot modify an item in a cancelled sourcing request")


def assert_sourcing_request_editable(request: SourcingRequest) -> None:
    if request.status == SourcingStatus.converted:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Cannot modify a converted sourcing request")
    if request.status == SourcingStatus.cancelled:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Cannot modify a cancelled sourcing request")


async def handle_delete_side_effects(
    db: AsyncSession,
    renewal_license_id: int | None,
    parent_order_id: int | None,
    *,
    renewal_license_ids: Iterable[int] | None = None,
) -> None:
    """Apply side effects after a SourcingItem has been deleted from the session.

    1. If the item belonged to a PendingOrder and was its last child, delete
       the now-orphaned PendingOrder.
    2. If the item was a renewal sourcing item and was the last one referencing
       its predecessor license, clear the license's pending_renewal status.
    """
    if parent_order_id is not None:
        remaining = await db.scalar(
            select(func.count()).select_from(SourcingItem).where(SourcingItem.pending_order_id == parent_order_id)
        )
        if remaining == 0:
            orphaned_po = await db.get(PendingOrder, parent_order_id)
            if orphaned_po is not None:
                await db.delete(orphaned_po)

    predecessor_ids = []
    seen = set()
    for predecessor_id in [renewal_license_id, *(renewal_license_ids or [])]:
        if predecessor_id is None or predecessor_id in seen:
            continue
        seen.add(predecessor_id)
        predecessor_ids.append(predecessor_id)

    for predecessor_id in predecessor_ids:
        await clear_pending_renewal_if_no_open_sourcing(db, predecessor_id)


def _item_represents_predecessor(item: SourcingItem, renewal_license_id: int) -> bool:
    return renewal_license_id in sourcing_item_predecessor_ids(item)


async def clear_pending_renewal_if_no_open_sourcing(db: AsyncSession, renewal_license_id: int) -> None:
    linked_license = await db.get(License, renewal_license_id)
    if linked_license is None:
        return

    result = await db.execute(
        select(SourcingItem).where(SourcingItem.status != SourcingStatus.cancelled)
    )
    has_open_work = any(
        _item_represents_predecessor(item, renewal_license_id)
        for item in result.scalars().all()
    )
    if not has_open_work:
        clear_pending_renewal_if_current(linked_license)


async def delete_empty_sourcing_requests(
    db: AsyncSession,
    request_ids: set[int],
) -> None:
    """Delete candidate sourcing requests that are still open and have no items."""
    if not request_ids:
        return

    result = await db.execute(
        select(SourcingRequest)
        .outerjoin(SourcingItem, SourcingItem.sourcing_request_id == SourcingRequest.id)
        .where(
            SourcingRequest.id.in_(request_ids),
            SourcingRequest.status == SourcingStatus.sourcing,
        )
        .group_by(SourcingRequest.id)
        .having(func.count(SourcingItem.id) == 0)
    )
    for request in result.scalars().all():
        await db.delete(request)


async def build_merged_sourcing_item(
    db: AsyncSession,
    items: list[SourcingItem],
    predecessors: list[License],
    created_by: int | None,
) -> SourcingItem:
    """Build a merged coterm SourcingItem from validated items and their predecessor licenses.

    Assumes all items and predecessors have already been validated (status checks,
    renewal checks, eligibility checks). The caller is responsible for persisting
    the returned item and deleting the originals.
    """

    def _sort_key(lic: License) -> tuple:
        return (lic.start_date or date.min, lic.id)

    sorted_preds = sorted(predecessors, key=_sort_key)
    primary_pred = sorted_preds[0]
    primary_item = next(item for item in items if item.renewal_for_license_id == primary_pred.id)

    total_quantity = sum(
        (parse_money(item.quantity) or Decimal("0") for item in items),
        start=Decimal("0"),
    )

    unit_price = parse_money(primary_item.estimated_unit_price)
    merged_total_price = (
        format(
            (unit_price * total_quantity).quantize(
                Decimal("0.01"),
                rounding=ROUND_HALF_EVEN,
            ),
            "f",
        )
        if unit_price is not None
        else None
    )

    source_supplier_ids = [
        item.sourcing_request.supplier_id if item.sourcing_request is not None else item.supplier_id
        for item in items
    ]
    target_supplier = None
    target_supplier_id = None
    if source_supplier_ids and all(supplier_id is not None for supplier_id in source_supplier_ids):
        if len(set(source_supplier_ids)) == 1:
            supplier_record = await db.get(Organization, source_supplier_ids[0])
            if supplier_record is not None:
                target_supplier = supplier_record.name
                target_supplier_id = supplier_record.id
    source_contacts = [
        item.sourcing_request.contact_email if item.sourcing_request is not None else item.contact_email
        for item in items
    ]
    target_contact = _common_nonblank_identity(source_contacts) if target_supplier is not None else None

    merged = SourcingItem(
        publisher_name=primary_item.publisher_name,
        software_description=primary_item.software_description,
        license_type=primary_item.license_type or primary_pred.license_type,
        quantity=format(total_quantity, "f") if total_quantity else None,
        estimated_unit_price=primary_item.estimated_unit_price,
        estimated_total_price=merged_total_price,
        currency=primary_item.currency,
        supplier=target_supplier,
        supplier_id=target_supplier_id,
        contact_email=target_contact,
        status=SourcingStatus.sourcing,
        renewal_for_license_id=primary_pred.id,
        coterm_predecessor_ids=[lic.id for lic in sorted_preds],
        created_by=created_by,
    )
    await resolve_sourcing_item_references(db, merged)
    return merged


async def ensure_sourcing_request_for_item(
    db: AsyncSession,
    item: SourcingItem,
    *,
    created_by: int | None,
) -> SourcingRequest:
    if item.sourcing_request_id is not None:
        request = await db.get(SourcingRequest, item.sourcing_request_id)
        if request is not None:
            await resolve_sourcing_item_references(db, item)
            await _resolve_request_supplier(db, request)
            item.supplier = request.supplier
            item.supplier_id = request.supplier_id
            return request

    await resolve_sourcing_item_references(db, item)
    item.contact_email = clean_procurement_identity(item.contact_email)
    request = SourcingRequest(
        supplier=item.supplier,
        supplier_id=item.supplier_id,
        contact_email=item.contact_email,
        notes=item.notes,
        status=item.status,
        created_by=created_by if created_by is not None else item.created_by,
    )
    db.add(request)
    await db.flush()
    item.sourcing_request_id = request.id
    return request


async def list_sourcing_request_records(db: AsyncSession) -> list[SourcingRequest]:
    await backfill_missing_sourcing_requests(db)
    result = await db.execute(
        select(SourcingRequest)
        .where(SourcingRequest.status == SourcingStatus.sourcing)
        .options(
            selectinload(SourcingRequest.items).selectinload(SourcingItem.pending_order),
            selectinload(SourcingRequest.items).selectinload(SourcingItem.converted_licenses),
            selectinload(SourcingRequest.quote_documents),
        )
        .order_by(SourcingRequest.created_at.desc())
    )
    return list(result.scalars().all())


async def list_sourcing_request_history_records(db: AsyncSession) -> list[SourcingRequest]:
    await backfill_missing_sourcing_requests(db)
    result = await db.execute(
        select(SourcingRequest)
        .where(SourcingRequest.status.in_([SourcingStatus.converted, SourcingStatus.cancelled]))
        .options(
            selectinload(SourcingRequest.items).selectinload(SourcingItem.pending_order),
            selectinload(SourcingRequest.items).selectinload(SourcingItem.converted_licenses),
            selectinload(SourcingRequest.quote_documents),
        )
        .order_by(SourcingRequest.updated_at.desc(), SourcingRequest.created_at.desc())
    )
    return list(result.scalars().all())


async def get_sourcing_request_or_404(db: AsyncSession, request_id: int) -> SourcingRequest:
    result = await db.execute(
        select(SourcingRequest)
        .where(SourcingRequest.id == request_id)
        .options(
            selectinload(SourcingRequest.items).selectinload(SourcingItem.pending_order),
            selectinload(SourcingRequest.items).selectinload(SourcingItem.converted_licenses),
            selectinload(SourcingRequest.quote_documents),
        )
        .execution_options(populate_existing=True)
    )
    request = result.scalar_one_or_none()
    if request is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Sourcing request not found")
    return request


async def get_sourcing_request_for_update_or_404(
    db: AsyncSession,
    request_id: int,
) -> SourcingRequest:
    result = await db.execute(
        select(SourcingRequest)
        .where(SourcingRequest.id == request_id)
        .options(selectinload(SourcingRequest.items))
        .with_for_update()
    )
    request = result.scalar_one_or_none()
    if request is None:
        raise HTTPException(status_code=404, detail="Sourcing request not found")
    return request


def _adopt_or_validate_identity(
    current: str | None,
    proposed: str | None,
    *,
    field_label: str,
    status_code: int,
) -> str | None:
    proposed = clean_procurement_identity(proposed)
    if proposed is None:
        return clean_procurement_identity(current)
    if current is None:
        return proposed
    if not procurement_identities_match(current, proposed):
        raise HTTPException(
            status_code=status_code,
            detail=f"All lines in a sourcing request must use the same {field_label}",
        )
    return clean_procurement_identity(current)


async def create_sourcing_request_record(
    db: AsyncSession,
    payload: SourcingRequestCreate,
    *,
    created_by: int,
) -> SourcingRequest:
    if not payload.items:
        raise HTTPException(status_code=422, detail="At least one sourcing item is required")

    request_supplier, request_supplier_id = await _resolve_supplier_candidate(db, payload.supplier)
    request_contact = clean_procurement_identity(payload.contact_email)
    for item_payload in payload.items:
        if item_payload.parent_item_index is not None:
            continue
        item_supplier, item_supplier_id = await _resolve_supplier_candidate(db, item_payload.supplier)
        if item_supplier_id is not None:
            if request_supplier_id is None:
                request_supplier, request_supplier_id = item_supplier, item_supplier_id
            elif request_supplier_id != item_supplier_id:
                raise HTTPException(
                    status_code=422,
                    detail="All lines in a sourcing request must use the same request supplier",
                )
        request_contact = _adopt_or_validate_identity(
            request_contact,
            item_payload.contact_email,
            field_label="supplier contact",
            status_code=422,
        )

    request = SourcingRequest(
        supplier=request_supplier,
        supplier_id=request_supplier_id,
        contact_email=request_contact,
        notes=payload.notes,
        status=SourcingStatus.sourcing,
        created_by=created_by,
    )
    db.add(request)
    await db.flush()

    created_items: list[SourcingItem] = []
    for index, item_payload in enumerate(payload.items):
        parent_index = item_payload.parent_item_index
        if parent_index is not None and not 0 <= parent_index < index:
            raise HTTPException(
                status_code=422,
                detail=f"Item {index + 1} has an invalid maintenance parent",
            )

        target_request = request
        parent_item = created_items[parent_index] if parent_index is not None else None
        if parent_item is not None:
            child_supplier, child_supplier_id = await _resolve_supplier_candidate(db, item_payload.supplier)
            if child_supplier_id is None:
                child_supplier, child_supplier_id = request.supplier, request.supplier_id
            if child_supplier_id is not None and child_supplier_id != request.supplier_id:
                target_request = SourcingRequest(
                    supplier=child_supplier,
                    supplier_id=child_supplier_id,
                    contact_email=clean_procurement_identity(item_payload.contact_email) or request.contact_email,
                    notes=payload.notes,
                    status=SourcingStatus.sourcing,
                    created_by=created_by,
                )
                db.add(target_request)
                await db.flush()
            elif item_payload.contact_email and not procurement_identities_match(
                item_payload.contact_email,
                request.contact_email,
            ):
                raise HTTPException(
                    status_code=422,
                    detail="All lines in a sourcing request must use the same supplier contact",
                )

        item = _build_request_item(
            item_payload,
            request_id=target_request.id,
            created_by=created_by,
            supplier=target_request.supplier,
            contact_email=target_request.contact_email,
        )
        if parent_item is not None:
            item.parent_sourcing_item_id = parent_item.id
        await resolve_sourcing_item_references(db, item)
        db.add(item)
        await db.flush()
        created_items.append(item)
    return request


async def add_sourcing_request_item_record(
    db: AsyncSession,
    request_id: int,
    payload: SourcingItemCreate,
    *,
    created_by: int,
) -> SourcingRequest:
    request = await get_sourcing_request_for_update_or_404(db, request_id)
    assert_sourcing_request_editable(request)
    await _resolve_request_supplier(db, request)
    proposed_supplier = clean_procurement_identity(payload.supplier)
    proposed_supplier_id = None
    if proposed_supplier:
        proposed_supplier_record = await resolve_organization(
            db, proposed_supplier, role="supplier", create_if_missing=True
        )
        proposed_supplier = proposed_supplier_record.name
        proposed_supplier_id = proposed_supplier_record.id
    proposed_contact = clean_procurement_identity(payload.contact_email)
    if request.supplier_id is not None and proposed_supplier_id is not None and request.supplier_id != proposed_supplier_id:
        raise HTTPException(
            status_code=409,
            detail="The line supplier conflicts with the sourcing request supplier",
        )
    if request.contact_email is not None and proposed_contact is not None and not procurement_identities_match(
        request.contact_email,
        proposed_contact,
    ):
        raise HTTPException(
            status_code=409,
            detail="The line contact conflicts with the sourcing request contact",
        )

    if request.supplier is None and proposed_supplier is not None:
        synchronize_open_request_identity(
            request,
            supplier=proposed_supplier,
            supplier_id=proposed_supplier_id,
            contact_email=proposed_contact if proposed_contact is not None else _IDENTITY_UNSET,
        )
    elif request.contact_email is None and proposed_contact is not None:
        synchronize_open_request_identity(request, contact_email=proposed_contact)

    item = _build_request_item(
            payload,
            request_id=request.id,
            created_by=created_by,
            supplier=request.supplier,
            contact_email=request.contact_email,
        )
    await resolve_sourcing_item_references(db, item)
    db.add(item)
    await db.flush()
    return request


async def delete_sourcing_request_record(db: AsyncSession, request_id: int) -> str:
    request = await get_sourcing_request_or_404(db, request_id)
    assert_sourcing_request_editable(request)
    if any(item.status == SourcingStatus.converted for item in request.items):
        from fastapi import HTTPException

        raise HTTPException(
            status_code=409,
            detail="Cannot delete a sourcing request after any line has been converted",
        )

    label = request.supplier or f"Sourcing request {request.id}"
    renewal_ids = [
        predecessor_id
        for item in request.items
        if item.status == SourcingStatus.sourcing
        for predecessor_id in sourcing_item_predecessor_ids(item)
    ]
    await db.delete(request)
    await db.flush()
    for renewal_id in renewal_ids:
        await handle_delete_side_effects(db, renewal_license_id=renewal_id, parent_order_id=None)
    return label


async def cancel_sourcing_request_record(db: AsyncSession, request_id: int) -> SourcingRequest:
    request = await get_sourcing_request_or_404(db, request_id)
    assert_sourcing_request_editable(request)

    renewal_ids = {
        predecessor_id
        for item in request.items
        if item.status == SourcingStatus.sourcing
        for predecessor_id in sourcing_item_predecessor_ids(item)
    }
    request.status = SourcingStatus.cancelled
    for item in request.items:
        if item.status == SourcingStatus.sourcing:
            item.status = SourcingStatus.cancelled
    await db.flush()
    for renewal_id in renewal_ids:
        await clear_pending_renewal_if_no_open_sourcing(db, renewal_id)
    return request


async def backfill_missing_sourcing_requests(db: AsyncSession) -> None:
    result = await db.execute(select(SourcingItem).where(SourcingItem.sourcing_request_id.is_(None)))
    items = list(result.scalars().all())
    if not items:
        return
    for item in items:
        await ensure_sourcing_request_for_item(db, item, created_by=item.created_by)
    await db.flush()


def _build_request_item(
    payload: SourcingItemCreate,
    *,
    request_id: int,
    created_by: int,
    supplier: str | None,
    contact_email: str | None,
) -> SourcingItem:
    item_data = payload.model_dump(by_alias=False)
    item_data.pop("sourcing_request_id", None)
    item_data.pop("status", None)
    item_data.pop("parent_item_index", None)
    if item_data.get("license_type") == LicenseType.freeware:
        item_data["estimated_unit_price"] = None
        item_data["estimated_total_price"] = None
    item_data["supplier"] = supplier
    item_data["contact_email"] = contact_email
    return SourcingItem(
        **item_data,
        sourcing_request_id=request_id,
        status=SourcingStatus.sourcing,
        created_by=created_by,
    )


async def convert_sourcing_item_to_order(
    db: AsyncSession,
    item: SourcingItem,
    pending_order_id: int | None,
    po_number: str | None,
    supplier: str | None,
    notes: str | None,
    created_by: int | None,
    procurement_reference: str | None = None,
) -> PendingOrder:
    """Attach a sourcing item to a PendingOrder (existing or newly created).

    Mutates item.pending_order_id and item.status in place. Flushes but does
    not commit - the caller controls the transaction boundary.

    Raises ValueError if pending_order_id is given but the order doesn't exist.
    """
    if is_direct_freeware_item(item):
        raise ValueError("Freeware / Open Source items convert directly to the License Registry")

    request = item.sourcing_request
    if request is None and item.sourcing_request_id is not None:
        request = await get_sourcing_request_for_update_or_404(db, item.sourcing_request_id)
    if request is not None:
        await _resolve_request_supplier(db, request)

    if pending_order_id is not None:
        order = await db.get(PendingOrder, pending_order_id)
        if order is None:
            raise ValueError("Pending order not found")
        order_supplier = clean_procurement_identity(order.supplier)
        if order_supplier is None:
            raise HTTPException(status_code=422, detail="The selected pending order must have a supplier")
        order_supplier_record = await resolve_organization(db, order_supplier, role="supplier", create_if_missing=True)
        order.supplier = order_supplier_record.name
        order.supplier_id = order_supplier_record.id
        if request is not None and request.supplier_id is not None and request.supplier_id != order_supplier_record.id:
            raise HTTPException(
                status_code=409,
                detail="The sourcing request supplier conflicts with the selected pending order supplier",
            )
        if request is not None:
            synchronize_open_request_identity(
                request,
                supplier=order_supplier_record.name,
                supplier_id=order.supplier_id,
            )
    else:
        target_supplier = clean_procurement_identity(supplier) or (
            clean_procurement_identity(request.supplier) if request is not None else None
        ) or clean_procurement_identity(item.supplier)
        if target_supplier is None:
            raise HTTPException(status_code=422, detail="Supplier is required to create a pending order")
        target_supplier_record = await resolve_organization(db, target_supplier, role="supplier", create_if_missing=True)
        target_supplier = target_supplier_record.name
        if request is not None:
            synchronize_open_request_identity(
                request,
                supplier=target_supplier,
                supplier_id=target_supplier_record.id,
            )
        else:
            item.supplier = target_supplier
            item.supplier_id = target_supplier_record.id
        order = PendingOrder(
            po_number=(po_number or "").strip(),
            procurement_reference=(procurement_reference or "").strip(),
            supplier=target_supplier,
            supplier_id=target_supplier_record.id,
            notes=notes,
            created_by=created_by,
        )
        db.add(order)
        await db.flush()

    item.pending_order_id = order.id
    item.status = SourcingStatus.converted
    item.supplier = order.supplier
    item.supplier_id = order.supplier_id
    if request is not None:
        await refresh_sourcing_request_status(db, request)
    return order


async def convert_sourcing_request_to_order(
    db: AsyncSession,
    request: SourcingRequest,
    pending_order_id: int | None,
    po_number: str | None,
    supplier: str | None,
    notes: str | None,
    created_by: int | None,
    procurement_reference: str | None = None,
) -> PendingOrder:
    """Attach the open purchase items in a sourcing request to a PendingOrder."""
    if request.status == SourcingStatus.converted:
        raise ValueError("Sourcing request has already been converted")
    await _resolve_request_supplier(db, request)

    purchase_items = [
        item
        for item in request.items
        if item.status == SourcingStatus.sourcing and not is_direct_freeware_item(item)
    ]
    if not purchase_items:
        raise ValueError("No purchase items are available to convert to a pending order")

    if pending_order_id is not None:
        order = await db.get(PendingOrder, pending_order_id)
        if order is None:
            raise ValueError("Pending order not found")
        order_supplier = clean_procurement_identity(order.supplier)
        if order_supplier is None:
            raise HTTPException(status_code=422, detail="The selected pending order must have a supplier")
        order_supplier_record = await resolve_organization(db, order_supplier, role="supplier", create_if_missing=True)
        order.supplier = order_supplier_record.name
        order.supplier_id = order_supplier_record.id
        if request.supplier_id is not None and request.supplier_id != order_supplier_record.id:
            raise HTTPException(
                status_code=409,
                detail="The sourcing request supplier conflicts with the selected pending order supplier",
            )
        synchronize_open_request_identity(
            request,
            supplier=order_supplier_record.name,
            supplier_id=order.supplier_id,
        )
    else:
        target_supplier = (
            clean_procurement_identity(supplier)
            or clean_procurement_identity(request.supplier)
            or next((clean_procurement_identity(item.supplier) for item in request.items if item.supplier), None)
        )
        if target_supplier is None:
            raise HTTPException(status_code=422, detail="Supplier is required to create a pending order")
        target_supplier_record = await resolve_organization(db, target_supplier, role="supplier", create_if_missing=True)
        target_supplier = target_supplier_record.name
        synchronize_open_request_identity(
            request,
            supplier=target_supplier,
            supplier_id=target_supplier_record.id,
        )
        order = PendingOrder(
            po_number=(po_number or "").strip(),
            procurement_reference=(procurement_reference or "").strip(),
            supplier=target_supplier,
            supplier_id=target_supplier_record.id,
            notes=notes if notes is not None else request.notes,
            created_by=created_by,
        )
        db.add(order)
        await db.flush()

    for item in purchase_items:
        item.pending_order_id = order.id
        item.status = SourcingStatus.converted
        item.supplier = order.supplier
        item.supplier_id = order.supplier_id
    await refresh_sourcing_request_status(db, request)
    return order


async def refresh_sourcing_request_status(
    db: AsyncSession,
    request: SourcingRequest,
) -> None:
    """Close a request only after every line has completed its own path."""
    await db.flush()
    remaining = await db.scalar(
        select(func.count())
        .select_from(SourcingItem)
        .where(
            SourcingItem.sourcing_request_id == request.id,
            SourcingItem.status == SourcingStatus.sourcing,
        )
    )
    if remaining == 0:
        request.status = SourcingStatus.converted
