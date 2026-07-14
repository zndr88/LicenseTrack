import logging
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Awaitable, Callable, Optional

from fastapi import HTTPException, UploadFile
from sqlalchemy import select, update
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal
from app.models.license import License, LicenseType
from app.models.pending_order import EvidenceTransferStatus, PendingOrder, PendingOrderStatus
from app.models.user import User
from app.schemas.license import LicenseResponse
from app.schemas.pending_order import BatchConvertItem, PendingOrderConvertRequest
from app.services import renewal_orchestrator
from app.services.audit_service import log_event
from app.services.conversion.license_converter import create_purchase_license
from app.services.conversion.pending_order_status import mark_item_converted, refresh_order_status
from app.services.conversion_response_service import build_conversion_response
from app.services.procurement_document_transfer_service import (
    StoredProcurementPath,
    copy_quote_documents_to_procurement_documents,
    validate_invoice_file,
    write_invoice_procurement_document,
)
from app.services.storage import delete_file
from app.services.renewal_workflow import build_pending_order_item_license_data

log = logging.getLogger(__name__)


def _cleanup_written_procurement_files(paths: list[StoredProcurementPath]) -> None:
    for path, storage_base in paths:
        try:
            delete_file(path, storage_base)
        except Exception:
            pass


async def _mark_evidence_transfer_complete(db: AsyncSession, order_id: int) -> None:
    order = await db.get(PendingOrder, order_id)
    if order is None:
        return
    order.evidence_transfer_status = EvidenceTransferStatus.complete
    order.evidence_transfer_detail = None
    order.evidence_transfer_failed_at = None
    await db.commit()


async def _mark_evidence_transfer_failed(
    db: AsyncSession,
    *,
    order_id: int,
    order_label: str,
    actor: User | SimpleNamespace,
    ip_address: str | None,
    detail: str,
) -> None:
    order = await db.get(PendingOrder, order_id)
    if order is not None:
        order.evidence_transfer_status = EvidenceTransferStatus.failed
        order.evidence_transfer_detail = detail
        order.evidence_transfer_failed_at = datetime.now(timezone.utc)
    await log_event(
        db,
        "po.evidence_transfer_failed",
        actor=actor,
        ip_address=ip_address,
        target_type="pending_order",
        target_id=str(order_id),
        target_label=order_label,
        detail=detail,
    )
    await db.commit()


async def _run_evidence_transfer_after_conversion_commit(
    *,
    db: AsyncSession,
    order_id: int,
    order_label: str,
    actor: User | SimpleNamespace,
    ip_address: str | None,
    transfer: Callable[[], Awaitable[list[StoredProcurementPath]]],
) -> None:
    written_procurement_paths: list[StoredProcurementPath] = []
    try:
        written_procurement_paths = await transfer()
        await _mark_evidence_transfer_complete(db, order_id)
    except Exception as exc:
        _cleanup_written_procurement_files(written_procurement_paths)
        await db.rollback()
        await _mark_evidence_transfer_failed(
            db,
            order_id=order_id,
            order_label=order_label,
            actor=actor,
            ip_address=ip_address,
            detail=f"{type(exc).__name__}: {exc}",
        )


async def _validate_invoice_file(file: UploadFile) -> tuple[bytes, str, str]:
    return await validate_invoice_file(file)


