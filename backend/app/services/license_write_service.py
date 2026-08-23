"""
Write-side business rules for license mutations.

These helpers centralize validation and side effects so the route layer can
focus on HTTP concerns, auth, and response wiring.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import delete, or_, select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document, ProcurementDocument
from app.models.license import License, LicenseMaintenanceLink, LicenseType, MaintenanceCoverage
from app.models.sourcing import SourcingItem, SourcingStatus
from app.schemas.license import LicenseBatchCreateItem, LicenseCreate, LicenseUpdate
from app.services import storage
from app.services.contract_identity_service import resolve_contract_id_for_number
from app.services.lifecycle_rules import (
    REPAIR_ONLY_UPDATE_FIELDS,
    validate_general_license_update_fields,
    validate_lifecycle_repair_update,
    validate_renewal_link_invariants,
)
from app.services.maintenance_rules import (
    assert_active_maintenance_allows_retirement,
    assert_active_maintenance_allows_coverage_change,
    assert_active_maintenance_allows_type_change,
    assert_coverage_allowed_for_type,
    default_maintenance_coverage,
    assert_maintenance_requires_parent,
    assert_non_maintenance_has_no_parent,
)
from app.services.maintenance_service import (
    activate_maintenance_for_parent,
    create_maintenance_for_parent,
    detach_maintenance_from_parent,
    retire_maintenance_license,
    sync_parent_mirror_fields,
    validate_parent_license,
)
from app.services.money import is_canonical_money
from app.services.po_total_override_service import (
    inherit_po_total_override,
    resolve_reassigned_po_total_override,
)
from app.services.reference_data_service import (
    resolve_license_reference_fields,
    resolve_license_reference_updates,
)
from app.services.support_coverage_defaults import apply_bundled_included_support_defaults
from app.services.sourcing_service import sourcing_item_predecessor_ids

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DeletedLicenseRecord:
    label: str
    document_paths: tuple[str, ...]


@dataclass(frozen=True)
class DeletedLicenseBatch:
    ids: tuple[int, ...]
    document_paths: tuple[str, ...]


ALLOWED_PATCH_FIELDS: dict[str, str] = {
    "publisherName": "publisher_name",
    "softwareDescription": "software_description",
    "licenseType": "license_type",
    "licenseMetric": "license_metric",
    "portalUrl": "portal_url",
    "quantity": "quantity",
    "quantityPerUnit": "quantity_per_unit",
    "skuCode": "sku_code",
    "unitPrice": "unit_price",
    "totalPoPrice": "total_po_price",
    "currency": "currency",
    "startDate": "start_date",
    "endDate": "end_date",
    "noticeDate": "notice_date",
    "requestDate": "request_date",
    "purchaseDate": "purchase_date",
    "contractNumber": "contract_number",
    "poNumber": "po_number",
    "procurementReference": "procurement_reference",
    "invoiceNumber": "invoice_number",
    "contactEmail": "contact_email",
    "supplier": "supplier",
    "costCentre": "cost_centre",
    "budgetOwnerEmail": "budget_owner_email",
    "notes": "notes",
    "maintenanceCoverage": "maintenance_coverage",
}
DATE_PATCH_FIELDS = {"startDate", "endDate", "noticeDate"}
DATETIME_PATCH_FIELDS = {"requestDate", "purchaseDate"}
EMAIL_PATCH_FIELDS = {"contactEmail", "budgetOwnerEmail"}
NUMERIC_PATCH_FIELDS = {"quantity", "quantityPerUnit", "unitPrice", "totalPoPrice"}
MAINTENANCE_COVERAGE_VALUES = {coverage.value for coverage in MaintenanceCoverage}
BUNDLED_SUPPORT_MIRROR_FIELDS = (
    "maintenance_start_date",
    "maintenance_end_date",
    "maintenance_pricing_basis",
    "maintenance_quantity",
    "maintenance_unit_price",
    "maintenance_cost",
)


def _is_valid_email(value: str) -> bool:
    if any(ch.isspace() for ch in value):
        return False

    local_part, separator, domain = value.rpartition("@")
    if not separator or not local_part or not domain or "@" in local_part or "@" in domain:
        return False

    labels = domain.split(".")
    if len(labels) < 2:
        return False

    return all(label and not label.startswith("-") and not label.endswith("-") for label in labels)


def _sync_invoice_numbers(update_data: dict) -> None:
    """Keep the legacy primary invoice_number mirrored from invoice_numbers."""
    if "invoice_numbers" in update_data:
        invoice_numbers = update_data.get("invoice_numbers") or []
        if invoice_numbers:
            update_data["invoice_number"] = invoice_numbers[0]
            return
        primary = update_data.get("invoice_number") or ""
        if primary:
            update_data["invoice_numbers"] = [primary]
        else:
            update_data["invoice_number"] = ""
        return

    if "invoice_number" in update_data:
        primary = update_data.get("invoice_number") or ""
        update_data["invoice_number"] = primary
        update_data["invoice_numbers"] = [primary] if primary else []


def _parse_procurement_milestone_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


async def _resolve_contract_id(db: AsyncSession, contract_number: str | None) -> int | None:
    """Return the Contract.id matching contract_number (case-insensitive), or None."""
    return await resolve_contract_id_for_number(db, contract_number)


def normalise_perpetual_end_date(update_data: dict) -> None:
    """Perpetual licenses never carry an end date in persisted state."""
    if update_data.get("license_type") == LicenseType.perpetual:
        update_data["end_date"] = None


def _apply_bundled_support_defaults_to_create_data(create_data: dict) -> None:
    apply_bundled_included_support_defaults(create_data)


def _sync_bundled_support_defaults_on_license(license_obj: License) -> None:
    data = {
        "license_type": license_obj.license_type,
        "maintenance_coverage": license_obj.maintenance_coverage,
        "start_date": license_obj.start_date,
        "end_date": license_obj.end_date,
        "quantity": license_obj.quantity,
        "unit_price": license_obj.unit_price,
        "total_po_price": license_obj.total_po_price,
        "maintenance_start_date": license_obj.maintenance_start_date,
        "maintenance_end_date": license_obj.maintenance_end_date,
        "maintenance_pricing_basis": license_obj.maintenance_pricing_basis,
        "maintenance_quantity": license_obj.maintenance_quantity,
        "maintenance_unit_price": license_obj.maintenance_unit_price,
        "maintenance_cost": license_obj.maintenance_cost,
    }
    apply_bundled_included_support_defaults(data)
    for field in BUNDLED_SUPPORT_MIRROR_FIELDS:
        setattr(license_obj, field, data.get(field))


def _clear_notice_handled_if_date_changed(license_obj: License, update_data: dict) -> None:
    """Treat a changed notice date as a new reminder obligation."""
    if "notice_date" not in update_data:
        return
    if update_data.get("notice_date") == license_obj.notice_date:
        return
    license_obj.notice_handled_at = None
    license_obj.notice_handled_by_user_id = None


def _normalise_maintenance_parent_ids(parent_license_id: int | None, maintenance_parent_ids: list[int]) -> list[int]:
    parent_ids: list[int] = []
    for parent_id in (parent_license_id, *maintenance_parent_ids):
        if parent_id is None or parent_id in parent_ids:
            continue
        parent_ids.append(parent_id)
    return parent_ids


async def create_license_record(
    db: AsyncSession,
    payload: LicenseCreate,
    *,
    created_by: int,
    generate_license_ref,
    procurement_bundle_id: str | None = None,
) -> License:
    """Create a license ORM record, including maintenance-parent invariants."""
    parent_licenses: list[License] = []
    maintenance_parent_ids = _normalise_maintenance_parent_ids(
        payload.parent_license_id,
        payload.maintenance_parent_ids,
    )
    if payload.license_type == LicenseType.maintenance:
        if not maintenance_parent_ids:
            raise HTTPException(status_code=400, detail="Maintenance licenses require parent_license_id")
        try:
            for parent_id in maintenance_parent_ids:
                parent_licenses.append(await validate_parent_license(db, parent_id))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    else:
        try:
            assert_non_maintenance_has_no_parent(payload.license_type, payload.parent_license_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        if maintenance_parent_ids:
            raise HTTPException(status_code=400, detail="maintenanceParentIds is only valid for maintenance licenses")

    if payload.license_type == LicenseType.maintenance:
        create_data = payload.model_dump(by_alias=False)
        _sync_invoice_numbers(create_data)
        await resolve_license_reference_fields(db, create_data)
        create_data["procurement_bundle_id"] = procurement_bundle_id
        create_data["contract_id"] = await _resolve_contract_id(db, create_data.get("contract_number"))
        await inherit_po_total_override(db, create_data)
        maintenance_license = await create_maintenance_for_parent(
            db,
            parent_licenses[0],
            create_data,
            created_by=created_by,
        )
        for extra_parent in parent_licenses[1:]:
            await activate_maintenance_for_parent(db, maintenance_license, extra_parent)
        return maintenance_license

    create_data = payload.model_dump(by_alias=False)
    create_data.pop("maintenance_parent_ids", None)
    _sync_invoice_numbers(create_data)
    await resolve_license_reference_fields(db, create_data)
    create_data["procurement_bundle_id"] = procurement_bundle_id
    create_data["maintenance_coverage"] = create_data.get("maintenance_coverage") or default_maintenance_coverage(
        payload.license_type
    )
    try:
        assert_coverage_allowed_for_type(payload.license_type, create_data["maintenance_coverage"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if payload.license_type == LicenseType.freeware:
        create_data["unit_price"] = ""
        create_data["total_po_price"] = ""
    _apply_bundled_support_defaults_to_create_data(create_data)

    # F1: chain and lifecycle fields cannot be set at create time.
    _CREATE_CHAIN_FIELDS = REPAIR_ONLY_UPDATE_FIELDS
    blocked = sorted(f for f in _CREATE_CHAIN_FIELDS if create_data.get(f) is not None)
    if blocked:
        raise HTTPException(
            status_code=400,
            detail=f"Chain fields cannot be set on license create: {', '.join(blocked)}",
        )
    lifecycle_val = create_data.get("lifecycle_status")
    if lifecycle_val is not None and getattr(lifecycle_val, "value", lifecycle_val) not in (None, "legacy"):
        raise HTTPException(
            status_code=400,
            detail="lifecycle_status cannot be set on create except to 'legacy'.",
        )

    normalise_perpetual_end_date(create_data)
    create_data["contract_id"] = await _resolve_contract_id(db, create_data.get("contract_number"))
    await inherit_po_total_override(db, create_data)
    license_obj = License(**create_data, created_by=created_by)
    db.add(license_obj)
    await db.flush()
    license_obj.license_ref = await generate_license_ref(db)
    return license_obj


async def create_license_batch_records(
    db: AsyncSession,
    items: list[LicenseBatchCreateItem],
    *,
    created_by: int,
    generate_license_ref,
) -> list[License]:
    """Create an ordered license batch inside the caller's transaction."""
    created: list[License] = []
    procurement_bundle_id = str(uuid4()) if len(items) > 1 else None
    for item in items:
        payload = item.license
        if item.parent_line_index is not None:
            payload = payload.model_copy(
                update={"parent_license_id": created[item.parent_line_index].id},
            )
        created.append(
            await create_license_record(
                db,
                payload,
                created_by=created_by,
                generate_license_ref=generate_license_ref,
                procurement_bundle_id=procurement_bundle_id,
            )
        )
    return created


