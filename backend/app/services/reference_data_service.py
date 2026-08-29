"""Canonical organization and cost-centre resolution and administration."""

from __future__ import annotations

import re
import unicodedata
from fastapi import HTTPException, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.contract import Contract
from app.models.license import License
from app.models.pending_order import PendingOrder
from app.models.reference_data import CostCentre, CostCentreAlias, Organization, OrganizationAlias
from app.models.sourcing import SourcingItem, SourcingRequest
from app.models.user_department_access import UserDepartmentAccess
from app.schemas.reference_data import (
    CostCentreAliasCreate,
    CostCentreCreate,
    CostCentreUpdate,
    MergeRequest,
    OrganizationAliasCreate,
    OrganizationCreate,
    OrganizationUpdate,
)


def normalize_reference_name(value: str) -> str:
    """Return the shared exact-match key for a reference display value."""
    if not isinstance(value, str):
        raise ValueError("Reference names must be strings")
    normalized = unicodedata.normalize("NFKC", value)
    normalized = re.sub(r"\s+", " ", normalized.strip())
    return normalized.casefold()


def clean_reference_name(value: str) -> str:
    try:
        normalized = unicodedata.normalize("NFKC", value)
    except TypeError as exc:
        raise HTTPException(status_code=422, detail="Reference names must be strings") from exc
    cleaned = re.sub(r"\s+", " ", normalized.strip())
    if not cleaned:
        raise HTTPException(status_code=422, detail="Reference names cannot be blank")
    return cleaned


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


async def _flush_new(db: AsyncSession, instance) -> None:
    """Flush a new reference inside a savepoint so uniqueness races are recoverable."""
    try:
        async with db.begin_nested():
            db.add(instance)
            await db.flush()
    except IntegrityError as exc:
        raise _conflict("That reference name or alias already exists.") from exc


async def _find_organization(db: AsyncSession, normalized: str) -> Organization | None:
    canonical = await db.scalar(select(Organization).where(Organization.normalized_name == normalized))
    if canonical is not None:
        return canonical
    alias = await db.scalar(select(OrganizationAlias).where(OrganizationAlias.normalized_name == normalized))
    if alias is None:
        return None
    return await db.get(Organization, alias.organization_id)


async def resolve_organization(
    db: AsyncSession,
    value: str,
    *,
    role: str,
    create_if_missing: bool = False,
) -> Organization:
    """Resolve a canonical name or alias and optionally create an active record."""
    cleaned = clean_reference_name(value)
    normalized = normalize_reference_name(cleaned)
    if role not in {"publisher", "supplier"}:
        raise ValueError(f"Unsupported organization role: {role}")

    organization = await _find_organization(db, normalized)
    if organization is not None:
        if not organization.is_active:
            raise _conflict(f"Organization '{organization.name}' is inactive and requires admin action.")
        if role == "publisher" and not organization.is_publisher:
            organization.is_publisher = True
        if role == "supplier" and not organization.is_supplier:
            organization.is_supplier = True
        return organization
    if not create_if_missing:
        raise HTTPException(status_code=404, detail=f"No organization matches '{cleaned}'.")

    organization = Organization(
        name=cleaned,
        normalized_name=normalized,
        is_publisher=role == "publisher",
        is_supplier=role == "supplier",
        is_active=True,
    )
    try:
        await _flush_new(db, organization)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_409_CONFLICT:
            raise
        organization = await _find_organization(db, normalized)
        if organization is None:
            raise
        if not organization.is_active:
            raise _conflict(f"Organization '{organization.name}' is inactive and requires admin action.")
        if role == "publisher":
            organization.is_publisher = True
        else:
            organization.is_supplier = True
    return organization


async def resolve_cost_centre(db: AsyncSession, value: str, *, create_if_missing: bool = False) -> CostCentre:
    cleaned = clean_reference_name(value)
    normalized = normalize_reference_name(cleaned)
    cost_centre = await db.scalar(select(CostCentre).where(CostCentre.normalized_name == normalized))
    if cost_centre is None:
        alias = await db.scalar(select(CostCentreAlias).where(CostCentreAlias.normalized_name == normalized))
        if alias is not None:
            cost_centre = await db.get(CostCentre, alias.cost_centre_id)
    if cost_centre is not None:
        if not cost_centre.is_active:
            raise _conflict(f"Cost centre '{cost_centre.name}' is inactive and requires admin action.")
        return cost_centre
    if not create_if_missing:
        raise HTTPException(status_code=404, detail=f"No cost centre matches '{cleaned}'.")
    cost_centre = CostCentre(name=cleaned, normalized_name=normalized, is_active=True)
    try:
        await _flush_new(db, cost_centre)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_409_CONFLICT:
            raise
        cost_centre = await db.scalar(select(CostCentre).where(CostCentre.normalized_name == normalized))
        if cost_centre is None:
            alias = await db.scalar(select(CostCentreAlias).where(CostCentreAlias.normalized_name == normalized))
            if alias is not None:
                cost_centre = await db.get(CostCentre, alias.cost_centre_id)
        if cost_centre is None:
            raise
        if not cost_centre.is_active:
            raise _conflict(f"Cost centre '{cost_centre.name}' is inactive and requires admin action.")
    return cost_centre


