# backend/app/routes/import_mappings.py
"""
Mapping CRUD endpoints.

GET    /api/import/mappings           — list all saved mappings
POST   /api/import/mappings           — create a new mapping
PUT    /api/import/mappings/{id}      — update a mapping
DELETE /api/import/mappings/{id}      — delete a mapping

All endpoints are restricted to admin role.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import asc
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_admin
from app.models.import_mapping import ImportMapping
from app.models.user import User
from app.schemas.csv_import import ImportMappingCreate, ImportMappingResponse

router = APIRouter(prefix="/api/import", tags=["import"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@router.get("/mappings", response_model=list[ImportMappingResponse])
async def list_mappings(
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> list[ImportMappingResponse]:
    """Return all saved import mappings ordered by name."""
    result = await db.execute(sa_select(ImportMapping).order_by(asc(ImportMapping.name)))
    return result.scalars().all()


@router.post("/mappings", response_model=ImportMappingResponse, status_code=status.HTTP_201_CREATED)
async def create_mapping(
    db: DbSession,
    body: ImportMappingCreate,
    _admin: User = Depends(require_admin),
) -> ImportMappingResponse:
    """Create a new named import mapping."""
    existing = await db.execute(
        sa_select(ImportMapping).where(ImportMapping.name == body.name)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A mapping named {body.name!r} already exists",
        )
    mapping_data = [{"raw_header": e.raw_header, "target": e.target} for e in body.mapping]
    row = ImportMapping(name=body.name, mapping=mapping_data)
    db.add(row)
    await db.flush()
    await db.refresh(row)
    await db.commit()
    return row


@router.put("/mappings/{mapping_id}", response_model=ImportMappingResponse)
async def update_mapping(
    mapping_id: int,
    db: DbSession,
    body: ImportMappingCreate,
    _admin: User = Depends(require_admin),
) -> ImportMappingResponse:
    """Update an existing import mapping."""
    result = await db.execute(
        sa_select(ImportMapping).where(ImportMapping.id == mapping_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mapping not found")

    if body.name != row.name:
        conflict = await db.execute(
            sa_select(ImportMapping).where(ImportMapping.name == body.name)
        )
        if conflict.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A mapping named {body.name!r} already exists",
            )

    row.name = body.name
    row.mapping = [{"raw_header": e.raw_header, "target": e.target} for e in body.mapping]
    row.updated_at = _utc_now()
    await db.flush()
    await db.refresh(row)
    await db.commit()
    return row


@router.delete(
    "/mappings/{mapping_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_mapping(
    mapping_id: int,
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> Response:
    """Delete an import mapping."""
    result = await db.execute(
        sa_select(ImportMapping).where(ImportMapping.id == mapping_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mapping not found")
    await db.delete(row)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