async def apply_license_update(
    db: AsyncSession,
    license_id: int,
    payload: LicenseUpdate,
) -> tuple[License, dict, dict]:
    """Apply a full license update and return (license, before, after)."""
    result = await db.execute(select(License).where(License.id == license_id))
    license_obj = result.scalar_one_or_none()
    if license_obj is None:
        raise HTTPException(status_code=404, detail="License not found")

    update_data = payload.model_dump(by_alias=False, exclude_unset=True)
    parent_update_requested = "parent_license_id" in update_data
    requested_parent_id = update_data.pop("parent_license_id", None)
    _sync_invoice_numbers(update_data)
    await resolve_license_reference_updates(db, update_data)
    if (
        "license_type" in update_data
        and "maintenance_coverage" not in update_data
        and license_obj.active_maintenance_id is None
    ):
        update_data["maintenance_coverage"] = default_maintenance_coverage(update_data["license_type"])
    normalise_perpetual_end_date(update_data)
    if update_data.get("license_type", license_obj.license_type) == LicenseType.freeware:
        update_data["unit_price"] = ""
        update_data["total_po_price"] = ""

    validate_general_license_update_fields(update_data, license_obj)
    if "po_number" in update_data:
        update_data["po_total_override"] = await resolve_reassigned_po_total_override(
            db,
            license_obj,
            update_data.get("po_number"),
        )

    new_type = update_data.get("license_type", license_obj.license_type)
    new_parent_id = requested_parent_id if parent_update_requested else license_obj.parent_license_id
    try:
        assert_coverage_allowed_for_type(
            new_type,
            update_data.get("maintenance_coverage", license_obj.maintenance_coverage),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await _validate_maintenance_parent_transition(db, license_obj, new_type, new_parent_id)
    linking_legacy_parent = (
        new_type == LicenseType.maintenance
        and parent_update_requested
        and requested_parent_id is not None
        and license_obj.is_legacy_unlinked_maintenance
        and license_obj.parent_license_id is None
    )
    if parent_update_requested and not linking_legacy_parent:
        update_data["parent_license_id"] = requested_parent_id
    if (new_type != LicenseType.maintenance or new_parent_id is not None) and not linking_legacy_parent:
        update_data["is_legacy_unlinked_maintenance"] = False

    before = {column.name: getattr(license_obj, column.name) for column in license_obj.__table__.columns}
    _clear_notice_handled_if_date_changed(license_obj, update_data)
    for field, value in update_data.items():
        setattr(license_obj, field, value)
    _sync_bundled_support_defaults_on_license(license_obj)

    if "contract_number" in update_data:
        license_obj.contract_id = await _resolve_contract_id(db, update_data.get("contract_number"))

    validate_renewal_link_invariants(license_obj)
    _validate_active_maintenance_parent_update(license_obj, before)
    await _reconcile_maintenance_relationships_after_update(
        db,
        license_obj,
        previous_parent_id=before.get("parent_license_id"),
        requested_parent_id=requested_parent_id,
        parent_update_requested=parent_update_requested,
    )
    await _sync_active_maintenance_parent_if_needed(db, license_obj)

    # Build `after` from `before` + applied changes rather than re-reading from
    # the ORM object. The db.execute() in _resolve_contract_id triggers autoflush
    # (the session has pending changes), which causes SQLAlchemy to expire
    # server-generated columns like `updated_at` (onupdate=func.now()). Accessing
    # them afterwards in an async context raises MissingGreenlet.
    # `updated_at` and `created_at` are in _DEFAULT_EXCLUDE so they don't affect
    # the audit diff regardless.
    after = dict(before)
    for field, value in update_data.items():
        if field in after:
            after[field] = value
    if "notice_date" in update_data and update_data.get("notice_date") != before.get("notice_date"):
        after["notice_handled_at"] = None
        after["notice_handled_by_user_id"] = None
    if "contract_number" in update_data:
        # contract_id is derived from contract_number but set separately above;
        # read from instance __dict__ to avoid any instrumentation lazy-load path
        after["contract_id"] = license_obj.__dict__.get("contract_id", before.get("contract_id"))
    for field in BUNDLED_SUPPORT_MIRROR_FIELDS:
        if field in after:
            after[field] = getattr(license_obj, field)
    if parent_update_requested or before.get("parent_license_id") != license_obj.parent_license_id:
        after["parent_license_id"] = license_obj.parent_license_id
    if before.get("is_legacy_unlinked_maintenance") != license_obj.is_legacy_unlinked_maintenance:
        after["is_legacy_unlinked_maintenance"] = license_obj.is_legacy_unlinked_maintenance

    return license_obj, before, after


async def apply_license_lifecycle_repair(
    db: AsyncSession,
    license_id: int,
    update_data: dict,
) -> tuple[License, dict, dict]:
    """Apply admin-only lifecycle/relationship repair fields."""
    result = await db.execute(select(License).where(License.id == license_id))
    license_obj = result.scalar_one_or_none()
    if license_obj is None:
        raise HTTPException(status_code=404, detail="License not found")
    if not update_data:
        raise HTTPException(status_code=422, detail="At least one repair field is required")

    await validate_lifecycle_repair_update(db, license_obj, update_data)

    before = {column.name: getattr(license_obj, column.name) for column in license_obj.__table__.columns}
    for field, value in update_data.items():
        setattr(license_obj, field, value)

    validate_renewal_link_invariants(license_obj)
    after = dict(before)
    for field, value in update_data.items():
        if field in after:
            after[field] = value
    return license_obj, before, after


def validate_patch_field_input(field: str, value: str | None) -> None:
    """Raise HTTP 400 when a patch field name or value is invalid."""
    if field not in ALLOWED_PATCH_FIELDS:
        raise HTTPException(
            status_code=400,
            detail=f"Field '{field}' is not allowed. Allowed: {', '.join(ALLOWED_PATCH_FIELDS)}",
        )

    if field in DATE_PATCH_FIELDS and value:
        try:
            date.fromisoformat(value)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid date for '{field}'. Expected YYYY-MM-DD.")

    if field in DATETIME_PATCH_FIELDS and value:
        try:
            _parse_procurement_milestone_datetime(value)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid date for '{field}'. Expected YYYY-MM-DD or an ISO datetime.",
            )

    if field in EMAIL_PATCH_FIELDS and value:
        if not _is_valid_email(value):
            raise HTTPException(status_code=400, detail=f"Invalid email format for '{field}'.")

    if field in NUMERIC_PATCH_FIELDS and value and not is_canonical_money(value):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid numeric value for '{field}'. Expected a plain decimal string such as '1234.50'.",
        )
    if field == "maintenanceCoverage" and value not in MAINTENANCE_COVERAGE_VALUES:
        raise HTTPException(status_code=400, detail=f"Invalid maintenance coverage: {value}")


