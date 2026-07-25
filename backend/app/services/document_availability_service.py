from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contract import ContractDocument
from app.models.document import Document, ProcurementDocument
from app.models.settings import GlobalSettings
from app.models.sourcing import SourcingQuoteDocument
from app.services import storage


async def get_document_storage_base(db: AsyncSession) -> str | None:
    """Return configured storage base without failing when it is unavailable."""
    result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
    settings_row = result.scalar_one_or_none()
    return (settings_row.storage_path if settings_row else "") or None


def document_availability(document, storage_base: str | None = None) -> storage.DocumentFileAvailability:
    return storage.get_file_availability(document.filename, storage_base)


def with_file_availability(response, document, storage_base: str | None = None):
    response.file_availability = document_availability(document, storage_base)
    return response


def count_file_availability(
    documents: Iterable,
    storage_base: str | None = None,
) -> dict[str, int]:
    counts = {
        "total": 0,
        "available": 0,
        "missing": 0,
        "unavailable": 0,
    }
    for document in documents:
        counts["total"] += 1
        counts[document_availability(document, storage_base)] += 1
    return counts


async def reconcile_document_storage(db: AsyncSession, storage_base: str | None = None) -> dict[str, int]:
    """Count managed document records against currently available managed files."""
    effective_base = storage_base
    if effective_base is None:
        effective_base = await get_document_storage_base(db)
    documents = []
    for model in (Document, ProcurementDocument, SourcingQuoteDocument, ContractDocument):
        result = await db.execute(select(model))
        documents.extend(result.scalars().all())
    return count_file_availability(documents, effective_base)

