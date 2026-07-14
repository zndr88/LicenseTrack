from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import CurrentUser, require_admin, require_editor_or_admin
from app.models.document import Document
from app.models.license import License
from app.models.user import User
from app.schemas.license import (
    BulkDeleteRequest,
    FieldUpdateRequest,
    LicenseCreate,
    LicenseLifecycleRepairRequest,
    LicenseResponse,
    LicenseUpdate,
)
from app.services.access_service import apply_department_filter, can_view_license, get_viewer_departments
from app.services.audit_service import diff_fields, format_audit_detail, log_event
from app.services.license_service import (
    compute_stats,
    generate_license_ref,
)
from app.services.license_response_service import (
    DEFAULT_NOTIFICATION_DAYS,
    get_custom_field_values_by_license_id,
    enrich_license_response,
    get_mandatory_fields,
    get_procurement_documents_by_scope,
)
from app.services.license_write_service import (
    apply_license_field_patch,
    apply_license_lifecycle_repair,
    apply_license_update,
    bulk_delete_license_records,
    create_license_record,
    delete_license_record,
)

router = APIRouter(prefix="/api/licenses", tags=["licenses"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


def _repair_diff(before: dict, after: dict, fields: set[str]) -> str | None:
    changes = []
    for field in sorted(fields):
        if before.get(field) != after.get(field):
            changes.append(f"{field}: {before.get(field)} -> {after.get(field)}")
    return "\n".join(changes) if changes else None


# ---------------------------------------------------------------------------
# CRUD routes
# ---------------------------------------------------------------------------


@router.get("/departments")
async def list_departments(db: DbSession, _current_user: CurrentUser) -> list[str]:
    """Return distinct non-null, non-empty cost_centre values sorted alphabetically."""
    result = await db.execute(
        select(License.cost_centre)
        .where(License.cost_centre.isnot(None))
        .where(License.cost_centre != "")
        .distinct()
        .order_by(License.cost_centre)
    )
    return [row[0] for row in result.all()]


@router.get("/stats")
async def get_stats(db: DbSession, _current_user: CurrentUser) -> dict:
    """Dashboard statistics derived from all licenses."""
    mandatory_fields = await get_mandatory_fields(db)

    departments = await get_viewer_departments(_current_user.id, db) if _current_user.role == "viewer" else None
    query = select(License).options(selectinload(License.documents))
    query = apply_department_filter(query, departments)
    result = await db.execute(query)
    all_licenses = list(result.scalars().all())
    procurement_documents_by_license_id = await get_procurement_documents_by_scope(db, all_licenses)

    documents_by_license_id: dict[int, list[Document]] = {}
    for lic in all_licenses:
        documents_by_license_id[lic.id] = [
            *list(lic.documents),
            *procurement_documents_by_license_id.get(lic.id, []),
        ]

    return compute_stats(all_licenses, documents_by_license_id, mandatory_fields, DEFAULT_NOTIFICATION_DAYS)


@router.get("", response_model=list[LicenseResponse])
async def list_licenses(
    db: DbSession,
    _current_user: CurrentUser,
    include_retired: bool = Query(default=False),
    parent_license_id: int | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1),
    offset: int = Query(default=0, ge=0),
) -> list[LicenseResponse]:
    mandatory_fields = await get_mandatory_fields(db)

    departments = await get_viewer_departments(_current_user.id, db) if _current_user.role == "viewer" else None

    query = select(License).options(selectinload(License.documents), selectinload(License.creator))
    if not include_retired:
        query = query.where(License.is_retired.is_(False))
    if parent_license_id is not None:
        query = query.where(License.parent_license_id == parent_license_id)
    query = apply_department_filter(query, departments)
    query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)

    result = await db.execute(query)
    licenses = list(result.scalars().all())
    procurement_documents_by_license_id = await get_procurement_documents_by_scope(db, licenses)
    custom_field_values_by_license_id = await get_custom_field_values_by_license_id(
        db,
        [lic.id for lic in licenses],
    )
    return [
        enrich_license_response(
            lic,
            mandatory_fields,
            procurement_documents=procurement_documents_by_license_id.get(lic.id, []),
            custom_field_values=custom_field_values_by_license_id.get(lic.id, []),
        )
        for lic in licenses
    ]