async def apply_license_field_patch(
    db: AsyncSession,
    license_id: int,
    *,
    field: str,
    value: str | None,
) -> License:
    """Apply a single-field patch to a license and return the ORM object."""
    validate_patch_field_input(field, value)

    result = await db.execute(select(License).where(License.id == license_id))
    license_obj = result.scalar_one_or_none()
    if license_obj is None:
        raise HTTPException(status_code=404, detail="License not found")

    snake_field = ALLOWED_PATCH_FIELDS[field]
    if field in DATE_PATCH_FIELDS:
        parsed_value = date.fromisoformat(value) if value else None
        if field == "noticeDate" and parsed_value != license_obj.notice_date:
            license_obj.notice_handled_at = None
            license_obj.notice_handled_by_user_id = None
        setattr(license_obj, snake_field, parsed_value)
    elif field in DATETIME_PATCH_FIELDS:
        setattr(license_obj, snake_field, _parse_procurement_milestone_datetime(value) if value else None)
    elif field == "licenseType":
        apply_license_type_patch(license_obj, value)
    elif field == "maintenanceCoverage":
        try:
            new_coverage = MaintenanceCoverage(value)
            assert_active_maintenance_allows_coverage_change(license_obj.active_maintenance_id, new_coverage)
            assert_coverage_allowed_for_type(license_obj.license_type, new_coverage)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        license_obj.maintenance_coverage = new_coverage
    elif field == "contractNumber":
        license_obj.contract_number = value or ""
        license_obj.contract_id = await _resolve_contract_id(db, value)
    elif field == "invoiceNumber":
        primary = value or ""
        license_obj.invoice_number = primary
        license_obj.invoice_numbers = [primary] if primary else []
    elif field == "poNumber":
        license_obj.po_total_override = await resolve_reassigned_po_total_override(db, license_obj, value or "")
        license_obj.po_number = value or ""
    elif field in {"publisherName", "supplier", "costCentre"}:
        reference_updates = {
            {
                "publisherName": "publisher_name",
                "supplier": "supplier",
                "costCentre": "cost_centre",
            }[field]: value
        }
        await resolve_license_reference_updates(db, reference_updates)
        for update_field, update_value in reference_updates.items():
            setattr(license_obj, update_field, update_value)
            if update_field == "publisher_name":
                license_obj.publisher_id = reference_updates.get("publisher_id")
            elif update_field == "supplier":
                license_obj.supplier_id = reference_updates.get("supplier_id")
            elif update_field == "cost_centre":
                license_obj.cost_centre_id = reference_updates.get("cost_centre_id")
    else:
        setattr(license_obj, snake_field, value)

    _sync_bundled_support_defaults_on_license(license_obj)
    await _sync_active_maintenance_parent_if_needed(db, license_obj)
    return license_obj


