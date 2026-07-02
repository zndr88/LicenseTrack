"""
Document storage routes.

POST   /api/licenses/{license_id}/documents          — upload a file
GET    /api/licenses/{license_id}/documents          — list documents for a license
GET    /api/documents/{document_id}/download         — stream a file
DELETE /api/documents/{document_id}                  — delete record + file
"""

from __future__ import annotations

import mimetypes
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, require_editor_or_admin
from app.models.document import Document, DocumentCategory, ProcurementDocument, ProcurementDocumentCategory
from app.models.license import License
from app.models.user import User
from app.schemas.document import DocumentResponse, ProcurementDocumentResponse
from app.services import storage
from app.services.access_service import can_download_documents, can_view_license
from app.services.audit_contracts import format_document_amendment_detail
from app.services.audit_service import log_event

router = APIRouter(tags=["documents"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


# MIME types that are considered valid for upload (browser-reported values vary)
_ALLOWED_MIME_TYPES: frozenset[str] = frozenset(
    {
        "application/pdf",
        "image/png",
        "image/jpeg",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "text/csv",
        "text/plain",
        "application/csv",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
        # Some browsers send generic binary for office documents validated by extension
        "application/octet-stream",
    }
)


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

@router.post(
    "/api/licenses/{license_id}/documents",
    response_model=DocumentResponse | ProcurementDocumentResponse,
    status_code=201,
)
async def upload_document(
    license_id: int,
    request: Request,
    db: DbSession,
    file: UploadFile,
    category: DocumentCategory = Form(...),
    current_user: User = Depends(require_editor_or_admin),
) -> DocumentResponse | ProcurementDocumentResponse:
    """Upload a file and attach it to a license."""
    # Verify license exists
    lic_result = await db.execute(select(License).where(License.id == license_id))
    lic = lic_result.scalar_one_or_none()
    if lic is None:
        raise HTTPException(status_code=404, detail="License not found")

    # F10: reject oversized uploads before buffering the full body.
    from app.config import settings as _settings
    _max_bytes = _settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    _cl = request.headers.get("content-length")
    try:
        _cl_int = int(_cl) if _cl is not None else 0
    except ValueError:
        _cl_int = 0
    if _cl_int > _max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the maximum allowed size of {_settings.MAX_UPLOAD_SIZE_MB} MB.",
        )

    # Read content once for validation; storage.save_file will seek(0) to re-read
    content = await file.read()
    storage.validate_upload(file, content, allowed_mimes=_ALLOWED_MIME_TYPES)
    await file.seek(0)

    original_filename = file.filename or "upload"
    mime_type = file.content_type or mimetypes.guess_type(original_filename)[0] or "application/octet-stream"

    storage_base = await storage.resolve_storage_path(db)
    if category.value in {member.value for member in ProcurementDocumentCategory} and lic.po_number:
        stored_path, file_size = await storage.save_procurement_document_file(file, lic.po_number, storage_base)
        procurement_document = ProcurementDocument(
            po_number=lic.po_number,
            pending_order_id=None,
            license_id=license_id,
            filename=stored_path,
            original_filename=original_filename,
            file_size=file_size,
            mime_type=mime_type,
            category=ProcurementDocumentCategory(category.value),
            uploaded_by=current_user.id,
        )
        db.add(procurement_document)
        await db.flush()
        ip = request.client.host if request.client else None
        await log_event(
            db,
            "procurement_document.uploaded",
            actor=current_user,
            ip_address=ip,
            target_type="procurement_document",
            target_id=str(procurement_document.id),
            target_label=procurement_document.original_filename,
            detail=format_document_amendment_detail(
                operation="upload",
                post_conversion=lic.pending_order_id is not None,
                document_category=procurement_document.category.value,
                document_scope="procurement",
                document_id=procurement_document.id,
                filename=procurement_document.original_filename,
                related_license_id=license_id,
                pending_order_id=lic.pending_order_id,
                po_number=lic.po_number,
                actor_email=current_user.email,
            ),
        )
        await db.commit()
        await db.refresh(procurement_document)
        return ProcurementDocumentResponse.model_validate(procurement_document)

    stored_path, file_size = await storage.save_file(file, license_id, storage_base)
    document = Document(
        license_id=license_id,
        filename=stored_path,
        original_filename=original_filename,
        file_size=file_size,
        mime_type=mime_type,
        category=category,
        uploaded_by=current_user.id,
    )
    db.add(document)
    await db.flush()

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "document.uploaded",
        actor=current_user,
        ip_address=ip,
        target_type="document",
        target_id=str(document.id),
        target_label=document.original_filename,
        detail=format_document_amendment_detail(
            operation="upload",
            post_conversion=lic.pending_order_id is not None,
            document_category=document.category.value,
            document_scope="license",
            document_id=document.id,
            filename=document.original_filename,
            related_license_id=license_id,
            pending_order_id=lic.pending_order_id,
            po_number=lic.po_number,
            actor_email=current_user.email,
        ),
    )
    await db.commit()
    await db.refresh(document)
    return DocumentResponse.model_validate(document)


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@router.get(
    "/api/licenses/{license_id}/documents",
    response_model=list[DocumentResponse | ProcurementDocumentResponse],
)
async def list_documents(
    license_id: int,
    db: DbSession,
    _current_user: CurrentUser,
) -> list[DocumentResponse | ProcurementDocumentResponse]:
    """Return all documents attached to a license."""
    result = await db.execute(select(License).where(License.id == license_id))
    license_obj = result.scalar_one_or_none()
    if license_obj is None:
        raise HTTPException(status_code=404, detail="License not found")
    if not await can_view_license(_current_user, license_obj, db):
        raise HTTPException(status_code=404, detail="License not found")

    docs_result = await db.execute(
        select(Document).where(Document.license_id == license_id)
    )
    documents = list(docs_result.scalars().all())
    responses: list[DocumentResponse | ProcurementDocumentResponse] = [
        DocumentResponse.model_validate(doc) for doc in documents
    ]
    procurement_conditions = [ProcurementDocument.license_id == license_id]
    if license_obj.pending_order_id is not None:
        procurement_conditions.append(ProcurementDocument.pending_order_id == license_obj.pending_order_id)
    procurement_query = select(ProcurementDocument).where(procurement_conditions[0])
    if len(procurement_conditions) > 1:
        procurement_query = select(ProcurementDocument).where(
            procurement_conditions[0] | procurement_conditions[1]
        )
    procurement_result = await db.execute(procurement_query)
    responses.extend(
        ProcurementDocumentResponse.model_validate(doc)
        for doc in procurement_result.scalars().all()
    )
    return responses


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

