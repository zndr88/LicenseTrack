from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, require_editor_or_admin
from app.models.document import Document, ProcurementDocument
from app.models.extension import ExtensionCapability
from app.models.license import License
from app.models.user import User
from app.schemas.document_action import (
    DocumentActionInvoke,
    DocumentActionInvokeResponse,
    DocumentActionResponse,
)
from app.services.access_service import can_view_license
from app.services.audit_service import log_event
from app.services.webhook_service import has_active_subscriber

router = APIRouter(prefix="/api/document-actions", tags=["document-actions"])

DbSession = Annotated[AsyncSession, Depends(get_db)]

DOCUMENT_ACTIONS: dict[str, DocumentActionResponse] = {
    "request_processing": DocumentActionResponse(
        key="request_processing",
        label="Request processing",
        description="Emit a document action event for an external processor.",
    ),
}

DOCUMENT_ACTION_EVENT = "document_action.requested"
DOCUMENT_PROCESSING_CAPABILITY = "document.processing"


async def _document_processing_available(db: AsyncSession) -> bool:
    capability = await db.scalar(
        select(ExtensionCapability).where(
            ExtensionCapability.capability_type == DOCUMENT_PROCESSING_CAPABILITY,
            ExtensionCapability.status == "available",
        )
    )
    return capability is not None


@router.get("", response_model=list[DocumentActionResponse])
async def list_document_actions(_current_user: CurrentUser, db: DbSession) -> list[DocumentActionResponse]:
    if not await has_active_subscriber(db, DOCUMENT_ACTION_EVENT):
        return []
    if not await _document_processing_available(db):
        return []
    return list(DOCUMENT_ACTIONS.values())


async def _get_license_document_or_404(
    db: AsyncSession,
    document_id: int,
    current_user: User,
) -> tuple[Document, License]:
    document = await db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    license_obj = await db.get(License, document.license_id)
    if license_obj is None or not await can_view_license(current_user, license_obj, db):
        raise HTTPException(status_code=404, detail="Document not found")
    return document, license_obj


async def _get_procurement_document_or_404(
    db: AsyncSession,
    document_id: int,
    current_user: User,
) -> tuple[ProcurementDocument, License | None]:
    document = await db.get(ProcurementDocument, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    license_query = None
    if document.license_id is not None:
        license_query = select(License).where(License.id == document.license_id)
    elif document.pending_order_id is not None:
        license_query = select(License).where(License.pending_order_id == document.pending_order_id)

    if license_query is None:
        raise HTTPException(status_code=404, detail="Document not found")

    result = await db.execute(license_query)
    licenses = list(result.scalars().all())
    visible = [license_obj for license_obj in licenses if await can_view_license(current_user, license_obj, db)]
    if not visible:
        raise HTTPException(status_code=404, detail="Document not found")
    return document, visible[0]


@router.post("/{action_key}/invoke", response_model=DocumentActionInvokeResponse)
async def invoke_document_action(
    action_key: str,
    payload: DocumentActionInvoke,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> DocumentActionInvokeResponse:
    action = DOCUMENT_ACTIONS.get(action_key)
    if action is None:
        raise HTTPException(status_code=404, detail="Document action not found")
    if not await has_active_subscriber(db, DOCUMENT_ACTION_EVENT):
        raise HTTPException(status_code=409, detail="No active document processor webhook is configured")
    if not await _document_processing_available(db):
        raise HTTPException(status_code=409, detail="No available document processor extension is registered")

    if payload.document_type == "license_document":
        document, license_obj = await _get_license_document_or_404(db, payload.document_id, current_user)
        target_label = document.original_filename
        detail_parts = [
            f"action={action.key}",
            f"documentType={payload.document_type}",
            f"filename={document.original_filename}",
            f"licenseId={license_obj.id}",
        ]
    else:
        document, license_obj = await _get_procurement_document_or_404(db, payload.document_id, current_user)
        target_label = document.original_filename
        detail_parts = [
            f"action={action.key}",
            f"documentType={payload.document_type}",
            f"filename={document.original_filename}",
        ]
        if license_obj is not None:
            detail_parts.append(f"licenseId={license_obj.id}")
        if document.pending_order_id is not None:
            detail_parts.append(f"pendingOrderId={document.pending_order_id}")
        if document.po_number:
            detail_parts.append(f"poNumber={document.po_number}")

    await log_event(
        db,
        DOCUMENT_ACTION_EVENT,
        actor=current_user,
        ip_address=request.client.host if request.client else None,
        target_type=payload.document_type,
        target_id=str(payload.document_id),
        target_label=target_label,
        detail="\n".join(detail_parts),
    )
    await db.commit()
    return DocumentActionInvokeResponse(
        action_key=action.key,
        document_type=payload.document_type,
        document_id=payload.document_id,
    )