async def mark_license_notice_handled(
    db: AsyncSession,
    license_id: int,
    *,
    handled_by_user_id: int,
) -> tuple[License, dict, dict]:
    """Mark the current notice date as handled for reminder suppression."""
    result = await db.execute(select(License).where(License.id == license_id))
    license_obj = result.scalar_one_or_none()
    if license_obj is None:
        raise HTTPException(status_code=404, detail="License not found")
    if license_obj.notice_date is None:
        raise HTTPException(status_code=400, detail="License has no notice date to mark handled")

    before = {column.name: getattr(license_obj, column.name) for column in license_obj.__table__.columns}
    handled_at = datetime.now(timezone.utc)
    license_obj.notice_handled_at = handled_at
    license_obj.notice_handled_by_user_id = handled_by_user_id

    after = dict(before)
    after["notice_handled_at"] = handled_at
    after["notice_handled_by_user_id"] = handled_by_user_id
    return license_obj, before, after


async def _prepare_maintenance_relationships_for_delete(
    db: AsyncSession,
    licenses: list[License],
) -> None:
    """Detach deleted parents without orphaning shared maintenance records."""
    deleted_ids = {license_obj.id for license_obj in licenses}
    if not deleted_ids:
        return

    active_ids = {license_obj.active_maintenance_id for license_obj in licenses if license_obj.active_maintenance_id}
    linked_result = await db.execute(
        select(LicenseMaintenanceLink.maintenance_license_id).where(
            LicenseMaintenanceLink.parent_license_id.in_(deleted_ids)
        )
    )
    maintenance_ids = set(linked_result.scalars().all()) | active_ids
    primary_result = await db.execute(
        select(License.id).where(
            License.id.not_in(deleted_ids),
            License.license_type == LicenseType.maintenance,
            License.parent_license_id.in_(deleted_ids),
        )
    )
    maintenance_ids.update(primary_result.scalars().all())
    if not maintenance_ids:
        return

    children_result = await db.execute(
        select(License).where(License.id.in_(maintenance_ids), License.id.not_in(deleted_ids))
    )
    children = list(children_result.scalars().all())

    # Clear parent mirrors before deleting parent rows so the consistency
    # check is not evaluated with has_maintenance still true.
    for parent in licenses:
        if parent.active_maintenance_id in maintenance_ids:
            parent.active_maintenance_id = None
            await sync_parent_mirror_fields(db, parent)

    for child in children:
        remaining_result = await db.execute(
            select(LicenseMaintenanceLink.parent_license_id)
            .where(
                LicenseMaintenanceLink.maintenance_license_id == child.id,
                LicenseMaintenanceLink.parent_license_id.not_in(deleted_ids),
            )
            .order_by(LicenseMaintenanceLink.parent_license_id)
        )
        remaining_parent_ids = list(remaining_result.scalars().all())
        if remaining_parent_ids:
            if child.parent_license_id not in remaining_parent_ids:
                child.parent_license_id = remaining_parent_ids[0]
        else:
            child.parent_license_id = None
            child.is_legacy_unlinked_maintenance = False
            child.is_retired = True

    await db.execute(
        delete(LicenseMaintenanceLink).where(LicenseMaintenanceLink.parent_license_id.in_(deleted_ids))
    )