async def resolve_license_reference_fields(db: AsyncSession, data: dict) -> dict:
    """Resolve license publisher, supplier, and cost-centre fields in-place."""
    publisher_value = data.get("publisher_name")
    if not isinstance(publisher_value, str) or not publisher_value.strip():
        raise HTTPException(status_code=422, detail="publisher_name is required")
    publisher = await resolve_organization(db, publisher_value, role="publisher", create_if_missing=True)
    data["publisher_name"] = publisher.name
    data["publisher_id"] = publisher.id

    supplier_value = data.get("supplier")
    if isinstance(supplier_value, str) and supplier_value.strip():
        supplier = await resolve_organization(db, supplier_value, role="supplier", create_if_missing=True)
        data["supplier"] = supplier.name
        data["supplier_id"] = supplier.id
    else:
        data["supplier"] = ""
        data["supplier_id"] = None

    cost_centre_value = data.get("cost_centre")
    if isinstance(cost_centre_value, str) and cost_centre_value.strip():
        cost_centre = await resolve_cost_centre(db, cost_centre_value, create_if_missing=True)
        data["cost_centre"] = cost_centre.name
        data["cost_centre_id"] = cost_centre.id
    else:
        data["cost_centre"] = ""
        data["cost_centre_id"] = None
    return data


async def resolve_license_reference_updates(db: AsyncSession, data: dict) -> dict:
    """Resolve only the reference fields present in a partial license update."""
    if "publisher_name" in data:
        value = data.get("publisher_name")
        if not isinstance(value, str) or not value.strip():
            raise HTTPException(status_code=422, detail="publisher_name is required")
        publisher = await resolve_organization(db, value, role="publisher", create_if_missing=True)
        data["publisher_name"] = publisher.name
        data["publisher_id"] = publisher.id
    if "supplier" in data:
        value = data.get("supplier")
        if isinstance(value, str) and value.strip():
            supplier = await resolve_organization(db, value, role="supplier", create_if_missing=True)
            data["supplier"] = supplier.name
            data["supplier_id"] = supplier.id
        else:
            data["supplier"] = ""
            data["supplier_id"] = None
    if "cost_centre" in data:
        value = data.get("cost_centre")
        if isinstance(value, str) and value.strip():
            cost_centre = await resolve_cost_centre(db, value, create_if_missing=True)
            data["cost_centre"] = cost_centre.name
            data["cost_centre_id"] = cost_centre.id
        else:
            data["cost_centre"] = ""
            data["cost_centre_id"] = None
    return data


async def resolve_procurement_reference_fields(
    db: AsyncSession,
    data: dict,
    *,
    publisher_required: bool = False,
    supplier_required: bool = False,
) -> dict:
    """Resolve procurement publisher/supplier fields while preserving blank shapes."""
    publisher_value = data.get("publisher_name")
    if publisher_required and (not isinstance(publisher_value, str) or not publisher_value.strip()):
        raise HTTPException(status_code=422, detail="publisher_name is required")
    if isinstance(publisher_value, str) and publisher_value.strip():
        publisher = await resolve_organization(db, publisher_value, role="publisher", create_if_missing=True)
        data["publisher_name"] = publisher.name
        data["publisher_id"] = publisher.id
    elif "publisher_name" in data:
        data["publisher_name"] = ""
        data["publisher_id"] = None

    supplier_value = data.get("supplier")
    if supplier_required and (not isinstance(supplier_value, str) or not supplier_value.strip()):
        raise HTTPException(status_code=422, detail="supplier is required")
    if isinstance(supplier_value, str) and supplier_value.strip():
        supplier = await resolve_organization(db, supplier_value, role="supplier", create_if_missing=True)
        data["supplier"] = supplier.name
        data["supplier_id"] = supplier.id
    elif "supplier" in data:
        data["supplier"] = None if data.get("supplier") is None else ""
        data["supplier_id"] = None
    return data