@router.get("/{license_id}", response_model=LicenseResponse)
async def get_license(license_id: int, db: DbSession, _current_user: CurrentUser) -> LicenseResponse:
    mandatory_fields = await get_mandatory_fields(db)

    result = await db.execute(
        select(License)
        .where(License.id == license_id)
        .options(selectinload(License.documents), selectinload(License.creator))
    )
    license_obj = result.scalar_one_or_none()
    if license_obj is None:
        raise HTTPException(status_code=404, detail="License not found")
    if not await can_view_license(_current_user, license_obj, db):
        raise HTTPException(status_code=404, detail="License not found")
    procurement_documents_by_license_id = await get_procurement_documents_by_scope(db, [license_obj])
    custom_field_values_by_license_id = await get_custom_field_values_by_license_id(db, [license_obj.id])
    return enrich_license_response(
        license_obj,
        mandatory_fields,
        procurement_documents=procurement_documents_by_license_id.get(license_obj.id, []),
        custom_field_values=custom_field_values_by_license_id.get(license_obj.id, []),
    )


@router.post("", response_model=LicenseResponse, status_code=201)
async def create_license(
    payload: LicenseCreate,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> LicenseResponse:
    mandatory_fields = await get_mandatory_fields(db)
    license_obj = await create_license_record(
        db,
        payload,
        created_by=current_user.id,
        generate_license_ref=generate_license_ref,
    )

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "license.created",
        actor=current_user,
        ip_address=ip,
        target_type="license",
        target_id=str(license_obj.id),
        target_label=license_obj.software_description,
    )
    await db.commit()

    result = await db.execute(
        select(License)
        .where(License.id == license_obj.id)
        .options(selectinload(License.documents), selectinload(License.creator))
    )
    license_obj = result.scalar_one()
    procurement_documents_by_license_id = await get_procurement_documents_by_scope(db, [license_obj])
    custom_field_values_by_license_id = await get_custom_field_values_by_license_id(db, [license_obj.id])
    return enrich_license_response(
        license_obj,
        mandatory_fields,
        procurement_documents=procurement_documents_by_license_id.get(license_obj.id, []),
        custom_field_values=custom_field_values_by_license_id.get(license_obj.id, []),
    )


@router.post("/{license_id}/repair-lifecycle", response_model=LicenseResponse)
async def repair_license_lifecycle(
    license_id: int,
    payload: LicenseLifecycleRepairRequest,
    request: Request,
    db: DbSession,
    _admin: User = Depends(require_admin),
) -> LicenseResponse:
    """Admin-only repair endpoint for lifecycle and renewal-chain fields."""
    mandatory_fields = await get_mandatory_fields(db)
    payload_data = payload.model_dump(by_alias=False, exclude_unset=True)
    reason = payload_data.pop("reason")
    update_data = payload_data
    license_obj, before, after = await apply_license_lifecycle_repair(db, license_id, update_data)

    diff = _repair_diff(before, after, set(update_data))
    if diff:
        detail = format_audit_detail(
            "lifecycle_repair",
            {
                "reason": reason,
                "targetLicenseId": str(license_id),
            },
            field_diffs=diff.splitlines(),
        )
        await log_event(
            db,
            "license.lifecycle_repaired",
            actor=_admin,
            ip_address=request.client.host if request.client else None,
            target_type="license",
            target_id=str(license_id),
            target_label=license_obj.software_description,
            detail=detail,
        )

    await db.commit()

    result = await db.execute(
        select(License)
        .where(License.id == license_id)
        .options(selectinload(License.documents), selectinload(License.creator))
    )
    license_obj = result.scalar_one()
    procurement_documents_by_license_id = await get_procurement_documents_by_scope(db, [license_obj])
    custom_field_values_by_license_id = await get_custom_field_values_by_license_id(db, [license_obj.id])
    return enrich_license_response(
        license_obj,
        mandatory_fields,
        procurement_documents=procurement_documents_by_license_id.get(license_obj.id, []),
        custom_field_values=custom_field_values_by_license_id.get(license_obj.id, []),
    )


