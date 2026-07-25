"""
Unit tests for renewal_workbench_model pure functions.

These tests have no database dependency — they exercise synchronous,
side-effect-free computation only.
"""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock


from app.services.renewal_workbench_model import (
    HIGH_VALUE_THRESHOLD,
    compute_risk_flags,
    estimate_annual_value,
    matches_workbench_view,
)
from app.models.license import LicenseMetric, LicenseType
from app.schemas.renewal import RenewalWorkbenchRow


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_license(
    license_type: LicenseType = LicenseType.subscription,
    quantity: str = "10",
    unit_price: str = "100.00",
    budget_owner_email: str = "owner@example.com",
    supplier: str = "Acme",
    contract_number: str = "C-001",
    po_number: str = "PO-001",
) -> MagicMock:
    """Return a mock License with the given field values."""
    obj = MagicMock()
    obj.license_type = license_type
    obj.quantity = quantity
    obj.unit_price = unit_price
    obj.budget_owner_email = budget_owner_email
    obj.supplier = supplier
    obj.contract_number = contract_number
    obj.po_number = po_number
    return obj


def _make_row(**overrides) -> RenewalWorkbenchRow:
    """Build a minimal valid RenewalWorkbenchRow for view-matching tests."""
    defaults = dict(
        license_id=1,
        publisher_name="Publisher",
        software_description="Some Software",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        renewal_status="due_soon",
        contract_number="",
        po_number="",
        supplier="",
        cost_centre="",
        budget_owner_email="owner@example.com",
        contact_email="contact@example.com",
        currency="EUR",
        quantity="10",
        unit_price="100.00",
        estimated_annual_value=1000.0,
        document_count=1,
        risk_flags=[],
        custom_fields=[],
        days_until_expiry=20,
    )
    defaults.update(overrides)
    return RenewalWorkbenchRow(**defaults)


# ---------------------------------------------------------------------------
# estimate_annual_value
# ---------------------------------------------------------------------------

class TestEstimateAnnualValue:
    def test_subscription(self):
        lic = _make_license(LicenseType.subscription, quantity="10", unit_price="150.00")
        assert estimate_annual_value(lic) == Decimal("1500.00")

    def test_perpetual_returns_zero(self):
        lic = _make_license(LicenseType.perpetual, quantity="10", unit_price="150.00")
        assert estimate_annual_value(lic) == Decimal("0")

    def test_saas(self):
        lic = _make_license(LicenseType.saas, quantity="5", unit_price="200.00")
        assert estimate_annual_value(lic) == Decimal("1000.00")

    def test_maintenance(self):
        lic = _make_license(LicenseType.maintenance, quantity="3", unit_price="50.00")
        assert estimate_annual_value(lic) == Decimal("150.00")

    def test_fractional_quantity_uses_exact_decimal_arithmetic(self):
        lic = _make_license(LicenseType.subscription, quantity="2.5", unit_price="19.99")
        assert estimate_annual_value(lic) == Decimal("49.975")

    def test_blank_quantity_returns_zero(self):
        lic = _make_license(LicenseType.subscription, quantity="", unit_price="19.99")
        assert estimate_annual_value(lic) == Decimal("0")

    def test_blank_unit_price_returns_zero(self):
        lic = _make_license(LicenseType.subscription, quantity="2.5", unit_price="")
        assert estimate_annual_value(lic) == Decimal("0")

    def test_localized_quantity_is_invalid(self):
        lic = _make_license(LicenseType.subscription, quantity="1,5", unit_price="19.99")
        assert estimate_annual_value(lic) is None

    def test_free_form_quantity_is_invalid(self):
        lic = _make_license(LicenseType.subscription, quantity="25 seats", unit_price="19.99")
        assert estimate_annual_value(lic) is None

    def test_invalid_unit_price_is_invalid(self):
        lic = _make_license(LicenseType.subscription, quantity="2.5", unit_price="EUR 19.99")
        assert estimate_annual_value(lic) is None


# ---------------------------------------------------------------------------
# compute_risk_flags
# ---------------------------------------------------------------------------

def _flag_codes(flags) -> list[str]:
    return [f.code for f in flags]


