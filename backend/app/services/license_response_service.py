"""
Response assembly helpers for licenses.

Keeps route modules thin by centralizing mandatory-field lookup and
LicenseResponse enrichment.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.custom_fields import CustomFieldValue
from app.models.document import ProcurementDocument
from app.schemas.custom_fields import CustomFieldValueResponse
from app.schemas.license import LicenseResponse
from app.services.license_service import (
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


async def get_procurement_documents_by_scope(db: AsyncSession, licenses: list) -> dict[int, list[ProcurementDocument]]:
    """Return procurement documents keyed by license id using explicit record scope."""
    pending_order_ids = {lic.pending_order_id for lic in licenses if lic.pending_order_id is not None}
    license_ids = {lic.id for lic in licenses if lic.id is not None}
    if not pending_order_ids and not license_ids:
        return {}

    conditions = []
    if pending_order_ids:
        conditions.append(ProcurementDocument.pending_order_id.in_(pending_order_ids))
    if license_ids:
        conditions.append(ProcurementDocument.license_id.in_(license_ids))

    result = await db.execute(
        select(ProcurementDocument).where(*conditions) if len(conditions) == 1 else
        select(ProcurementDocument).where(conditions[0] | conditions[1])
    )
    documents_by_license_id: dict[int, list[ProcurementDocument]] = {lic.id: [] for lic in licenses}
    pending_to_license_ids: dict[int, list[int]] = {}
    for lic in licenses:
        if lic.pending_order_id is not None:
            pending_to_license_ids.setdefault(lic.pending_order_id, []).append(lic.id)

    for document in result.scalars().all():
        if document.license_id is not None and document.license_id in documents_by_license_id:
            documents_by_license_id[document.license_id].append(document)
        if document.pending_order_id is not None:
            for license_id in pending_to_license_ids.get(document.pending_order_id, []):
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
) -> LicenseResponse:
    """Convert an ORM License (with documents loaded) into an enriched response."""
    today = date.today()
    documents = [*list(license_obj.documents), *(procurement_documents or [])]

    response = LicenseResponse.model_validate(license_obj)
    creator = license_obj.__dict__.get("creator")
    response.created_by_name = creator.username if creator is not None else None
    response.created_by_email = creator.email if creator is not None else None
    response.completeness_pct = compute_completeness(license_obj, documents, mandatory_fields)
    response.days_until_expiry = compute_days_until_expiry(license_obj, today)
    response.expiration_status = compute_expiration_status(license_obj, today, notification_days)
    response.document_count = len(documents)
    response.custom_fields = [
        CustomFieldValueResponse.model_validate(value)
        for value in custom_field_values or []
    ]
    return response
