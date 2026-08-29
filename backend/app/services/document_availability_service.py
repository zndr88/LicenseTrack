from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settings import GlobalSettings
from app.services import storage


async def get_document_storage_base(db: AsyncSession) -> str | None:
    """Return configured storage base without failing when it is unavailable."""
    result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
    settings_row = result.scalar_one_or_none()
    return (settings_row.storage_path if settings_row else "") or None


def with_file_availability(response, document, storage_base: str | None = None):
    response.file_availability = storage.get_file_availability(document.filename, storage_base)
    return response


def inspect_document_availability(
    documents: Iterable,
    storage_base: str | None = None,
) -> tuple[list, dict[str, int]]:
    """Return available records and availability counts with one storage scan."""
    counts = {
        "total": 0,
        "available": 0,
        "missing": 0,
        "unavailable": 0,
    }
    available = []
    for document in documents:
        counts["total"] += 1
        availability = storage.get_file_availability(document.filename, storage_base)
        counts[availability] += 1
        if availability == "available":
            available.append(document)
    return available, counts


def available_documents(
    documents: Iterable,
    storage_base: str | None = None,
) -> list:
    """Return only document records whose managed file currently exists."""
    return inspect_document_availability(documents, storage_base)[0]