async def convert_pending_order_to_licenses(
    *,
    order_id: int,
    convert_payload: PendingOrderConvertRequest,
    file: Optional[UploadFile],
    db: AsyncSession,
    current_user: User,
    ip_address: str | None,
) -> list[LicenseResponse]:
    actor_snapshot = SimpleNamespace(id=current_user.id, email=current_user.email)

    # Validate the file BEFORE touching the database. Bad uploads fail fast here.
    file_data: tuple[bytes, str, str] | None = None
    if file is not None:
        file_data = await validate_invoice_file(file)

    result = await db.execute(
        select(PendingOrder)
        .where(PendingOrder.id == order_id)
        .options(selectinload(PendingOrder.items), selectinload(PendingOrder.documents))
    )
    order = result.scalar_one_or_none()
    if order is None:
        raise HTTPException(status_code=404, detail="Pending order not found")
    if order.status == PendingOrderStatus.converted:
        raise HTTPException(status_code=409, detail="Pending order has already been converted")
    # F5: Acquire a write lock before creating any licenses.
    _lock = await db.execute(
        update(PendingOrder)
        .where(PendingOrder.id == order_id)
        .where(PendingOrder.status != PendingOrderStatus.converted)
        .values(notes=order.notes)
        .execution_options(synchronize_session=False)
    )
    try:
        await db.flush()
    except InvalidRequestError:
        raise HTTPException(
            status_code=409,
            detail="Pending order has already been converted",
        )
    if _lock.rowcount == 0:
        raise HTTPException(
            status_code=409,
            detail="Pending order has already been converted",
        )
    form_data = convert_payload.model_dump(by_alias=False)
    form_data["pending_order_id"] = order_id
    form_data["purchase_date"] = order.created_at

    new_license_entries: list[tuple[int, str]] = []
    predecessor_ids: list[int] = []
    quote_request_ids: list[int] = []
    evidence_transfer_required = file_data is not None

    if not order.items:
        new_lic = await create_purchase_license(
            db=db,
            item_data=form_data,
            created_by=current_user.id,
            created_parent_by_sourcing_item_id={},
            item_id=order_id,
        )
        new_license_entries.append((new_lic.id, "new_purchase"))
    else:
        for item in order.items:
            if item.renewal_for_license_id is not None:
                old_result = await db.execute(select(License).where(License.id == item.renewal_for_license_id))
                old_lic = old_result.scalar_one_or_none()
                if old_lic is None:
                    raise HTTPException(
                        status_code=404,
                        detail=f"License {item.renewal_for_license_id} not found for renewal",
                    )

                item_data = build_pending_order_item_license_data(form_data, item, old_lic)

                renewal_result = await renewal_orchestrator.create_renewal_successor_from_sourcing_item(
                    db=db,
                    sourcing_item=item,
                    license_data=item_data,
                    created_by=current_user.id,
                    missing_license_detail=f"License {item.renewal_for_license_id} not found for renewal",
                    primary_predecessor=old_lic,
                )
                new_lic = renewal_result.successor
                predecessor_ids.extend(renewal_result.predecessor_ids)
                new_license_entries.append((new_lic.id, "renewed"))
                if item.sourcing_request_id is not None:
                    quote_request_ids.append(item.sourcing_request_id)
                    evidence_transfer_required = True
            else:
                item_data = build_pending_order_item_license_data(form_data, item, None)
                new_lic = await create_purchase_license(
                    db=db,
                    item_data=item_data,
                    created_by=current_user.id,
                    created_parent_by_sourcing_item_id={},
                    item_id=item.id,
                )
                new_license_entries.append((new_lic.id, "new_purchase"))
                if item.sourcing_request_id is not None:
                    quote_request_ids.append(item.sourcing_request_id)
                    evidence_transfer_required = True

    for item in order.items:
        mark_item_converted(item)

    refresh_order_status(order)
    order_po_number = order.po_number
    order_label = order.po_number or order.supplier or ""
    if evidence_transfer_required:
        order.evidence_transfer_status = EvidenceTransferStatus.pending
        order.evidence_transfer_detail = None
        order.evidence_transfer_failed_at = None

    await log_event(
        db,
        "po.converted",
        actor=current_user,
        ip_address=ip_address,
        target_type="pending_order",
        target_id=str(order_id),
        target_label=order_label,
        detail=f"{len(new_license_entries)} license(s) created",
    )
    await db.commit()

    async def transfer_evidence() -> list[StoredProcurementPath]:
        written_paths: list[StoredProcurementPath] = []
        if file_data is not None:
            content, filename, mime_type = file_data
            written_paths.append(
                await write_invoice_procurement_document(
                    db, content, filename, mime_type, order_po_number, order_id, actor_snapshot.id
                )
            )

        if quote_request_ids:
            written_paths.extend(
                await copy_quote_documents_to_procurement_documents(
                    db, order_po_number, order_id, quote_request_ids, actor_snapshot.id
                )
            )
        await db.commit()
        return written_paths

    if evidence_transfer_required:
        await _run_evidence_transfer_after_conversion_commit(
            db=db,
            order_id=order_id,
            order_label=order_label,
            actor=actor_snapshot,
            ip_address=ip_address,
            transfer=transfer_evidence,
        )

    return await build_conversion_response(db, new_license_entries, predecessor_ids)


