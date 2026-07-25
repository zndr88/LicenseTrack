import mimetypes
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.sourcing import SourcingQuoteDocument
from app.models.user import User
from app.schemas.sourcing import (
    SourcingQuoteDocumentResponse,
)
from app.services import storage
from app.services.audit_service import log_event
from app.services.document_availability_service import get_document_storage_base, with_file_availability
from app.services.sourcing_service import (
    get_sourcing_request_or_404,
)

router = APIRouter(prefix="/api/sourcing", tags=["sourcing"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.post("/requests/{request_id}/quote-documents", response_model=SourcingQuoteDocumentResponse, status_code=201)
async def upload_sourcing_quote_document(
    request_id: int,
    request: Request,
    db: DbSession,
    file: UploadFile,
    current_user: User = Depends(require_editor_or_admin),
) -> SourcingQuoteDocumentResponse:
    sourcing_request = await get_sourcing_request_or_404(db, request_id)
    content = await file.read()
    storage.validate_upload(file, content)
    await file.seek(0)

    storage_base = await storage.resolve_storage_path(db)
    stored_path, file_size = await storage.save_sourcing_request_file(file, request_id, storage_base)
    original_filename = file.filename or "quote"
    mime_type = file.content_type or mimetypes.guess_type(original_filename)[0] or "application/octet-stream"
    document = SourcingQuoteDocument(
        sourcing_request_id=request_id,
        filename=stored_path,
        original_filename=original_filename,
        file_size=file_size,
        mime_type=mime_type,
        uploaded_by=current_user.id,
    )
    db.add(document)
    await db.flush()
    ip = request.client.host if request.client else None
    await log_event(
        db,
        "sourcing_quote.uploaded",
        actor=current_user,
        ip_address=ip,
        target_type="sourcing_request",
        target_id=str(request_id),
        target_label=sourcing_request.supplier or f"Sourcing request {request_id}",
        detail=original_filename,
    )
    await db.commit()
    await db.refresh(document)
    response = SourcingQuoteDocumentResponse.model_validate(document)
    return with_file_availability(response, document, storage_base)


@router.get("/requests/{request_id}/quote-documents", response_model=list[SourcingQuoteDocumentResponse])
async def list_sourcing_quote_documents(
    request_id: int,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> list[SourcingQuoteDocumentResponse]:
    await get_sourcing_request_or_404(db, request_id)
    result = await db.execute(
        select(SourcingQuoteDocument).where(SourcingQuoteDocument.sourcing_request_id == request_id)
    )
    storage_base = await get_document_storage_base(db)
    return [
        with_file_availability(SourcingQuoteDocumentResponse.model_validate(doc), doc, storage_base)
        for doc in result.scalars().all()
    ]


@router.get("/quote-documents/{document_id}/download")
async def download_sourcing_quote_document(
    document_id: int,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> FileResponse:
    result = await db.execute(select(SourcingQuoteDocument).where(SourcingQuoteDocument.id == document_id))
    document = result.scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    storage_base = await get_document_storage_base(db)
    file_path = storage.require_available_file(document.filename, storage_base)
    return FileResponse(
        path=str(file_path),
        media_type=document.mime_type,
        filename=document.original_filename,
    )


@router.delete("/quote-documents/{document_id}", status_code=204, response_class=Response)
async def delete_sourcing_quote_document(
    document_id: int,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> Response:
    result = await db.execute(select(SourcingQuoteDocument).where(SourcingQuoteDocument.id == document_id))
    document = result.scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    filename = document.filename
    original_filename = document.original_filename
    storage_base = await storage.resolve_storage_path(db)
    await db.delete(document)
    ip = request.client.host if request.client else None
    await log_event(
        db,
        "sourcing_quote.deleted",
        actor=_editor,
        ip_address=ip,
        target_type="sourcing_quote",
        target_id=str(document_id),
        target_label=original_filename,
    )
    await db.commit()
    storage.delete_file(filename, storage_base)
    return Response(status_code=204)
