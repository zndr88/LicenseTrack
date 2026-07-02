"""
Unit tests: Pydantic schema validators reject non-canonical money strings.

Step 0 spec: the API must validate and reject non-canonical values (symbols,
grouping separators, locale commas) at the schema boundary so CSV and direct
API writes cannot bypass canonical storage.

These are pure unit tests — no DB or HTTP stack needed.
"""
import pytest
from pydantic import ValidationError

from app.schemas.license import LicenseCreate, LicenseUpdate
from app.schemas.pending_order import PendingOrderConvertRequest
from app.schemas.sourcing import SourcingItemCreate, SourcingItemUpdate

INVALID_MONEY = [
    "€100",
    "$100",
    "£100",
    "1,234.50",
    "1.234,50",
    "1 234,50",
    "1234,50",
    "EUR 100",
]

_LICENSE_REQUIRED = {
    "publisher_name": "Acme",
    "software_description": "Widget",
    "license_type": "subscription",
    "license_metric": "per_user",
}

_PO_CONVERT_REQUIRED = {
    "publisher_name": "Acme",
    "software_description": "Widget",
}


# ---------------------------------------------------------------------------
# LicenseCreate / LicenseBase validators
# ---------------------------------------------------------------------------

class TestLicenseSchemaMoneyValidation:
    def test_valid_empty_unit_price(self):
        LicenseCreate(**_LICENSE_REQUIRED, unit_price="")

    def test_valid_canonical_unit_price(self):
        LicenseCreate(**_LICENSE_REQUIRED, unit_price="1234.50")

    def test_valid_canonical_total_po_price(self):
        LicenseCreate(**_LICENSE_REQUIRED, total_po_price="999.00")

    def test_valid_canonical_maintenance_cost(self):
        LicenseCreate(**_LICENSE_REQUIRED, maintenance_cost="200.00")

    def test_valid_none_maintenance_cost(self):
        LicenseCreate(**_LICENSE_REQUIRED, maintenance_cost=None)

    @pytest.mark.parametrize("bad", INVALID_MONEY)
    def test_rejects_non_canonical_unit_price(self, bad):
        with pytest.raises(ValidationError):
            LicenseCreate(**_LICENSE_REQUIRED, unit_price=bad)

    @pytest.mark.parametrize("bad", INVALID_MONEY)
    def test_rejects_non_canonical_total_po_price(self, bad):
        with pytest.raises(ValidationError):
            LicenseCreate(**_LICENSE_REQUIRED, total_po_price=bad)

    @pytest.mark.parametrize("bad", INVALID_MONEY)
    def test_rejects_non_canonical_maintenance_cost(self, bad):
        with pytest.raises(ValidationError):
            LicenseCreate(**_LICENSE_REQUIRED, maintenance_cost=bad)

    @pytest.mark.parametrize("bad", INVALID_MONEY)
    def test_rejects_non_canonical_quantity(self, bad):
        with pytest.raises(ValidationError):
            LicenseCreate(**_LICENSE_REQUIRED, quantity=bad)


class TestLicenseUpdateMoneyValidation:
    @pytest.mark.parametrize("bad", INVALID_MONEY)
    def test_rejects_non_canonical_unit_price(self, bad):
        with pytest.raises(ValidationError):
            LicenseUpdate(unit_price=bad)

    @pytest.mark.parametrize("bad", INVALID_MONEY)
    def test_rejects_non_canonical_total_po_price(self, bad):
        with pytest.raises(ValidationError):
            LicenseUpdate(total_po_price=bad)

    def test_valid_none_fields(self):
        # Partial update with no fields is valid
        LicenseUpdate()

    def test_valid_canonical_unit_price(self):
        LicenseUpdate(unit_price="500.00")

    @pytest.mark.parametrize("bad", INVALID_MONEY)
    def test_rejects_non_canonical_quantity(self, bad):
        with pytest.raises(ValidationError):
            LicenseUpdate(quantity=bad)


# ---------------------------------------------------------------------------
# SourcingItemCreate validators
# ---------------------------------------------------------------------------

class TestSourcingSchemaMoneyValidation:
    _REQUIRED = {
        "publisher_name": "Acme",
        "software_description": "Widget",
    }

    def test_valid_none_prices(self):
        SourcingItemCreate(**self._REQUIRED)

    def test_valid_canonical_unit_price(self):
        SourcingItemCreate(**self._REQUIRED, estimated_unit_price="250.00")

    @pytest.mark.parametrize("bad", INVALID_MONEY)
    def test_rejects_non_canonical_unit_price(self, bad):
        with pytest.raises(ValidationError):
            SourcingItemCreate(**self._REQUIRED, estimated_unit_price=bad)

    @pytest.mark.parametrize("bad", INVALID_MONEY)
    def test_rejects_non_canonical_total_price(self, bad):
        with pytest.raises(ValidationError):
            SourcingItemCreate(**self._REQUIRED, estimated_total_price=bad)

    @pytest.mark.parametrize("bad", INVALID_MONEY)
    def test_rejects_non_canonical_quantity(self, bad):
        with pytest.raises(ValidationError):
            SourcingItemCreate(**self._REQUIRED, quantity=bad)


class TestSourcingUpdateMoneyValidation:
    @pytest.mark.parametrize("bad", INVALID_MONEY)
    def test_rejects_non_canonical_unit_price(self, bad):
        with pytest.raises(ValidationError):
            SourcingItemUpdate(estimated_unit_price=bad)

    @pytest.mark.parametrize("bad", INVALID_MONEY)
    def test_rejects_non_canonical_quantity(self, bad):
        with pytest.raises(ValidationError):
            SourcingItemUpdate(quantity=bad)


# ---------------------------------------------------------------------------
# PendingOrderConvertRequest / BatchConvertItem validators
# ---------------------------------------------------------------------------

class TestPendingOrderConvertSchemaMoneyValidation:
    @pytest.mark.parametrize("bad", INVALID_MONEY)
    def test_rejects_non_canonical_unit_price(self, bad):
        with pytest.raises(ValidationError):
            PendingOrderConvertRequest(**_PO_CONVERT_REQUIRED, unit_price=bad)

    @pytest.mark.parametrize("bad", INVALID_MONEY)
    def test_rejects_non_canonical_total_po_price(self, bad):
        with pytest.raises(ValidationError):
            PendingOrderConvertRequest(**_PO_CONVERT_REQUIRED, total_po_price=bad)

    @pytest.mark.parametrize("bad", INVALID_MONEY)
    def test_rejects_non_canonical_quantity(self, bad):
        with pytest.raises(ValidationError):
            PendingOrderConvertRequest(**_PO_CONVERT_REQUIRED, quantity=bad)

    def test_valid_canonical_prices(self):
        PendingOrderConvertRequest(
            **_PO_CONVERT_REQUIRED,
            unit_price="100.00",
            total_po_price="300.00",
        )