async def batch_convert_pending_order_to_licenses(
    *,
    order_id: int,
    payload: list[BatchConvertItem],
    db: AsyncSession,
    current_user: User,
    ip_address: str | None,
) -> list[LicenseResponse]:
    actor_snapshot = SimpleNamespace(id=current_user.id, email=current_user.email)

    result = await db.execute(
        select(PendingOrder)
        .where(PendingOrder.id == order_id)
        .options(selectinload(PendingOrder.items), selectinload(PendingOrder.documents))
    )
    order = result.scalar_one_or_none()
    if order is None:
        raise HTTPException(status_code=404, detail="Pending order not found")
    if order.status == PendingOrderStatus.converted:
        raise HTTPException(status_code=409, detail="Pending order has already been converted")
    # F5: Acquire a write lock before creating any licenses.
    _lock = await db.execute(
        update(PendingOrder)
        .where(PendingOrder.id == order_id)
        .where(PendingOrder.status != PendingOrderStatus.converted)
        .values(notes=order.notes)
        .execution_options(synchronize_session=False)
    )
    try:
        await db.flush()
    except InvalidRequestError:
        raise HTTPException(
            status_code=409,
            detail="Pending order has already been converted",
        )
    if _lock.rowcount == 0:
        raise HTTPException(
            status_code=409,
            detail="Pending order has already been converted",
        )

    if not payload:
        raise HTTPException(status_code=422, detail="Payload must contain at least one item")

    order_item_map = {si.id: si for si in order.items}

    new_license_entries: list[tuple[int, str]] = []
    predecessor_ids: list[int] = []
    quote_request_ids: list[int] = []
    created_parent_by_sourcing_item_id: dict[int, License] = {}
    pending_maintenance_items: list[tuple[BatchConvertItem, dict]] = []

    for batch_item in payload:
        sourcing_item = order_item_map.get(batch_item.sourcing_item_id)
        if sourcing_item is None:
            raise HTTPException(
                status_code=422,
                detail=f"Item {batch_item.sourcing_item_id}: not found in pending order {order_id}",
            )

        item_data = batch_item.model_dump(by_alias=False, exclude={"sourcing_item_id"})
        item_data["pending_order_id"] = order_id
        item_data["request_date"] = sourcing_item.created_at
        item_data["purchase_date"] = order.created_at

        if sourcing_item.renewal_for_license_id is not None:
            item_data.pop("parent_sourcing_item_id", None)
            old_result = await db.execute(select(License).where(License.id == sourcing_item.renewal_for_license_id))
            old_lic = old_result.scalar_one_or_none()
            if old_lic is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Item {batch_item.sourcing_item_id}: license {sourcing_item.renewal_for_license_id} not found for renewal",
                )

            renewal_result = await renewal_orchestrator.create_renewal_successor_from_sourcing_item(
                db=db,
                sourcing_item=sourcing_item,
                license_data=item_data,
                created_by=current_user.id,
                missing_license_detail=(
                    f"Item {batch_item.sourcing_item_id}: license "
                    f"{sourcing_item.renewal_for_license_id} not found for renewal"
                ),
                primary_predecessor=old_lic,
                validate_maintenance_parent=True,
                validation_detail_prefix=f"Item {batch_item.sourcing_item_id}: ",
            )
            new_lic = renewal_result.successor
            predecessor_ids.extend(renewal_result.predecessor_ids)
            new_license_entries.append((new_lic.id, "renewed"))
            if sourcing_item.sourcing_request_id is not None:
                quote_request_ids.append(sourcing_item.sourcing_request_id)
        else:
            if item_data.get("license_type") == LicenseType.maintenance:
                pending_maintenance_items.append((batch_item, item_data))
                continue

            new_lic = await create_purchase_license(
                db=db,
                item_data=item_data,
                created_by=current_user.id,
                created_parent_by_sourcing_item_id=created_parent_by_sourcing_item_id,
                item_id=batch_item.sourcing_item_id,
            )
            if item_data.get("license_type") in (LicenseType.perpetual, LicenseType.oem, LicenseType.freeware):
                created_parent_by_sourcing_item_id[batch_item.sourcing_item_id] = new_lic
            new_license_entries.append((new_lic.id, "new_purchase"))
            if sourcing_item.sourcing_request_id is not None:
                quote_request_ids.append(sourcing_item.sourcing_request_id)

        mark_item_converted(sourcing_item)

    for batch_item, item_data in pending_maintenance_items:
        sourcing_item = order_item_map[batch_item.sourcing_item_id]
        new_lic = await create_purchase_license(
            db=db,
            item_data=item_data,
            created_by=current_user.id,
            created_parent_by_sourcing_item_id=created_parent_by_sourcing_item_id,
            item_id=batch_item.sourcing_item_id,
        )
        new_license_entries.append((new_lic.id, "new_purchase"))
        if sourcing_item.sourcing_request_id is not None:
            quote_request_ids.append(sourcing_item.sourcing_request_id)
        mark_item_converted(sourcing_item)

    refresh_order_status(order)
    order_po_number = order.po_number
    order_label = order.po_number or order.supplier or ""
    if quote_request_ids:
        order.evidence_transfer_status = EvidenceTransferStatus.pending
        order.evidence_transfer_detail = None
        order.evidence_transfer_failed_at = None

    await log_event(
        db,
        "po.converted",
        actor=current_user,
        ip_address=ip_address,
        target_type="pending_order",
        target_id=str(order_id),
        target_label=order_label,
        detail=f"{len(new_license_entries)} license(s) created",
    )
    await db.commit()

    async def transfer_evidence() -> list[StoredProcurementPath]:
        written_paths: list[StoredProcurementPath] = []
        if quote_request_ids:
            written_paths.extend(
                await copy_quote_documents_to_procurement_documents(
                    db, order_po_number, order_id, quote_request_ids, actor_snapshot.id
                )
            )
        await db.commit()
        return written_paths

    if quote_request_ids:
        await _run_evidence_transfer_after_conversion_commit(
            db=db,
            order_id=order_id,
            order_label=order_label,
            actor=actor_snapshot,
            ip_address=ip_address,
            transfer=transfer_evidence,
        )

    return await build_conversion_response(db, new_license_entries, predecessor_ids)