class TestComputeRiskFlags:
    def _call(self, license_obj=None, high_value_threshold=None, **kwargs):
        defaults = dict(
            renewal_status="due_soon",
            days_until_expiry=20,
            completeness_pct=100,
            document_count=1,
            estimated_annual_value=Decimal("1000"),
            window_days=90,
        )
        defaults.update(kwargs)
        if license_obj is None:
            license_obj = _make_license()
        return compute_risk_flags(license_obj, high_value_threshold=high_value_threshold, **defaults)

    def test_expired_flag_when_negative_days(self):
        flags = self._call(days_until_expiry=-1)
        codes = _flag_codes(flags)
        assert "expired" in codes

    def test_due_30_flag_when_within_30_days(self):
        flags = self._call(days_until_expiry=15)
        codes = _flag_codes(flags)
        assert "due_30" in codes
        assert "expired" not in codes

    def test_due_60_flag_when_within_60_days(self):
        flags = self._call(days_until_expiry=45)
        codes = _flag_codes(flags)
        assert "due_60" in codes
        assert "due_30" not in codes

    def test_due_90_flag_when_within_90_days(self):
        flags = self._call(days_until_expiry=75)
        codes = _flag_codes(flags)
        assert "due_90" in codes
        assert "due_60" not in codes

    def test_high_value_flag(self):
        flags = self._call(estimated_annual_value=HIGH_VALUE_THRESHOLD)
        assert "high_value" in _flag_codes(flags)

    def test_high_value_flag_above_threshold(self):
        flags = self._call(estimated_annual_value=HIGH_VALUE_THRESHOLD + Decimal("1"))
        assert "high_value" in _flag_codes(flags)

    def test_high_value_flag_uses_configured_threshold(self):
        custom_threshold = Decimal("10000")
        flags_below = self._call(estimated_annual_value=Decimal("9999"), high_value_threshold=custom_threshold)
        flags_at = self._call(estimated_annual_value=Decimal("10000"), high_value_threshold=custom_threshold)
        assert "high_value" not in _flag_codes(flags_below)
        assert "high_value" in _flag_codes(flags_at)

    def test_high_value_flag_not_set_below_default_threshold(self):
        flags = self._call(estimated_annual_value=Decimal("49999"))
        assert "high_value" not in _flag_codes(flags)

    def test_invalid_numeric_value_is_flagged_instead_of_treated_as_zero(self):
        flags = self._call(estimated_annual_value=None)
        assert "invalid_numeric" in _flag_codes(flags)
        assert "high_value" not in _flag_codes(flags)

    def test_no_documents_flag(self):
        flags = self._call(document_count=0)
        assert "no_documents" in _flag_codes(flags)

    def test_no_flags_for_clean_row(self):
        # A clean row: well in the future, fully complete, documents present
        flags = self._call(
            days_until_expiry=200,
            renewal_status="pending_renewal",
            completeness_pct=100,
            document_count=2,
            estimated_annual_value=Decimal("1000"),
            window_days=90,
        )
        assert _flag_codes(flags) == []


# ---------------------------------------------------------------------------
# matches_workbench_view
# ---------------------------------------------------------------------------

class TestMatchesWorkbenchView:
    def test_all_always_true(self):
        row = _make_row(renewal_status="in_sourcing")
        assert matches_workbench_view(row, "all") is True

    def test_needs_action_due_soon(self):
        row = _make_row(renewal_status="due_soon")
        assert matches_workbench_view(row, "needs_action") is True

    def test_needs_action_in_sourcing_false(self):
        row = _make_row(renewal_status="in_sourcing")
        assert matches_workbench_view(row, "needs_action") is False

    def test_due_30_within_range(self):
        row = _make_row(days_until_expiry=10)
        assert matches_workbench_view(row, "due_30") is True

    def test_due_30_outside_range(self):
        row = _make_row(days_until_expiry=45)
        assert matches_workbench_view(row, "due_30") is False

    def test_due_60_within_range(self):
        row = _make_row(days_until_expiry=45)
        assert matches_workbench_view(row, "due_60") is True

    def test_due_60_outside_range(self):
        row = _make_row(days_until_expiry=75)
        assert matches_workbench_view(row, "due_60") is False

    def test_missing_docs_zero(self):
        row = _make_row(document_count=0)
        assert matches_workbench_view(row, "missing_docs") is True

    def test_missing_docs_nonzero(self):
        row = _make_row(document_count=2)
        assert matches_workbench_view(row, "missing_docs") is False

    def test_high_value_uses_decimal_risk_result(self):
        row = _make_row(
            estimated_annual_value=0.0,
            risk_flags=[{"code": "high_value", "label": "High value", "severity": "high"}],
        )
        assert matches_workbench_view(row, "high_value") is True

    def test_high_value_excludes_rows_without_high_value_flag(self):
        row = _make_row(estimated_annual_value=999999.0, risk_flags=[])
        assert matches_workbench_view(row, "high_value") is False
