"""
Response assembly helpers for licenses.

Keeps route modules thin by centralizing mandatory-field lookup and
LicenseResponse enrichment.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.custom_fields import CustomFieldValue
from app.models.document import ProcurementDocument
from app.schemas.custom_fields import CustomFieldValueResponse
from app.schemas.license import LicenseResponse
from app.services.document_availability_service import inspect_document_availability
from app.services.document_availability_service import get_document_storage_base
from app.services.license_service import (
    calc_effective_quantity,
    compute_completeness,
    compute_days_until_expiry,
    compute_expiration_status,
)
from app.services.settings_service import get_global_settings as _get_cached_global_settings

DEFAULT_NOTIFICATION_DAYS = 30


async def get_mandatory_fields(db: AsyncSession) -> dict:
    """Return mandatory_fields from the singleton GlobalSettings row."""
    global_settings = await _get_cached_global_settings(db)
    return global_settings.mandatory_fields or {} if global_settings else {}


async def get_notification_days(db: AsyncSession) -> int:
    """Return the configured expiration warning window in days."""
    global_settings = await _get_cached_global_settings(db)
    return int(global_settings.notification_days) if global_settings else DEFAULT_NOTIFICATION_DAYS


async def get_procurement_documents_by_scope(db: AsyncSession, licenses: list) -> dict[int, list[ProcurementDocument]]:
    """Return procurement documents keyed by license id using explicit record scope."""
    pending_order_ids = {lic.pending_order_id for lic in licenses if lic.pending_order_id is not None}
    procurement_bundle_ids = {
        lic.procurement_bundle_id for lic in licenses if lic.procurement_bundle_id is not None
    }
    license_ids = {lic.id for lic in licenses if lic.id is not None}
    if not pending_order_ids and not procurement_bundle_ids and not license_ids:
        return {}

    conditions = []
    if pending_order_ids:
        conditions.append(ProcurementDocument.pending_order_id.in_(pending_order_ids))
    if license_ids:
        conditions.append(ProcurementDocument.license_id.in_(license_ids))
    if procurement_bundle_ids:
        conditions.append(ProcurementDocument.procurement_bundle_id.in_(procurement_bundle_ids))

    result = await db.execute(select(ProcurementDocument).where(or_(*conditions)))
    documents_by_license_id: dict[int, list[ProcurementDocument]] = {lic.id: [] for lic in licenses}
    pending_to_license_ids: dict[int, list[int]] = {}
    bundle_to_license_ids: dict[str, list[int]] = {}
    for lic in licenses:
        if lic.pending_order_id is not None:
            pending_to_license_ids.setdefault(lic.pending_order_id, []).append(lic.id)
        if lic.procurement_bundle_id is not None:
            bundle_to_license_ids.setdefault(lic.procurement_bundle_id, []).append(lic.id)

    for document in result.scalars().all():
        target_license_ids: set[int] = set()
        if document.license_id is not None and document.license_id in documents_by_license_id:
            target_license_ids.add(document.license_id)
        if document.pending_order_id is not None:
            target_license_ids.update(pending_to_license_ids.get(document.pending_order_id, []))
        if document.procurement_bundle_id is not None:
            target_license_ids.update(bundle_to_license_ids.get(document.procurement_bundle_id, []))
        for license_id in target_license_ids:
            documents_by_license_id[license_id].append(document)
    return documents_by_license_id


async def get_custom_field_values_by_license_id(
    db: AsyncSession,
    license_ids: list[int],
) -> dict[int, list[CustomFieldValue]]:
    """Return custom field values keyed by license id with definitions loaded."""
    if not license_ids:
        return {}

    result = await db.execute(
        select(CustomFieldValue)
        .where(CustomFieldValue.license_id.in_(license_ids))
        .options(selectinload(CustomFieldValue.definition))
    )
    values_by_license_id: dict[int, list[CustomFieldValue]] = {license_id: [] for license_id in license_ids}
    for value in result.scalars().all():
        values_by_license_id.setdefault(value.license_id, []).append(value)
    return values_by_license_id


def enrich_license_response(
    license_obj,
    mandatory_fields: dict,
    notification_days: int = DEFAULT_NOTIFICATION_DAYS,
    procurement_documents: list[ProcurementDocument] | None = None,
    custom_field_values: list[CustomFieldValue] | None = None,
    storage_base: str | None = None,
) -> LicenseResponse:
    """Convert an ORM License (with documents loaded) into an enriched response."""
    today = date.today()
    documents = [*list(license_obj.documents), *(procurement_documents or [])]

    response = LicenseResponse.model_validate(license_obj)
    effective_quantity = calc_effective_quantity(license_obj.quantity, license_obj.quantity_per_unit)
    response.effective_quantity = format(effective_quantity, "f") if effective_quantity is not None else None
    if not response.invoice_numbers and response.invoice_number:
        response.invoice_numbers = [response.invoice_number]
    parent_links = license_obj.__dict__.get("maintenance_parent_links")
    if parent_links is not None:
        response.maintenance_parent_ids = sorted({link.parent_license_id for link in parent_links})
    elif response.parent_license_id is not None:
        response.maintenance_parent_ids = [response.parent_license_id]
    child_links = license_obj.__dict__.get("maintenance_child_links")
    if child_links is not None:
        linked_ids = sorted({link.maintenance_license_id for link in child_links})
        response.linked_maintenance_ids = linked_ids
        if not linked_ids and response.active_maintenance_id is not None:
            response.linked_maintenance_ids = [response.active_maintenance_id]
    elif response.active_maintenance_id is not None:
        response.linked_maintenance_ids = [response.active_maintenance_id]
    creator = license_obj.__dict__.get("creator")
    response.created_by_name = creator.username if creator is not None else None
    response.created_by_email = creator.email if creator is not None else None
    available_docs, document_counts = inspect_document_availability(documents, storage_base)
    response.completeness_pct = compute_completeness(license_obj, available_docs, mandatory_fields)
    response.days_until_expiry = compute_days_until_expiry(license_obj, today)
    response.expiration_status = compute_expiration_status(license_obj, today, notification_days)
    response.document_count = document_counts["total"]
    response.available_document_count = document_counts["available"]
    response.missing_document_count = document_counts["missing"]
    response.unavailable_document_count = document_counts["unavailable"]
    response.custom_fields = [CustomFieldValueResponse.model_validate(value) for value in custom_field_values or []]
    return response


async def load_enriched_license_responses(
    db: AsyncSession,
    license_ids: list[int],
    *,
    populate_existing: bool = False,
) -> dict[int, LicenseResponse]:
    """Reload and enrich licenses by id after a workflow mutation."""
    if not license_ids:
        return {}

    from app.models.license import License

    query = (
        select(License)
        .where(License.id.in_(license_ids))
        .options(
            selectinload(License.documents),
            selectinload(License.creator),
            selectinload(License.maintenance_parent_links),
            selectinload(License.maintenance_child_links),
        )
    )
    if populate_existing:
        query = query.execution_options(populate_existing=True)
    result = await db.execute(query)
    licenses = list(result.scalars().all())
    mandatory_fields = await get_mandatory_fields(db)
    notification_days = await get_notification_days(db)
    procurement_documents = await get_procurement_documents_by_scope(db, licenses)
    custom_field_values = await get_custom_field_values_by_license_id(db, license_ids)
    storage_base = await get_document_storage_base(db)
    return {
        license_obj.id: enrich_license_response(
            license_obj,
            mandatory_fields,
            notification_days,
            procurement_documents=procurement_documents.get(license_obj.id, []),
            custom_field_values=custom_field_values.get(license_obj.id, []),
            storage_base=storage_base,
        )
        for license_obj in licenses
    }


async def load_enriched_license_response(
    db: AsyncSession,
    license_id: int,
    *,
    populate_existing: bool = False,
) -> LicenseResponse:
    """Reload and enrich one license after a workflow mutation."""
    responses = await load_enriched_license_responses(
        db,
        [license_id],
        populate_existing=populate_existing,
    )
    return responses[license_id]
