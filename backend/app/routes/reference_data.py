from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_admin, require_editor_or_admin
from app.models.reference_data import CostCentre, CostCentreAlias, Organization, OrganizationAlias
from app.models.user import User
from app.schemas.reference_data import (
    CostCentreAliasCreate,
    CostCentreCreate,
    CostCentreLookupResponse,
    CostCentreResponse,
    CostCentreUpdate,
    MergePreviewResponse,
    MergeRequest,
    MergeResponse,
    OrganizationAliasCreate,
    OrganizationCreate,
    OrganizationLookupResponse,
    OrganizationResponse,
    OrganizationUpdate,
)
from app.services import reference_data_service as service
from app.services.audit_service import format_audit_detail, log_event

router = APIRouter(prefix="/api/reference-data", tags=["reference-data"])
DbSession = Annotated[AsyncSession, Depends(get_db)]


def _organization_response(view: dict) -> OrganizationResponse:
    organization: Organization = view["organization"]
    return OrganizationResponse(
        id=organization.id,
        name=organization.name,
        normalized_name=organization.normalized_name,
        is_publisher=organization.is_publisher,
        is_supplier=organization.is_supplier,
        is_active=organization.is_active,
        aliases=organization.aliases,
        usage=view["usage"],
        created_at=organization.created_at,
        updated_at=organization.updated_at,
    )


def _cost_centre_response(view: dict) -> CostCentreResponse:
    cost_centre: CostCentre = view["cost_centre"]
    return CostCentreResponse(
        id=cost_centre.id,
        name=cost_centre.name,
        normalized_name=cost_centre.normalized_name,
        is_active=cost_centre.is_active,
        aliases=cost_centre.aliases,
        usage=view["usage"],
        created_at=cost_centre.created_at,
        updated_at=cost_centre.updated_at,
    )


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.get("/organizations", response_model=list[OrganizationResponse])
async def list_organizations(
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
    search: str | None = None,
    role: str | None = None,
    active: bool | None = None,
) -> list[OrganizationResponse]:
    views = await service.list_organizations(db, search=search, role=role, active=active)
    return [_organization_response(view) for view in views]


@router.get("/organizations/search", response_model=list[OrganizationLookupResponse])
async def search_organizations(
    db: DbSession,
    search: str,
    _editor: User = Depends(require_editor_or_admin),
    role: str | None = None,
    active: bool | None = None,
    limit: int = 25,
) -> list[OrganizationLookupResponse]:
    views = await service.search_reference_data(
        db,
        organization=True,
        search=search,
        role=role,
        active=active,
        limit=limit,
    )
    return [OrganizationLookupResponse.model_validate(view["organization"]) for view in views]


@router.get("/organizations/{organization_id}", response_model=OrganizationResponse)
async def get_organization(
    organization_id: int,
    db: DbSession,
    _editor: User = Depends(require_editor_or_admin),
) -> OrganizationResponse:
    return _organization_response(await service.get_organization(db, organization_id))


