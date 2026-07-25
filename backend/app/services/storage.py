"""
File storage service - saves/retrieves/deletes documents on the local filesystem.

The StorageBackend ABC defines the interface; LocalStorageBackend is the default
filesystem implementation. The module-level ``_backend`` variable holds the active
instance and is used by all public helper functions.
"""

from __future__ import annotations

import logging
import mimetypes
import os
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Optional

from fastapi import HTTPException, UploadFile

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.models.settings import GlobalSettings

logger = logging.getLogger("license_lifecycle.storage")

DocumentFileAvailability = Literal["available", "missing", "unavailable"]
MISSING_FILE_DETAIL = "The document record exists, but the file is missing from managed storage."
UNAVAILABLE_STORAGE_DETAIL = "The document record exists, but managed storage is unavailable."


@dataclass(frozen=True)
class ValidatedStoragePath:
    """A filesystem path that has been checked against the storage root."""

    base: Path
    absolute: Path
    relative: Path


# ---------------------------------------------------------------------------
# StorageBackend interface
# ---------------------------------------------------------------------------


class StorageBackend(ABC):
    """Abstract file-storage interface.

    All paths passed to these methods are absolute Path objects that have
    already been validated against the storage root by the calling helper.
    """

    @abstractmethod
    def write(self, dest: ValidatedStoragePath, content: bytes) -> None:
        """Write *content* to *dest*, creating parent directories as needed."""

    @abstractmethod
    def read(self, source: Path) -> bytes:
        """Return the raw bytes stored at *source*."""

    @abstractmethod
    def delete(self, path: Path) -> None:
        """Remove the file at *path*; silently ignore if it does not exist."""

    @abstractmethod
    def exists(self, path: Path) -> bool:
        """Return True when a file exists at *path*."""


# ---------------------------------------------------------------------------
# LocalStorageBackend - filesystem implementation
# ---------------------------------------------------------------------------


class LocalStorageBackend(StorageBackend):
    """Stores files on the local filesystem."""

    def write(self, dest: ValidatedStoragePath, content: bytes) -> None:
        target = dest.absolute
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        logger.info("File written: %s (%d bytes)", target.name, len(content))

    def read(self, source: Path) -> bytes:
        return source.read_bytes()

    def delete(self, path: Path) -> None:
        path.unlink(missing_ok=True)
        logger.info("File deleted: %s", path.name)

    def exists(self, path: Path) -> bool:
        return path.exists()


# Active backend - swap this to change the storage implementation globally.
_backend: StorageBackend = LocalStorageBackend()


# ---------------------------------------------------------------------------
# Internal path helpers
# ---------------------------------------------------------------------------


def _resolve_base(storage_base: Optional[str] = None) -> Path:
    """Return the effective storage base path."""
    if storage_base:
        return Path(storage_base).resolve()
    return Path(settings.STORAGE_PATH).resolve()


def _license_dir(license_id: int, storage_base: Optional[str] = None) -> Path:
    """Return the per-license storage directory path."""
    return _resolve_base(storage_base) / "documents" / str(license_id)


def _contract_dir(contract_id: int, storage_base: Optional[str] = None) -> Path:
    """Return the per-contract storage directory path."""
    return _resolve_base(storage_base) / "contracts" / str(contract_id)


def _sourcing_request_dir(sourcing_request_id: int, storage_base: Optional[str] = None) -> Path:
    """Return the per-sourcing-request storage directory path."""
    return _resolve_base(storage_base) / "sourcing_requests" / str(sourcing_request_id)


def _procurement_document_dir(po_number: str, storage_base: Optional[str] = None) -> Path:
    """Return the per-PO procurement document storage directory path."""
    safe_po = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in po_number) or "unassigned"
    return _resolve_base(storage_base) / "procurement_documents" / safe_po


def _path_within_base(candidate: Path, base: Path, log_value: object) -> Path:
    base_abs = os.path.abspath(os.fspath(base))
    candidate_abs = os.path.abspath(os.fspath(candidate))
    try:
        common_path = os.path.commonpath([base_abs, candidate_abs])
    except ValueError:
        common_path = ""
    if common_path != base_abs:
        logger.warning("Path traversal attempt blocked: %s", log_value)
        raise HTTPException(status_code=400, detail="Invalid file path.")
    return Path(candidate_abs)


