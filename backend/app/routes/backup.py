"""
Backup and restore endpoints (admin only).

POST /api/backup/trigger   - create a backup immediately
POST /api/backup/restore   - upload a .zip and restore the database
POST /api/backup/restore-server - restore an allow-listed server archive
GET  /api/backup/list      - list available backup files
"""

import asyncio
import logging
import os
import signal
import tempfile
from pathlib import Path
from typing import Annotated

log = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

from app.config import settings
from app.database import AsyncSessionLocal, get_db
from app.dependencies import require_admin
from app.models.settings import GlobalSettings
from app.models.user import User
from app.services.audit_service import log_event
from app.services.backup_service import (
    create_document_restore_safety_archive,
    document_storage_reconciliation,
    inspect_backup_archive,
    list_server_backup_archives,
    resolve_server_backup_archive,
    restore_backup_archive,
)

router = APIRouter(prefix="/api/backup", tags=["backup"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


class ServerRestoreRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=500)


def _terminate_process_after_restore() -> None:
    """Terminate after the restore response has been sent to the client."""
    log.info("Restore response sent; sending SIGTERM so the process manager can restart the API.")
    os.kill(os.getpid(), signal.SIGTERM)


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
    from app.services.backup_service import run_routine_backup

    gs = await _get_global_settings(db)
    try:
        zip_path = await run_routine_backup(
            str(gs.backup_location),
            int(gs.backup_keep),
        )
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
    When configured, the process is sent SIGTERM after the response so the
    process manager restarts it.
    """
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
    if len(content) > _max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the maximum allowed size of {_settings.MAX_UPLOAD_SIZE_MB} MB.",
        )

    # Write to a temp file and restore
    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        return await _perform_restore(tmp_path, request, db, _admin)
    finally:
        tmp_path.unlink(missing_ok=True)


@router.post("/restore-server", status_code=200)
async def restore_server_backup(
    payload: ServerRestoreRequest,
    request: Request,
    db: DbSession,
    _admin: User = Depends(require_admin),
):
    """Restore an exact archive selected from the configured server backup directory."""
    gs = await _get_global_settings(db)
    try:
        archive_path = resolve_server_backup_archive(gs.backup_location, payload.filename)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Server backup archive was not found.")
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid server backup selection.")
    return await _perform_restore(archive_path, request, db, _admin)


async def _perform_restore(
    archive_path: Path,
    request: Request,
    db: AsyncSession,
    admin: User,
):
    try:
        archive_info = inspect_backup_archive(archive_path)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    gs = await _get_global_settings(db)
    storage_location = gs.storage_path or settings.STORAGE_PATH
    safety_archive = None
    if archive_info["includes_documents"]:
        from app.services.portfolio_reset_service import (
            portfolio_counts,
            portfolio_document_paths,
        )

        counts = await portfolio_counts(db)
        document_paths = await portfolio_document_paths(db)
        try:
            safety_archive = await asyncio.to_thread(
                create_document_restore_safety_archive,
                gs.backup_location,
                storage_location,
                counts,
                document_paths,
            )
        except Exception as exc:
            log.error("Pre-restore database-and-document archive failed: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail="Restore safety archive failed. Check server logs.")

    # Log before replacing the database. Use a separate session because the
    # request session and engine are closed immediately afterward.
    ip = request.client.host if request.client else None
    try:
        async with AsyncSessionLocal() as audit_db:
            await log_event(
                audit_db,
                "system.backup_restored",
                actor=admin,
                ip_address=ip,
                target_type="backup",
                target_label=archive_path.name,
                detail=f"archiveType={archive_info['archive_type']}",
            )
            await audit_db.commit()
    except Exception as exc:
        log.warning("Could not audit database restore before overwrite: %s", exc, exc_info=True)

    from app.database import engine as _engine

    await db.close()
    try:
        await _engine.dispose()
        restore_result = restore_backup_archive(
            archive_path,
            storage_location=storage_location,
            safety_archive=safety_archive,
        )
    except Exception as exc:
        log.error("Backup restore failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Restore failed. Check server logs.")

    warnings = []
    try:
        reconciliation = document_storage_reconciliation(storage_location)
    except Exception as exc:
        log.warning("Document storage reconciliation after restore failed: %s", exc, exc_info=True)
        reconciliation = {
            "document_records": 0,
            "available_files": 0,
            "missing_files": 0,
            "unavailable_files": 0,
        }
        warnings.append("Managed document storage reconciliation could not be completed.")
    if reconciliation["missing_files"] or reconciliation["unavailable_files"]:
        warnings.append(
            "Managed document storage does not currently contain every document file referenced by the restored database."
        )
    response_data = {
        "status": "restore_completed",
        "restart_scheduled": False,
        **restore_result,
        "document_storage": reconciliation,
        "warnings": warnings,
    }
    if not settings.RESTART_AFTER_RESTORE:
        log.info("Restore complete; RESTART_AFTER_RESTORE=false, keeping the API process running.")
        return response_data

    response_data.update(status="restore_initiated", restart_scheduled=True)
    # Signal the process manager only after the response body has been sent.
    return JSONResponse(
        response_data,
        background=BackgroundTask(_terminate_process_after_restore),
    )


@router.get("/list", status_code=200)
async def list_backups(
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> list[dict]:
    """List all backup zip files in the configured backup location (admin only)."""
    gs = await _get_global_settings(db)
    return list_server_backup_archives(gs.backup_location)[:25]