@router.post("/organizations", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
async def create_organization(
    data: OrganizationCreate,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> OrganizationResponse:
    organization = await service.create_organization(db, data)
    await log_event(
        db,
        "reference.organization_created",
        actor=admin,
        ip_address=_ip(request),
        target_type="organization",
        target_id=str(organization.id),
        target_label=organization.name,
        detail=format_audit_detail(
            "organization_create",
            {"name": organization.name, "isPublisher": str(organization.is_publisher), "isSupplier": str(organization.is_supplier)},
        ),
    )
    await db.commit()
    return _organization_response(await service.get_organization(db, organization.id))


@router.patch("/organizations/{organization_id}", response_model=OrganizationResponse)
async def update_organization(
    organization_id: int,
    data: OrganizationUpdate,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> OrganizationResponse:
    before = await service.get_organization(db, organization_id)
    before_name = before["organization"].name
    before_is_publisher = before["organization"].is_publisher
    before_is_supplier = before["organization"].is_supplier
    organization = await service.update_organization(db, organization_id, data)
    after = await service.get_organization(db, organization_id)
    await log_event(
        db,
        "reference.organization_updated",
        actor=admin,
        ip_address=_ip(request),
        target_type="organization",
        target_id=str(organization.id),
        target_label=organization.name,
        detail=format_audit_detail(
            "organization_update",
            {"beforeName": before_name, "afterName": organization.name, "beforeRoles": f"publisher={before_is_publisher},supplier={before_is_supplier}", "afterRoles": f"publisher={organization.is_publisher},supplier={organization.is_supplier}"},
            field_diffs=[f"affected: {after['usage']['total']} linked record(s)"],
        ),
    )
    await db.commit()
    return _organization_response(after)


@router.post("/organizations/{organization_id}/aliases", response_model=OrganizationResponse)
async def add_organization_alias(
    organization_id: int,
    data: OrganizationAliasCreate,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> OrganizationResponse:
    alias = await service.add_organization_alias(db, organization_id, data)
    view = await service.get_organization(db, organization_id)
    await log_event(
        db,
        "reference.organization_alias_added",
        actor=admin,
        ip_address=_ip(request),
        target_type="organization",
        target_id=str(organization_id),
        target_label=view["organization"].name,
        detail=format_audit_detail("organization_alias_add", {"alias": alias.name, "canonicalName": view["organization"].name}),
    )
    await db.commit()
    return _organization_response(view)


@router.delete("/organizations/{organization_id}/aliases/{alias_id}", response_class=Response, status_code=204)
async def delete_organization_alias(
    organization_id: int,
    alias_id: int,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> Response:
    alias = await db.get(OrganizationAlias, alias_id)
    if alias is None or alias.organization_id != organization_id:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Alias not found")
    alias_name = alias.name
    await service.delete_alias(db, alias_id, organization=True)
    await log_event(db, "reference.organization_alias_removed", actor=admin, ip_address=_ip(request), target_type="organization", target_id=str(organization_id), detail=f"alias={alias_name}")
    await db.commit()
    return Response(status_code=204)


@router.post("/organizations/{organization_id}/activate", response_model=OrganizationResponse)
async def activate_organization(organization_id: int, request: Request, db: DbSession, admin: User = Depends(require_admin)) -> OrganizationResponse:
    organization = await service.set_active(db, organization_id, organization=True, active=True)
    await log_event(db, "reference.organization_activated", actor=admin, ip_address=_ip(request), target_type="organization", target_id=str(organization.id), target_label=organization.name)
    await db.commit()
    return _organization_response(await service.get_organization(db, organization.id))


@router.post("/organizations/{organization_id}/deactivate", response_model=OrganizationResponse)
async def deactivate_organization(organization_id: int, request: Request, db: DbSession, admin: User = Depends(require_admin)) -> OrganizationResponse:
    organization = await service.set_active(db, organization_id, organization=True, active=False)
    await log_event(db, "reference.organization_deactivated", actor=admin, ip_address=_ip(request), target_type="organization", target_id=str(organization.id), target_label=organization.name)
    await db.commit()
    return _organization_response(await service.get_organization(db, organization.id))


@router.get("/organizations/{organization_id}/merge-preview", response_model=MergePreviewResponse)
async def organization_merge_preview(organization_id: int, target_id: int, db: DbSession, _editor: User = Depends(require_editor_or_admin)) -> dict:
    return await service.organization_merge_preview(db, organization_id, target_id)


@router.post("/organizations/{organization_id}/merge", response_model=MergeResponse)
async def merge_organization(
    organization_id: int,
    data: MergeRequest,
    request: Request,
    db: DbSession,
    admin: User = Depends(require_admin),
) -> MergeResponse:
    result = await service.merge_organizations(db, data, organization_id)
    source = result["source"]
    target = result["target"]
    await log_event(db, "reference.organization_merged", actor=admin, ip_address=_ip(request), target_type="organization", target_id=str(target.id), target_label=target.name, detail=format_audit_detail("organization_merge", {"sourceId": str(organization_id), "sourceName": source.name, "targetId": str(target.id), "targetName": target.name, "roles": f"publisher={target.is_publisher},supplier={target.is_supplier}", "affected": str(result["affected"])}))
    await db.commit()
    return MergeResponse(source_id=organization_id, target_id=target.id, target_name=target.name, affected=result["affected"])


@router.delete("/organizations/{organization_id}", response_class=Response, status_code=204)
async def delete_organization(organization_id: int, request: Request, db: DbSession, admin: User = Depends(require_admin)) -> Response:
    organization = await db.get(Organization, organization_id)
    await service.delete_organization(db, organization_id)
    await log_event(db, "reference.organization_deleted", actor=admin, ip_address=_ip(request), target_type="organization", target_id=str(organization_id), target_label=organization.name if organization else None)
    await db.commit()
    return Response(status_code=204)


@router.get("/cost-centres", response_model=list[CostCentreResponse])
async def list_cost_centres(db: DbSession, _editor: User = Depends(require_editor_or_admin), search: str | None = None, active: bool | None = None) -> list[CostCentreResponse]:
    views = await service.list_cost_centres(db, search=search, active=active)
    return [_cost_centre_response(view) for view in views]


@router.get("/cost-centres/search", response_model=list[CostCentreLookupResponse])
async def search_cost_centres(
    db: DbSession,
    search: str,
    _editor: User = Depends(require_editor_or_admin),
    active: bool | None = None,
    limit: int = 25,
) -> list[CostCentreLookupResponse]:
    views = await service.search_reference_data(
        db,
        organization=False,
        search=search,
        active=active,
        limit=limit,
    )
    return [CostCentreLookupResponse.model_validate(view["cost_centre"]) for view in views]


@router.get("/cost-centres/{cost_centre_id}", response_model=CostCentreResponse)
async def get_cost_centre(cost_centre_id: int, db: DbSession, _editor: User = Depends(require_editor_or_admin)) -> CostCentreResponse:
    return _cost_centre_response(await service.get_cost_centre(db, cost_centre_id))


@router.post("/cost-centres", response_model=CostCentreResponse, status_code=status.HTTP_201_CREATED)
async def create_cost_centre(data: CostCentreCreate, request: Request, db: DbSession, admin: User = Depends(require_admin)) -> CostCentreResponse:
    cost_centre = await service.create_cost_centre(db, data)
    await log_event(db, "reference.cost_centre_created", actor=admin, ip_address=_ip(request), target_type="cost_centre", target_id=str(cost_centre.id), target_label=cost_centre.name, detail=f"name={cost_centre.name}")
    await db.commit()
    return _cost_centre_response(await service.get_cost_centre(db, cost_centre.id))


@router.patch("/cost-centres/{cost_centre_id}", response_model=CostCentreResponse)
async def update_cost_centre(cost_centre_id: int, data: CostCentreUpdate, request: Request, db: DbSession, admin: User = Depends(require_admin)) -> CostCentreResponse:
    before = await service.get_cost_centre(db, cost_centre_id)
    before_name = before["cost_centre"].name
    cost_centre = await service.update_cost_centre(db, cost_centre_id, data)
    after = await service.get_cost_centre(db, cost_centre_id)
    await log_event(db, "reference.cost_centre_updated", actor=admin, ip_address=_ip(request), target_type="cost_centre", target_id=str(cost_centre.id), target_label=cost_centre.name, detail=format_audit_detail("cost_centre_update", {"beforeName": before_name, "afterName": cost_centre.name, "affected": str(after["usage"])}))
    await db.commit()
    return _cost_centre_response(after)


@router.post("/cost-centres/{cost_centre_id}/aliases", response_model=CostCentreResponse)
async def add_cost_centre_alias(cost_centre_id: int, data: CostCentreAliasCreate, request: Request, db: DbSession, admin: User = Depends(require_admin)) -> CostCentreResponse:
    alias = await service.add_cost_centre_alias(db, cost_centre_id, data)
    view = await service.get_cost_centre(db, cost_centre_id)
    await log_event(db, "reference.cost_centre_alias_added", actor=admin, ip_address=_ip(request), target_type="cost_centre", target_id=str(cost_centre_id), target_label=view["cost_centre"].name, detail=f"alias={alias.name}")
    await db.commit()
    return _cost_centre_response(view)


@router.delete("/cost-centres/{cost_centre_id}/aliases/{alias_id}", response_class=Response, status_code=204)
async def delete_cost_centre_alias(cost_centre_id: int, alias_id: int, request: Request, db: DbSession, admin: User = Depends(require_admin)) -> Response:
    alias = await db.get(CostCentreAlias, alias_id)
    if alias is None or alias.cost_centre_id != cost_centre_id:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Alias not found")
    alias_name = alias.name
    await service.delete_alias(db, alias_id, organization=False)
    await log_event(db, "reference.cost_centre_alias_removed", actor=admin, ip_address=_ip(request), target_type="cost_centre", target_id=str(cost_centre_id), detail=f"alias={alias_name}")
    await db.commit()
    return Response(status_code=204)


@router.post("/cost-centres/{cost_centre_id}/activate", response_model=CostCentreResponse)
async def activate_cost_centre(cost_centre_id: int, request: Request, db: DbSession, admin: User = Depends(require_admin)) -> CostCentreResponse:
    cost_centre = await service.set_active(db, cost_centre_id, organization=False, active=True)
    await log_event(db, "reference.cost_centre_activated", actor=admin, ip_address=_ip(request), target_type="cost_centre", target_id=str(cost_centre.id), target_label=cost_centre.name)
    await db.commit()
    return _cost_centre_response(await service.get_cost_centre(db, cost_centre.id))


@router.post("/cost-centres/{cost_centre_id}/deactivate", response_model=CostCentreResponse)
async def deactivate_cost_centre(cost_centre_id: int, request: Request, db: DbSession, admin: User = Depends(require_admin)) -> CostCentreResponse:
    cost_centre = await service.set_active(db, cost_centre_id, organization=False, active=False)
    await log_event(db, "reference.cost_centre_deactivated", actor=admin, ip_address=_ip(request), target_type="cost_centre", target_id=str(cost_centre.id), target_label=cost_centre.name)
    await db.commit()
    return _cost_centre_response(await service.get_cost_centre(db, cost_centre.id))


@router.get("/cost-centres/{cost_centre_id}/merge-preview", response_model=MergePreviewResponse)
async def cost_centre_merge_preview(cost_centre_id: int, target_id: int, db: DbSession, _editor: User = Depends(require_editor_or_admin)) -> dict:
    return await service.cost_centre_merge_preview(db, cost_centre_id, target_id)


@router.post("/cost-centres/{cost_centre_id}/merge", response_model=MergeResponse)
async def merge_cost_centre(cost_centre_id: int, data: MergeRequest, request: Request, db: DbSession, admin: User = Depends(require_admin)) -> MergeResponse:
    result = await service.merge_cost_centres(db, data, cost_centre_id)
    source = result["source"]
    target = result["target"]
    await log_event(db, "reference.cost_centre_merged", actor=admin, ip_address=_ip(request), target_type="cost_centre", target_id=str(target.id), target_label=target.name, detail=format_audit_detail("cost_centre_merge", {"sourceId": str(cost_centre_id), "sourceName": source.name, "targetId": str(target.id), "targetName": target.name, "affected": str(result["affected"])}))
    await db.commit()
    return MergeResponse(source_id=cost_centre_id, target_id=target.id, target_name=target.name, affected=result["affected"])


@router.delete("/cost-centres/{cost_centre_id}", response_class=Response, status_code=204)
async def delete_cost_centre(cost_centre_id: int, request: Request, db: DbSession, admin: User = Depends(require_admin)) -> Response:
    cost_centre = await db.get(CostCentre, cost_centre_id)
    await service.delete_cost_centre(db, cost_centre_id)
    await log_event(db, "reference.cost_centre_deleted", actor=admin, ip_address=_ip(request), target_type="cost_centre", target_id=str(cost_centre_id), target_label=cost_centre.name if cost_centre else None)
    await db.commit()
    return Response(status_code=204)
