from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.license import License
from app.models.pending_order import PendingOrder
from app.models.sourcing import SourcingItem, SourcingRequest
from app.schemas.license import (
    LicenseProcurementTrailResponse,
    ProcurementTrailConversion,
    ProcurementTrailDocument,
    ProcurementTrailExistingSuccessorLink,
    ProcurementTrailPendingOrder,
    ProcurementTrailSourcingItem,
    ProcurementTrailSourcingRequest,
)


def _enum_value(value: object) -> str:
    return str(getattr(value, "value", value))


def _document_response(document: object) -> ProcurementTrailDocument:
    return ProcurementTrailDocument(
        id=document.id,
        original_filename=document.original_filename,
        category=_enum_value(getattr(document, "category", "quote")),
        uploaded_at=document.uploaded_at,
    )


def _sourcing_request_response(request: SourcingRequest | None) -> ProcurementTrailSourcingRequest | None:
    if request is None:
        return None
    return ProcurementTrailSourcingRequest(
        id=request.id,
        status=_enum_value(request.status),
        supplier=request.supplier,
        contact_email=request.contact_email,
        notes=request.notes,
        created_at=request.created_at,
        updated_at=request.updated_at,
        quote_documents=[_document_response(document) for document in request.quote_documents],
    )


def _sourcing_item_response(item: SourcingItem | None) -> ProcurementTrailSourcingItem | None:
    if item is None:
        return None
    return ProcurementTrailSourcingItem(
        id=item.id,
        status=_enum_value(item.status),
        publisher_name=item.publisher_name,
        software_description=item.software_description,
        quantity=item.quantity,
        estimated_unit_price=item.estimated_unit_price,
        estimated_total_price=item.estimated_total_price,
        currency=item.currency,
        renewal_for_license_id=item.renewal_for_license_id,
        coterm_predecessor_ids=item.coterm_predecessor_ids,
    )


def _pending_order_response(order: PendingOrder | None) -> ProcurementTrailPendingOrder | None:
    if order is None:
        return None
    return ProcurementTrailPendingOrder(
        id=order.id,
        po_number=order.po_number,
        procurement_reference=order.procurement_reference,
        status=_enum_value(order.status),
        supplier=order.supplier,
        notes=order.notes,
        created_at=order.created_at,
        updated_at=order.updated_at,
        documents=[_document_response(document) for document in order.documents],
    )


def _normalized(value: str | None) -> str:
    return (value or "").strip().casefold()


def _match_legacy_source_item(license_obj: License, order: PendingOrder | None) -> tuple[SourcingItem | None, str]:
    if order is None:
        return None, "none"

    matches = [
        item
        for item in order.items
        if _normalized(item.publisher_name) == _normalized(license_obj.publisher_name)
        and _normalized(item.software_description) == _normalized(license_obj.software_description)
    ]
    if len(matches) == 1:
        return matches[0], "matched"
    if len(matches) > 1:
        return None, "ambiguous"
    return None, "po_only"


async def _load_pending_order(db: AsyncSession, order_id: int | None) -> PendingOrder | None:
    if order_id is None:
        return None

    result = await db.execute(
        select(PendingOrder)
        .where(PendingOrder.id == order_id)
        .options(
            selectinload(PendingOrder.documents),
            selectinload(PendingOrder.items)
            .selectinload(SourcingItem.sourcing_request)
            .selectinload(SourcingRequest.quote_documents),
        )
    )
    return result.scalar_one_or_none()


async def _load_source_item(db: AsyncSession, item_id: int | None) -> SourcingItem | None:
    if item_id is None:
        return None

    result = await db.execute(
        select(SourcingItem)
        .where(SourcingItem.id == item_id)
        .options(selectinload(SourcingItem.sourcing_request).selectinload(SourcingRequest.quote_documents))
    )
    return result.scalar_one_or_none()


async def build_license_procurement_trail(
    db: AsyncSession,
    license_obj: License,
) -> LicenseProcurementTrailResponse:
    pending_order = await _load_pending_order(db, license_obj.pending_order_id)
    source_item = await _load_source_item(db, license_obj.source_sourcing_item_id)
    source_match_type = "exact" if source_item is not None else "none"

    if source_item is None:
        source_item, source_match_type = _match_legacy_source_item(license_obj, pending_order)

    sourcing_request = source_item.sourcing_request if source_item is not None else None

    if sourcing_request is None and pending_order is not None:
        sourced_items = [item for item in pending_order.items if item.sourcing_request is not None]
        if len({item.sourcing_request_id for item in sourced_items}) == 1:
            sourcing_request = sourced_items[0].sourcing_request

    link_predecessor = license_obj if license_obj.existing_successor_linked_at is not None else None
    if link_predecessor is None and license_obj.renewed_from_id is not None:
        candidate = await db.get(License, license_obj.renewed_from_id)
        if (
            candidate is not None
            and candidate.existing_successor_linked_at is not None
            and candidate.renewed_to_id == license_obj.id
        ):
            link_predecessor = candidate

    existing_successor_link = None
    if link_predecessor is not None and link_predecessor.renewed_to_id is not None:
        existing_successor_link = ProcurementTrailExistingSuccessorLink(
            predecessor_license_id=link_predecessor.id,
            successor_license_id=link_predecessor.renewed_to_id,
            po_number=link_predecessor.po_number,
            chain_license_ref=link_predecessor.license_ref,
            former_successor_license_ref=link_predecessor.existing_successor_original_ref,
            linked_at=link_predecessor.existing_successor_linked_at,
            linked_by_email=link_predecessor.existing_successor_linked_by_email,
        )

    return LicenseProcurementTrailResponse(
        license_id=license_obj.id,
        license_ref=license_obj.license_ref,
        sourcing_request=_sourcing_request_response(sourcing_request),
        sourcing_item=_sourcing_item_response(source_item),
        pending_order=_pending_order_response(pending_order),
        existing_successor_link=existing_successor_link,
        conversion=ProcurementTrailConversion(
            pending_order_id=license_obj.pending_order_id,
            source_sourcing_item_id=source_item.id if source_item is not None else license_obj.source_sourcing_item_id,
            source_match_type=source_match_type,
            request_date=license_obj.request_date,
            purchase_date=license_obj.purchase_date,
            renewed_from_id=license_obj.renewed_from_id,
            predecessor_id=license_obj.predecessor_id,
            coterm_from_ids=license_obj.coterm_from_ids,
        ),
    )
