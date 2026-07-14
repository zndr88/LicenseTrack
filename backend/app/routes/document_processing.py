from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, require_editor_or_admin
from app.models.custom_fields import CustomFieldDefinition, CustomFieldValue
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
from app.services.access_service import can_view_license
from app.services.audit_service import format_audit_detail, log_event
from app.services.custom_fields_service import build_custom_field_value
from app.services.license_write_service import (
    ALLOWED_PATCH_FIELDS,
    apply_license_field_patch,
    validate_patch_field_input,
)

router = APIRouter(prefix="/api/document-processing-results", tags=["document-processing"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


def _normalise_suggested_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _custom_field_lookup_key(value: str) -> str:
    return value.strip().lower().replace(" ", "_")


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


async def _apply_custom_field_value(
    db: AsyncSession,
    *,
    license_id: int,
    definition: CustomFieldDefinition,
    raw_value: str | None,
) -> None:
    value = build_custom_field_value(license_id, definition, raw_value)
    existing = await db.scalar(
        select(CustomFieldValue).where(
            CustomFieldValue.license_id == license_id,
            CustomFieldValue.custom_field_def_id == definition.id,
        )
    )
    if existing is not None:
        existing.value_text = value.value_text
        existing.value_currency = value.value_currency
    else:
        db.add(value)


async def _apply_suggested_fields(
    db: AsyncSession,
    result: DocumentProcessingResult,
    suggested_field_indexes: list[int] | None = None,
) -> tuple[list[str], list[str]]:
    if result.license_id is None:
        raise HTTPException(status_code=422, detail="Processing result is not linked to a license")
    if suggested_field_indexes is not None:
        selected_indexes = sorted(set(suggested_field_indexes))
        invalid_indexes = [index for index in selected_indexes if index < 0 or index >= len(result.suggested_fields)]
        if invalid_indexes:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid suggested field index(es): {', '.join(str(index) for index in invalid_indexes)}",
            )
        suggestions = [result.suggested_fields[index] for index in selected_indexes]
    else:
        suggestions = list(result.suggested_fields)

    definitions = await db.scalars(select(CustomFieldDefinition))
    custom_fields = list(definitions.all())
    custom_by_key: dict[str, CustomFieldDefinition] = {}
    for definition in custom_fields:
        custom_by_key[_custom_field_lookup_key(definition.field_key)] = definition
        custom_by_key[_custom_field_lookup_key(definition.field_key.removeprefix("cf_"))] = definition
        custom_by_key[_custom_field_lookup_key(definition.name)] = definition

    unknown_fields: list[str] = []
    license_field_ops: list[tuple[str, str | None]] = []
    custom_field_ops: list[tuple[CustomFieldDefinition, str | None]] = []
    for suggestion in suggestions:
        field = str(suggestion.get("field", "")).strip()
        if not field:
            unknown_fields.append(field)
            continue
        raw_value = _normalise_suggested_value(suggestion.get("value"))
        if field in ALLOWED_PATCH_FIELDS:
            validate_patch_field_input(field, raw_value)
            license_field_ops.append((field, raw_value))
            continue

        definition = custom_by_key.get(_custom_field_lookup_key(field))
        if definition is not None:
            custom_field_ops.append((definition, raw_value))
            continue
        unknown_fields.append(field)

    if unknown_fields:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported suggested field(s): {', '.join(unknown_fields)}",
        )
    if not license_field_ops and not custom_field_ops:
        raise HTTPException(status_code=422, detail="No suggested fields to apply")

    applied_fields: list[str] = []
    applied_changes: list[str] = []
    for field, raw_value in license_field_ops:
        license_obj = await db.get(License, result.license_id)
        snake_field = ALLOWED_PATCH_FIELDS[field]
        before_value = getattr(license_obj, snake_field) if license_obj is not None else None
        updated_license = await apply_license_field_patch(db, result.license_id, field=field, value=raw_value)
        after_value = getattr(updated_license, snake_field)
        applied_fields.append(field)
        applied_changes.append(f"{field}: {before_value or ''} → {after_value or ''}")
    for definition, raw_value in custom_field_ops:
        existing = await db.scalar(
            select(CustomFieldValue).where(
                CustomFieldValue.license_id == result.license_id,
                CustomFieldValue.custom_field_def_id == definition.id,
            )
        )
        before_value = (
            existing.value_currency
            if definition.field_type == "currency" and existing
            else existing.value_text
            if existing
            else None
        )
        await _apply_custom_field_value(
            db,
            license_id=result.license_id,
            definition=definition,
            raw_value=raw_value,
        )
        applied_fields.append(definition.field_key)
        applied_changes.append(f"{definition.field_key}: {before_value or ''} → {raw_value or ''}")
    return applied_fields, applied_changes


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
    return document.original_filename, visible[0].id


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


async def _supersede_previous_pending_results(
    db: AsyncSession,
    *,
    payload: DocumentProcessingResultCreate,
    current_user: User,
    request: Request,
) -> int:
    now = datetime.now(timezone.utc)
    previous = await db.scalars(
        select(DocumentProcessingResult).where(
            DocumentProcessingResult.document_type == payload.document_type,
            DocumentProcessingResult.document_id == payload.document_id,
            DocumentProcessingResult.capability_key == payload.capability_key,
            DocumentProcessingResult.status == "pending",
        )
    )
    superseded = list(previous.all())
    for row in superseded:
        row.status = "superseded"
        row.reviewed_by = current_user.id
        row.reviewed_at = now
        await log_event(
            db,
            "document_processing_result.superseded",
            actor=current_user,
            ip_address=request.client.host if request.client else None,
            target_type="document_processing_result",
            target_id=str(row.id),
            target_label=f"{row.document_type}:{row.document_id}",
            detail=(f"capability={row.capability_key}\ndocumentType={row.document_type}\ndocumentId={row.document_id}"),
        )
    return len(superseded)


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
    superseded_count = await _supersede_previous_pending_results(
        db,
        payload=payload,
        current_user=current_user,
        request=request,
    )
    result = DocumentProcessingResult(
        document_type=payload.document_type,
        document_id=payload.document_id,
        license_id=license_id,
        capability_key=payload.capability_key,
        status="pending",
        suggested_fields=[field.model_dump(mode="json", by_alias=True) for field in payload.suggested_fields],
        summary=payload.summary,
        raw_output=payload.raw_output,
        error=payload.error,
        created_by=current_user.id,
    )
    db.add(result)
    await db.flush()
    await log_event(
        db,
        "document_processing_result.created",
        actor=current_user,
        ip_address=request.client.host if request.client else None,
        target_type="document_processing_result",
        target_id=str(result.id),
        target_label=filename,
        detail=(
            f"capability={payload.capability_key}\n"
            f"documentType={payload.document_type}\n"
            f"documentId={payload.document_id}\n"
            f"suggestedFields={len(payload.suggested_fields)}\n"
            f"supersededPendingResults={superseded_count}"
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
    applied_fields, applied_changes = await _apply_suggested_fields(
        db, result, payload.suggested_field_indexes if payload else None
    )
    result.status = "accepted"
    result.reviewed_by = current_user.id
    result.reviewed_at = datetime.now(timezone.utc)

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
    result.status = "rejected"
    result.reviewed_by = current_user.id
    result.reviewed_at = datetime.now(timezone.utc)
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
        result=DocumentProcessingResultResponse.model_validate(result),
        applied_fields=[],
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
