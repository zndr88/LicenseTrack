"""Safeguards for evidence attached to a selected procurement draft line."""

import logging
from contextlib import asynccontextmanager

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import ProcurementDocument, ProcurementDocumentCategory
from app.models.license import License
from app.models.sourcing import SourcingItem, SourcingQuoteDocument
from app.services import storage

logger = logging.getLogger(__name__)


async def require_no_single_documents(db: AsyncSession, item_ids: list[int]) -> None:
    for model in (SourcingQuoteDocument, ProcurementDocument):
        document_id = await db.scalar(select(model.id).where(model.target_sourcing_item_id.in_(item_ids)).limit(1))
        if document_id is not None:
            raise HTTPException(
                status_code=409,
                detail="This line has Single documents attached. Review and remove those documents before deleting or merging the line.",
            )


@asynccontextmanager
async def draft_document_transaction(db: AsyncSession):
    """Compensate only new file copies if the enclosing conversion fails."""
    paths: list[tuple[str, str | None]] = []
    try:
        yield paths
    except Exception:
        await db.rollback()
        for filename, storage_base in paths:
            try:
                storage.delete_file(filename, storage_base)
            except Exception:
                logger.warning("Could not clean up draft document copy %s", filename, exc_info=True)
        raise


async def copy_sourcing_documents_to_license(
    db: AsyncSession,
    item: SourcingItem,
    license_obj: License,
    user_id: int,
    paths: list[tuple[str, str | None]],
) -> None:
    """Copy source evidence locally; blank freeware POs never form a shared group."""
    documents = (
        (
            await db.scalars(
                select(SourcingQuoteDocument).where(
                    SourcingQuoteDocument.sourcing_request_id == item.sourcing_request_id,
                )
            )
        ).all()
        if item.sourcing_request_id is not None
        else []
    )
    documents = [document for document in documents if document.target_sourcing_item_id in (None, item.id)]
    if not documents:
        return
    storage_base = await storage.resolve_storage_path(db)
    for document in documents:
        source_path = storage.require_available_file(document.filename, storage_base)
        filename, file_size = storage.save_procurement_document_bytes(
            source_path.read_bytes(),
            document.original_filename,
            "license",
            license_obj.id,
            storage_base,
        )
        paths.append((filename, storage_base))
        db.add(
            ProcurementDocument(
                po_number="",
                license_id=license_obj.id,
                source_sourcing_quote_document_id=document.id,
                filename=filename,
                original_filename=document.original_filename,
                file_size=file_size,
                mime_type=document.mime_type,
                category=ProcurementDocumentCategory(document.category or "quote"),
                uploaded_by=user_id,
            )
        )
