"""
Storage helpers for contract documents.

Provides:
  get_storage_base(db)      - resolve effective base path, best-effort (no error on missing)
  require_storage_base(db)  - same but raises HTTP 503 if storage is not configured
  validate_contract_upload(file, content) - size, extension, and MIME checks
"""

from __future__ import annotations

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import storage

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
        "application/octet-stream",
    }
)


async def get_storage_base(db: AsyncSession) -> str | None:
    """Resolve effective storage base. Returns None when no custom path is set (callers fall
    back to STORAGE_PATH from config) and also when no valid storage exists at all.
    Best-effort - file deletion callers must tolerate a None that leads nowhere."""
    return await storage.resolve_storage_path(db, require_available=False)


async def require_storage_base(db: AsyncSession) -> str | None:
    """Like get_storage_base but raises HTTP 503 if storage is not configured."""
    return await storage.resolve_storage_path(
        db,
        unavailable_detail=(
            "Document storage is not configured. An administrator must set a storage path in Settings."
        ),
    )


def validate_contract_upload(file: UploadFile, content: bytes) -> None:
    storage.validate_upload(file, content, allowed_mimes=_ALLOWED_MIME_TYPES)
