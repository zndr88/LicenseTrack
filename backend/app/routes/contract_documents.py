"""
Contract document routes.

POST   /api/contracts/{contract_id}/documents
POST   /api/contracts/{contract_id}/folders/{folder_id}/documents
GET    /api/contracts/{contract_id}/documents
GET    /api/contracts/{contract_id}/documents/{doc_id}/download
DELETE /api/contracts/{contract_id}/documents/{doc_id}
"""

from __future__ import annotations

import logging
import mimetypes
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, require_editor_or_admin
from app.models.contract import Contract, ContractDocument, ContractFolder
from app.models.user import User
from app.schemas.contract import ContractDocumentResponse
from app.services import storage
from app.services.access_service import can_download_documents, can_view_contract
from app.services.audit_contracts import format_document_amendment_detail
from app.services.audit_service import log_event
from app.services.contract_storage_service import (
    get_storage_base,
    require_storage_base,
    validate_contract_upload,
)
from app.services.document_availability_service import get_document_storage_base, with_file_availability

router = APIRouter(tags=["contract-documents"])
logger = logging.getLogger(__name__)

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def _save_contract_document(
    *,
    contract_id: int,
    folder_id: int | None,
    db: AsyncSession,
    file: UploadFile,
    request: Request,
    current_user: User,
) -> ContractDocumentResponse:
    content = await file.read()
    validate_contract_upload(file, content)
    await file.seek(0)

    storage_base = await require_storage_base(db)
    stored_path, file_size = await storage.save_contract_file(file, contract_id, storage_base)
    original_filename = file.filename or "upload"
    doc = ContractDocument(
        contract_id=contract_id,
        folder_id=folder_id,
        filename=stored_path,
        original_filename=original_filename,
        file_size=file_size,
        created_by=current_user.id,
    )
    try:
        db.add(doc)
        await db.flush()
        await log_event(
            db,
            "contract_document.uploaded",
            actor=current_user,
            ip_address=request.client.host if request.client else None,
            target_type="contract_document",
            target_id=str(doc.id),
            target_label=original_filename,
            detail=format_document_amendment_detail(
                operation="upload",
                post_conversion=False,
                document_category="contract",
                document_scope="contract",
                document_id=doc.id,
                filename=original_filename,
                contract_id=contract_id,
                folder_id=folder_id,
                actor_email=current_user.email,
            ),
        )
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            storage.delete_file(stored_path, storage_base)
        except Exception:
            logger.warning("Could not clean up failed contract document upload %s", stored_path, exc_info=True)
        raise

    await db.refresh(doc)
    response = ContractDocumentResponse.model_validate(doc)
    return with_file_availability(response, doc, storage_base)


@router.post(
    "/api/contracts/{contract_id}/documents",
    response_model=ContractDocumentResponse,
    status_code=201,
)
async def upload_contract_document(
    contract_id: int,
    request: Request,
    db: DbSession,
    file: UploadFile,
    current_user: User = Depends(require_editor_or_admin),
) -> ContractDocumentResponse:
    result = await db.execute(select(Contract).where(Contract.id == contract_id))
    contract = result.scalar_one_or_none()
    if contract is None:
        raise HTTPException(status_code=404, detail="Contract not found")
    return await _save_contract_document(
        contract_id=contract_id,
        folder_id=None,
        db=db,
        file=file,
        request=request,
        current_user=current_user,
    )


@router.post(
    "/api/contracts/{contract_id}/folders/{folder_id}/documents",
    response_model=ContractDocumentResponse,
    status_code=201,
)
async def upload_contract_folder_document(
    contract_id: int,
    folder_id: int,
    request: Request,
    db: DbSession,
    file: UploadFile,
    current_user: User = Depends(require_editor_or_admin),
) -> ContractDocumentResponse:
    folder_result = await db.execute(
        select(ContractFolder).where(
            ContractFolder.id == folder_id,
            ContractFolder.contract_id == contract_id,
        )
    )
    if folder_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    return await _save_contract_document(
        contract_id=contract_id,
        folder_id=folder_id,
        db=db,
        file=file,
        request=request,
        current_user=current_user,
    )


