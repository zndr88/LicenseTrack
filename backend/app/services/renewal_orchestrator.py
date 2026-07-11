from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License, LicenseType
from app.models.sourcing import SourcingItem, SourcingStatus
from app.models.user import User
from app.services.audit_service import log_event
from app.services.license_service import generate_license_ref
from app.services.lifecycle_rules import (
    assert_predecessor_has_no_successor,
    clear_pending_renewal,
    mark_pending_renewal,
    mark_predecessor_renewed,
)
from app.services.maintenance_service import sync_parent_mirror_fields, validate_parent_license
from app.services.maintenance_rules import default_maintenance_coverage
from app.services.renewal_workflow import build_renewal_sourcing_item
from app.services.sourcing_service import ensure_sourcing_request_for_item


@dataclass
class InitiateRenewalResult:
    license: License
    sourcing_item: SourcingItem


@dataclass
class CancelRenewalResult:
    license: License
    po_warning: bool


@dataclass
class RenewalConversionResult:
    successor: License
    primary_predecessor: License
    predecessor_ids: list[int]


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
    clear_pending_renewal(license_obj)

    sourcing_result = await db.execute(
        select(SourcingItem).where(
            SourcingItem.renewal_for_license_id == license_id,
            SourcingItem.status == SourcingStatus.sourcing,
        )
    )
    sourcing_only = sourcing_result.scalar_one_or_none()
    if sourcing_only is not None:
        await db.delete(sourcing_only)

    po_result = await db.execute(
        select(SourcingItem).where(
            SourcingItem.renewal_for_license_id == license_id,
            SourcingItem.status == SourcingStatus.converted,
        )
    )
    po_warning = po_result.scalar_one_or_none() is not None

    await log_event(
        db,
        "license.renewal_cancelled",
        actor=actor,
        ip_address=ip_address,
        target_type="license",
        target_id=str(license_id),
        target_label=license_obj.software_description,
        detail="sourcing item deleted" if sourcing_only is not None else None,
    )

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

    old_lic = primary_predecessor
    if old_lic is None:
        old_result = await db.execute(
            select(License).where(License.id == sourcing_item.renewal_for_license_id)
        )
        old_lic = old_result.scalar_one_or_none()
    if old_lic is None:
        raise HTTPException(status_code=404, detail=missing_license_detail)

    if old_lic.license_type == LicenseType.maintenance:
        license_data = {
            **license_data,
            "license_type": old_lic.license_type,
            "license_metric": old_lic.license_metric,
            "parent_license_id": old_lic.parent_license_id,
        }
    successor_type = license_data.get("license_type", old_lic.license_type)
    license_data = {
        **license_data,
        "maintenance_coverage": (
            license_data.get("maintenance_coverage")
            or default_maintenance_coverage(successor_type)
        ),
    }

    if validate_maintenance_parent and old_lic.license_type == LicenseType.maintenance:
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

    predecessor_ids = list(sourcing_item.coterm_predecessor_ids or [])
    all_pred_result = await db.execute(
        select(License).where(License.id.in_(predecessor_ids))
    )
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
        primary_pred.license_ref if primary_pred and primary_pred.license_ref
        else await generate_license_ref(db)
    )

    marked_predecessor_ids: list[int] = []
    for pred_id in predecessor_ids:
        pred = all_preds.get(pred_id)
        if pred is not None:
            mark_predecessor_renewed(pred, new_lic.id)
            marked_predecessor_ids.append(pred.id)

    if primary_predecessor.license_type == LicenseType.maintenance and primary_predecessor.parent_license_id is not None:
        parent_result = await db.execute(
            select(License).where(License.id == primary_predecessor.parent_license_id)
        )
        parent_lic = parent_result.scalar_one_or_none()
        if parent_lic is not None:
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
        parent_result = await db.execute(
            select(License).where(License.id == old_license.parent_license_id)
        )
        parent_lic = parent_result.scalar_one_or_none()
        if parent_lic is not None:
            parent_lic.active_maintenance_id = new_lic.id
            await sync_parent_mirror_fields(db, parent_lic)

    return RenewalConversionResult(
        successor=new_lic,
        primary_predecessor=old_license,
        predecessor_ids=[old_license.id],
    )
