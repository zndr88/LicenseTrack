import mimetypes
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.document import ProcurementDocument, ProcurementDocumentCategory
from app.models.settings import GlobalSettings
from app.models.sourcing import SourcingQuoteDocument
from app.services import storage

StoredProcurementPath = tuple[str, str | None]


async def validate_invoice_file(file: UploadFile) -> tuple[bytes, str, str]:
    """Read and validate an invoice upload. Returns (content, filename, mime_type)."""
    content = await file.read()
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the maximum allowed size of {settings.MAX_UPLOAD_SIZE_MB} MB.",
        )
    allowed_extensions = {".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".webp", ".docx"}
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in allowed_extensions:
        raise HTTPException(
            status_code=422,
            detail=(f"File type '{suffix}' is not allowed. Allowed types: PDF, PNG, JPG, TIFF, WEBP, DOCX."),
        )
    mime_type = (file.content_type or "").split(";")[0].strip()
    if not mime_type:
        mime_type = mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    return content, file.filename or "invoice", mime_type


async def write_invoice_procurement_document(
    db: AsyncSession,
    content: bytes,
    filename: str,
    mime_type: str,
    po_number: str,
    pending_order_id: int,
    user_id: int,
) -> StoredProcurementPath:
    gs_result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
    gs_row = gs_result.scalar_one_or_none()
    storage_base = (gs_row.storage_path if gs_row else "") or None
    stored_path, file_size = storage.save_procurement_document_bytes(content, filename, po_number, storage_base)
    db.add(
        ProcurementDocument(
            po_number=po_number,
            pending_order_id=pending_order_id,
            filename=stored_path,
            original_filename=filename,
            file_size=file_size,
            mime_type=mime_type,
            category=ProcurementDocumentCategory.invoice,
            uploaded_by=user_id,
        )
    )
    return stored_path, storage_base


async def copy_quote_documents_to_procurement_documents(
    db: AsyncSession,
    po_number: str,
    pending_order_id: int,
    request_ids: list[int],
    user_id: int,
) -> list[StoredProcurementPath]:
    gs_result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
    gs_row = gs_result.scalar_one_or_none()
    storage_base = (gs_row.storage_path if gs_row else "") or None

    request_ids = sorted(set(request_ids))
    quote_result = await db.execute(
        select(SourcingQuoteDocument).where(SourcingQuoteDocument.sourcing_request_id.in_(request_ids))
    )
    existing_result = await db.execute(
        select(ProcurementDocument).where(
            ProcurementDocument.pending_order_id == pending_order_id,
            ProcurementDocument.category == ProcurementDocumentCategory.quote,
        )
    )
    existing_keys = {(doc.original_filename, doc.file_size, doc.mime_type) for doc in existing_result.scalars().all()}

    stored_paths: list[StoredProcurementPath] = []
    for quote_doc in quote_result.scalars().all():
        key = (quote_doc.original_filename, quote_doc.file_size, quote_doc.mime_type)
        if key in existing_keys:
            continue
        source_path = storage.get_file_path(quote_doc.filename, storage_base)
        if not source_path.exists():
            continue
        stored_path, file_size = storage.save_procurement_document_bytes(
            source_path.read_bytes(),
            quote_doc.original_filename,
            po_number,
            storage_base,
        )
        db.add(
            ProcurementDocument(
                po_number=po_number,
                pending_order_id=pending_order_id,
                filename=stored_path,
                original_filename=quote_doc.original_filename,
                file_size=file_size,
                mime_type=quote_doc.mime_type,
                category=ProcurementDocumentCategory.quote,
                uploaded_by=user_id,
            )
        )
        existing_keys.add(key)
        stored_paths.append((stored_path, storage_base))
    return stored_paths