@router.get("/api/documents/{document_id}/download")
async def download_document(document_id: int, db: DbSession, current_user: CurrentUser) -> FileResponse:
    """Stream a stored file back to the client.

    JWT is required (401 if missing/invalid — enforced by CurrentUser).
    Viewers may only download in-scope documents when downloads are enabled.
    Admins and Editors may download any document.
    """
    result = await db.execute(select(Document).where(Document.id == document_id))
    document = result.scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    license_result = await db.execute(
        select(License).where(License.id == document.license_id)
    )
    license_obj = license_result.scalar_one_or_none()
    if license_obj is None or not await can_view_license(current_user, license_obj, db):
        raise HTTPException(status_code=404, detail="Document not found")
    if not can_download_documents(current_user):
        raise HTTPException(status_code=403, detail="Downloads are disabled for this viewer")

    storage_base = await storage.resolve_storage_path(db)
    file_path = storage.get_file_path(document.filename, storage_base)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=str(file_path),
        media_type=document.mime_type,
        filename=document.original_filename,
    )


@router.get("/api/procurement-documents/{document_id}/download")
async def download_procurement_document(document_id: int, db: DbSession, current_user: CurrentUser) -> FileResponse:
    result = await db.execute(select(ProcurementDocument).where(ProcurementDocument.id == document_id))
    document = result.scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    if document.license_id is not None:
        license_result = await db.execute(select(License).where(License.id == document.license_id))
    elif document.pending_order_id is not None:
        license_result = await db.execute(select(License).where(License.pending_order_id == document.pending_order_id))
    else:
        license_result = await db.execute(select(License).where(License.po_number == document.po_number))
    licenses = list(license_result.scalars().all())
    can_view_any = any([await can_view_license(current_user, license_obj, db) for license_obj in licenses])
    if not can_view_any:
        raise HTTPException(status_code=404, detail="Document not found")
    if not can_download_documents(current_user):
        raise HTTPException(status_code=403, detail="Downloads are disabled for this viewer")

    storage_base = await storage.resolve_storage_path(db)
    file_path = storage.get_file_path(document.filename, storage_base)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=str(file_path),
        media_type=document.mime_type,
        filename=document.original_filename,
    )


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

