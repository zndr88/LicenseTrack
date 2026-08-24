from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License, LicenseType, MaintenanceCoverage
from app.models.reference_data import Organization
from app.models.sourcing import SourcingItem, SourcingRequest, SourcingStatus
from app.models.user import User
from app.services.audit_service import format_audit_detail, log_event
from app.services.license_service import compute_expiration_status, generate_license_ref
from app.services.lifecycle_rules import (
    assert_can_cancel_renewal,
    assert_predecessor_has_no_successor,
    clear_pending_renewal,
    mark_pending_renewal,
    mark_predecessor_renewed,
)
from app.services.maintenance_service import (
    link_maintenance_to_parent,
    sync_parent_mirror_fields,
    validate_parent_license,
)
from app.services.maintenance_rules import (
    assert_coverage_allowed_for_type,
    default_maintenance_coverage,
)
from app.services.po_total_override_service import inherit_po_total_override
from app.services.reference_data_service import resolve_license_reference_fields, resolve_organization
from app.services.renewal_workflow import build_renewal_sourcing_item
from app.services.sourcing_service import (
    cancel_sourcing_request_record,
    ensure_sourcing_request_for_item,
    sourcing_item_predecessor_ids,
)


@dataclass
class InitiateRenewalResult:
    license: License
    sourcing_item: SourcingItem


@dataclass
class InitiateRenewalBundleResult:
    licenses: list[License]
    sourcing_request: SourcingRequest
    sourcing_items: list[SourcingItem]


@dataclass
class CancelRenewalResult:
    license: License
    po_warning: bool


@dataclass
class RenewalConversionResult:
    successor: License
    primary_predecessor: License
    predecessor_ids: list[int]


@dataclass
class ExistingSuccessorLinkResult:
    predecessor: License
    successor: License
    former_successor_license_ref: str | None


def _normalized_po(value: str | None) -> str:
    return (value or "").strip().casefold()


def _assert_existing_successor_candidate(
    predecessor: License,
    successor: License,
    *,
    notification_days: int,
) -> None:
    predecessor_status = compute_expiration_status(predecessor, date.today(), notification_days)
    if predecessor_status not in {"expiring", "expired"}:
        raise HTTPException(status_code=400, detail="Only expiring or expired licenses can link an existing successor")
    if predecessor.is_retired or predecessor.lifecycle_status in {"renewed", "legacy", "pending_renewal"}:
        raise HTTPException(status_code=409, detail="This license is not eligible to link an existing successor")
    if predecessor.end_date is None or predecessor.license_type in {LicenseType.service, LicenseType.other}:
        raise HTTPException(status_code=400, detail="This license type is not eligible for renewal")
    assert_predecessor_has_no_successor(predecessor)

    if successor.id == predecessor.id:
        raise HTTPException(status_code=400, detail="A license cannot be its own successor")
    if successor.is_retired or successor.lifecycle_status is not None:
        raise HTTPException(status_code=409, detail="The selected successor is not an active or upcoming license")
    if successor.renewed_from_id is not None or successor.predecessor_id is not None or successor.coterm_from_ids:
        raise HTTPException(status_code=409, detail="The selected license already has a predecessor")
    if successor.renewed_to_id is not None:
        raise HTTPException(status_code=409, detail="The selected license is already part of another renewal chain")
    successor_status = compute_expiration_status(successor, date.today(), notification_days)
    if successor_status not in {"active", "upcoming"}:
        raise HTTPException(status_code=400, detail="The selected successor must be active or upcoming")

    predecessor_po = _normalized_po(predecessor.po_number)
    successor_po = _normalized_po(successor.po_number)
    if not predecessor_po or predecessor_po != successor_po:
        raise HTTPException(status_code=400, detail="The successor must have the same PO number")
    if predecessor.end_date is None or successor.end_date is None or successor.end_date <= predecessor.end_date:
        raise HTTPException(status_code=400, detail="The successor must extend coverage beyond the predecessor end date")
    if predecessor.start_date is not None and (
        successor.start_date is None or successor.start_date <= predecessor.start_date
    ):
        raise HTTPException(status_code=400, detail="The successor must start after the predecessor start date")