@router.put("/{license_id}", response_model=LicenseResponse)
async def update_license(
    license_id: int,
    payload: LicenseUpdate,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> LicenseResponse:
    mandatory_fields = await get_mandatory_fields(db)
    license_obj, before, after = await apply_license_update(db, license_id, payload)

    diff = diff_fields(before, after)
    if diff:
        ip = request.client.host if request.client else None
        await log_event(
            db,
            "license.updated",
            actor=_editor,
            ip_address=ip,
            target_type="license",
            target_id=str(license_id),
            target_label=license_obj.software_description,
            detail=diff,
        )

    await db.commit()

    result = await db.execute(
        select(License)
        .where(License.id == license_id)
        .options(selectinload(License.documents), selectinload(License.creator))
    )
    license_obj = result.scalar_one()
    procurement_documents_by_license_id = await get_procurement_documents_by_scope(db, [license_obj])
    custom_field_values_by_license_id = await get_custom_field_values_by_license_id(db, [license_obj.id])
    return enrich_license_response(
        license_obj,
        mandatory_fields,
        procurement_documents=procurement_documents_by_license_id.get(license_obj.id, []),
        custom_field_values=custom_field_values_by_license_id.get(license_obj.id, []),
    )


@router.patch("/{license_id}/field", response_model=LicenseResponse)
async def patch_license_field(
    license_id: int,
    payload: FieldUpdateRequest,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> LicenseResponse:
    """Update a single named field on a license."""
    field = payload.field
    value = payload.value
    mandatory_fields = await get_mandatory_fields(db)
    license_obj = await apply_license_field_patch(db, license_id, field=field, value=value)

    await log_event(
        db,
        "license.field_updated",
        actor=_editor,
        ip_address=request.client.host if request.client else None,
        target_type="license",
        target_id=str(license_id),
        target_label=license_obj.software_description,
        detail=f"{field}: → {value}",
    )
    await db.commit()

    result = await db.execute(
        select(License)
        .where(License.id == license_id)
        .options(selectinload(License.documents), selectinload(License.creator))
    )
    license_obj = result.scalar_one()
    procurement_documents_by_license_id = await get_procurement_documents_by_scope(db, [license_obj])
    custom_field_values_by_license_id = await get_custom_field_values_by_license_id(db, [license_obj.id])
    return enrich_license_response(
        license_obj,
        mandatory_fields,
        procurement_documents=procurement_documents_by_license_id.get(license_obj.id, []),
        custom_field_values=custom_field_values_by_license_id.get(license_obj.id, []),
    )


@router.delete("/bulk", status_code=200)
async def bulk_delete_licenses(
    payload: BulkDeleteRequest,
    request: Request,
    db: DbSession,
    current_user: User = Depends(require_editor_or_admin),
) -> dict:
    """Delete multiple licenses by ID in a single transaction.

    Missing IDs are silently skipped - concurrent deletes should not cause failures.
    Returns { deleted: N } where N is the number of records actually deleted.
    """
    found_ids = await bulk_delete_license_records(db, payload.ids)
    if not found_ids:
        return {"deleted": 0}

    # Single audit log entry for the batch
    ip = request.client.host if request.client else None
    await log_event(
        db,
        "license.bulk_deleted",
        actor=current_user,
        ip_address=ip,
        target_type="license",
        detail=f"Bulk delete: {len(found_ids)} license(s) deleted. IDs: {found_ids}",
    )

    await db.commit()
    return {"deleted": len(found_ids)}


@router.delete("/{license_id}", status_code=204, response_class=Response)
async def delete_license(
    license_id: int,
    request: Request,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> Response:
    label = await delete_license_record(db, license_id)

    ip = request.client.host if request.client else None
    await log_event(
        db,
        "license.deleted",
        actor=_editor,
        ip_address=ip,
        target_type="license",
        target_id=str(license_id),
        target_label=label,
    )
    await db.commit()
    return Response(status_code=204)
