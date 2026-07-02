"""
File storage service — saves/retrieves/deletes documents on the local filesystem.

The StorageBackend ABC defines the interface; LocalStorageBackend is the default
filesystem implementation. The module-level ``_backend`` variable holds the active
instance and is used by all public helper functions.
"""

from __future__ import annotations

import mimetypes
import uuid
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, UploadFile

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.models.settings import GlobalSettings

logger = logging.getLogger("license_lifecycle.storage")


# ---------------------------------------------------------------------------
# StorageBackend interface
# ---------------------------------------------------------------------------

class StorageBackend(ABC):
    """Abstract file-storage interface.

    All paths passed to these methods are absolute Path objects that have
    already been validated against the storage root by the calling helper.
    """

    @abstractmethod
    def write(self, dest: Path, content: bytes) -> None:
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
# LocalStorageBackend — filesystem implementation
# ---------------------------------------------------------------------------

class LocalStorageBackend(StorageBackend):
    """Stores files on the local filesystem."""

    def write(self, dest: Path, content: bytes) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(content)
        logger.info("File written: %s (%d bytes)", dest.name, len(content))

    def read(self, source: Path) -> bytes:
        return source.read_bytes()

    def delete(self, path: Path) -> None:
        path.unlink(missing_ok=True)
        logger.info("File deleted: %s", path.name)

    def exists(self, path: Path) -> bool:
        return path.exists()


# Active backend — swap this to change the storage implementation globally.
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
    """Return (and create) the per-license storage directory."""
    directory = _resolve_base(storage_base) / "documents" / str(license_id)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _contract_dir(contract_id: int, storage_base: Optional[str] = None) -> Path:
    """Return (and create) the per-contract storage directory."""
    directory = _resolve_base(storage_base) / "contracts" / str(contract_id)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _sourcing_request_dir(sourcing_request_id: int, storage_base: Optional[str] = None) -> Path:
    """Return (and create) the per-sourcing-request storage directory."""
    directory = _resolve_base(storage_base) / "sourcing_requests" / str(sourcing_request_id)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _procurement_document_dir(po_number: str, storage_base: Optional[str] = None) -> Path:
    """Return (and create) the per-PO procurement document storage directory."""
    safe_po = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in po_number) or "unassigned"
    directory = _resolve_base(storage_base) / "procurement_documents" / safe_po
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _check_traversal(dest: Path, base: Path) -> None:
    if not dest.resolve().is_relative_to(base):
        logger.warning("Path traversal attempt blocked: %s", dest)
        raise HTTPException(status_code=400, detail="Invalid file path.")


# ---------------------------------------------------------------------------
# Public API — delegates I/O to _backend
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
    safe_filename = Path(file.filename).name if file.filename else "upload"
    stored_name = f"{uuid.uuid4().hex}_{safe_filename}"
    base = _resolve_base(storage_base)
    dest = _license_dir(license_id, storage_base) / stored_name

    _check_traversal(dest, base)

    contents = await file.read()
    _backend.write(dest, contents)

    relative = dest.relative_to(base)
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
    safe_filename = Path(filename).name if filename else "upload"
    stored_name = f"{uuid.uuid4().hex}_{safe_filename}"
    base = _resolve_base(storage_base)
    dest = _license_dir(license_id, storage_base) / stored_name

    _check_traversal(dest, base)

    _backend.write(dest, content)

    relative = dest.relative_to(base)
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
    safe_filename = Path(file.filename).name if file.filename else "upload"
    stored_name = f"{uuid.uuid4().hex}_{safe_filename}"
    base = _resolve_base(storage_base)
    dest = _contract_dir(contract_id, storage_base) / stored_name

    _check_traversal(dest, base)

    contents = await file.read()
    _backend.write(dest, contents)

    relative = dest.relative_to(base)
    return str(relative), len(contents)


async def save_sourcing_request_file(
    file: UploadFile,
    sourcing_request_id: int,
    storage_base: Optional[str] = None,
) -> tuple[str, int]:
    """Persist *file* under <storage_base>/sourcing_requests/{id}/{uuid}_{filename}."""
    safe_filename = Path(file.filename).name if file.filename else "upload"
    stored_name = f"{uuid.uuid4().hex}_{safe_filename}"
    base = _resolve_base(storage_base)
    dest = _sourcing_request_dir(sourcing_request_id, storage_base) / stored_name

    _check_traversal(dest, base)

    contents = await file.read()
    _backend.write(dest, contents)

    relative = dest.relative_to(base)
    return str(relative), len(contents)


async def save_procurement_document_file(
    file: UploadFile,
    po_number: str,
    storage_base: Optional[str] = None,
) -> tuple[str, int]:
    """Persist *file* under <storage_base>/procurement_documents/{po}/{uuid}_{filename}."""
    safe_filename = Path(file.filename).name if file.filename else "upload"
    stored_name = f"{uuid.uuid4().hex}_{safe_filename}"
    base = _resolve_base(storage_base)
    dest = _procurement_document_dir(po_number, storage_base) / stored_name

    _check_traversal(dest, base)

    contents = await file.read()
    _backend.write(dest, contents)

    relative = dest.relative_to(base)
    return str(relative), len(contents)


def save_procurement_document_bytes(
    content: bytes,
    filename: str,
    po_number: str,
    storage_base: Optional[str] = None,
) -> tuple[str, int]:
    """Write bytes under procurement_documents/{po}/{uuid}_{filename}."""
    safe_filename = Path(filename).name if filename else "upload"
    stored_name = f"{uuid.uuid4().hex}_{safe_filename}"
    base = _resolve_base(storage_base)
    dest = _procurement_document_dir(po_number, storage_base) / stored_name

    _check_traversal(dest, base)

    _backend.write(dest, content)

    relative = dest.relative_to(base)
    return str(relative), len(content)


def delete_file(stored_path: str, storage_base: Optional[str] = None) -> None:
    """Remove a file from disk; silently ignores missing files."""
    full_path = get_file_path(stored_path, storage_base)
    _backend.delete(full_path)


def get_file_path(stored_path: str, storage_base: Optional[str] = None) -> Path:
    """Return the absolute Path for a stored_path relative to storage_base."""
    base = _resolve_base(storage_base)
    resolved_path = base / stored_path
    if not resolved_path.resolve().is_relative_to(base.resolve()):
        logger.warning("Path traversal attempt blocked in get_file_path: %s", stored_path)
        raise HTTPException(status_code=400, detail="Invalid file path.")
    return resolved_path


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
    allowed_exts = frozenset(
        e.strip().lower()
        for e in settings.ALLOWED_UPLOAD_EXTENSIONS.split(",")
        if e.strip()
    )
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=422,
            detail=(
                f"File extension '{ext or '(none)'}' is not allowed. "
                f"Accepted types: {', '.join(sorted(allowed_exts))}"
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