async def link_existing_successor(
    *,
    db: AsyncSession,
    predecessor_id: int,
    successor_id: int,
    actor: User,
    ip_address: str | None,
    notification_days: int,
) -> ExistingSuccessorLinkResult:
    """Adopt an existing purchased License row as a standard renewal successor."""
    result = await db.execute(
        select(License)
        .where(License.id.in_([predecessor_id, successor_id]))
        .order_by(License.id)
        .with_for_update()
    )
    licenses = {license_obj.id: license_obj for license_obj in result.scalars().all()}
    predecessor = licenses.get(predecessor_id)
    successor = licenses.get(successor_id)
    if predecessor is None:
        raise HTTPException(status_code=404, detail="Predecessor license not found")
    if successor is None:
        raise HTTPException(status_code=404, detail="Successor license not found")

    _assert_existing_successor_candidate(
        predecessor,
        successor,
        notification_days=notification_days,
    )

    former_ref = successor.license_ref
    chain_ref = predecessor.license_ref or await generate_license_ref(db)
    aliases = list(successor.license_ref_aliases or [])
    if former_ref and former_ref != chain_ref and former_ref not in aliases:
        aliases.append(former_ref)

    mark_predecessor_renewed(predecessor, successor.id)
    predecessor.existing_successor_linked_at = datetime.now(timezone.utc)
    predecessor.existing_successor_linked_by_email = actor.email
    predecessor.existing_successor_original_ref = former_ref
    successor.renewed_from_id = predecessor.id
    successor.predecessor_id = predecessor.id
    successor.license_ref = chain_ref
    successor.license_ref_aliases = aliases

    detail = format_audit_detail(
        "existing_successor_link",
        {
            "predecessorLicenseId": str(predecessor.id),
            "successorLicenseId": str(successor.id),
            "poNumber": predecessor.po_number,
            "chainLicenseRef": chain_ref,
            "formerSuccessorLicenseRef": former_ref,
            "successorStartDate": successor.start_date.isoformat() if successor.start_date else None,
            "successorEndDate": successor.end_date.isoformat() if successor.end_date else None,
            "actorEmail": actor.email,
        },
    )
    await log_event(
        db,
        "license.existing_successor_linked",
        actor=actor,
        ip_address=ip_address,
        target_type="license",
        target_id=str(predecessor.id),
        target_label=predecessor.software_description,
        detail=detail,
    )
    return ExistingSuccessorLinkResult(predecessor, successor, former_ref)


async def unlink_existing_successor(
    *,
    db: AsyncSession,
    predecessor_id: int,
    actor: User,
    ip_address: str | None,
) -> ExistingSuccessorLinkResult:
    """Undo an existing-purchase link without touching ordinary renewal chains."""
    predecessor_result = await db.execute(
        select(License).where(License.id == predecessor_id).with_for_update()
    )
    predecessor = predecessor_result.scalar_one_or_none()
    if predecessor is None:
        raise HTTPException(status_code=404, detail="Predecessor license not found")
    if predecessor.existing_successor_linked_at is None or predecessor.renewed_to_id is None:
        raise HTTPException(status_code=409, detail="This license has no linked existing successor")

    successor_result = await db.execute(
        select(License).where(License.id == predecessor.renewed_to_id).with_for_update()
    )
    successor = successor_result.scalar_one_or_none()
    if successor is None:
        raise HTTPException(status_code=409, detail="The linked successor no longer exists")
    if successor.renewed_to_id is not None:
        raise HTTPException(status_code=409, detail="Unlink the successor's later renewal before removing this link")

    former_ref = predecessor.existing_successor_original_ref
    aliases = list(successor.license_ref_aliases or [])
    if former_ref:
        successor.license_ref = former_ref
        aliases = [alias for alias in aliases if alias != former_ref]
    successor.license_ref_aliases = aliases
    successor.renewed_from_id = None
    successor.predecessor_id = None

    predecessor.lifecycle_status = None
    predecessor.renewed_to_id = None
    predecessor.existing_successor_linked_at = None
    predecessor.existing_successor_linked_by_email = None
    predecessor.existing_successor_original_ref = None

    detail = format_audit_detail(
        "existing_successor_unlink",
        {
            "predecessorLicenseId": str(predecessor.id),
            "successorLicenseId": str(successor.id),
            "restoredSuccessorLicenseRef": former_ref,
            "actorEmail": actor.email,
        },
    )
    await log_event(
        db,
        "license.existing_successor_unlinked",
        actor=actor,
        ip_address=ip_address,
        target_type="license",
        target_id=str(predecessor.id),
        target_label=predecessor.software_description,
        detail=detail,
    )
    return ExistingSuccessorLinkResult(predecessor, successor, former_ref)


