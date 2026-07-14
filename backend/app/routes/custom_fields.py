"""
Custom fields routes.

Definitions router:
GET    /api/custom-fields          - list all definitions (authenticated)
POST   /api/custom-fields          - create definition (admin only, 201)
GET    /api/custom-fields/{id}     - get single definition (authenticated)
PATCH  /api/custom-fields/{id}     - update definition (admin only)
DELETE /api/custom-fields/{id}     - delete definition + cascade values (admin only)

Values router (any authenticated user):
GET    /api/licenses/{license_id}/custom-fields   - get all values for license
PUT    /api/licenses/{license_id}/custom-fields   - upsert values (partial)
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, require_admin, require_editor_or_admin
from app.models.license import License
from app.models.user import User
from app.schemas.custom_fields import (
    CustomFieldDefinitionCreate,
    CustomFieldDefinitionResponse,
    CustomFieldDefinitionUpdate,
    CustomFieldDeleteResponse,
    CustomFieldValuesResponse,
    CustomFieldValuesUpsert,
)
from app.services import custom_fields_service
from app.services.access_service import can_view_license, get_user_departments_for_scope
from app.services.audit_service import log_event

# ---------------------------------------------------------------------------
# Definitions router
# ---------------------------------------------------------------------------

definitions_router = APIRouter(
    prefix="/api/custom-fields",
    tags=["custom-fields"],
)

DbSession = Annotated[AsyncSession, Depends(get_db)]


@definitions_router.get("/", response_model=list[CustomFieldDefinitionResponse])
async def list_definitions(db: DbSession, _current_user: CurrentUser):
    return await custom_fields_service.get_all_definitions(db)


@definitions_router.post("/", response_model=CustomFieldDefinitionResponse, status_code=status.HTTP_201_CREATED)
async def create_definition(
    data: CustomFieldDefinitionCreate,
    request: Request,
    db: DbSession,
    _admin: User = Depends(require_admin),
):
    result = await custom_fields_service.create_definition(db, data)
    ip = request.client.host if request.client else None
    await log_event(
        db,
        "custom_field.created",
        actor=_admin,
        ip_address=ip,
        target_type="custom_field",
        target_id=str(result.id),
        target_label=result.name,
        detail=f"name={result.name}, type={result.field_type}",
    )
    await db.commit()
    return result


@definitions_router.get("/{def_id}", response_model=CustomFieldDefinitionResponse)
async def get_definition(def_id: int, db: DbSession, _current_user: CurrentUser):
    definition = await custom_fields_service.get_definition_by_id(db, def_id)
    if definition is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail=f"Custom field definition {def_id} not found.")
    return definition


@definitions_router.patch("/{def_id}", response_model=CustomFieldDefinitionResponse)
async def update_definition(
    def_id: int,
    data: CustomFieldDefinitionUpdate,
    request: Request,
    db: DbSession,
    _admin: User = Depends(require_admin),
):
    result = await custom_fields_service.update_definition(db, def_id, data)
    ip = request.client.host if request.client else None
    await log_event(
        db,
        "custom_field.updated",
        actor=_admin,
        ip_address=ip,
        target_type="custom_field",
        target_id=str(def_id),
        target_label=result.name,
    )
    await db.commit()
    return result


@definitions_router.delete("/{def_id}", response_model=CustomFieldDeleteResponse)
async def delete_definition(
    def_id: int,
    request: Request,
    db: DbSession,
    _admin: User = Depends(require_admin),
):
    definition = await custom_fields_service.get_definition_by_id(db, def_id)
    if definition is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail=f"Custom field definition {def_id} not found.")
    field_name = definition.name
    result = await custom_fields_service.delete_definition(db, def_id)
    ip = request.client.host if request.client else None
    await log_event(
        db,
        "custom_field.deleted",
        actor=_admin,
        ip_address=ip,
        target_type="custom_field",
        target_id=str(def_id),
        target_label=field_name,
        detail=f"cascaded to {result.get('affected_licenses', 0)} license(s)",
    )
    await db.commit()
    return CustomFieldDeleteResponse(
        affected_licenses=result.get("affected_licenses", 0),
        field_name=field_name,
    )


# ---------------------------------------------------------------------------
# Bulk values router - any authenticated user
# ---------------------------------------------------------------------------

bulk_router = APIRouter(
    prefix="/api/custom-fields",
    tags=["custom-fields"],
)


@bulk_router.get("/values", response_model=CustomFieldValuesResponse)
async def get_all_custom_field_values(current_user: CurrentUser, db: DbSession):
    """
    Return visible license_custom_values rows.
    Used by the frontend to populate the license table in one request.
    The table is always small (sparse: only rows where a value was set).
    """
    departments = await get_user_departments_for_scope(current_user, db)
    values = await custom_fields_service.get_all_values(db, departments)
    return CustomFieldValuesResponse(values=values)


# ---------------------------------------------------------------------------
# Values router - any authenticated user
# ---------------------------------------------------------------------------

values_router = APIRouter(
    prefix="/api/licenses/{license_id}/custom-fields",
    tags=["custom-fields"],
)


@values_router.get("/", response_model=CustomFieldValuesResponse)
async def get_values(license_id: int, current_user: CurrentUser, db: DbSession):
    license_obj = await db.scalar(select(License).where(License.id == license_id))
    if license_obj is None or not await can_view_license(current_user, license_obj, db):
        raise HTTPException(status_code=404, detail="License not found")
    values = await custom_fields_service.get_values_for_license(db, license_id)
    return CustomFieldValuesResponse(values=values)


@values_router.put("/", response_model=CustomFieldValuesResponse)
async def upsert_values(
    license_id: int,
    data: CustomFieldValuesUpsert,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
):
    license_obj = await db.scalar(select(License).where(License.id == license_id))
    if license_obj is None:
        raise HTTPException(status_code=404, detail="License not found")
    values = await custom_fields_service.upsert_values_for_license(db, license_id, data)
    await db.commit()
    return CustomFieldValuesResponse(values=values)