async def resolve_department_assignment_names(
    db: AsyncSession,
    names: list[str],
    *,
    currently_assigned_ids: set[int] | None = None,
) -> list[CostCentre]:
    """Resolve admin department payloads, retaining already-assigned inactive units."""
    current_ids = currently_assigned_ids or set()
    resolved: list[CostCentre] = []
    seen: set[int] = set()
    for value in names:
        cleaned = clean_reference_name(value)
        normalized = normalize_reference_name(cleaned)
        cost_centre = await db.scalar(select(CostCentre).where(CostCentre.normalized_name == normalized))
        if cost_centre is None:
            alias = await db.scalar(select(CostCentreAlias).where(CostCentreAlias.normalized_name == normalized))
            if alias is not None:
                cost_centre = await db.get(CostCentre, alias.cost_centre_id)
        if cost_centre is None:
            cost_centre = await resolve_cost_centre(db, cleaned, create_if_missing=True)
        elif not cost_centre.is_active and cost_centre.id not in current_ids:
            raise _conflict(f"Cost centre '{cost_centre.name}' is inactive and requires admin action.")
        if cost_centre.id not in seen:
            resolved.append(cost_centre)
            seen.add(cost_centre.id)
    return resolved


async def resolve_contract_publisher(db: AsyncSession, value: str) -> Organization:
    """Resolve a contract publisher and return its canonical organization."""
    return await resolve_organization(db, value, role="publisher", create_if_missing=True)


async def _organization_usage(db: AsyncSession, organization_id: int) -> dict[str, int]:
    counts = {
        "licenses": await db.scalar(
            select(func.count()).where(
                or_(License.publisher_id == organization_id, License.supplier_id == organization_id)
            )
        )
        or 0,
        "contracts": await db.scalar(select(func.count()).where(Contract.publisher_id == organization_id)) or 0,
        "sourcing_requests": await db.scalar(
            select(func.count()).where(SourcingRequest.supplier_id == organization_id)
        )
        or 0,
        "sourcing_items": await db.scalar(
            select(func.count()).where(
                or_(SourcingItem.publisher_id == organization_id, SourcingItem.supplier_id == organization_id)
            )
        )
        or 0,
        "pending_orders": await db.scalar(select(func.count()).where(PendingOrder.supplier_id == organization_id)) or 0,
    }
    counts["total"] = sum(counts.values())
    return counts


async def _organization_role_usage(db: AsyncSession, organization_id: int) -> dict[str, int]:
    return {
        "publisher": sum(
            [
                await db.scalar(select(func.count()).where(License.publisher_id == organization_id)) or 0,
                await db.scalar(select(func.count()).where(Contract.publisher_id == organization_id)) or 0,
                await db.scalar(select(func.count()).where(SourcingItem.publisher_id == organization_id)) or 0,
            ]
        ),
        "supplier": sum(
            [
                await db.scalar(select(func.count()).where(License.supplier_id == organization_id)) or 0,
                await db.scalar(select(func.count()).where(SourcingRequest.supplier_id == organization_id)) or 0,
                await db.scalar(select(func.count()).where(SourcingItem.supplier_id == organization_id)) or 0,
                await db.scalar(select(func.count()).where(PendingOrder.supplier_id == organization_id)) or 0,
            ]
        ),
    }


async def _cost_centre_usage(db: AsyncSession, cost_centre_id: int) -> dict[str, int]:
    licenses = await db.scalar(select(func.count()).where(License.cost_centre_id == cost_centre_id)) or 0
    viewers = await db.scalar(
        select(func.count()).where(UserDepartmentAccess.cost_centre_id == cost_centre_id)
    ) or 0
    return {"licenses": licenses, "assigned_viewers": viewers, "total": licenses + viewers}


async def _organization_usage_grouped(db: AsyncSession, ids: list[int]) -> dict[int, dict[str, int]]:
    usage = {reference_id: {"licenses": 0, "contracts": 0, "sourcing_requests": 0, "sourcing_items": 0, "pending_orders": 0, "total": 0} for reference_id in ids}
    if not ids:
        return usage
    for record_id, first_ref, second_ref, key in [
        (License.id, License.publisher_id, License.supplier_id, "licenses"),
        (SourcingItem.id, SourcingItem.publisher_id, SourcingItem.supplier_id, "sourcing_items"),
    ]:
        pair_query = select(record_id.label("record_id"), first_ref.label("reference_id")).where(first_ref.in_(ids)).union(
            select(record_id, second_ref).where(second_ref.in_(ids))
        ).subquery()
        result = await db.execute(select(pair_query.c.reference_id, func.count()).group_by(pair_query.c.reference_id))
        for reference_id, count in result.all():
            usage[reference_id][key] = count
    for column, key, model in [
        (Contract.publisher_id, "contracts", Contract), (SourcingRequest.supplier_id, "sourcing_requests", SourcingRequest),
        (PendingOrder.supplier_id, "pending_orders", PendingOrder),
    ]:
        result = await db.execute(select(column, func.count()).where(column.in_(ids)).group_by(column))
        for reference_id, count in result.all():
            usage[reference_id][key] += count
    for values in usage.values():
        values["total"] = sum(values[key] for key in values if key != "total")
    return usage