async def retry_evidence_transfer(
    *,
    order_id: int,
    db: AsyncSession,
    actor: User,
    ip_address: str | None,
) -> None:
    """Re-attempt the quote document copy for a converted order whose evidence
    transfer previously failed or is stuck in 'pending'.

    Raises HTTPException:
      404 if the order does not exist.
      409 if the order has not been converted, or if its transfer status is
          not 'pending' or 'failed', or if it has no sourcing items with
          associated quote documents to copy.
    """
    result = await db.execute(
        select(PendingOrder).where(PendingOrder.id == order_id).options(selectinload(PendingOrder.items))
    )
    order = result.scalar_one_or_none()
    if order is None:
        raise HTTPException(status_code=404, detail="Pending order not found")
    if order.status != PendingOrderStatus.converted:
        raise HTTPException(status_code=409, detail="Pending order has not been converted")
    if order.evidence_transfer_status not in (
        EvidenceTransferStatus.pending,
        EvidenceTransferStatus.failed,
    ):
        raise HTTPException(
            status_code=409,
            detail="Evidence transfer is not in a retryable state",
        )

    quote_request_ids = [item.sourcing_request_id for item in order.items if item.sourcing_request_id is not None]
    if not quote_request_ids:
        raise HTTPException(
            status_code=409,
            detail="No sourcing quote documents found to transfer",
        )

    order_po_number = order.po_number
    order_label = order.po_number or order.supplier or ""
    actor_snapshot = SimpleNamespace(id=actor.id, email=actor.email)

    async def transfer_evidence() -> list[StoredProcurementPath]:
        written_paths = await copy_quote_documents_to_procurement_documents(
            db, order_po_number, order_id, quote_request_ids, actor_snapshot.id
        )
        await db.commit()
        return written_paths

    await _run_evidence_transfer_after_conversion_commit(
        db=db,
        order_id=order_id,
        order_label=order_label,
        actor=actor_snapshot,
        ip_address=ip_address,
        transfer=transfer_evidence,
    )