async def bulk_delete_license_records(db: AsyncSession, license_ids: list[int]) -> DeletedLicenseBatch:
    """Delete multiple licenses and return their IDs and managed document paths."""
    if not license_ids:
        return DeletedLicenseBatch(ids=(), document_paths=())

    result = await db.execute(select(License).where(License.id.in_(license_ids)))
    found = list(result.scalars().all())
    if not found:
        return DeletedLicenseBatch(ids=(), document_paths=())

    await _assert_license_delete_allowed(db, found)

    found_ids = [license_obj.id for license_obj in found]

    await _prepare_maintenance_relationships_for_delete(db, found)
    for license_obj in found:
        if license_obj.license_type == LicenseType.maintenance:
            license_obj.is_retired = True

    document_paths = await _cleanup_license_delete_references(db, found_ids)
    for license_obj in found:
        await db.delete(license_obj)

    return DeletedLicenseBatch(ids=tuple(found_ids), document_paths=document_paths)


async def delete_license_record(db: AsyncSession, license_id: int) -> DeletedLicenseRecord:
    """Delete a single license and return its audit label and managed document paths."""
    result = await db.execute(select(License).where(License.id == license_id))
    license_obj = result.scalar_one_or_none()
    if license_obj is None:
        raise HTTPException(status_code=404, detail="License not found")

    await _assert_license_delete_allowed(db, [license_obj])

    await _prepare_maintenance_relationships_for_delete(db, [license_obj])

    if license_obj.license_type == LicenseType.maintenance:
        license_obj.is_retired = True

    label = license_obj.software_description
    document_paths = await _cleanup_license_delete_references(db, [license_id])
    await db.delete(license_obj)
    return DeletedLicenseRecord(label=label, document_paths=document_paths)