async def _cost_centre_usage_grouped(db: AsyncSession, ids: list[int]) -> dict[int, dict[str, int]]:
    usage = {reference_id: {"licenses": 0, "assigned_viewers": 0, "total": 0} for reference_id in ids}
    if not ids:
        return usage
    for model, column, key in [(License, License.cost_centre_id, "licenses"), (UserDepartmentAccess, UserDepartmentAccess.cost_centre_id, "assigned_viewers")]:
        result = await db.execute(select(column, func.count()).where(column.in_(ids)).group_by(column))
        for reference_id, count in result.all():
            usage[reference_id][key] = count
    for values in usage.values():
        values["total"] = values["licenses"] + values["assigned_viewers"]
    return usage


async def _organization_view(db: AsyncSession, organization: Organization) -> dict:
    await db.refresh(organization, attribute_names=["aliases"])
    return {"organization": organization, "usage": await _organization_usage(db, organization.id)}


async def _cost_centre_view(db: AsyncSession, cost_centre: CostCentre) -> dict:
    await db.refresh(cost_centre, attribute_names=["aliases"])
    return {"cost_centre": cost_centre, "usage": await _cost_centre_usage(db, cost_centre.id)}


async def list_organizations(
    db: AsyncSession, *, search: str | None = None, role: str | None = None, active: bool | None = None
) -> list[dict]:
    query = select(Organization).order_by(func.lower(Organization.name), Organization.id)
    if search:
        pattern = f"%{clean_reference_name(search)}%"
        query = query.where(
            or_(Organization.name.ilike(pattern), OrganizationAlias.name.ilike(pattern))
        ).outerjoin(OrganizationAlias)
    if role == "publisher":
        query = query.where(Organization.is_publisher.is_(True))
    elif role == "supplier":
        query = query.where(Organization.is_supplier.is_(True))
    elif role not in {None, "publisher", "supplier"}:
        raise HTTPException(status_code=422, detail="Role must be publisher or supplier")
    if active is not None:
        query = query.where(Organization.is_active.is_(active))
    result = await db.execute(query.options(selectinload(Organization.aliases)).distinct())
    organizations = list(result.scalars().all())
    ids = [organization.id for organization in organizations]
    usage = await _organization_usage_grouped(db, ids)
    return [{"organization": organization, "usage": usage[organization.id]} for organization in organizations]


async def get_organization(db: AsyncSession, organization_id: int) -> dict:
    organization = await db.get(Organization, organization_id)
    if organization is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return await _organization_view(db, organization)


async def list_cost_centres(db: AsyncSession, *, search: str | None = None, active: bool | None = None) -> list[dict]:
    query = select(CostCentre).order_by(func.lower(CostCentre.name), CostCentre.id)
    if search:
        pattern = f"%{clean_reference_name(search)}%"
        query = query.where(or_(CostCentre.name.ilike(pattern), CostCentreAlias.name.ilike(pattern))).outerjoin(
            CostCentreAlias
        )
    if active is not None:
        query = query.where(CostCentre.is_active.is_(active))
    result = await db.execute(query.options(selectinload(CostCentre.aliases)).distinct())
    cost_centres = list(result.scalars().all())
    usage = await _cost_centre_usage_grouped(db, [cost_centre.id for cost_centre in cost_centres])
    return [{"cost_centre": cost_centre, "usage": usage[cost_centre.id]} for cost_centre in cost_centres]


async def search_reference_data(
    db: AsyncSession,
    *,
    organization: bool,
    search: str,
    role: str | None = None,
    active: bool | None = None,
    limit: int = 25,
) -> list[dict]:
    """Return combobox candidates without expensive administration usage counts."""
    if organization and role not in {None, "publisher", "supplier"}:
        raise HTTPException(status_code=422, detail="Role must be publisher or supplier")
    model = Organization if organization else CostCentre
    alias_model = OrganizationAlias if organization else CostCentreAlias
    query = (
        select(model)
        .options(selectinload(model.aliases))
        .outerjoin(alias_model)
        .where(or_(model.name.ilike(f"%{clean_reference_name(search)}%"), alias_model.name.ilike(f"%{clean_reference_name(search)}%")))
        .order_by(func.lower(model.name), model.id)
        .limit(max(1, min(limit, 100)))
    )
    if active is not None:
        query = query.where(model.is_active.is_(active))
    if organization and role == "publisher":
        query = query.where(Organization.is_publisher.is_(True))
    elif organization and role == "supplier":
        query = query.where(Organization.is_supplier.is_(True))
    result = await db.execute(query.distinct())
    key = "organization" if organization else "cost_centre"
    return [{key: item} for item in result.scalars().all()]


async def get_cost_centre(db: AsyncSession, cost_centre_id: int) -> dict:
    cost_centre = await db.get(CostCentre, cost_centre_id)
    if cost_centre is None:
        raise HTTPException(status_code=404, detail="Cost centre not found")
    return await _cost_centre_view(db, cost_centre)


