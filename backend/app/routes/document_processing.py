from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, require_editor_or_admin
from app.models.document import Document, ProcurementDocument
from app.models.document_processing import DocumentProcessingResult
from app.models.extension import ExtensionCapability
from app.models.license import License
from app.models.user import User
from app.schemas.document_processing import (
    DocumentProcessingAcceptRequest,
    DocumentProcessingResultCreate,
    DocumentProcessingResultResponse,
    DocumentProcessingReviewResponse,
)
from app.services.access_service import can_view_license, can_view_procurement_document
from app.services.audit_service import format_audit_detail, log_event
from app.services.document_processing_service import (
    accept_document_processing_result_record,
    create_document_processing_result_record,
    reject_document_processing_result_record,
)
from app.services.procurement_document_scope_service import get_procurement_document_licenses

router = APIRouter(prefix="/api/document-processing-results", tags=["document-processing"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def _get_pending_result_or_404(
    db: AsyncSession,
    result_id: int,
    current_user: User,
) -> DocumentProcessingResult:
    result = await db.get(DocumentProcessingResult, result_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Document processing result not found")
    if result.license_id is not None:
        license_obj = await db.get(License, result.license_id)
        if license_obj is None or not await can_view_license(current_user, license_obj, db):
            raise HTTPException(status_code=404, detail="Document processing result not found")
    if result.status != "pending":
        raise HTTPException(status_code=409, detail=f"Document processing result is already {result.status}")
    return result


async def _resolve_document_context(
    db: AsyncSession,
    document_type: str,
    document_id: int,
    current_user: User,
) -> tuple[str, int | None]:
    if document_type == "license_document":
        document = await db.get(Document, document_id)
        if document is None:
            raise HTTPException(status_code=404, detail="Document not found")
        license_obj = await db.get(License, document.license_id)
        if license_obj is None or not await can_view_license(current_user, license_obj, db):
            raise HTTPException(status_code=404, detail="Document not found")
        return document.original_filename, license_obj.id

    document = await db.get(ProcurementDocument, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    licenses = await get_procurement_document_licenses(db, document)
    if not licenses or not await can_view_procurement_document(current_user, licenses, db):
        raise HTTPException(status_code=404, detail="Document not found")
    return document.original_filename, licenses[0].id


async def _get_source_document_filename(
    db: AsyncSession,
    document_type: str,
    document_id: int,
) -> str | None:
    """Return the original filename for the source document, or None if not found."""
    if document_type == "license_document":
        doc = await db.get(Document, document_id)
        return doc.original_filename if doc is not None else None
    doc = await db.get(ProcurementDocument, document_id)
    return doc.original_filename if doc is not None else None


@router.post("", response_model=DocumentProcessingResultResponse, status_code=status.HTTP_201_CREATED)
async def create_document_processing_result(
    payload: DocumentProcessingResultCreate,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> DocumentProcessingResultResponse:
    capability = await db.scalar(
        select(ExtensionCapability).where(
            ExtensionCapability.key == payload.capability_key,
            ExtensionCapability.capability_type == "document.processing",
            ExtensionCapability.status == "available",
        )
    )
    if capability is None:
        raise HTTPException(
            status_code=409, detail="No available document processor extension is registered for this capability"
        )

    filename, license_id = await _resolve_document_context(
        db,
        payload.document_type,
        payload.document_id,
        current_user,
    )
    outcome = await create_document_processing_result_record(
        db,
        payload,
        license_id=license_id,
        created_by=current_user.id,
    )
    ip_address = request.client.host if request.client else None
    for superseded in outcome.superseded:
        await log_event(
            db,
            "document_processing_result.superseded",
            actor=current_user,
            ip_address=ip_address,
            target_type="document_processing_result",
            target_id=str(superseded.id),
            target_label=f"{superseded.document_type}:{superseded.document_id}",
            detail=(
                f"capability={superseded.capability_key}\n"
                f"documentType={superseded.document_type}\n"
                f"documentId={superseded.document_id}"
            ),
        )
    result = outcome.result
    await log_event(
        db,
        "document_processing_result.created",
        actor=current_user,
        ip_address=ip_address,
        target_type="document_processing_result",
        target_id=str(result.id),
        target_label=filename,
        detail=(
            f"capability={payload.capability_key}\n"
            f"documentType={payload.document_type}\n"
            f"documentId={payload.document_id}\n"
            f"suggestedFields={len(payload.suggested_fields)}\n"
            f"supersededPendingResults={len(outcome.superseded)}"
        ),
    )
    await db.commit()
    await db.refresh(result)
    return DocumentProcessingResultResponse.model_validate(result)


@router.post("/{result_id}/accept", response_model=DocumentProcessingReviewResponse)
async def accept_document_processing_result(
    result_id: int,
    request: Request,
    db: DbSession,
    payload: DocumentProcessingAcceptRequest | None = None,
    current_user: User = Depends(require_editor_or_admin),
) -> DocumentProcessingReviewResponse:
    result = await _get_pending_result_or_404(db, result_id, current_user)
    outcome = await accept_document_processing_result_record(
        db,
        result,
        reviewed_by=current_user.id,
        suggested_field_indexes=(
            payload.suggested_field_indexes if payload else None
        ),
    )
    applied_fields = list(outcome.applied_fields)
    applied_changes = list(outcome.applied_changes)

    source_doc = await _get_source_document_filename(db, result.document_type, result.document_id)
    acceptance_detail = format_audit_detail(
        "document_processing_acceptance",
        {
            "resultId": str(result.id),
            "documentType": result.document_type,
            "documentId": str(result.document_id),
            "sourceDocument": source_doc,
            "capabilityKey": result.capability_key,
            "reviewer": current_user.email,
            "appliedFields": ", ".join(applied_fields),
        },
        field_diffs=applied_changes,
    )
    await log_event(
        db,
        "document_processing_result.accepted",
        actor=current_user,
        ip_address=request.client.host if request.client else None,
        target_type="document_processing_result",
        target_id=str(result.id),
        target_label=f"{result.document_type}:{result.document_id}",
        detail=acceptance_detail,
    )
    if result.license_id is not None:
        license_detail = format_audit_detail(
            "document_processing_acceptance",
            {
                "resultId": str(result.id),
                "capabilityKey": result.capability_key,
                "sourceDocument": source_doc,
                "reviewer": current_user.email,
            },
            field_diffs=applied_changes,
        )
        await log_event(
            db,
            "license.updated",
            actor=current_user,
            ip_address=request.client.host if request.client else None,
            target_type="license",
            target_id=str(result.license_id),
            target_label=f"Document processing result {result.id}",
            detail=license_detail,
        )
    await db.commit()
    await db.refresh(result)
    return DocumentProcessingReviewResponse(
        result=DocumentProcessingResultResponse.model_validate(result),
        applied_fields=applied_fields,
    )


@router.post("/{result_id}/reject", response_model=DocumentProcessingReviewResponse)
async def reject_document_processing_result(
    result_id: int,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> DocumentProcessingReviewResponse:
    result = await _get_pending_result_or_404(db, result_id, current_user)
    outcome = reject_document_processing_result_record(
        result,
        reviewed_by=current_user.id,
    )
    await log_event(
        db,
        "document_processing_result.rejected",
        actor=current_user,
        ip_address=request.client.host if request.client else None,
        target_type="document_processing_result",
        target_id=str(result.id),
        target_label=f"{result.document_type}:{result.document_id}",
        detail=(
            f"capability={result.capability_key}\ndocumentType={result.document_type}\ndocumentId={result.document_id}"
        ),
    )
    await db.commit()
    await db.refresh(result)
    return DocumentProcessingReviewResponse(
        result=DocumentProcessingResultResponse.model_validate(outcome.result),
        applied_fields=list(outcome.applied_fields),
    )


@router.get("", response_model=list[DocumentProcessingResultResponse])
async def list_document_processing_results(
    db: DbSession,
    current_user: CurrentUser,
    license_id: int | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
) -> list[DocumentProcessingResultResponse]:
    query = select(DocumentProcessingResult).order_by(
        DocumentProcessingResult.created_at.desc(), DocumentProcessingResult.id.desc()
    )
    if license_id is not None:
        license_obj = await db.get(License, license_id)
        if license_obj is None or not await can_view_license(current_user, license_obj, db):
            raise HTTPException(status_code=404, detail="License not found")
        query = query.where(DocumentProcessingResult.license_id == license_id)
    if status_filter is not None:
        query = query.where(DocumentProcessingResult.status == status_filter)

    result = await db.execute(query)
    rows = list(result.scalars().all())
    if current_user.role != "viewer":
        return [DocumentProcessingResultResponse.model_validate(row) for row in rows]

    visible_rows: list[DocumentProcessingResult] = []
    for row in rows:
        if row.license_id is None:
            continue
        license_obj = await db.get(License, row.license_id)
        if license_obj is not None and await can_view_license(current_user, license_obj, db):
            visible_rows.append(row)
    return [DocumentProcessingResultResponse.model_validate(row) for row in visible_rows]