_SYSTEM_ACTOR = SimpleNamespace(id=0, email="system")

MAX_EVIDENCE_SWEEP_ATTEMPTS = 5


async def sweep_stale_evidence_transfers() -> int:
    """Retry evidence transfers for converted orders stuck in pending/failed state.

    Called by the background scheduler so that a server crash between the conversion
    commit and the document copy does not leave the order permanently stuck without
    admin intervention.  Returns the number of orders where a retry was attempted.

    After MAX_EVIDENCE_SWEEP_ATTEMPTS failures the order is marked 'escalated' and
    removed from the retry queue; an audit event is emitted so an operator can
    investigate.
    """
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PendingOrder)
            .where(PendingOrder.status == PendingOrderStatus.converted)
            .where(
                PendingOrder.evidence_transfer_status.in_(
                    [
                        EvidenceTransferStatus.pending,
                        EvidenceTransferStatus.failed,
                    ]
                )
            )
            .options(selectinload(PendingOrder.items))
        )
        stuck = [
            (
                order.id,
                order.po_number,
                order.po_number or order.supplier or "",
                [item.sourcing_request_id for item in order.items if item.sourcing_request_id is not None],
                order.evidence_transfer_attempts,
            )
            for order in result.scalars().all()
        ]

    count = 0
    for order_id, order_po_number, order_label, quote_ids, attempts in stuck:
        new_attempts = attempts + 1

        if new_attempts > MAX_EVIDENCE_SWEEP_ATTEMPTS:
            # Cap exceeded — stop retrying and surface for human review.
            async with AsyncSessionLocal() as db:
                order = await db.get(PendingOrder, order_id)
                if order is not None:
                    order.evidence_transfer_status = EvidenceTransferStatus.escalated
                    await log_event(
                        db,
                        "po.evidence_transfer_escalated",
                        actor=_SYSTEM_ACTOR,
                        ip_address=None,
                        target_type="pending_order",
                        target_id=str(order_id),
                        target_label=order_label,
                        detail=(
                            f"Evidence transfer exceeded {MAX_EVIDENCE_SWEEP_ATTEMPTS} "
                            "sweep attempts; manual intervention required."
                        ),
                    )
                    await db.commit()
            count += 1
            continue

        # Increment the attempt counter before running so a crash mid-transfer
        # still counts against the cap.
        async with AsyncSessionLocal() as db:
            order = await db.get(PendingOrder, order_id)
            if order is None:
                continue
            order.evidence_transfer_attempts = new_attempts
            await db.commit()

        if not quote_ids:
            # Nothing to copy — mark complete so it stops appearing in the sweep.
            async with AsyncSessionLocal() as db:
                await _mark_evidence_transfer_complete(db, order_id)
            continue

        async with AsyncSessionLocal() as db:

            async def _transfer(
                _db=db,
                _opn=order_po_number,
                _oid=order_id,
                _qids=quote_ids,
            ) -> list[StoredProcurementPath]:
                written = await copy_quote_documents_to_procurement_documents(_db, _opn, _oid, _qids, _SYSTEM_ACTOR.id)
                await _db.commit()
                return written

            await _run_evidence_transfer_after_conversion_commit(
                db=db,
                order_id=order_id,
                order_label=order_label,
                actor=_SYSTEM_ACTOR,
                ip_address=None,
                transfer=_transfer,
            )
        count += 1

    return count
