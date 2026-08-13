from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.custom_fields import CustomFieldValue
from app.models.document import ProcurementDocument
from app.models.license import License, LicenseType
from app.models.settings import GlobalSettings
from app.models.sourcing import SourcingItem, SourcingStatus
from app.models.user import User
from app.schemas.renewal import (
    RenewalCustomFieldValue,
    RenewalWorkbenchRow,
)
from app.services.access_service import apply_department_filter, get_viewer_departments
from app.services.license_service import compute_completeness, compute_days_until_expiry
from app.services.license_response_service import get_procurement_documents_by_scope
from app.services.renewal_workflow import compute_workbench_renewal_status
from app.services.renewal_workbench_model import (
    compute_risk_flags,
    estimate_annual_value,
    matches_workbench_view,
)
from app.services.sourcing_service import sourcing_item_predecessor_ids

NON_RENEWABLE_LICENSE_TYPES = (LicenseType.service, LicenseType.other)


async def get_renewal_workbench_rows(
    db: AsyncSession,
    current_user: User,
    window_days: int = 90,
    view: str = "all",
    today: date | None = None,
) -> list[RenewalWorkbenchRow]:
    today = today or date.today()
    cutoff = today + timedelta(days=window_days)

    mandatory_fields, high_value_threshold = await _get_global_settings(db)
    licenses = await _load_candidate_licenses(db, current_user, cutoff)
    if not licenses:
        return []

    license_ids = [lic.id for lic in licenses]
    sourcing_by_license_id = await _load_renewal_sourcing_items(db, license_ids)
    custom_fields_by_license_id = await _load_custom_fields(db, license_ids)
    procurement_documents_by_license_id = await get_procurement_documents_by_scope(db, licenses)

    rows = [
        _build_row(
            license_obj=lic,
            sourcing_item=sourcing_by_license_id.get(lic.id),
            custom_fields=custom_fields_by_license_id.get(lic.id, []),
            procurement_documents=procurement_documents_by_license_id.get(lic.id, []),
            mandatory_fields=mandatory_fields,
            window_days=window_days,
            today=today,
            high_value_threshold=high_value_threshold,
        )
        for lic in licenses
    ]
    return [row for row in rows if matches_workbench_view(row, view)]


async def _get_global_settings(db: AsyncSession) -> tuple[dict[str, bool], Decimal]:
    result = await db.execute(select(GlobalSettings).where(GlobalSettings.id == 1))
    settings = result.scalar_one_or_none()
    mandatory_fields = (settings.mandatory_fields if settings else {}) or {}
    raw_threshold = settings.high_value_threshold if settings else None
    high_value_threshold = Decimal(str(raw_threshold)) if raw_threshold is not None else Decimal("50000")
    return mandatory_fields, high_value_threshold


async def _load_candidate_licenses(
    db: AsyncSession,
    current_user: User,
    cutoff: date,
) -> list[License]:
    departments = await get_viewer_departments(current_user.id, db) if current_user.role == "viewer" else None

    query = (
        select(License)
        .where(License.is_retired.is_(False))
        .where(License.license_type.notin_(NON_RENEWABLE_LICENSE_TYPES))
        .where(or_(License.lifecycle_status.is_(None), License.lifecycle_status.notin_(["renewed", "legacy"])))
        .where(or_(License.end_date.isnot(None), License.lifecycle_status == "pending_renewal"))
        .where(or_(License.end_date <= cutoff, License.lifecycle_status == "pending_renewal"))
        .options(selectinload(License.documents))
        .order_by(License.end_date.is_(None), License.end_date, License.publisher_name, License.id)
    )
    query = apply_department_filter(query, departments)
    result = await db.execute(query)
    return list(result.scalars().all())