def _stored_file_path(base: Path, directory: Path, stored_name: str) -> ValidatedStoragePath:
    """Return a validated storage destination before any filesystem mutation."""
    base_abs = Path(os.path.abspath(os.fspath(base)))
    absolute = _path_within_base(directory / stored_name, base_abs, stored_name)
    return ValidatedStoragePath(base=base_abs, absolute=absolute, relative=absolute.relative_to(base_abs))


def _stored_upload_name(filename: str | None) -> str:
    """Return a filesystem-only name that never embeds user-controlled path text."""
    suffix = Path(filename or "").suffix.lower()
    if suffix and (len(suffix) > 20 or not suffix.startswith(".") or not suffix[1:].isalnum()):
        suffix = ""
    return f"{uuid.uuid4().hex}{suffix}"


# ---------------------------------------------------------------------------
# Public API - delegates I/O to _backend
# ---------------------------------------------------------------------------


async def save_file(file: UploadFile, license_id: int, storage_base: Optional[str] = None) -> tuple[str, int]:
    """
    Persist *file* under <storage_base>/documents/{license_id}/{uuid}_{filename}.

    Returns
    -------
    stored_path : str
        Relative path (from storage_base) used to locate the file later.
    file_size : int
        Number of bytes written.
    """
    stored_name = _stored_upload_name(file.filename)
    base = _resolve_base(storage_base)
    dest = _stored_file_path(base, _license_dir(license_id, storage_base), stored_name)

    contents = await file.read()
    _backend.write(dest, contents)

    relative = dest.relative
    return str(relative), len(contents)


def save_file_bytes(
    content: bytes,
    filename: str,
    license_id: int,
    storage_base: Optional[str] = None,
) -> tuple[str, int]:
    """Write pre-read bytes to disk under documents/{license_id}/{uuid}_{filename}.

    Unlike save_file(), this accepts bytes directly so the disk write can be
    deferred until after a DB commit. Returns (relative_stored_path, byte_count).
    """
    stored_name = _stored_upload_name(filename)
    base = _resolve_base(storage_base)
    dest = _stored_file_path(base, _license_dir(license_id, storage_base), stored_name)

    _backend.write(dest, content)

    relative = dest.relative
    return str(relative), len(content)


async def save_contract_file(file: UploadFile, contract_id: int, storage_base: Optional[str] = None) -> tuple[str, int]:
    """
    Persist *file* under <storage_base>/contracts/{contract_id}/{uuid}_{filename}.

    Returns
    -------
    stored_path : str
        Relative path (from storage_base) used to locate the file later.
    file_size : int
        Number of bytes written.
    """
    stored_name = _stored_upload_name(file.filename)
    base = _resolve_base(storage_base)
    dest = _stored_file_path(base, _contract_dir(contract_id, storage_base), stored_name)

    contents = await file.read()
    _backend.write(dest, contents)

    relative = dest.relative
    return str(relative), len(contents)


async def save_sourcing_request_file(
    file: UploadFile,
    sourcing_request_id: int,
    storage_base: Optional[str] = None,
) -> tuple[str, int]:
    """Persist *file* under <storage_base>/sourcing_requests/{id}/{uuid}_{filename}."""
    stored_name = _stored_upload_name(file.filename)
    base = _resolve_base(storage_base)
    dest = _stored_file_path(base, _sourcing_request_dir(sourcing_request_id, storage_base), stored_name)

    contents = await file.read()
    _backend.write(dest, contents)

    relative = dest.relative
    return str(relative), len(contents)


async def save_procurement_document_file(
    file: UploadFile,
    po_number: str,
    storage_base: Optional[str] = None,
) -> tuple[str, int]:
    """Persist *file* under <storage_base>/procurement_documents/{po}/{uuid}_{filename}."""
    stored_name = _stored_upload_name(file.filename)
    base = _resolve_base(storage_base)
    dest = _stored_file_path(base, _procurement_document_dir(po_number, storage_base), stored_name)

    contents = await file.read()
    _backend.write(dest, contents)

    relative = dest.relative
    return str(relative), len(contents)


