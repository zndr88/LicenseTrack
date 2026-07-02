"""
Unit tests for app.services.maintenance_rules.

Pure-function tests — no database or ORM session required. Fake License objects
are built with types.SimpleNamespace.
"""

import pytest
from types import SimpleNamespace

from app.models.license import LicenseType, MaintenanceCoverage
from app.services.maintenance_rules import (
    MAINTENANCE_PARENT_TYPES,
    assert_active_maintenance_allows_retirement,
    assert_active_maintenance_allows_coverage_change,
    assert_active_maintenance_allows_type_change,
    assert_maintenance_requires_parent,
    assert_non_maintenance_has_no_parent,
    assert_parent_not_retired,
    assert_parent_type_eligible,
    default_maintenance_coverage,
)


def make_parent(license_type=LicenseType.perpetual, is_retired=False, id=1):
    return SimpleNamespace(id=id, license_type=license_type, is_retired=is_retired)


# ---------------------------------------------------------------------------
# MAINTENANCE_PARENT_TYPES constant
# ---------------------------------------------------------------------------

def test_maintenance_parent_types_contains_perpetual_oem_and_freeware():
    assert LicenseType.perpetual in MAINTENANCE_PARENT_TYPES
    assert LicenseType.oem in MAINTENANCE_PARENT_TYPES
    assert LicenseType.freeware in MAINTENANCE_PARENT_TYPES


def test_maintenance_parent_types_excludes_other_types():
    for t in (LicenseType.subscription, LicenseType.saas, LicenseType.maintenance):
        assert t not in MAINTENANCE_PARENT_TYPES


# ---------------------------------------------------------------------------
# Rule 1 — assert_parent_type_eligible
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("eligible_type", [LicenseType.perpetual, LicenseType.oem, LicenseType.freeware])
def test_parent_type_eligible_passes_for_valid_types(eligible_type):
    parent = make_parent(license_type=eligible_type)
    assert_parent_type_eligible(parent)  # must not raise


@pytest.mark.parametrize("bad_type", [
    LicenseType.subscription,
    LicenseType.saas,
    LicenseType.maintenance,
])
def test_parent_type_eligible_raises_for_invalid_types(bad_type):
    parent = make_parent(license_type=bad_type)
    with pytest.raises(ValueError, match="maintenance can only attach to perpetual, oem, or freeware"):
        assert_parent_type_eligible(parent)


# ---------------------------------------------------------------------------
# Rule 2 — assert_parent_not_retired
# ---------------------------------------------------------------------------

def test_parent_not_retired_passes_for_active_parent():
    parent = make_parent(is_retired=False)
    assert_parent_not_retired(parent)  # must not raise


def test_parent_not_retired_raises_for_retired_parent():
    parent = make_parent(is_retired=True)
    with pytest.raises(ValueError, match="is retired"):
        assert_parent_not_retired(parent)


# ---------------------------------------------------------------------------
# Rule 3 — assert_maintenance_requires_parent
# ---------------------------------------------------------------------------

def test_maintenance_requires_parent_passes_when_parent_set():
    assert_maintenance_requires_parent(LicenseType.maintenance, parent_license_id=42)


def test_maintenance_requires_parent_raises_when_parent_missing():
    with pytest.raises(ValueError, match="Maintenance licenses require parent_license_id"):
        assert_maintenance_requires_parent(LicenseType.maintenance, parent_license_id=None)


@pytest.mark.parametrize("lt", [
    LicenseType.subscription, LicenseType.perpetual, LicenseType.saas,
    LicenseType.oem, LicenseType.freeware,
])
def test_maintenance_requires_parent_is_noop_for_non_maintenance(lt):
    # Non-maintenance types should pass regardless of parent_license_id value
    assert_maintenance_requires_parent(lt, parent_license_id=None)
    assert_maintenance_requires_parent(lt, parent_license_id=99)


# ---------------------------------------------------------------------------
# Rule 4 — assert_non_maintenance_has_no_parent
# ---------------------------------------------------------------------------

def test_non_maintenance_has_no_parent_passes_when_no_parent():
    assert_non_maintenance_has_no_parent(LicenseType.subscription, parent_license_id=None)


def test_non_maintenance_has_no_parent_raises_when_parent_set():
    with pytest.raises(ValueError, match="parent_license_id is only valid for maintenance licenses"):
        assert_non_maintenance_has_no_parent(LicenseType.subscription, parent_license_id=5)


def test_non_maintenance_has_no_parent_is_noop_for_maintenance():
    # Maintenance type is exempt — the parent check is rule 3's domain
    assert_non_maintenance_has_no_parent(LicenseType.maintenance, parent_license_id=None)
    assert_non_maintenance_has_no_parent(LicenseType.maintenance, parent_license_id=10)


# ---------------------------------------------------------------------------
# Rule 5 — assert_active_maintenance_allows_type_change
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("eligible_type", [LicenseType.perpetual, LicenseType.oem, LicenseType.freeware])
def test_type_change_passes_when_new_type_still_eligible(eligible_type):
    assert_active_maintenance_allows_type_change(active_maintenance_id=7, new_type=eligible_type)


def test_type_change_passes_when_no_active_maintenance():
    assert_active_maintenance_allows_type_change(active_maintenance_id=None, new_type=LicenseType.subscription)


@pytest.mark.parametrize("bad_type", [
    LicenseType.subscription, LicenseType.saas, LicenseType.maintenance,
])
def test_type_change_raises_when_active_maintenance_and_ineligible_type(bad_type):
    with pytest.raises(ValueError, match="Disable maintenance tracking"):
        assert_active_maintenance_allows_type_change(active_maintenance_id=3, new_type=bad_type)


# ---------------------------------------------------------------------------
# Rule 6 — assert_active_maintenance_allows_retirement
# ---------------------------------------------------------------------------

def test_retirement_passes_when_no_active_maintenance():
    assert_active_maintenance_allows_retirement(
        None, was_retired=False, now_retired=True
    )


def test_retirement_passes_when_already_was_retired():
    # Idempotent retire: was already retired, still retired → not a new retirement
    assert_active_maintenance_allows_retirement(
        active_maintenance_id=2, was_retired=True, now_retired=True
    )


def test_retirement_passes_when_not_retiring():
    assert_active_maintenance_allows_retirement(
        active_maintenance_id=2, was_retired=False, now_retired=False
    )


def test_retirement_raises_when_retiring_parent_with_active_maintenance():
    with pytest.raises(ValueError, match="Disable maintenance tracking"):
        assert_active_maintenance_allows_retirement(
            active_maintenance_id=2, was_retired=False, now_retired=True
        )


@pytest.mark.parametrize("license_type", [LicenseType.subscription, LicenseType.saas])
def test_default_maintenance_coverage_is_included_for_recurring_types(license_type):
    assert default_maintenance_coverage(license_type) == MaintenanceCoverage.included


@pytest.mark.parametrize("license_type", [LicenseType.perpetual, LicenseType.oem, LicenseType.freeware])
def test_default_maintenance_coverage_is_unknown_for_optional_parent_types(license_type):
    assert default_maintenance_coverage(license_type) == MaintenanceCoverage.unknown


def test_default_maintenance_coverage_is_not_applicable_for_maintenance_child():
    assert default_maintenance_coverage(LicenseType.maintenance) == MaintenanceCoverage.not_applicable


def test_active_maintenance_requires_separately_tracked_coverage():
    with pytest.raises(ValueError, match="active maintenance/support record"):
        assert_active_maintenance_allows_coverage_change(2, MaintenanceCoverage.included)
    assert_active_maintenance_allows_coverage_change(2, MaintenanceCoverage.separately_tracked)
