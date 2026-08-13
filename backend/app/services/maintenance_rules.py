"""
MAINTENANCE_RULES - single source of truth for maintenance license invariants.

All maintenance-specific validation should call through this module rather than
duplicating checks inline. Each assertion raises ValueError with a descriptive
message; callers are responsible for converting to HTTPException at the route/service
boundary.

Invariants
----------
1. Only perpetual, OEM, and freeware/open-source license types may host a maintenance child.
2. A retired parent cannot acquire a new maintenance child.
3. A maintenance license must have parent_license_id set.
4. A non-maintenance license must not have parent_license_id set.
5. A parent with active maintenance cannot change to an ineligible type.
6. A parent with active maintenance cannot be retired.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.models.license import LicenseType, MaintenanceCoverage

if TYPE_CHECKING:
    from app.models.license import License


# Types that may act as a maintenance parent.
MAINTENANCE_PARENT_TYPES: frozenset[LicenseType] = frozenset(
    {
        LicenseType.perpetual,
        LicenseType.oem,
        LicenseType.freeware,
    }
)


def default_maintenance_coverage(license_type: LicenseType) -> MaintenanceCoverage:
    """Return the initial maintenance/support classification for a license type."""
    if license_type in (LicenseType.subscription, LicenseType.saas):
        return MaintenanceCoverage.included
    if license_type in (LicenseType.maintenance, LicenseType.service, LicenseType.other):
        return MaintenanceCoverage.not_applicable
    return MaintenanceCoverage.unknown


# ---------------------------------------------------------------------------
# Rule 1 - parent type must be eligible
# ---------------------------------------------------------------------------


def assert_parent_type_eligible(parent: "License") -> None:
    """Raise ValueError when *parent* cannot host a maintenance child (wrong type)."""
    if parent.license_type not in MAINTENANCE_PARENT_TYPES:
        raise ValueError(
            f"parent_license_id={parent.id} is {parent.license_type.value}; "
            "maintenance can only attach to perpetual, oem, or freeware Licenses"
        )


# ---------------------------------------------------------------------------
# Rule 2 - parent must not be retired
# ---------------------------------------------------------------------------


def assert_parent_not_retired(parent: "License") -> None:
    """Raise ValueError when *parent* is retired and cannot accept a new maintenance child."""
    if parent.is_retired:
        raise ValueError(f"parent_license_id={parent.id} is retired; cannot attach new maintenance")


# ---------------------------------------------------------------------------
# Rules 3 & 4 - maintenance ↔ parent_license_id consistency
# ---------------------------------------------------------------------------


def assert_maintenance_requires_parent(
    license_type: LicenseType,
    parent_license_id: int | None,
) -> None:
    """Raise ValueError when a maintenance license has no parent_license_id."""
    if license_type == LicenseType.maintenance and parent_license_id is None:
        raise ValueError("Maintenance licenses require parent_license_id")


def assert_non_maintenance_has_no_parent(
    license_type: LicenseType,
    parent_license_id: int | None,
) -> None:
    """Raise ValueError when a non-maintenance license carries a parent_license_id."""
    if license_type != LicenseType.maintenance and parent_license_id is not None:
        raise ValueError("parent_license_id is only valid for maintenance licenses")


# ---------------------------------------------------------------------------
# Rule 5 - cannot change parent type when it has active maintenance
# ---------------------------------------------------------------------------


def assert_active_maintenance_allows_type_change(
    active_maintenance_id: int | None,
    new_type: LicenseType,
) -> None:
    """Raise ValueError when a type change would leave active maintenance orphaned."""
    if active_maintenance_id is not None and new_type not in MAINTENANCE_PARENT_TYPES:
        raise ValueError(
            "This license has active maintenance. Disable maintenance tracking "
            "before changing the license type or retiring it."
        )


# ---------------------------------------------------------------------------
# Rule 6 - cannot retire a parent that has active maintenance
# ---------------------------------------------------------------------------


def assert_active_maintenance_allows_retirement(
    active_maintenance_id: int | None,
    *,
    was_retired: bool,
    now_retired: bool,
) -> None:
    """Raise ValueError when retiring a parent that still has active maintenance."""
    just_retired = now_retired and not was_retired
    if active_maintenance_id is not None and just_retired:
        raise ValueError(
            "This license has active maintenance. Disable maintenance tracking "
            "before changing the license type or retiring it."
        )


def assert_active_maintenance_allows_coverage_change(
    active_maintenance_id: int | None,
    new_coverage: MaintenanceCoverage,
) -> None:
    """Raise ValueError when an active linked record would contradict coverage."""
    if active_maintenance_id is not None and new_coverage != MaintenanceCoverage.separately_tracked:
        raise ValueError(
            "This license has an active maintenance/support record. Disable the linked "
            "contract before changing coverage away from separately tracked."
        )