async def initiate_renewal(
    *,
    db: AsyncSession,
    license_id: int,
    actor: User,
    ip_address: str | None,
) -> InitiateRenewalResult:
    """
    Begin the renewal procurement workflow for a license.

    Mutates the loaded license and creates a sourcing item. Caller commits.
    """
    result = await db.execute(select(License).where(License.id == license_id))
    license_obj = result.scalar_one_or_none()
    if license_obj is None:
        raise HTTPException(status_code=404, detail="License not found")
    mark_pending_renewal(license_obj)

    sourcing_item = build_renewal_sourcing_item(license_obj, created_by=actor.id)
    sourcing_item.publisher_id = license_obj.publisher_id
    sourcing_item.supplier_id = license_obj.supplier_id
    db.add(sourcing_item)
    await db.flush()
    await ensure_sourcing_request_for_item(db, sourcing_item, created_by=actor.id)

    await log_event(
        db,
        "license.renewal_initiated",
        actor=actor,
        ip_address=ip_address,
        target_type="license",
        target_id=str(license_id),
        target_label=license_obj.software_description,
        detail=f"sourcing item {sourcing_item.id} created",
    )

    return InitiateRenewalResult(license=license_obj, sourcing_item=sourcing_item)


def _common_or_none(values: list[str | None]) -> str | None:
    cleaned = [(value or "").strip() for value in values]
    if not cleaned or any(not value for value in cleaned):
        return None
    first = cleaned[0]
    return first if all(value.casefold() == first.casefold() for value in cleaned[1:]) else None


async def initiate_renewal_bundle(
    *,
    db: AsyncSession,
    license_ids: list[int],
    actor: User,
    ip_address: str | None,
) -> InitiateRenewalBundleResult:
    """
    Begin one procurement renewal request containing multiple license lines.

    Bundle renewal is intentionally narrower than coterm merge: licenses must
    share the same PO number and end date, but each product stays a distinct
    sourcing line inside one request.
    """
    ordered_ids = list(dict.fromkeys(license_ids))
    if len(ordered_ids) < 2:
        raise HTTPException(status_code=400, detail="At least two license IDs are required for a renewal bundle")

    result = await db.execute(select(License).where(License.id.in_(ordered_ids)).with_for_update())
    by_id = {license_obj.id: license_obj for license_obj in result.scalars().all()}
    missing = [license_id for license_id in ordered_ids if license_id not in by_id]
    if missing:
        raise HTTPException(status_code=404, detail=f"License(s) not found: {missing}")

    licenses = [by_id[license_id] for license_id in ordered_ids]
    po_numbers = {(license_obj.po_number or "").strip() for license_obj in licenses}
    if len(po_numbers) != 1 or not next(iter(po_numbers)):
        raise HTTPException(status_code=400, detail="Renewal bundle licenses must share the same PO number")
    end_dates = {license_obj.end_date for license_obj in licenses}
    if len(end_dates) != 1:
        raise HTTPException(status_code=400, detail="Renewal bundle licenses must share the same end date")

    for license_obj in licenses:
        mark_pending_renewal(license_obj)

    supplier_ids = [license_obj.supplier_id for license_obj in licenses]
    target_supplier_id = None
    target_supplier = None
    target_contact = None
    if supplier_ids and all(supplier_id is not None for supplier_id in supplier_ids) and len(set(supplier_ids)) == 1:
        supplier_record = await db.get(Organization, supplier_ids[0])
        if supplier_record is not None:
            supplier_record = await resolve_organization(
                db,
                supplier_record.name,
                role="supplier",
                create_if_missing=False,
            )
            target_supplier = supplier_record.name
            target_supplier_id = supplier_record.id
            target_contact = _common_or_none([license_obj.contact_email for license_obj in licenses])
    request = SourcingRequest(
        supplier=target_supplier,
        supplier_id=target_supplier_id,
        contact_email=target_contact,
        status=SourcingStatus.sourcing,
        created_by=actor.id,
    )
    db.add(request)
    await db.flush()

    sourcing_items: list[SourcingItem] = []
    for license_obj in licenses:
        sourcing_item = build_renewal_sourcing_item(license_obj, created_by=actor.id)
        sourcing_item.sourcing_request_id = request.id
        sourcing_item.supplier = target_supplier
        publisher_record = await db.get(Organization, license_obj.publisher_id) if license_obj.publisher_id else None
        publisher_record = await resolve_organization(
            db,
            publisher_record.name if publisher_record is not None else license_obj.publisher_name,
            role="publisher",
            create_if_missing=publisher_record is None,
        )
        sourcing_item.publisher_name = publisher_record.name
        sourcing_item.publisher_id = publisher_record.id
        sourcing_item.supplier_id = request.supplier_id
        sourcing_item.contact_email = target_contact
        db.add(sourcing_item)
        sourcing_items.append(sourcing_item)
    await db.flush()

    for license_obj, sourcing_item in zip(licenses, sourcing_items):
        await log_event(
            db,
            "license.renewal_initiated",
            actor=actor,
            ip_address=ip_address,
            target_type="license",
            target_id=str(license_obj.id),
            target_label=license_obj.software_description,
            detail=f"sourcing request {request.id}, item {sourcing_item.id} created",
        )

    return InitiateRenewalBundleResult(licenses=licenses, sourcing_request=request, sourcing_items=sourcing_items)