async def create_organization(db: AsyncSession, data: OrganizationCreate) -> Organization:
    cleaned = clean_reference_name(data.name)
    if not data.is_publisher and not data.is_supplier:
        raise HTTPException(status_code=422, detail="An organization must have a publisher or supplier role.")
    if await _find_organization(db, normalize_reference_name(cleaned)) is not None:
        raise _conflict(f"An organization matching '{cleaned}' already exists.")
    organization = Organization(
        name=cleaned,
        normalized_name=normalize_reference_name(cleaned),
        is_publisher=data.is_publisher,
        is_supplier=data.is_supplier,
        is_active=True,
    )
    await _flush_new(db, organization)
    return organization


async def create_cost_centre(db: AsyncSession, data: CostCentreCreate) -> CostCentre:
    cleaned = clean_reference_name(data.name)
    normalized = normalize_reference_name(cleaned)
    if (
        await db.scalar(select(CostCentre).where(CostCentre.normalized_name == normalized)) is not None
        or await db.scalar(select(CostCentreAlias).where(CostCentreAlias.normalized_name == normalized)) is not None
    ):
        raise _conflict(f"A cost centre matching '{cleaned}' already exists.")
    cost_centre = CostCentre(name=cleaned, normalized_name=normalized, is_active=True)
    await _flush_new(db, cost_centre)
    return cost_centre


async def _assert_name_available(db: AsyncSession, normalized: str, *, organization_id: int | None = None, cost_centre_id: int | None = None) -> None:
    if organization_id is not None:
        canonical = await db.scalar(select(Organization).where(Organization.normalized_name == normalized, Organization.id != organization_id))
        alias = await db.scalar(select(OrganizationAlias).where(OrganizationAlias.normalized_name == normalized, OrganizationAlias.organization_id != organization_id))
    else:
        canonical = await db.scalar(select(CostCentre).where(CostCentre.normalized_name == normalized, CostCentre.id != cost_centre_id))
        alias = await db.scalar(select(CostCentreAlias).where(CostCentreAlias.normalized_name == normalized, CostCentreAlias.cost_centre_id != cost_centre_id))
    if canonical is not None or alias is not None:
        raise _conflict("That canonical name or alias is already in use.")


async def _rename_reference(
    db: AsyncSession,
    reference,
    cleaned: str,
    normalized: str,
    *,
    alias_model,
    alias_owner_column,
    add_alias,
    sync_mirrors,
    conflict_detail: str,
) -> None:
    try:
        async with db.begin_nested():
            if isinstance(reference, Organization):
                await _assert_name_available(db, normalized, organization_id=reference.id)
            else:
                await _assert_name_available(db, normalized, cost_centre_id=reference.id)
            own_alias = await db.scalar(
                select(alias_model).where(
                    alias_owner_column == reference.id,
                    alias_model.normalized_name == normalized,
                )
            )
            if own_alias is not None:
                await db.delete(own_alias)
                await db.flush()
            old_name = reference.name
            reference.name = cleaned
            reference.normalized_name = normalized
            await add_alias(db, reference, old_name)
            await sync_mirrors(db, reference)
    except IntegrityError as exc:
        raise _conflict(conflict_detail) from exc


async def update_organization(db: AsyncSession, organization_id: int, data: OrganizationUpdate) -> Organization:
    organization = await db.get(Organization, organization_id)
    if organization is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    proposed_publisher = data.is_publisher if data.is_publisher is not None else organization.is_publisher
    proposed_supplier = data.is_supplier if data.is_supplier is not None else organization.is_supplier
    if not proposed_publisher and not proposed_supplier:
        raise HTTPException(status_code=422, detail="An organization must retain a publisher or supplier role.")
    role_usage = await _organization_role_usage(db, organization.id)
    if not proposed_publisher and role_usage["publisher"]:
        raise _conflict("The publisher role cannot be removed while publisher records still reference it.")
    if not proposed_supplier and role_usage["supplier"]:
        raise _conflict("The supplier role cannot be removed while supplier records still reference it.")

    if data.name is not None:
        cleaned = clean_reference_name(data.name)
        normalized = normalize_reference_name(cleaned)
        if normalized != organization.normalized_name:
            await _rename_reference(
                db,
                organization,
                cleaned,
                normalized,
                alias_model=OrganizationAlias,
                alias_owner_column=OrganizationAlias.organization_id,
                add_alias=_add_organization_alias,
                sync_mirrors=_sync_organization_mirrors,
                conflict_detail="That organization name or alias is already in use.",
            )
        else:
            organization.name = cleaned
            organization.normalized_name = normalized
            await _sync_organization_mirrors(db, organization)
    organization.is_publisher = proposed_publisher
    organization.is_supplier = proposed_supplier
    try:
        await db.flush()
    except IntegrityError as exc:
        raise _conflict("That organization name or alias is already in use.") from exc
    return organization


