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

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License, LicenseMaintenanceLink, LicenseType, MaintenanceCoverage
from app.services.license_service import calc_line_total, generate_license_ref
from app.services.maintenance_rules import (
    assert_parent_not_retired,
    assert_parent_type_eligible,
)
from app.services.po_total_override_service import inherit_po_total_override


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

    if active_child is None:
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
    await link_maintenance_to_parent(db, maintenance_license, parent)
    parent.active_maintenance_id = maintenance_license.id
    await sync_parent_mirror_fields(db, parent)


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
        await db.execute(
            delete(LicenseMaintenanceLink).where(
                LicenseMaintenanceLink.maintenance_license_id == active_child.id,
                LicenseMaintenanceLink.parent_license_id == parent.id,
            )
        )
        db.expire(active_child, ["maintenance_parent_links"])
        db.expire(parent, ["maintenance_child_links"])
        remaining_result = await db.execute(
            select(func.count()).select_from(LicenseMaintenanceLink).where(
                LicenseMaintenanceLink.maintenance_license_id == active_child.id
            )
        )
        if int(remaining_result.scalar_one()) == 0:
            active_child.is_retired = True

    parent.active_maintenance_id = None
    await sync_parent_mirror_fields(db, parent)