@router.delete("/api/documents/{document_id}", status_code=204, response_class=Response)
async def delete_document(
    document_id: int,
    request: Request,
    db: DbSession,
    reason: str | None = Query(default=None),
    _editor: User = Depends(require_editor_or_admin),
) -> Response:
    """Delete both the database record and the file from disk."""
    result = await db.execute(select(Document).where(Document.id == document_id))
    document = result.scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    filename = document.original_filename
    license_id = document.license_id
    stored_path = document.filename
    storage_base = await storage.resolve_storage_path(db)

    lic_result = await db.execute(select(License).where(License.id == license_id))
    lic = lic_result.scalar_one_or_none()

    await db.delete(document)

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "document.deleted",
        actor=_editor,
        ip_address=ip,
        target_type="document",
        target_label=filename,
        detail=format_document_amendment_detail(
            operation="delete",
            post_conversion=lic.pending_order_id is not None if lic else False,
            document_category=document.category.value,
            document_scope="license",
            document_id=document_id,
            filename=filename,
            related_license_id=license_id,
            pending_order_id=lic.pending_order_id if lic else None,
            po_number=lic.po_number if lic else None,
            actor_email=_editor.email,
            reason=reason,
        ),
    )
    await db.commit()

    storage.delete_file(stored_path, storage_base)
    return Response(status_code=204)


@router.delete("/api/procurement-documents/{document_id}", status_code=204, response_class=Response)
async def delete_procurement_document(
    document_id: int,
    request: Request,
    db: DbSession,
    reason: str | None = Query(default=None),
    _editor: User = Depends(require_editor_or_admin),
) -> Response:
    result = await db.execute(select(ProcurementDocument).where(ProcurementDocument.id == document_id))
    document = result.scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    filename = document.original_filename
    stored_path = document.filename
    po_number = document.po_number
    category = document.category.value
    license_id = document.license_id
    pending_order_id = document.pending_order_id
    related_license = await db.get(License, license_id) if license_id is not None else None
    if related_license is None and pending_order_id is not None:
        related_license = await db.scalar(
            select(License).where(License.pending_order_id == pending_order_id)
        )
    storage_base = await storage.resolve_storage_path(db)

    await db.delete(document)
    ip = request.client.host if request.client else None
    await log_event(
        db,
        "procurement_document.deleted",
        actor=_editor,
        ip_address=ip,
        target_type="procurement_document",
        target_label=filename,
        detail=format_document_amendment_detail(
            operation="delete",
            post_conversion=(
                (related_license.pending_order_id is not None)
                if related_license is not None
                else pending_order_id is not None
            ),
            document_category=category,
            document_scope="procurement",
            document_id=document_id,
            filename=filename,
            related_license_id=related_license.id if related_license is not None else license_id,
            pending_order_id=(
                related_license.pending_order_id
                if related_license is not None
                else pending_order_id
            ),
            po_number=po_number,
            actor_email=_editor.email,
            reason=reason,
        ),
    )
    await db.commit()

    storage.delete_file(stored_path, storage_base)
    return Response(status_code=204)