async def update_cost_centre(db: AsyncSession, cost_centre_id: int, data: CostCentreUpdate) -> CostCentre:
    cost_centre = await db.get(CostCentre, cost_centre_id)
    if cost_centre is None:
        raise HTTPException(status_code=404, detail="Cost centre not found")
    if data.name is not None:
        cleaned = clean_reference_name(data.name)
        normalized = normalize_reference_name(cleaned)
        if normalized != cost_centre.normalized_name:
            await _rename_reference(
                db,
                cost_centre,
                cleaned,
                normalized,
                alias_model=CostCentreAlias,
                alias_owner_column=CostCentreAlias.cost_centre_id,
                add_alias=_add_cost_centre_alias,
                sync_mirrors=_sync_cost_centre_mirrors,
                conflict_detail="That cost centre name or alias is already in use.",
            )
        else:
            cost_centre.name = cleaned
            cost_centre.normalized_name = normalized
            await _sync_cost_centre_mirrors(db, cost_centre)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise _conflict("That cost centre name or alias is already in use.") from exc
    return cost_centre


async def _add_organization_alias(db: AsyncSession, organization: Organization, name: str) -> OrganizationAlias:
    cleaned = clean_reference_name(name)
    normalized = normalize_reference_name(cleaned)
    existing = await db.scalar(select(OrganizationAlias).where(OrganizationAlias.normalized_name == normalized))
    if existing is not None:
        if existing.organization_id == organization.id:
            return existing
        raise _conflict("That alias is already assigned to another organization.")
    canonical = await db.scalar(select(Organization).where(Organization.normalized_name == normalized))
    if canonical is not None:
        raise _conflict("An alias cannot duplicate a canonical organization name.")
    alias = OrganizationAlias(organization_id=organization.id, name=cleaned, normalized_name=normalized)
    await _flush_new(db, alias)
    return alias


async def add_organization_alias(db: AsyncSession, organization_id: int, data: OrganizationAliasCreate) -> OrganizationAlias:
    organization = await db.get(Organization, organization_id)
    if organization is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return await _add_organization_alias(db, organization, data.name)


async def add_cost_centre_alias(db: AsyncSession, cost_centre_id: int, data: CostCentreAliasCreate) -> CostCentreAlias:
    cost_centre = await db.get(CostCentre, cost_centre_id)
    if cost_centre is None:
        raise HTTPException(status_code=404, detail="Cost centre not found")
    return await _add_cost_centre_alias(db, cost_centre, data)


async def _add_cost_centre_alias(
    db: AsyncSession, cost_centre: CostCentre, data: CostCentreAliasCreate | str
) -> CostCentreAlias:
    name = data if isinstance(data, str) else data.name
    cleaned = clean_reference_name(name)
    normalized = normalize_reference_name(cleaned)
    existing = await db.scalar(select(CostCentreAlias).where(CostCentreAlias.normalized_name == normalized))
    canonical = await db.scalar(select(CostCentre).where(CostCentre.normalized_name == normalized))
    if existing is not None and existing.cost_centre_id != cost_centre.id:
        raise _conflict("That alias is already in use by another cost centre.")
    if canonical is not None:
        raise _conflict("An alias cannot duplicate a canonical cost centre name.")
    if existing is not None:
        return existing
    alias = CostCentreAlias(cost_centre_id=cost_centre.id, name=cleaned, normalized_name=normalized)
    await _flush_new(db, alias)
    return alias


async def delete_alias(db: AsyncSession, alias_id: int, *, organization: bool) -> None:
    model = OrganizationAlias if organization else CostCentreAlias
    alias = await db.get(model, alias_id)
    if alias is None:
        raise HTTPException(status_code=404, detail="Alias not found")
    await db.delete(alias)
    await db.flush()


async def set_active(db: AsyncSession, reference_id: int, *, organization: bool, active: bool):
    model = Organization if organization else CostCentre
    reference = await db.get(model, reference_id)
    if reference is None:
        raise HTTPException(status_code=404, detail="Reference record not found")
    reference.is_active = active
    await db.flush()
    return reference


async def _sync_organization_mirrors(db: AsyncSession, organization: Organization) -> dict[str, int]:
    name = organization.name
    affected: dict[str, int] = {}
    updates = [
        (License, License.publisher_id, License.publisher_name),
        (License, License.supplier_id, License.supplier),
        (Contract, Contract.publisher_id, Contract.publisher_name),
        (SourcingRequest, SourcingRequest.supplier_id, SourcingRequest.supplier),
        (SourcingItem, SourcingItem.publisher_id, SourcingItem.publisher_name),
        (SourcingItem, SourcingItem.supplier_id, SourcingItem.supplier),
        (PendingOrder, PendingOrder.supplier_id, PendingOrder.supplier),
    ]
    for model, id_column, mirror_column in updates:
        result = await db.execute(update(model).where(id_column == organization.id).values({mirror_column: name}))
        affected[model.__tablename__] = affected.get(model.__tablename__, 0) + result.rowcount
    return affected


