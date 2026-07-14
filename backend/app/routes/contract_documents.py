"""
Contract document routes.

POST   /api/contracts/{contract_id}/documents
POST   /api/contracts/{contract_id}/folders/{folder_id}/documents
GET    /api/contracts/{contract_id}/documents
GET    /api/contracts/{contract_id}/documents/{doc_id}/download
DELETE /api/contracts/{contract_id}/documents/{doc_id}
"""

from __future__ import annotations

import mimetypes
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
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
from app.services.contract_storage_service import (
    get_storage_base,
    require_storage_base,
    validate_contract_upload,
)

router = APIRouter(tags=["contract-documents"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.post(
    "/api/contracts/{contract_id}/documents",
    response_model=ContractDocumentResponse,
    status_code=201,
)
async def upload_contract_document(
    contract_id: int,
    db: DbSession,
    file: UploadFile,
    current_user: User = Depends(require_editor_or_admin),
) -> ContractDocumentResponse:
    result = await db.execute(select(Contract).where(Contract.id == contract_id))
    contract = result.scalar_one_or_none()
    if contract is None:
        raise HTTPException(status_code=404, detail="Contract not found")

    content = await file.read()
    validate_contract_upload(file, content)
    await file.seek(0)

    storage_base = await require_storage_base(db)
    stored_path, file_size = await storage.save_contract_file(file, contract_id, storage_base)

    original_filename = file.filename or "upload"
    doc = ContractDocument(
        contract_id=contract_id,
        folder_id=None,
        filename=stored_path,
        original_filename=original_filename,
        file_size=file_size,
        created_by=current_user.id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return ContractDocumentResponse.model_validate(doc)


@router.post(
    "/api/contracts/{contract_id}/folders/{folder_id}/documents",
    response_model=ContractDocumentResponse,
    status_code=201,
)
async def upload_contract_folder_document(
    contract_id: int,
    folder_id: int,
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
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return ContractDocumentResponse.model_validate(doc)


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
    return [ContractDocumentResponse.model_validate(doc) for doc in docs]


@router.get("/api/contracts/{contract_id}/documents/{doc_id}/download")
async def download_contract_document(
    contract_id: int,
    doc_id: int,
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
    file_path = storage.get_file_path(doc.filename, storage_base)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

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
    await db.delete(doc)
    await db.commit()

    storage_base = await get_storage_base(db)
    try:
        storage.delete_file(stored_path, storage_base)
    except Exception:
        pass

    return Response(status_code=204)