async def _cleanup_license_delete_references(db: AsyncSession, license_ids: list[int]) -> tuple[str, ...]:
    """Detach rows that may legitimately outlive deleted license records."""
    if not license_ids:
        return ()

    await _detach_cancelled_renewal_history(db, license_ids)

    document_result = await db.execute(select(Document.filename).where(Document.license_id.in_(license_ids)))
    document_paths = list(document_result.scalars().all())
    await db.execute(delete(Document).where(Document.license_id.in_(license_ids)))

    bundle_result = await db.execute(
        select(License.procurement_bundle_id).where(
            License.id.in_(license_ids),
            License.procurement_bundle_id.is_not(None),
        )
    )
    bundle_ids = set(bundle_result.scalars().all())
    if bundle_ids:
        remaining_result = await db.execute(
            select(License.procurement_bundle_id).where(
                License.procurement_bundle_id.in_(bundle_ids),
                License.id.not_in(license_ids),
            )
        )
        orphaned_bundle_ids = bundle_ids - set(remaining_result.scalars().all())
        if orphaned_bundle_ids:
            procurement_document_result = await db.execute(
                select(ProcurementDocument.filename).where(
                    ProcurementDocument.procurement_bundle_id.in_(orphaned_bundle_ids)
                )
            )
            document_paths.extend(procurement_document_result.scalars().all())
            await db.execute(
                delete(ProcurementDocument).where(
                    ProcurementDocument.procurement_bundle_id.in_(orphaned_bundle_ids)
                )
            )

    await db.execute(
        sa_update(ProcurementDocument).where(ProcurementDocument.license_id.in_(license_ids)).values(license_id=None)
    )
    await db.execute(sa_update(License).where(License.renewed_from_id.in_(license_ids)).values(renewed_from_id=None))
    await db.execute(sa_update(License).where(License.renewed_to_id.in_(license_ids)).values(renewed_to_id=None))
    await db.execute(sa_update(License).where(License.predecessor_id.in_(license_ids)).values(predecessor_id=None))
    await db.execute(
        sa_update(License)
        .where(License.active_maintenance_id.in_(license_ids))
        .values(
            active_maintenance_id=None,
            has_maintenance=False,
            maintenance_start_date=None,
            maintenance_end_date=None,
            maintenance_pricing_basis=None,
            maintenance_quantity=None,
            maintenance_unit_price=None,
            maintenance_cost=None,
        )
    )
    return tuple(document_paths)


