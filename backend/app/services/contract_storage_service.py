"""
Storage helpers for contract documents.

Provides:
  get_storage_base(db)      — resolve effective base path, best-effort (no error on missing)
  require_storage_base(db)  — same but raises HTTP 503 if storage is not configured
  validate_contract_upload(file, content) — size, extension, and MIME checks
"""

from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_settings
from app.models.settings import GlobalSettings

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
    Best-effort — file deletion callers must tolerate a None that leads nowhere."""
    gs_result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
    gs = gs_result.scalar_one_or_none()
    custom = (gs.storage_path if gs else "") or ""
    if custom:
        return custom
    if Path(app_settings.STORAGE_PATH).is_dir():
        return None
    return None  # best-effort; file deletion callers tolerate missing paths


async def require_storage_base(db: AsyncSession) -> str | None:
    """Like get_storage_base but raises HTTP 503 if storage is not configured."""
    gs_result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
    gs = gs_result.scalar_one_or_none()
    custom = (gs.storage_path if gs else "") or ""
    if custom:
        return custom
    if Path(app_settings.STORAGE_PATH).is_dir():
        return None
    raise HTTPException(
        status_code=503,
        detail="Document storage is not configured. An administrator must set a storage path in Settings.",
    )


def validate_contract_upload(file: UploadFile, content: bytes) -> None:
    max_bytes = app_settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=422,
            detail=f"File exceeds the maximum allowed size of {app_settings.MAX_UPLOAD_SIZE_MB} MB.",
        )
    filename = file.filename or ""
    ext = Path(filename).suffix.lower()
    allowed_exts = frozenset(e.strip().lower() for e in app_settings.ALLOWED_UPLOAD_EXTENSIONS.split(",") if e.strip())
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=422,
            detail=f"File extension '{ext or '(none)'}' is not allowed. Accepted types: {', '.join(sorted(allowed_exts))}",
        )
    mime_type = (file.content_type or "").split(";")[0].strip().lower()
    if not mime_type:
        mime_type = mimetypes.guess_type(filename)[0] or ""
    if mime_type and mime_type not in _ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"MIME type '{mime_type}' is not permitted for upload.",
        )
