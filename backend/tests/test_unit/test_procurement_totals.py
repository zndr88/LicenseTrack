from types import SimpleNamespace

from app.models.license import MaintenanceCoverage, MaintenancePricingBasis
from app.schemas.sourcing import SourcingItemCreate
from app.services.procurement_totals import procurement_line_total


def _item(**overrides):
    return SimpleNamespace(
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