async def cancel_renewal(
    *,
    db: AsyncSession,
    license_id: int,
    actor: User,
    ip_address: str | None,
) -> CancelRenewalResult:
    """
    Cancel a pending renewal and clean up a sourcing-only renewal item.

    If the sourcing item is already linked to a pending order, the pending
    order is not removed; the caller can surface po_warning to the UI.
    Caller commits.
    """
    result = await db.execute(select(License).where(License.id == license_id))
    license_obj = result.scalar_one_or_none()
    if license_obj is None:
        raise HTTPException(status_code=404, detail="License not found")
    assert_can_cancel_renewal(license_obj)

    sourcing_result = await db.execute(
        select(SourcingItem).where(SourcingItem.status == SourcingStatus.sourcing)
    )
    sourcing_only_items = [
        item
        for item in sourcing_result.scalars().all()
        if license_id in sourcing_item_predecessor_ids(item)
    ]
    for item in sourcing_only_items:
        if item.sourcing_request_id is None:
            await ensure_sourcing_request_for_item(db, item, created_by=actor.id)
    affected_request_ids = sorted(
        {
            item.sourcing_request_id
            for item in sourcing_only_items
            if item.sourcing_request_id is not None
        }
    )

    for request_id in affected_request_ids:
        cancelled_request = await cancel_sourcing_request_record(db, request_id)
        await log_event(
            db,
            "sourcing_request.cancelled",
            actor=actor,
            ip_address=ip_address,
            target_type="sourcing_request",
            target_id=str(request_id),
            target_label=cancelled_request.supplier or f"Sourcing request {request_id}",
        )

    po_result = await db.execute(
        select(SourcingItem).where(SourcingItem.status == SourcingStatus.converted)
    )
    po_warning = any(
        license_id in sourcing_item_predecessor_ids(item)
        for item in po_result.scalars().all()
    )

    if license_obj.lifecycle_status == "pending_renewal":
        clear_pending_renewal(license_obj)

    return CancelRenewalResult(license=license_obj, po_warning=po_warning)


async def create_renewal_successor_from_sourcing_item(
    *,
    db: AsyncSession,
    sourcing_item: SourcingItem,
    license_data: dict,
    created_by: int | None,
    missing_license_detail: str,
    primary_predecessor: License | None = None,
    validate_maintenance_parent: bool = False,
    validation_detail_prefix: str = "",
) -> RenewalConversionResult:
    """
    Create a successor license and mark predecessor license rows as renewed.

    Handles standard and coterm renewal sourcing items. Caller commits.
    """
    if sourcing_item.renewal_for_license_id is None:
        raise ValueError("sourcing_item must reference a renewal predecessor")

    # The sourcing form is only a snapshot.  Re-read the predecessor at the
    # conversion boundary so a legacy maintenance record linked after
    # sourcing began inherits its current parent state.
    old_result = await db.execute(
        select(License)
        .where(License.id == sourcing_item.renewal_for_license_id)
        .with_for_update()
    )
    old_lic = old_result.scalar_one_or_none()
    if old_lic is None:
        raise HTTPException(status_code=404, detail=missing_license_detail)

    # This is an internal derived field, never a sourcing or conversion input.
    license_data.pop("is_legacy_unlinked_maintenance", None)
    if old_lic.license_type == LicenseType.maintenance:
        license_data = {
            **license_data,
            "license_type": old_lic.license_type,
            "license_metric": old_lic.license_metric,
            "parent_license_id": old_lic.parent_license_id,
            "is_legacy_unlinked_maintenance": (
                old_lic.is_legacy_unlinked_maintenance and old_lic.parent_license_id is None
            ),
        }
    successor_type = license_data.get("license_type", old_lic.license_type)
    try:
        successor_type = LicenseType(successor_type)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"{validation_detail_prefix}Invalid license type for renewal: {exc}",
        ) from exc
    successor_coverage = license_data.get("maintenance_coverage") or default_maintenance_coverage(
        successor_type
    )
    try:
        successor_coverage = MaintenanceCoverage(successor_coverage)
        assert_coverage_allowed_for_type(successor_type, successor_coverage)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"{validation_detail_prefix}{exc}",
        ) from exc
    license_data = {
        **license_data,
        "license_type": successor_type,
        "maintenance_coverage": successor_coverage,
    }
    await resolve_license_reference_fields(db, license_data)

    if (
        validate_maintenance_parent
        and old_lic.license_type == LicenseType.maintenance
        and not (
            old_lic.is_legacy_unlinked_maintenance
            and old_lic.parent_license_id is None
        )
    ):
        try:
            await validate_parent_license(db, old_lic.parent_license_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"{validation_detail_prefix}{exc}")

    if sourcing_item.coterm_predecessor_ids:
        return await _create_coterm_renewal_successor(
            db=db,
            sourcing_item=sourcing_item,
            license_data=license_data,
            created_by=created_by,
            primary_predecessor=old_lic,
        )

    return await _create_single_renewal_successor(
        db=db,
        old_license=old_lic,
        license_data=license_data,
        created_by=created_by,
    )


