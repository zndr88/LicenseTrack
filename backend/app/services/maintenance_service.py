"""
Service layer for managing maintenance-type Licenses.

A maintenance License is a License with license_type="maintenance"
linked to one or more parent perpetual, OEM, or freeware/open-source Licenses
through license_maintenance_links. parent_license_id remains the primary
compatibility parent for older API and import flows.
The parent carries mirror fields (has_maintenance,
maintenance_start_date, maintenance_end_date, maintenance_cost,
active_maintenance_id) that reflect the currently active
maintenance child. This service keeps those mirrors in sync.

Direct writes to the mirror fields should go through
sync_parent_mirror_fields rather than setattr on the parent.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License, LicenseCoverageHistory, LicenseMaintenanceLink, LicenseType, MaintenanceCoverage
from app.services.license_service import calc_line_total, generate_license_ref, validate_term_date_order
from app.services.maintenance_rules import (
    assert_parent_not_retired,
    assert_parent_type_eligible,
)
from app.services.po_total_override_service import inherit_po_total_override
from app.services.reference_data_service import resolve_license_reference_fields


# ---------------------------------------------------------------------
# Mirror sync
# ---------------------------------------------------------------------


async def sync_parent_mirror_fields(
    db: AsyncSession,
    parent: License,
) -> None:
    """
    Update the parent License's mirror fields to reflect its
    currently active maintenance License (as pointed to by
    parent.active_maintenance_id).

    When active_maintenance_id is None, mirror fields are cleared.
    When active_maintenance_id points at a valid maintenance
    License, mirrors copy from that License's fields.

    Callers must ensure parent is already in the session. This
    function does not commit -- the caller's transaction commits.
    """
    if parent.active_maintenance_id is None:
        parent.has_maintenance = False
        parent.maintenance_start_date = None
        parent.maintenance_end_date = None
        parent.maintenance_pricing_basis = None
        parent.maintenance_quantity = None
        parent.maintenance_unit_price = None
        parent.maintenance_cost = None
        return

    with db.no_autoflush:
        result = await db.execute(select(License).where(License.id == parent.active_maintenance_id))
    active_child = result.scalar_one_or_none()

    if active_child is None or active_child.license_type != LicenseType.maintenance or active_child.is_retired:
        # Defensive: FK points at a missing row. Clear the mirror
        # and the link to preserve ck_license_maintenance_link_consistency.
        parent.active_maintenance_id = None
        parent.has_maintenance = False
        parent.maintenance_start_date = None
        parent.maintenance_end_date = None
        parent.maintenance_pricing_basis = None
        parent.maintenance_quantity = None
        parent.maintenance_unit_price = None
        parent.maintenance_cost = None
        return

    parent.has_maintenance = True
    parent.maintenance_coverage = MaintenanceCoverage.separately_tracked
    parent.maintenance_start_date = active_child.start_date
    parent.maintenance_end_date = active_child.end_date
    parent.maintenance_pricing_basis = None
    parent.maintenance_quantity = None
    parent.maintenance_unit_price = None
    # Mirror the child's own line total (qty × unit price), not the stored
    # total_po_price: that column is a deprecated whole-PO aggregate and would
    # attribute the entire PO's value to this one maintenance line.
    line_total = calc_line_total(active_child.quantity, active_child.unit_price)
    parent.maintenance_cost = format(line_total, "f") if line_total is not None else None


# ---------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------


async def validate_parent_license(
    db: AsyncSession,
    parent_license_id: int,
) -> License:
    """
    Validate that the given parent_license_id points at a License
    that can host a maintenance child (must be perpetual, OEM, or freeware,
    must not be retired).

    Returns the loaded parent License.
    Raises ValueError with a specific message on failure. The
    caller is responsible for converting to HTTPException at the
    route layer.
    """
    result = await db.execute(select(License).where(License.id == parent_license_id))
    parent = result.scalar_one_or_none()
    if parent is None:
        raise ValueError(f"parent_license_id={parent_license_id} does not exist")
    assert_parent_type_eligible(parent)
    assert_parent_not_retired(parent)
    return parent


# ---------------------------------------------------------------------
# Helpers -- create / link / disable
# ---------------------------------------------------------------------


async def _snapshot_coverage_period(
    db: AsyncSession,
    parent: License,
    *,
    maintenance_license: License | None,
    coverage_type: str,
    source_type: str,
    start_date,
    end_date,
    pricing_basis,
    quantity,
    unit_price,
    cost,
    currency,
) -> None:
    """Store one coverage period, avoiding duplicate snapshots on retries."""
    existing = await db.execute(
        select(LicenseCoverageHistory.id).where(
            LicenseCoverageHistory.parent_license_id == parent.id,
            LicenseCoverageHistory.maintenance_license_id
            == (maintenance_license.id if maintenance_license is not None else None),
            LicenseCoverageHistory.coverage_type == coverage_type,
            LicenseCoverageHistory.start_date == start_date,
            LicenseCoverageHistory.end_date == end_date,
        )
    )
    if existing.scalar_one_or_none() is not None:
        return
    db.add(
        LicenseCoverageHistory(
            parent_license_id=parent.id,
            maintenance_license_id=maintenance_license.id if maintenance_license is not None else None,
            coverage_type=coverage_type,
            source_type=source_type,
            start_date=start_date,
            end_date=end_date,
            pricing_basis=pricing_basis.value if hasattr(pricing_basis, "value") else pricing_basis,
            quantity=quantity,
            unit_price=unit_price,
            cost=cost,
            currency=currency or "EUR",
        )
    )


async def link_maintenance_to_parent(
    db: AsyncSession,
    maintenance_license: License,
    parent: License,
) -> LicenseMaintenanceLink:
    """Create the association row linking a maintenance license to a parent."""
    if maintenance_license.license_type != LicenseType.maintenance:
        raise ValueError("Only maintenance licenses can be linked to maintenance/support parents")
    if maintenance_license.is_retired:
        raise ValueError("Retired maintenance licenses cannot be linked to maintenance/support parents")
    assert_parent_type_eligible(parent)
    assert_parent_not_retired(parent)

    result = await db.execute(
        select(LicenseMaintenanceLink).where(
            LicenseMaintenanceLink.maintenance_license_id == maintenance_license.id,
            LicenseMaintenanceLink.parent_license_id == parent.id,
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        db.expire(maintenance_license, ["maintenance_parent_links"])
        db.expire(parent, ["maintenance_child_links"])
        return existing

    link = LicenseMaintenanceLink(
        maintenance_license_id=maintenance_license.id,
        parent_license_id=parent.id,
    )
    db.add(link)
    await db.flush()
    db.expire(maintenance_license, ["maintenance_parent_links"])
    db.expire(parent, ["maintenance_child_links"])
    return link


async def activate_maintenance_for_parent(
    db: AsyncSession,
    maintenance_license: License,
    parent: License,
) -> None:
    """Link a maintenance license to a parent and make it that parent's active mirror source."""
    if parent.active_maintenance_id is None and parent.maintenance_coverage == MaintenanceCoverage.included:
        await _snapshot_coverage_period(
            db,
            parent,
            maintenance_license=None,
            coverage_type=MaintenanceCoverage.included.value,
            source_type="original_included_support",
            start_date=parent.maintenance_start_date,
            end_date=parent.maintenance_end_date,
            pricing_basis=parent.maintenance_pricing_basis,
            quantity=parent.maintenance_quantity,
            unit_price=parent.maintenance_unit_price,
            cost=parent.maintenance_cost,
            currency=parent.currency,
        )
    elif parent.active_maintenance_id is not None and parent.active_maintenance_id != maintenance_license.id:
        result = await db.execute(select(License).where(License.id == parent.active_maintenance_id))
        active_child = result.scalar_one_or_none()
        if active_child is not None:
            await _snapshot_coverage_period(
                db,
                parent,
                maintenance_license=active_child,
                coverage_type=MaintenanceCoverage.separately_tracked.value,
                source_type="maintenance_record",
                start_date=active_child.start_date,
                end_date=active_child.end_date,
                pricing_basis=None,
                quantity=active_child.quantity,
                unit_price=active_child.unit_price,
                cost=format(calc_line_total(active_child.quantity, active_child.unit_price), "f")
                if calc_line_total(active_child.quantity, active_child.unit_price) is not None
                else None,
                currency=active_child.currency,
            )
    await link_maintenance_to_parent(db, maintenance_license, parent)
    # A legacy-unlinked record becomes an ordinary linked maintenance record
    # as soon as an eligible parent is chosen.  Keep the primary parent in
    # sync for the legacy single-parent API while preserving an existing
    # primary parent when this is an additional association.
    if maintenance_license.parent_license_id is None:
        maintenance_license.parent_license_id = parent.id
    maintenance_license.is_legacy_unlinked_maintenance = False
    parent.active_maintenance_id = maintenance_license.id
    await sync_parent_mirror_fields(db, parent)