async def _linked_renewal_sourcing_items(db: AsyncSession, license_ids: list[int]) -> list[SourcingItem]:
    deleted_ids = set(license_ids)
    result = await db.execute(
        select(SourcingItem).where(
            or_(
                SourcingItem.renewal_for_license_id.in_(license_ids),
                SourcingItem.coterm_predecessor_ids.is_not(None),
            )
        )
    )
    return [
        item
        for item in result.scalars().all()
        if deleted_ids.intersection(sourcing_item_predecessor_ids(item))
    ]


async def _detach_cancelled_renewal_history(db: AsyncSession, license_ids: list[int]) -> None:
    """Remove deleted predecessor references while preserving cancelled procurement history."""
    deleted_ids = set(license_ids)
    for item in await _linked_renewal_sourcing_items(db, license_ids):
        if item.status != SourcingStatus.cancelled:
            continue
        remaining_ids = [
            predecessor_id
            for predecessor_id in sourcing_item_predecessor_ids(item)
            if predecessor_id not in deleted_ids
        ]
        item.renewal_for_license_id = remaining_ids[0] if remaining_ids else None
        if item.coterm_predecessor_ids is not None:
            item.coterm_predecessor_ids = remaining_ids or None


def delete_license_document_files(
    stored_paths: Iterable[str],
    storage_base: str | None,
) -> int:
    """Delete committed license-owned document files without failing the HTTP deletion."""
    deleted = 0
    for stored_path in dict.fromkeys(stored_paths):
        try:
            storage.delete_file(stored_path, storage_base)
            deleted += 1
        except Exception:
            logger.warning(
                "Could not delete stored license document file %s after license deletion",
                stored_path,
                exc_info=True,
            )
    return deleted


async def _assert_license_delete_allowed(db: AsyncSession, licenses: list[License]) -> None:
    license_ids = [license_obj.id for license_obj in licenses]
    if not license_ids:
        return

    for license_obj in licenses:
        if (
            license_obj.lifecycle_status in {"pending_renewal", "renewed"}
            or license_obj.renewed_from_id is not None
            or license_obj.renewed_to_id is not None
            or license_obj.predecessor_id is not None
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "Cannot delete a license that is part of a renewal workflow or renewal history. "
                    "Cancel the renewal or repair the lifecycle links first."
                ),
            )

    renewal_items = await _linked_renewal_sourcing_items(db, license_ids)
    if any(item.status != SourcingStatus.cancelled for item in renewal_items):
        raise HTTPException(
            status_code=409,
            detail=(
                "Cannot delete a license that is linked to a renewal sourcing or pending-order item. "
                "Cancel or complete the renewal workflow first."
            ),
        )