async def _sync_cost_centre_mirrors(db: AsyncSession, cost_centre: CostCentre) -> dict[str, int]:
    assignments = list(
        (
            await db.scalars(
                select(UserDepartmentAccess)
                .where(
                    or_(
                        UserDepartmentAccess.cost_centre_id == cost_centre.id,
                        UserDepartmentAccess.department == cost_centre.name,
                    )
                )
                .order_by(UserDepartmentAccess.user_id, UserDepartmentAccess.id)
            )
        ).all()
    )
    assignments_by_user: dict[int, list[UserDepartmentAccess]] = {}
    for assignment in assignments:
        assignments_by_user.setdefault(assignment.user_id, []).append(assignment)

    deduplicated = 0
    for user_assignments in assignments_by_user.values():
        linked = [assignment for assignment in user_assignments if assignment.cost_centre_id == cost_centre.id]
        if not linked:
            continue
        keeper = next(
            (assignment for assignment in linked if assignment.department == cost_centre.name),
            linked[0],
        )
        for assignment in user_assignments:
            if assignment.id == keeper.id:
                continue
            if assignment.cost_centre_id not in {None, cost_centre.id}:
                raise _conflict(
                    "Viewer access contains conflicting cost-centre assignments that require admin action."
                )
            await db.delete(assignment)
            deduplicated += 1
    if deduplicated:
        await db.flush()

    result = await db.execute(
        update(License).where(License.cost_centre_id == cost_centre.id).values(cost_centre=cost_centre.name)
    )
    result_access = await db.execute(
        update(UserDepartmentAccess)
        .where(UserDepartmentAccess.cost_centre_id == cost_centre.id)
        .values(department=cost_centre.name)
    )
    return {
        "licenses": result.rowcount,
        "viewer_assignments": result_access.rowcount,
        "viewer_assignments_deduplicated": deduplicated,
    }


async def _validate_organization_alias_transfer(
    db: AsyncSession,
    target: Organization,
    source: Organization,
    names: list[str],
) -> list[str]:
    candidates: list[str] = []
    seen: set[str] = set()
    for name in names:
        cleaned = clean_reference_name(name)
        normalized = normalize_reference_name(cleaned)
        if normalized in seen or normalized == target.normalized_name:
            continue
        canonical = await db.scalar(select(Organization).where(Organization.normalized_name == normalized))
        if canonical is not None and canonical.id not in {source.id, target.id}:
            raise _conflict("A merge alias collides with a third organization.")
        alias = await db.scalar(select(OrganizationAlias).where(OrganizationAlias.normalized_name == normalized))
        if alias is not None and alias.organization_id not in {source.id, target.id}:
            raise _conflict("A merge alias collides with a third organization.")
        seen.add(normalized)
        candidates.append(cleaned)
    return candidates


async def _validate_cost_centre_alias_transfer(
    db: AsyncSession,
    target: CostCentre,
    source: CostCentre,
    names: list[str],
) -> list[str]:
    candidates: list[str] = []
    seen: set[str] = set()
    for name in names:
        cleaned = clean_reference_name(name)
        normalized = normalize_reference_name(cleaned)
        if normalized in seen or normalized == target.normalized_name:
            continue
        canonical = await db.scalar(select(CostCentre).where(CostCentre.normalized_name == normalized))
        if canonical is not None and canonical.id not in {source.id, target.id}:
            raise _conflict("A merge alias collides with a third cost centre.")
        alias = await db.scalar(select(CostCentreAlias).where(CostCentreAlias.normalized_name == normalized))
        if alias is not None and alias.cost_centre_id not in {source.id, target.id}:
            raise _conflict("A merge alias collides with a third cost centre.")
        seen.add(normalized)
        candidates.append(cleaned)
    return candidates


async def merge_organizations(db: AsyncSession, data: MergeRequest, source_id: int) -> dict:
    async with db.begin_nested():
        return await _merge_organizations(db, data, source_id)


