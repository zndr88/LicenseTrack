"""
Contract folder routes.

POST   /api/contracts/{contract_id}/folders
PUT    /api/contracts/{contract_id}/folders/{folder_id}
DELETE /api/contracts/{contract_id}/folders/{folder_id}
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.contract import Contract, ContractDocument, ContractFolder
from app.models.user import User
from app.schemas.contract import ContractFolderCreate, ContractFolderResponse, ContractFolderUpdate

router = APIRouter(tags=["contract-folders"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.post(
    "/api/contracts/{contract_id}/folders",
    response_model=ContractFolderResponse,
    status_code=201,
)
async def create_folder(
    contract_id: int,
    body: ContractFolderCreate,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> ContractFolderResponse:
    result = await db.execute(select(Contract).where(Contract.id == contract_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Contract not found")

    folder = ContractFolder(contract_id=contract_id, name=body.name)
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return ContractFolderResponse(
        id=folder.id,
        name=folder.name,
        created_at=folder.created_at,
        document_count=0,
    )


@router.put(
    "/api/contracts/{contract_id}/folders/{folder_id}",
    response_model=ContractFolderResponse,
)
async def update_folder(
    contract_id: int,
    folder_id: int,
    body: ContractFolderUpdate,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> ContractFolderResponse:
    result = await db.execute(
        select(ContractFolder).where(
            ContractFolder.id == folder_id,
            ContractFolder.contract_id == contract_id,
        )
    )
    folder = result.scalar_one_or_none()
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")

    folder.name = body.name
    await db.commit()
    await db.refresh(folder)

    doc_count_result = await db.execute(
        select(func.count(ContractDocument.id)).where(
            ContractDocument.folder_id == folder.id
        )
    )
    doc_count = doc_count_result.scalar_one() or 0

    return ContractFolderResponse(
        id=folder.id,
        name=folder.name,
        created_at=folder.created_at,
        document_count=doc_count,
    )


@router.delete(
    "/api/contracts/{contract_id}/folders/{folder_id}",
    status_code=204,
    response_class=Response,
)
async def delete_folder(
    contract_id: int,
    folder_id: int,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> Response:
    result = await db.execute(
        select(ContractFolder).where(
            ContractFolder.id == folder_id,
            ContractFolder.contract_id == contract_id,
        )
    )
    folder = result.scalar_one_or_none()
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")

    doc_count_result = await db.execute(
        select(func.count(ContractDocument.id)).where(
            ContractDocument.folder_id == folder_id
        )
    )
    doc_count = doc_count_result.scalar_one() or 0
    if doc_count > 0:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete a folder that contains documents. Remove all documents first.",
        )

    await db.delete(folder)
    await db.commit()
    return Response(status_code=204)
