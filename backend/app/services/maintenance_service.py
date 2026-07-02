"""
Service layer for managing maintenance-type Licenses.

A maintenance License is a License with license_type="maintenance"
linked to a parent perpetual, OEM, or freeware/open-source License via parent_license_id.
The parent carries mirror fields (has_maintenance,
maintenance_start_date, maintenance_end_date, maintenance_cost,
active_maintenance_id) that reflect the currently active
maintenance child. This service keeps those mirrors in sync.

Direct writes to the mirror fields should go through
sync_parent_mirror_fields rather than setattr on the parent.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License, LicenseType, MaintenanceCoverage
from app.services.license_service import generate_license_ref
from app.services.maintenance_rules import (
    assert_parent_not_retired,
    assert_parent_type_eligible,
)


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
        parent.maintenance_cost = None
        return

    with db.no_autoflush:
        result = await db.execute(
            select(License).where(License.id == parent.active_maintenance_id)
        )
    active_child = result.scalar_one_or_none()

    if active_child is None:
        # Defensive: FK points at a missing row. Clear the mirror
        # and the link to preserve ck_license_maintenance_link_consistency.
        parent.active_maintenance_id = None
        parent.has_maintenance = False
        parent.maintenance_start_date = None
        parent.maintenance_end_date = None
        parent.maintenance_cost = None
        return

    parent.has_maintenance = True
    parent.maintenance_coverage = MaintenanceCoverage.separately_tracked
    parent.maintenance_start_date = active_child.start_date
    parent.maintenance_end_date = active_child.end_date
    parent.maintenance_cost = active_child.total_po_price


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
    result = await db.execute(
        select(License).where(License.id == parent_license_id)
    )
    parent = result.scalar_one_or_none()
    if parent is None:
        raise ValueError(
            f"parent_license_id={parent_license_id} does not exist"
        )
    assert_parent_type_eligible(parent)
    assert_parent_not_retired(parent)
    return parent


# ---------------------------------------------------------------------
# Helpers -- create / link / disable
# ---------------------------------------------------------------------

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
    data = {
        k: v
        for k, v in maintenance_data.items()
        if k not in ("license_type", "maintenance_coverage", "parent_license_id", "created_by")
    }

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

    parent.active_maintenance_id = maintenance_license.id
    await sync_parent_mirror_fields(db, parent)

    return maintenance_license


async def disable_maintenance_for_parent(
    db: AsyncSession,
    parent: License,
) -> None:
    """
    Disable maintenance tracking on a parent License. Retires the
    currently active maintenance License (preserving history) and
    clears the parent's active_maintenance_id and mirror fields.

    If there is no active maintenance, this is a no-op (returns
    without raising).

    Caller commits.
    """
    if parent.active_maintenance_id is None:
        return

    result = await db.execute(
        select(License).where(License.id == parent.active_maintenance_id)
    )
    active_child = result.scalar_one_or_none()
    if active_child is not None:
        active_child.is_retired = True

    parent.active_maintenance_id = None
    await sync_parent_mirror_fields(db, parent)