async def _merge_organizations(db: AsyncSession, data: MergeRequest, source_id: int) -> dict:
    source = await db.get(Organization, source_id)
    target = await db.get(Organization, data.target_id)
    if source is None or target is None:
        raise HTTPException(status_code=404, detail="Source or target organization not found")
    if source.id == target.id:
        raise _conflict("An organization cannot be merged into itself.")
    if not target.is_active:
        raise _conflict("The merge target must be active.")
    affected = await _organization_usage(db, source.id)
    source_name = source.name
    source_aliases = list(
        (await db.scalars(select(OrganizationAlias).where(OrganizationAlias.organization_id == source.id))).all()
    )
    transfer_names = await _validate_organization_alias_transfer(
        db, target, source, [source_name, *(alias.name for alias in source_aliases)]
    )
    target.is_publisher = target.is_publisher or source.is_publisher
    target.is_supplier = target.is_supplier or source.is_supplier
    for model, id_column, mirror_column in [
        (License, License.publisher_id, License.publisher_name),
        (License, License.supplier_id, License.supplier),
        (Contract, Contract.publisher_id, Contract.publisher_name),
        (SourcingRequest, SourcingRequest.supplier_id, SourcingRequest.supplier),
        (SourcingItem, SourcingItem.publisher_id, SourcingItem.publisher_name),
        (SourcingItem, SourcingItem.supplier_id, SourcingItem.supplier),
        (PendingOrder, PendingOrder.supplier_id, PendingOrder.supplier),
    ]:
        await db.execute(update(model).where(id_column == source.id).values({id_column: target.id}))
    for alias in source_aliases:
        await db.delete(alias)
    await db.delete(source)
    await db.flush()
    for name in transfer_names:
        await _add_organization_alias(db, target, name)
    mirror_affected = await _sync_organization_mirrors(db, target)
    affected.update({f"mirrors_{key}": value for key, value in mirror_affected.items()})
    return {"source": source, "target": target, "affected": affected}


async def merge_cost_centres(db: AsyncSession, data: MergeRequest, source_id: int) -> dict:
    async with db.begin_nested():
        return await _merge_cost_centres(db, data, source_id)


async def _merge_cost_centres(db: AsyncSession, data: MergeRequest, source_id: int) -> dict:
    source = await db.get(CostCentre, source_id)
    target = await db.get(CostCentre, data.target_id)
    if source is None or target is None:
        raise HTTPException(status_code=404, detail="Source or target cost centre not found")
    if source.id == target.id:
        raise _conflict("A cost centre cannot be merged into itself.")
    if not target.is_active:
        raise _conflict("The merge target must be active.")
    affected = await _cost_centre_usage(db, source.id)
    source_name = source.name
    source_aliases = list(
        (await db.scalars(select(CostCentreAlias).where(CostCentreAlias.cost_centre_id == source.id))).all()
    )
    transfer_names = await _validate_cost_centre_alias_transfer(
        db, target, source, [source_name, *(alias.name for alias in source_aliases)]
    )
    await db.execute(
        update(License).where(License.cost_centre_id == source.id).values(cost_centre_id=target.id)
    )
    assignments = list((await db.scalars(select(UserDepartmentAccess).where(UserDepartmentAccess.cost_centre_id == source.id))).all())
    for assignment in assignments:
        duplicate = await db.scalar(
            select(UserDepartmentAccess).where(
                UserDepartmentAccess.user_id == assignment.user_id,
                UserDepartmentAccess.cost_centre_id == target.id,
            )
        )
        if duplicate is not None:
            await db.delete(assignment)
        else:
            assignment.cost_centre_id = target.id
            assignment.department = target.name
    for alias in source_aliases:
        await db.delete(alias)
    await db.delete(source)
    await db.flush()
    for name in transfer_names:
        await _add_cost_centre_alias(db, target, CostCentreAliasCreate(name=name))
    mirror_affected = await _sync_cost_centre_mirrors(db, target)
    affected.update({f"mirrors_{key}": value for key, value in mirror_affected.items()})
    return {"source": source, "target": target, "affected": affected}


async def delete_organization(db: AsyncSession, organization_id: int) -> None:
    organization = await db.get(Organization, organization_id)
    if organization is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    usage = await _organization_usage(db, organization.id)
    if usage["total"]:
        raise _conflict("This organization is in use; merge or deactivate it instead.")
    await db.delete(organization)
    await db.flush()


async def delete_cost_centre(db: AsyncSession, cost_centre_id: int) -> None:
    cost_centre = await db.get(CostCentre, cost_centre_id)
    if cost_centre is None:
        raise HTTPException(status_code=404, detail="Cost centre not found")
    usage = await _cost_centre_usage(db, cost_centre.id)
    if usage["total"]:
        raise _conflict("This cost centre is in use; merge or deactivate it instead.")
    await db.delete(cost_centre)
    await db.flush()


async def organization_merge_preview(db: AsyncSession, source_id: int, target_id: int) -> dict:
    source = await db.get(Organization, source_id)
    target = await db.get(Organization, target_id)
    if source is None or target is None:
        raise HTTPException(status_code=404, detail="Source or target organization not found")
    return {"source_id": source.id, "source_name": source.name, "target_id": target.id, "target_name": target.name, "source_usage": await _organization_usage(db, source.id)}


async def cost_centre_merge_preview(db: AsyncSession, source_id: int, target_id: int) -> dict:
    source = await db.get(CostCentre, source_id)
    target = await db.get(CostCentre, target_id)
    if source is None or target is None:
        raise HTTPException(status_code=404, detail="Source or target cost centre not found")
    return {"source_id": source.id, "source_name": source.name, "target_id": target.id, "target_name": target.name, "source_usage": await _cost_centre_usage(db, source.id)}
