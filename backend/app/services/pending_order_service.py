"""
Pending-order CRUD and item-management workflow helpers.

These helpers keep the route layer focused on HTTP/auth concerns while
preserving the existing business rules around deletions and item creation.
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.document import ProcurementDocument
from app.models.license import License
from app.models.pending_order import EvidenceTransferStatus, PendingOrder, PendingOrderStatus
from app.models.sourcing import SourcingItem, SourcingRequest, SourcingStatus
from app.schemas.document import ProcurementDocumentResponse
from app.schemas.pending_order import PendingOrderCreate, PendingOrderResponse, PendingOrderUpdate, SourcingItemSummary
from app.schemas.sourcing import SourcingItemCreate, SourcingItemUpdate, SourcingQuoteDocumentResponse
from app.services.document_availability_service import with_file_availability
from app.services.procurement_totals import procurement_line_total
from app.services.reference_data_service import resolve_organization, resolve_procurement_reference_fields
from app.services.sourcing_service import resolve_sourcing_item_references


_CURRENCY_SYMBOLS: dict[str, str] = {
    "EUR": "€",
    "USD": "$",
    "GBP": "£",
}


def pending_order_total(items: list[object]) -> str | None:
    totals: dict[str, Decimal] = {}
    for item in items:
        line_total = procurement_line_total(item)
        if line_total is not None:
            totals[item.currency] = totals.get(item.currency, Decimal("0")) + line_total
    if not totals:
        return None
    return " + ".join(
        f"{_CURRENCY_SYMBOLS.get(currency, currency + chr(160))}{amount:,.2f}"
        for currency, amount in totals.items()
    )


def to_pending_order_response(order: PendingOrder, storage_base: str | None = None) -> PendingOrderResponse:
    items = list(order.items) if "items" in order.__dict__ else []
    documents = list(order.documents) if "documents" in order.__dict__ else []
    licenses = list(order.licenses) if "licenses" in order.__dict__ else []
    converted_license_refs = _converted_license_refs_by_item(items, licenses)
    order_license_ids = [license_obj.id for license_obj in licenses]
    order_license_payload: dict = {"converted_license_ids": order_license_ids}
    single_license = licenses[0] if len(licenses) == 1 else None
    if single_license is not None:
        order_license_payload["converted_license_id"] = single_license.id
        order_license_payload["converted_license_ref"] = single_license.license_ref
        order_license_payload["converted_license_retired"] = bool(single_license.is_retired)
    return PendingOrderResponse.model_validate(
        {
            "id": order.id,
            "po_number": order.po_number,
            "procurement_reference": order.procurement_reference,
            "supplier": order.supplier,
            "notes": order.notes,
            "status": order.status,
            "created_at": order.created_at,
            "updated_at": order.updated_at,
            "created_by": order.created_by,
            "evidence_transfer_status": order.evidence_transfer_status,
            "evidence_transfer_detail": order.evidence_transfer_detail,
            "evidence_transfer_failed_at": order.evidence_transfer_failed_at,
            "total_po_value": pending_order_total(items),
            **order_license_payload,
            "items": [
                SourcingItemSummary.model_validate(
                    {
                        **{column.name: getattr(item, column.name) for column in item.__table__.columns},
                        "quote_documents": _quote_document_responses(item, storage_base),
                        **converted_license_refs.get(item.id, {}),
                    }
                )
                for item in items
            ],
            "documents": [
                with_file_availability(ProcurementDocumentResponse.model_validate(document), document, storage_base)
                for document in documents
            ],
        }
    )


def _quote_document_responses(item: SourcingItem, storage_base: str | None) -> list[SourcingQuoteDocumentResponse]:
    return [
        with_file_availability(SourcingQuoteDocumentResponse.model_validate(document), document, storage_base)
        for document in item.quote_documents
    ]


def _converted_license_refs_by_item(items: list[SourcingItem], licenses: list[License]) -> dict[int, dict]:
    refs: dict[int, dict] = {}
    if not items or not licenses:
        return refs

    active_licenses = list(licenses)
    for item in items:
        exact_matches = [
            license_obj
            for license_obj in active_licenses
            if license_obj.source_sourcing_item_id == item.id
        ]
        matches = exact_matches or [
            license_obj
            for license_obj in active_licenses
            if license_obj.publisher_name == item.publisher_name
            and license_obj.software_description == item.software_description
        ]
        license_ids = [license_obj.id for license_obj in matches]
        payload: dict = {"converted_license_ids": license_ids}
        if len(matches) == 1:
            payload["converted_license_id"] = matches[0].id
            payload["converted_license_ref"] = matches[0].license_ref
            payload["converted_license_retired"] = bool(matches[0].is_retired)
        refs[item.id] = payload
    return refs


async def get_pending_order_or_404(
    db: AsyncSession,
    order_id: int,
    *,
    include_items: bool = True,
) -> PendingOrder:
    query = select(PendingOrder).where(PendingOrder.id == order_id)
    if include_items:
        query = query.options(
            selectinload(PendingOrder.items)
            .selectinload(SourcingItem.sourcing_request)
            .selectinload(SourcingRequest.quote_documents),
            selectinload(PendingOrder.documents),
            selectinload(PendingOrder.licenses),
        )
    query = query.execution_options(populate_existing=True)
    result = await db.execute(query)
    order = result.scalar_one_or_none()
    if order is None:
        raise HTTPException(status_code=404, detail="Pending order not found")
    return order


async def list_pending_order_records(
    db: AsyncSession,
    *,
    limit: int | None,
    offset: int,
    include_evidence_issues: bool = False,
) -> list[PendingOrder]:
    status_filter = PendingOrder.status.in_([PendingOrderStatus.pending, PendingOrderStatus.invoice_received])
    if include_evidence_issues:
        status_filter = or_(
            status_filter,
            (
                (PendingOrder.status == PendingOrderStatus.converted)
                & PendingOrder.evidence_transfer_status.in_(
                    [
                        EvidenceTransferStatus.pending,
                        EvidenceTransferStatus.failed,
                        EvidenceTransferStatus.escalated,
                    ]
                )
            ),
        )

    query = (
        select(PendingOrder)
        .where(status_filter)
        .options(
            selectinload(PendingOrder.items)
            .selectinload(SourcingItem.sourcing_request)
            .selectinload(SourcingRequest.quote_documents),
            selectinload(PendingOrder.documents),
            selectinload(PendingOrder.licenses),
        )
        .order_by(PendingOrder.created_at.desc())
        .offset(offset)
    )
    if limit is not None:
        query = query.limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def list_pending_order_history_records(
    db: AsyncSession,
    *,
    limit: int | None,
    offset: int,
) -> list[PendingOrder]:
    query = (
        select(PendingOrder)
        .where(PendingOrder.status.in_([PendingOrderStatus.converted, PendingOrderStatus.cancelled]))
        .options(
            selectinload(PendingOrder.items)
            .selectinload(SourcingItem.sourcing_request)
            .selectinload(SourcingRequest.quote_documents),
            selectinload(PendingOrder.documents),
            selectinload(PendingOrder.licenses),
        )
        .order_by(PendingOrder.updated_at.desc(), PendingOrder.created_at.desc())
        .offset(offset)
    )
    if limit is not None:
        query = query.limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_pending_order_record(
    db: AsyncSession,
    payload: PendingOrderCreate,
    *,
    created_by: int,
) -> PendingOrder:
    create_data = payload.model_dump(by_alias=False)
    create_data.pop("items", None)
    create_data["po_number"] = (create_data.get("po_number") or "").strip()
    create_data["procurement_reference"] = (create_data.get("procurement_reference") or "").strip()
    supplier_value = create_data.get("supplier")
    if isinstance(supplier_value, str) and supplier_value.strip():
        supplier = await resolve_organization(db, supplier_value, role="supplier", create_if_missing=True)
        create_data["supplier"] = supplier.name
        create_data["supplier_id"] = supplier.id
    else:
        create_data["supplier"] = None
        create_data["supplier_id"] = None
    order = PendingOrder(**create_data, created_by=created_by)
    db.add(order)
    await db.flush()
    if payload.items:
        await add_pending_order_items_bulk_record(
            db,
            order.id,
            payload.items,
            created_by=created_by,
        )
    return order


async def apply_pending_order_update(
    db: AsyncSession,
    order_id: int,
    payload: PendingOrderUpdate,
) -> tuple[PendingOrder, dict, dict]:
    order = await get_pending_order_or_404(db, order_id, include_items=True)
    ensure_pending_order_editable(order, action="update")
    before = {column.name: getattr(order, column.name) for column in order.__table__.columns}

    update_data = payload.model_dump(by_alias=False, exclude_unset=True)
    if "po_number" in update_data:
        update_data["po_number"] = (update_data.get("po_number") or "").strip()
    if "procurement_reference" in update_data:
        update_data["procurement_reference"] = (update_data.get("procurement_reference") or "").strip()
    if "supplier" in update_data:
        supplier_value = update_data.get("supplier")
        if isinstance(supplier_value, str) and supplier_value.strip():
            supplier = await resolve_organization(db, supplier_value, role="supplier", create_if_missing=True)
            update_data["supplier"] = supplier.name
            update_data["supplier_id"] = supplier.id
        else:
            update_data["supplier"] = None
            update_data["supplier_id"] = None
    if "status" in update_data and update_data["status"] not in {
        PendingOrderStatus.pending,
        PendingOrderStatus.invoice_received,
    }:
        raise HTTPException(
            status_code=422,
            detail="Pending order status can only be changed to pending or invoice_received from the edit path",
        )
    for field, value in update_data.items():
        setattr(order, field, value)

    after = {column.name: getattr(order, column.name) for column in order.__table__.columns}
    return order, before, after


async def delete_pending_order_record(db: AsyncSession, order_id: int) -> str:
    order = await get_pending_order_or_404(db, order_id, include_items=False)
    if order.status != PendingOrderStatus.pending:
        raise HTTPException(
            status_code=409,
            detail="Only pending orders with status 'pending' can be deleted",
        )

    items_result = await db.execute(
        select(SourcingItem).where(SourcingItem.pending_order_id == order_id)
    )
    affected_request_ids = set()
    items = list(items_result.scalars().all())
    for item in items:
        if item.sourcing_request_id is not None:
            affected_request_ids.add(item.sourcing_request_id)
        item.status = SourcingStatus.sourcing

    from app.services.sourcing_service import refresh_sourcing_request_status
    for request_id in affected_request_ids:
        request_result = await db.execute(select(SourcingRequest).where(SourcingRequest.id == request_id))
        request = request_result.scalar_one_or_none()
        if request is not None:
            request.status = SourcingStatus.sourcing
            await refresh_sourcing_request_status(db, request)

    docs_result = await db.execute(select(ProcurementDocument).where(ProcurementDocument.pending_order_id == order_id))
    docs = docs_result.scalars().all()
    stored_paths = [doc.filename for doc in docs]
    for doc in docs:
        await db.delete(doc)

    label = order.po_number or order.supplier or str(order_id)
    await db.delete(order)
    return label, stored_paths


async def cancel_pending_order_record(db: AsyncSession, order_id: int) -> PendingOrder:
    order = await get_pending_order_or_404(db, order_id, include_items=True)
    ensure_pending_order_editable(order, action="cancel")

    from app.services.sourcing_service import sourcing_item_predecessor_ids

    renewal_ids = {
        predecessor_id
        for item in order.items
        for predecessor_id in sourcing_item_predecessor_ids(item)
    }
    order.status = PendingOrderStatus.cancelled
    for item in order.items:
        item.status = SourcingStatus.cancelled

    await db.flush()
    if renewal_ids:
        from app.services.sourcing_service import clear_pending_renewal_if_no_open_sourcing

        for renewal_id in renewal_ids:
            await clear_pending_renewal_if_no_open_sourcing(db, renewal_id)
    return order


async def add_pending_order_item_record(
    db: AsyncSession,
    order_id: int,
    payload: SourcingItemCreate,
    *,
    created_by: int,
) -> PendingOrder:
    order = await get_pending_order_or_404(db, order_id, include_items=True)
    ensure_pending_order_editable(order, action="add items to")

    item = _build_pending_order_item(payload, order_id=order_id, created_by=created_by)
    await resolve_sourcing_item_references(db, item)
    db.add(item)
    return order


async def add_pending_order_items_bulk_record(
    db: AsyncSession,
    order_id: int,
    payload: list[SourcingItemCreate],
    *,
    created_by: int,
) -> PendingOrder:
    if not payload:
        raise HTTPException(status_code=422, detail="At least one item is required")

    order = await get_pending_order_or_404(db, order_id, include_items=True)
    ensure_pending_order_editable(order, action="add items to")

    for item_payload in payload:
        item = _build_pending_order_item(item_payload, order_id=order_id, created_by=created_by)
        await resolve_sourcing_item_references(db, item)
        db.add(item)

    return order


async def update_pending_order_item_record(
    db: AsyncSession,
    order_id: int,
    item_id: int,
    payload: SourcingItemUpdate,
) -> PendingOrder:
    order = await get_pending_order_or_404(db, order_id, include_items=True)
    ensure_pending_order_editable(order, action="update items on")

    item = _find_order_item(order, item_id)
    update_data = payload.model_dump(by_alias=False, exclude_unset=True)
    update_data.pop("status", None)
    if "publisher_name" in update_data or "supplier" in update_data:
        reference_data = {
            "publisher_name": update_data.get("publisher_name", item.publisher_name),
            "supplier": update_data.get("supplier", item.supplier),
        }
        await resolve_procurement_reference_fields(db, reference_data, publisher_required=True)
        if "publisher_name" in update_data:
            update_data["publisher_name"] = reference_data["publisher_name"]
            update_data["publisher_id"] = reference_data["publisher_id"]
        if "supplier" in update_data:
            update_data["supplier"] = reference_data["supplier"]
            update_data["supplier_id"] = reference_data["supplier_id"]
    for field, value in update_data.items():
        setattr(item, field, value)

    await db.flush()
    return order


async def delete_pending_order_item_record(
    db: AsyncSession,
    order_id: int,
    item_id: int,
) -> tuple[PendingOrder, str, list[int], bool]:
    order = await get_pending_order_or_404(db, order_id, include_items=True)
    ensure_pending_order_editable(order, action="delete items from")

    item = _find_order_item(order, item_id)
    label = f"{item.publisher_name} - {item.software_description}"
    from app.services.sourcing_service import sourcing_item_predecessor_ids

    renewal_license_ids = sourcing_item_predecessor_ids(item)
    await db.delete(item)
    order.items = [existing for existing in order.items if existing.id != item_id]
    order_cancelled = len(order.items) == 0
    if order_cancelled:
        order.status = PendingOrderStatus.cancelled
    await db.flush()
    return order, label, renewal_license_ids, order_cancelled


def ensure_pending_order_editable(order: PendingOrder, *, action: str = "modify") -> None:
    if order.status in {PendingOrderStatus.converted, PendingOrderStatus.cancelled}:
        raise HTTPException(status_code=409, detail=f"Cannot {action} a {order.status.value} order")


def _find_order_item(order: PendingOrder, item_id: int) -> SourcingItem:
    for item in order.items:
        if item.id == item_id:
            return item
    raise HTTPException(status_code=404, detail="Pending order item not found")


def _build_pending_order_item(
    payload: SourcingItemCreate,
    *,
    order_id: int,
    created_by: int,
) -> SourcingItem:
    item_data = payload.model_dump(by_alias=False)
    item_data.pop("status", None)
    item_data.pop("renewal_for_license_id", None)
    item_data.pop("sourcing_request_id", None)
    item_data.pop("parent_item_index", None)

    return SourcingItem(
        **item_data,
        status=SourcingStatus.converted,
        pending_order_id=order_id,
        created_by=created_by,
    )