async def detach_maintenance_from_parent(
    db: AsyncSession,
    maintenance_license: License,
    parent: License,
    *,
    update_primary: bool = True,
) -> list[int]:
    """Remove one parent association and return the remaining parent IDs.

    The primary ``parent_license_id`` is kept aligned with the association
    table.  The caller can then choose a new primary parent or retire an
    orphaned maintenance record.
    """
    await db.execute(
        delete(LicenseMaintenanceLink).where(
            LicenseMaintenanceLink.maintenance_license_id == maintenance_license.id,
            LicenseMaintenanceLink.parent_license_id == parent.id,
        )
    )
    if parent.active_maintenance_id == maintenance_license.id:
        parent.active_maintenance_id = None
        await sync_parent_mirror_fields(db, parent)

    remaining_result = await db.execute(
        select(LicenseMaintenanceLink.parent_license_id)
        .where(LicenseMaintenanceLink.maintenance_license_id == maintenance_license.id)
        .order_by(LicenseMaintenanceLink.parent_license_id)
    )
    remaining_parent_ids = list(remaining_result.scalars().all())
    if update_primary and maintenance_license.parent_license_id == parent.id:
        maintenance_license.parent_license_id = remaining_parent_ids[0] if remaining_parent_ids else None
    return remaining_parent_ids


