"""
Backup and restore endpoints (admin only).

POST /api/backup/trigger   — create a backup immediately
POST /api/backup/restore   — upload a .zip and restore the database
GET  /api/backup/list      — list available backup files
"""

import logging
import os
import signal
import tempfile
from pathlib import Path
from typing import Annotated

log = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal, get_db
from app.dependencies import require_admin
from app.models.settings import GlobalSettings
from app.models.user import User
from app.services.audit_service import log_event

router = APIRouter(prefix="/api/backup", tags=["backup"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def _get_global_settings(db: AsyncSession) -> GlobalSettings:
    result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
    gs = result.scalar_one_or_none()
    if gs is None:
        gs = GlobalSettings(id=1)
        db.add(gs)
        await db.commit()
        await db.refresh(gs)
    return gs


@router.post("/trigger", status_code=200)
async def trigger_backup(
    request: Request,
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> dict:
    """Immediately create a backup using current GlobalSettings (admin only)."""
    from app.services.backup_service import create_backup, prune_backups

    gs = await _get_global_settings(db)
    try:
        zip_path = create_backup(gs.backup_location)
        prune_backups(gs.backup_location, gs.backup_keep)
    except Exception as exc:
        log.error("Backup creation failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Backup failed. Check server logs.")

    ip = request.client.host if request.client else None
    await log_event(db, "system.backup_created", actor=_admin, ip_address=ip)
    await db.commit()

    return {"filename": zip_path.name}


@router.post("/restore", status_code=200)
async def restore_backup(
    file: UploadFile,
    request: Request,
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> dict:
    """
    Upload a backup .zip and restore the database (admin only).
    A safety snapshot of the current database is created before overwriting.
    After restore, the process is sent SIGTERM so the process manager restarts it.
    """
    import zipfile as zipmod
    from app.services.backup_service import restore_backup as do_restore

    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=422, detail="File must be a .zip archive.")

    # F10: reject oversized uploads before buffering the full body.
    from app.config import settings as _settings
    _max_bytes = _settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    _cl = request.headers.get("content-length")
    try:
        _cl_int = int(_cl) if _cl is not None else 0
    except ValueError:
        _cl_int = 0
    if _cl_int > _max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the maximum allowed size of {_settings.MAX_UPLOAD_SIZE_MB} MB.",
        )

    content = await file.read()

    # Validate the zip contains a .db file before touching anything
    try:
        import io
        with zipmod.ZipFile(io.BytesIO(content), "r") as zf:
            db_files = [n for n in zf.namelist() if n.endswith(".db")]
        if not db_files:
            raise HTTPException(status_code=422, detail="No .db file found inside the backup zip.")
    except zipmod.BadZipFile:
        raise HTTPException(status_code=422, detail="Uploaded file is not a valid zip archive.")

    # Write to a temp file and restore
    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    # Log the restore event BEFORE overwriting the database file.
    # Use a separate session so the audit row is committed independently
    # (do_restore replaces the DB file on disk, so the main session is unusable afterwards).
    ip = request.client.host if request.client else None
    try:
        async with AsyncSessionLocal() as audit_db:
            await log_event(audit_db, "system.backup_restored", actor=_admin, ip_address=ip)
            await audit_db.commit()
    except Exception:
        pass  # Never let audit failures block a restore

    from app.database import engine as _engine
    await db.close()
    try:
        await _engine.dispose()
        do_restore(tmp_path)
    except Exception as exc:
        log.error("Backup restore failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Restore failed. Check server logs.")
    finally:
        tmp_path.unlink(missing_ok=True)

    # Signal the process manager to restart the process
    os.kill(os.getpid(), signal.SIGTERM)

    return {"status": "restore_initiated"}


@router.get("/list", status_code=200)
async def list_backups(
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> list[dict]:
    """List all backup zip files in the configured backup location (admin only)."""
    gs = await _get_global_settings(db)
    backup_dir = Path(gs.backup_location).resolve()

    if not backup_dir.exists():
        return []

    backups = sorted(
        backup_dir.glob("license_lifecycle_backup_*.zip"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )

    return [
        {
            "filename": p.name,
            "size_bytes": p.stat().st_size,
            "created_at": p.stat().st_mtime,
        }
        for p in backups[:10]
    ]