def apply_license_type_patch(license_obj: License, value: str | None) -> None:
    """Apply licenseType patch semantics, including perpetual end-date normalization."""
    try:
        new_type = LicenseType(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid license type: {value}")

    try:
        if not (
            new_type == LicenseType.maintenance
            and license_obj.license_type == LicenseType.maintenance
            and license_obj.is_legacy_unlinked_maintenance
            and license_obj.parent_license_id is None
        ):
            assert_maintenance_requires_parent(new_type, license_obj.parent_license_id)
        assert_non_maintenance_has_no_parent(new_type, license_obj.parent_license_id)
        assert_active_maintenance_allows_type_change(license_obj.active_maintenance_id, new_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    license_obj.license_type = new_type
    if new_type != LicenseType.maintenance:
        license_obj.is_legacy_unlinked_maintenance = False
    if license_obj.active_maintenance_id is None:
        license_obj.maintenance_coverage = default_maintenance_coverage(new_type)
    if new_type == LicenseType.freeware:
        license_obj.unit_price = ""
        license_obj.total_po_price = ""
    if new_type == LicenseType.perpetual:
        license_obj.end_date = None
    _sync_bundled_support_defaults_on_license(license_obj)


async def _validate_maintenance_parent_transition(
    db: AsyncSession,
    license_obj: License,
    new_type: LicenseType,
    new_parent_id: int | None,
) -> None:
    try:
        grandfathered_legacy_unlinked = (
            new_type == LicenseType.maintenance
            and license_obj.license_type == LicenseType.maintenance
            and license_obj.is_legacy_unlinked_maintenance
            and license_obj.parent_license_id is None
            and new_parent_id is None
        )
        if not grandfathered_legacy_unlinked:
            assert_maintenance_requires_parent(new_type, new_parent_id)
        assert_non_maintenance_has_no_parent(new_type, new_parent_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if new_type == LicenseType.maintenance and new_parent_id is not None:
        try:
            await validate_parent_license(db, new_parent_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))


def _validate_active_maintenance_parent_update(license_obj: License, before: dict) -> None:
    if license_obj.active_maintenance_id is None:
        return
    try:
        assert_active_maintenance_allows_type_change(license_obj.active_maintenance_id, license_obj.license_type)
        assert_active_maintenance_allows_retirement(
            license_obj.active_maintenance_id,
            was_retired=bool(before.get("is_retired", False)),
            now_retired=license_obj.is_retired,
        )
        assert_active_maintenance_allows_coverage_change(
            license_obj.active_maintenance_id,
            license_obj.maintenance_coverage,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


async def _detach_all_maintenance_relationships(db: AsyncSession, license_obj: License) -> None:
    """Remove all association rows and clear each affected parent mirror."""
    parent_result = await db.execute(
        select(License)
        .join(
            LicenseMaintenanceLink,
            LicenseMaintenanceLink.parent_license_id == License.id,
        )
        .where(LicenseMaintenanceLink.maintenance_license_id == license_obj.id)
    )
    parents = list(parent_result.scalars().unique().all())
    if license_obj.parent_license_id is not None and all(
        parent.id != license_obj.parent_license_id for parent in parents
    ):
        primary = await db.get(License, license_obj.parent_license_id)
        if primary is not None:
            parents.append(primary)
    for parent in parents:
        await detach_maintenance_from_parent(db, license_obj, parent)
    license_obj.parent_license_id = None


async def _reconcile_maintenance_relationships_after_update(
    db: AsyncSession,
    license_obj: License,
    *,
    previous_parent_id: int | None,
    requested_parent_id: int | None,
    parent_update_requested: bool,
) -> None:
    """Apply ordinary PUT changes through maintenance link/mirror workflows."""
    if license_obj.license_type != LicenseType.maintenance:
        if previous_parent_id is not None or license_obj.parent_license_id is not None:
            await _detach_all_maintenance_relationships(db, license_obj)
        license_obj.is_legacy_unlinked_maintenance = False
        return
    if license_obj.is_retired:
        await retire_maintenance_license(db, license_obj)
        return
    if not parent_update_requested:
        return
    if previous_parent_id is not None and previous_parent_id != requested_parent_id:
        previous_parent = await db.get(License, previous_parent_id)
        if previous_parent is not None:
            await detach_maintenance_from_parent(db, license_obj, previous_parent, update_primary=False)
    if requested_parent_id is not None:
        parent = await validate_parent_license(db, requested_parent_id)
        await activate_maintenance_for_parent(db, license_obj, parent)
        # An additional association may already exist, so activation preserves
        # the old primary. A PUT explicitly selects the requested parent as the
        # compatibility primary while retaining any other valid links.
        license_obj.parent_license_id = requested_parent_id


async def _sync_active_maintenance_parent_if_needed(db: AsyncSession, license_obj: License) -> None:
    if license_obj.license_type != LicenseType.maintenance:
        return
    parent_result = await db.execute(
        select(License)
        .join(
            LicenseMaintenanceLink,
            LicenseMaintenanceLink.parent_license_id == License.id,
        )
        .where(LicenseMaintenanceLink.maintenance_license_id == license_obj.id)
    )
    parents = list(parent_result.scalars().unique().all())
    if license_obj.parent_license_id is not None and all(
        parent.id != license_obj.parent_license_id for parent in parents
    ):
        primary = await db.get(License, license_obj.parent_license_id)
        if primary is not None:
            parents.append(primary)
    for parent_license in parents:
        if parent_license.active_maintenance_id == license_obj.id:
            await sync_parent_mirror_fields(db, parent_license)
