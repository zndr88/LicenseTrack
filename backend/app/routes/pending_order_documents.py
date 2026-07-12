import mimetypes
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.document import ProcurementDocument, ProcurementDocumentCategory
from app.models.pending_order import PendingOrderStatus
from app.models.user import User
from app.schemas.document import ProcurementDocumentResponse
from app.services import storage
from app.services.audit_contracts import format_document_amendment_detail
from app.services.audit_service import log_event
from app.services.pending_order_service import get_pending_order_or_404

router = APIRouter(prefix="/api/pending-orders", tags=["pending-orders"])

DbSession = Annotated[AsyncSession, Depends(get_db)]



@router.post("/{order_id}/documents", response_model=ProcurementDocumentResponse, status_code=201)
async def upload_pending_order_document(
    order_id: int,
    request: Request,
    db: DbSession,
    file: UploadFile,
    current_user: User = Depends(require_editor_or_admin),
) -> ProcurementDocumentResponse:
    order = await get_pending_order_or_404(db, order_id, include_items=False)
    content = await file.read()
    storage.validate_upload(file, content)
    await file.seek(0)

    storage_base = await storage.resolve_storage_path(db)
    stored_path, file_size = await storage.save_procurement_document_file(file, order.po_number, storage_base)
    original_filename = file.filename or "purchase-order"
    mime_type = file.content_type or mimetypes.guess_type(original_filename)[0] or "application/octet-stream"
    document = ProcurementDocument(
        po_number=order.po_number,
        pending_order_id=order_id,
        filename=stored_path,
        original_filename=original_filename,
        file_size=file_size,
        mime_type=mime_type,
        category=ProcurementDocumentCategory.purchase_order,
        uploaded_by=current_user.id,
    )
    db.add(document)
    await db.flush()
    await log_event(
        db,
        "procurement_document.uploaded",
        actor=current_user,
        ip_address=request.client.host if request.client else None,
        target_type="pending_order",
        target_id=str(order_id),
        target_label=order.po_number or order.supplier or "",
        detail=format_document_amendment_detail(
            operation="upload",
            post_conversion=order.status == PendingOrderStatus.converted,
            document_category=document.category.value,
            document_scope="procurement",
            document_id=document.id,
            filename=original_filename,
            pending_order_id=order_id,
            po_number=order.po_number,
            actor_email=current_user.email,
        ),
    )
    await db.commit()
    await db.refresh(document)
    return ProcurementDocumentResponse.model_validate(document)


@router.get("/{order_id}/documents", response_model=list[ProcurementDocumentResponse])
async def list_pending_order_documents(
    order_id: int,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> list[ProcurementDocumentResponse]:
    result = await db.execute(
        select(ProcurementDocument).where(ProcurementDocument.pending_order_id == order_id)
    )
    return [ProcurementDocumentResponse.model_validate(doc) for doc in result.scalars().all()]


@router.get("/documents/{document_id}/download")
async def download_pending_order_document(
    document_id: int,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> FileResponse:
    result = await db.execute(select(ProcurementDocument).where(ProcurementDocument.id == document_id))
    document = result.scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    storage_base = await storage.resolve_storage_path(db)
    file_path = storage.get_file_path(document.filename, storage_base)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(
        path=str(file_path),
        media_type=document.mime_type,
        filename=document.original_filename,
    )


@router.delete("/documents/{document_id}", status_code=204, response_class=Response)
async def delete_pending_order_document(
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
    filename = document.filename
    original_filename = document.original_filename
    order_id = document.pending_order_id
    po_number = document.po_number
    category = document.category.value
    order = await get_pending_order_or_404(db, order_id, include_items=False) if order_id is not None else None
    storage_base = await storage.resolve_storage_path(db)
    await db.delete(document)
    await log_event(
        db,
        "procurement_document.deleted",
        actor=_editor,
        ip_address=request.client.host if request.client else None,
        target_type="procurement_document",
        target_id=str(document_id),
        target_label=original_filename,
        detail=format_document_amendment_detail(
            operation="delete",
            post_conversion=order.status == PendingOrderStatus.converted if order else False,
            document_category=category,
            document_scope="procurement",
            document_id=document_id,
            filename=original_filename,
            pending_order_id=order_id,
            po_number=po_number,
            actor_email=_editor.email,
            reason=reason,
        ),
    )
    await db.commit()
    storage.delete_file(filename, storage_base)
    return Response(status_code=204)
