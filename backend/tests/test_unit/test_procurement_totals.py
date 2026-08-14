from datetime import date, datetime, timezone
from types import SimpleNamespace

from app.models.license import MaintenanceCoverage, MaintenancePricingBasis
from app.models.pending_order import PendingOrderStatus
from app.models.sourcing import SourcingStatus
from app.schemas.pending_order import PendingOrderResponse
from app.schemas.sourcing import SourcingItemCreate, SourcingRequestResponse
from app.services.procurement_totals import procurement_line_total


def _item(**overrides):
    return SimpleNamespace(
        license_type=overrides.get("license_type"),
        estimated_total_price=overrides.get("estimated_total_price"),
        maintenance_coverage=overrides.get("maintenance_coverage"),
        maintenance_cost=overrides.get("maintenance_cost"),
    )


def test_line_total_adds_included_support_to_license_acquisition() -> None:
    item = _item(
        estimated_total_price="2000.00",
        maintenance_coverage=MaintenanceCoverage.included,
        maintenance_cost="600.00",
    )

    assert procurement_line_total(item) == 2600


def test_line_total_does_not_double_count_bundled_subscription_support() -> None:
    item = _item(
        license_type="subscription",
        estimated_total_price="2000.00",
        maintenance_coverage=MaintenanceCoverage.included,
        maintenance_cost="2000.00",
    )

    assert procurement_line_total(item) == 2000


def test_line_total_can_contain_only_paid_freeware_support() -> None:
    item = _item(
        estimated_total_price=None,
        maintenance_coverage=MaintenanceCoverage.included,
        maintenance_cost="750.00",
    )

    assert procurement_line_total(item) == 750


def test_line_total_does_not_double_count_separately_tracked_support() -> None:
    item = _item(
        estimated_total_price="2000.00",
        maintenance_coverage=MaintenanceCoverage.separately_tracked,
        maintenance_cost="600.00",
    )

    assert procurement_line_total(item) == 2000


def test_per_unit_support_total_is_derived_server_side() -> None:
    item = SourcingItemCreate(
        publisher_name="LibreOffice",
        software_description="Calc",
        maintenance_coverage=MaintenanceCoverage.included,
        maintenance_pricing_basis=MaintenancePricingBasis.per_unit,
        maintenance_quantity="3",
        maintenance_unit_price="12.50",
        maintenance_cost="999.00",
    )

    assert item.maintenance_cost == "37.50"


def test_sourcing_subscription_included_support_mirrors_term_and_line_total() -> None:
    item = SourcingItemCreate(
        publisher_name="Neypla",
        software_description="Neypla Subscription",
        license_type="subscription",
        maintenance_coverage=MaintenanceCoverage.included,
        maintenance_start_date=date(2025, 1, 1),
        maintenance_end_date=date(2025, 12, 31),
        maintenance_cost="999.00",
        quantity="1",
        estimated_unit_price="3600.00",
        estimated_total_price="3600.00",
        start_date=date(2026, 1, 1),
        end_date=date(2027, 6, 30),
    )

    assert item.maintenance_start_date == date(2026, 1, 1)
    assert item.maintenance_end_date == date(2027, 6, 30)
    assert item.maintenance_pricing_basis == MaintenancePricingBasis.flat
    assert item.maintenance_cost == "3600.00"


def test_sourcing_response_total_preserves_decimal_precision_and_string_contract() -> None:
    now = datetime.now(timezone.utc)
    response = SourcingRequestResponse(
        id=1,
        status=SourcingStatus.sourcing,
        created_at=now,
        updated_at=now,
        items=[
            {
                "id": 1,
                "publisher_name": "Acme",
                "software_description": "Suite A",
                "estimated_total_price": "9007199254740992.01",
                "currency": "USD",
                "status": SourcingStatus.sourcing,
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": 2,
                "publisher_name": "Acme",
                "software_description": "Suite B",
                "estimated_total_price": "0.01",
                "currency": "USD",
                "status": SourcingStatus.sourcing,
                "created_at": now,
                "updated_at": now,
            },
        ],
    )

    assert response.total_estimated_value == "USD 9,007,199,254,740,992.02"
    assert isinstance(response.total_estimated_value, str)


def test_pending_order_response_total_preserves_decimal_precision_and_string_contract() -> None:
    now = datetime.now(timezone.utc)
    response = PendingOrderResponse(
        id=1,
        po_number="PO-1",
        status=PendingOrderStatus.pending,
        created_at=now,
        updated_at=now,
        items=[
            {
                "id": 1,
                "publisher_name": "Acme",
                "software_description": "Suite A",
                "estimated_total_price": "9007199254740992.01",
                "currency": "USD",
                "status": SourcingStatus.converted,
            },
            {
                "id": 2,
                "publisher_name": "Acme",
                "software_description": "Suite B",
                "estimated_total_price": "0.01",
                "currency": "USD",
                "status": SourcingStatus.converted,
            },
        ],
    )

    assert response.total_po_value == "$9,007,199,254,740,992.02"
    assert isinstance(response.total_po_value, str)