def save_procurement_document_bytes(
    content: bytes,
    filename: str,
    po_number: str,
    storage_base: Optional[str] = None,
) -> tuple[str, int]:
    """Write bytes under procurement_documents/{po}/{uuid}_{filename}."""
    stored_name = _stored_upload_name(filename)
    base = _resolve_base(storage_base)
    dest = _stored_file_path(base, _procurement_document_dir(po_number, storage_base), stored_name)

    _backend.write(dest, content)

    relative = dest.relative
    return str(relative), len(content)


def delete_file(stored_path: str, storage_base: Optional[str] = None) -> None:
    """Remove a file from disk; silently ignores missing files."""
    full_path = get_file_path(stored_path, storage_base)
    _backend.delete(full_path)


def get_file_path(stored_path: str, storage_base: Optional[str] = None) -> Path:
    """Return the absolute Path for a stored_path relative to storage_base."""
    base = _resolve_base(storage_base)
    return _path_within_base(base / stored_path, base, stored_path)


def get_file_availability(stored_path: str, storage_base: Optional[str] = None) -> DocumentFileAvailability:
    """Return present file availability without reading file contents."""
    try:
        base = _resolve_base(storage_base)
        if not base.is_dir():
            return "unavailable"
        file_path = _path_within_base(base / stored_path, base, stored_path)
        return "available" if _backend.exists(file_path) else "missing"
    except Exception:
        logger.warning("Document file availability check failed.", exc_info=True)
        return "unavailable"


def require_available_file(stored_path: str, storage_base: Optional[str] = None) -> Path:
    """Resolve a stored file for download and raise a clear error if unavailable."""
    base = _resolve_base(storage_base)
    if not base.is_dir():
        raise HTTPException(status_code=404, detail=UNAVAILABLE_STORAGE_DETAIL)
    file_path = _path_within_base(base / stored_path, base, stored_path)
    try:
        if _backend.exists(file_path):
            return file_path
    except Exception as exc:
        logger.warning("Document storage availability check failed for download.", exc_info=True)
        raise HTTPException(status_code=404, detail=UNAVAILABLE_STORAGE_DETAIL) from exc
    raise HTTPException(status_code=404, detail=MISSING_FILE_DETAIL)


def validate_upload(
    file: UploadFile,
    content: bytes,
    allowed_mimes: frozenset[str] | None = None,
) -> None:
    """
    Raise HTTP 422 if *file* exceeds the configured size limit, has a disallowed
    extension, or (when *allowed_mimes* is provided) an unacceptable MIME type.
    Call this before persisting any uploaded document.
    """

    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=422,
            detail=f"File exceeds the maximum allowed size of {settings.MAX_UPLOAD_SIZE_MB} MB.",
        )
    ext = Path(file.filename or "").suffix.lower()
    allowed_exts = frozenset(e.strip().lower() for e in settings.ALLOWED_UPLOAD_EXTENSIONS.split(",") if e.strip())
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=422,
            detail=(
                f"File extension '{ext or '(none)'}' is not allowed. Accepted types: {', '.join(sorted(allowed_exts))}"
            ),
        )
    if allowed_mimes is not None:
        filename = file.filename or ""
        mime_type = (file.content_type or "").split(";")[0].strip().lower()
        if not mime_type:
            mime_type = mimetypes.guess_type(filename)[0] or ""
        if mime_type and mime_type not in allowed_mimes:
            raise HTTPException(
                status_code=422,
                detail=f"MIME type '{mime_type}' is not permitted for upload.",
            )


async def resolve_storage_path(db: AsyncSession) -> str | None:
    """
    Resolve the active document storage path from DB settings.

    Returns the custom storage path string if one is configured and valid,
    or None to signal that the default settings.STORAGE_PATH should be used.
    Raises HTTP 503 if the configured path does not exist on disk.
    """
    gs_result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
    gs = gs_result.scalar_one_or_none()
    custom = (gs.storage_path if gs else "") or ""
    if custom:
        if not Path(custom).is_dir():
            raise HTTPException(status_code=503, detail="Document storage is not configured.")
        return custom
    if Path(settings.STORAGE_PATH).is_dir():
        return None
    raise HTTPException(status_code=503, detail="Document storage is not configured.")