async def _load_renewal_sourcing_items(
    db: AsyncSession,
    license_ids: list[int],
) -> dict[int, SourcingItem]:
    license_id_set = set(license_ids)
    result = await db.execute(
        select(SourcingItem)
        .where(SourcingItem.status != SourcingStatus.cancelled)
        .where(
            or_(
                SourcingItem.renewal_for_license_id.isnot(None),
                SourcingItem.coterm_predecessor_ids.isnot(None),
            )
        )
        .options(selectinload(SourcingItem.pending_order))
        .order_by(SourcingItem.id.desc())
    )

    grouped: dict[int, list[SourcingItem]] = defaultdict(list)
    for item in result.scalars().all():
        for predecessor_id in sourcing_item_predecessor_ids(item):
            if predecessor_id in license_id_set:
                grouped[predecessor_id].append(item)

    selected: dict[int, SourcingItem] = {}
    for license_id, items in grouped.items():
        selected[license_id] = next(
            (item for item in items if item.pending_order_id is not None),
            items[0],
        )
    return selected


async def _load_custom_fields(
    db: AsyncSession,
    license_ids: list[int],
) -> dict[int, list[RenewalCustomFieldValue]]:
    result = await db.execute(
        select(CustomFieldValue)
        .where(CustomFieldValue.license_id.in_(license_ids))
        .options(selectinload(CustomFieldValue.definition))
    )

    grouped: dict[int, list[CustomFieldValue]] = defaultdict(list)
    for value in result.scalars().all():
        if value.definition is not None:
            grouped[value.license_id].append(value)

    output: dict[int, list[RenewalCustomFieldValue]] = {}
    for license_id, values in grouped.items():
        values.sort(key=lambda value: (value.definition.display_order, value.definition.name))
        output[license_id] = [
            RenewalCustomFieldValue(
                field_key=value.definition.field_key,
                name=value.definition.name,
                field_type=value.definition.field_type,
                value_text=value.value_text,
                value_currency=value.value_currency,
                section=value.definition.section,
            )
            for value in values
        ]
    return output


def _build_row(
    license_obj: License,
    sourcing_item: SourcingItem | None,
    custom_fields: list[RenewalCustomFieldValue],
    procurement_documents: list[ProcurementDocument],
    mandatory_fields: dict[str, bool],
    window_days: int,
    today: date,
    high_value_threshold=None,
) -> RenewalWorkbenchRow:
    docs = [*list(license_obj.documents), *procurement_documents]
    days_until_expiry = compute_days_until_expiry(license_obj, today)
    completeness_pct = compute_completeness(license_obj, docs, mandatory_fields)
    estimated_annual_value = estimate_annual_value(license_obj)
    renewal_status = compute_workbench_renewal_status(license_obj, sourcing_item, days_until_expiry)
    risk_flags = compute_risk_flags(
        license_obj=license_obj,
        renewal_status=renewal_status,
        days_until_expiry=days_until_expiry,
        completeness_pct=completeness_pct,
        document_count=len(docs),
        estimated_annual_value=estimated_annual_value,
        window_days=window_days,
        high_value_threshold=high_value_threshold,
    )

    pending_order = sourcing_item.pending_order if sourcing_item else None
    return RenewalWorkbenchRow(
        license_id=license_obj.id,
        license_ref=license_obj.license_ref,
        publisher_name=license_obj.publisher_name,
        software_description=license_obj.software_description,
        license_type=license_obj.license_type,
        license_metric=license_obj.license_metric,
        end_date=license_obj.end_date,
        days_until_expiry=days_until_expiry,
        renewal_status=renewal_status,
        lifecycle_status=license_obj.lifecycle_status,
        contract_number=license_obj.contract_number,
        po_number=license_obj.po_number,
        supplier=license_obj.supplier,
        cost_centre=license_obj.cost_centre,
        budget_owner_email=license_obj.budget_owner_email,
        contact_email=license_obj.contact_email,
        currency=license_obj.currency,
        quantity=license_obj.quantity,
        unit_price=license_obj.unit_price,
        estimated_annual_value=estimated_annual_value or Decimal("0"),
        completeness_pct=completeness_pct,
        document_count=len(docs),
        risk_flags=risk_flags,
        sourcing_item_id=sourcing_item.id if sourcing_item else None,
        pending_order_id=sourcing_item.pending_order_id if sourcing_item else None,
        pending_order_number=pending_order.po_number if pending_order else None,
        custom_fields=custom_fields,
    )