@router.get(
    "/api/contracts/{contract_id}/documents",
    response_model=list[ContractDocumentResponse],
)
async def list_contract_documents(
    contract_id: int,
    db: DbSession,
    _current_user: CurrentUser,
) -> list[ContractDocumentResponse]:
    result = await db.execute(select(Contract).where(Contract.id == contract_id))
    contract = result.scalar_one_or_none()
    if contract is None:
        raise HTTPException(status_code=404, detail="Contract not found")
    if not await can_view_contract(_current_user, contract, db):
        raise HTTPException(status_code=404, detail="Contract not found")

    docs_result = await db.execute(
        select(ContractDocument)
        .where(ContractDocument.contract_id == contract_id)
        .order_by(ContractDocument.created_at.asc())
    )
    docs = docs_result.scalars().all()
    storage_base = await get_document_storage_base(db)
    return [
        with_file_availability(ContractDocumentResponse.model_validate(doc), doc, storage_base)
        for doc in docs
    ]


@router.get("/api/contracts/{contract_id}/documents/{doc_id}/download")
async def download_contract_document(
    contract_id: int,
    doc_id: int,
    request: Request,
    db: DbSession,
    _current_user: CurrentUser,
) -> FileResponse:
    result = await db.execute(
        select(ContractDocument).where(
            ContractDocument.id == doc_id,
            ContractDocument.contract_id == contract_id,
        )
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    contract_result = await db.execute(select(Contract).where(Contract.id == contract_id))
    contract = contract_result.scalar_one_or_none()
    if contract is None or not await can_view_contract(_current_user, contract, db):
        raise HTTPException(status_code=404, detail="Document not found")
    if not can_download_documents(_current_user):
        raise HTTPException(status_code=403, detail="Downloads are disabled for this viewer")

    storage_base = await get_storage_base(db)
    file_path = storage.require_available_file(doc.filename, storage_base)
    await log_event(
        db,
        "contract_document.downloaded",
        actor=_current_user,
        ip_address=request.client.host if request.client else None,
        target_type="contract_document",
        target_id=str(doc.id),
        target_label=doc.original_filename,
        detail=f"contractId={contract_id}\noutcome=success",
    )
    await db.commit()

    media_type = mimetypes.guess_type(doc.original_filename)[0] or "application/octet-stream"
    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        filename=doc.original_filename,
    )


@router.delete(
    "/api/contracts/{contract_id}/documents/{doc_id}",
    status_code=204,
    response_class=Response,
)
async def delete_contract_document(
    contract_id: int,
    doc_id: int,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> Response:
    result = await db.execute(
        select(ContractDocument).where(
            ContractDocument.id == doc_id,
            ContractDocument.contract_id == contract_id,
        )
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    stored_path = doc.filename
    original_filename = doc.original_filename
    folder_id = doc.folder_id
    storage_base = await get_storage_base(db)
    await db.delete(doc)
    await log_event(
        db,
        "contract_document.deleted",
        actor=_editor,
        ip_address=request.client.host if request.client else None,
        target_type="contract_document",
        target_id=str(doc_id),
        target_label=original_filename,
        detail=format_document_amendment_detail(
            operation="delete",
            post_conversion=False,
            document_category="contract",
            document_scope="contract",
            document_id=doc_id,
            filename=original_filename,
            contract_id=contract_id,
            folder_id=folder_id,
            actor_email=_editor.email,
        ),
    )
    await db.commit()

    try:
        storage.delete_file(stored_path, storage_base)
    except Exception:
        logger.warning("Could not delete stored contract document file %s", stored_path, exc_info=True)

    return Response(status_code=204)