async def retire_maintenance_license(
    db: AsyncSession,
    maintenance_license: License,
) -> None:
    """Retire a maintenance record and clear every parent relationship."""
    parent_result = await db.execute(
        select(License)
        .join(
            LicenseMaintenanceLink,
            LicenseMaintenanceLink.parent_license_id == License.id,
        )
        .where(LicenseMaintenanceLink.maintenance_license_id == maintenance_license.id)
    )
    parents = list(parent_result.scalars().unique().all())
    if maintenance_license.parent_license_id is not None and all(
        parent.id != maintenance_license.parent_license_id for parent in parents
    ):
        primary_result = await db.execute(
            select(License).where(License.id == maintenance_license.parent_license_id)
        )
        primary = primary_result.scalar_one_or_none()
        if primary is not None:
            parents.append(primary)

    await db.execute(
        delete(LicenseMaintenanceLink).where(
            LicenseMaintenanceLink.maintenance_license_id == maintenance_license.id
        )
    )
    for parent in parents:
        if parent.active_maintenance_id == maintenance_license.id:
            parent.active_maintenance_id = None
            await sync_parent_mirror_fields(db, parent)
    maintenance_license.parent_license_id = None
    maintenance_license.is_legacy_unlinked_maintenance = False
    maintenance_license.is_retired = True


async def create_maintenance_for_parent(
    db: AsyncSession,
    parent: License,
    maintenance_data: dict,
    created_by: Optional[int] = None,
) -> License:
    """
    Create a new maintenance-type License as a child of the given
    parent, link it as the parent's active maintenance, sync
    mirror fields.

    maintenance_data should be a dict matching License constructor
    kwargs (minus license_type, parent_license_id, created_by -- this
    function sets those).

    Returns the newly created maintenance License. Caller commits.
    """
    # Sanitize -- the service sets license_type and parent_license_id
    service_owned_fields = {
        "license_type",
        "maintenance_coverage",
        "parent_license_id",
        "maintenance_parent_ids",
        "created_by",
    }
    data = {k: v for k, v in maintenance_data.items() if k not in service_owned_fields}
    if "invoice_numbers" not in data:
        invoice_number = data.get("invoice_number") or ""
        data["invoice_numbers"] = [invoice_number] if invoice_number else []
    await resolve_license_reference_fields(db, data)
    validate_term_date_order(data.get("start_date"), data.get("end_date"))
    await inherit_po_total_override(db, data)

    maintenance_license = License(
        license_type=LicenseType.maintenance,
        maintenance_coverage=MaintenanceCoverage.not_applicable,
        parent_license_id=parent.id,
        created_by=created_by,
        **data,
    )
    db.add(maintenance_license)
    await db.flush()
    maintenance_license.license_ref = await generate_license_ref(db)
    await activate_maintenance_for_parent(db, maintenance_license, parent)

    return maintenance_license


async def disable_maintenance_for_parent(
    db: AsyncSession,
    parent: License,
) -> None:
    """
    Disable maintenance tracking on a parent License. The active maintenance
    link for this parent is removed. If no other parents are linked to that
    maintenance record, the maintenance License is retired to preserve the
    legacy single-parent behavior.

    If there is no active maintenance, this is a no-op (returns
    without raising).

    Caller commits.
    """
    if parent.active_maintenance_id is None:
        return

    result = await db.execute(select(License).where(License.id == parent.active_maintenance_id))
    active_child = result.scalar_one_or_none()
    if active_child is not None:
        remaining_parent_ids = await detach_maintenance_from_parent(db, active_child, parent)
        if not remaining_parent_ids:
            active_child.is_retired = True
            active_child.is_legacy_unlinked_maintenance = False

    parent.active_maintenance_id = None
    await sync_parent_mirror_fields(db, parent)