async def _create_coterm_renewal_successor(
    *,
    db: AsyncSession,
    sourcing_item: SourcingItem,
    license_data: dict,
    created_by: int | None,
    primary_predecessor: License,
) -> RenewalConversionResult:
    if "invoice_numbers" not in license_data:
        invoice_number = license_data.get("invoice_number") or ""
        license_data["invoice_numbers"] = [invoice_number] if invoice_number else []
    await inherit_po_total_override(db, license_data)

    predecessor_ids = list(sourcing_item.coterm_predecessor_ids or [])
    all_pred_result = await db.execute(select(License).where(License.id.in_(predecessor_ids)))
    all_preds = {lic.id: lic for lic in all_pred_result.scalars().all()}
    for pred in all_preds.values():
        assert_predecessor_has_no_successor(pred)

    new_lic = License(
        **license_data,
        created_by=created_by,
        renewed_from_id=predecessor_ids[0],
        predecessor_id=predecessor_ids[0],
        coterm_from_ids=predecessor_ids,
    )
    db.add(new_lic)
    await db.flush()

    primary_pred = all_preds.get(predecessor_ids[0])
    new_lic.license_ref = (
        primary_pred.license_ref if primary_pred and primary_pred.license_ref else await generate_license_ref(db)
    )

    marked_predecessor_ids: list[int] = []
    for pred_id in predecessor_ids:
        pred = all_preds.get(pred_id)
        if pred is not None:
            mark_predecessor_renewed(pred, new_lic.id)
            marked_predecessor_ids.append(pred.id)

    if (
        primary_predecessor.license_type == LicenseType.maintenance
        and primary_predecessor.parent_license_id is not None
    ):
        parent_result = await db.execute(select(License).where(License.id == primary_predecessor.parent_license_id))
        parent_lic = parent_result.scalar_one_or_none()
        if parent_lic is not None:
            await link_maintenance_to_parent(db, new_lic, parent_lic)
            parent_lic.active_maintenance_id = new_lic.id
            await sync_parent_mirror_fields(db, parent_lic)

    return RenewalConversionResult(
        successor=new_lic,
        primary_predecessor=primary_predecessor,
        predecessor_ids=marked_predecessor_ids,
    )


async def _create_single_renewal_successor(
    *,
    db: AsyncSession,
    old_license: License,
    license_data: dict,
    created_by: int | None,
) -> RenewalConversionResult:
    assert_predecessor_has_no_successor(old_license)
    if "invoice_numbers" not in license_data:
        invoice_number = license_data.get("invoice_number") or ""
        license_data["invoice_numbers"] = [invoice_number] if invoice_number else []
    await inherit_po_total_override(db, license_data)

    new_lic = License(
        **license_data,
        created_by=created_by,
        renewed_from_id=old_license.id,
        predecessor_id=old_license.id,
    )
    db.add(new_lic)
    await db.flush()
    new_lic.license_ref = old_license.license_ref or await generate_license_ref(db)

    mark_predecessor_renewed(old_license, new_lic.id)

    if old_license.license_type == LicenseType.maintenance and old_license.parent_license_id is not None:
        parent_result = await db.execute(select(License).where(License.id == old_license.parent_license_id))
        parent_lic = parent_result.scalar_one_or_none()
        if parent_lic is not None:
            await link_maintenance_to_parent(db, new_lic, parent_lic)
            parent_lic.active_maintenance_id = new_lic.id
            await sync_parent_mirror_fields(db, parent_lic)

    return RenewalConversionResult(
        successor=new_lic,
        primary_predecessor=old_license,
        predecessor_ids=[old_license.id],
    )
