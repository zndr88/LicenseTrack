from __future__ import annotations

from typing import Any

from app.models.license import LicenseType, MaintenanceCoverage, MaintenancePricingBasis
from app.services.money import MoneyParseError, parse_money


BUNDLED_INCLUDED_SUPPORT_TYPES: frozenset[LicenseType] = frozenset(
    {
        LicenseType.subscription,
        LicenseType.saas,
    }
)


def is_bundled_included_support(
    license_type: LicenseType | str | None,
    maintenance_coverage: MaintenanceCoverage | str | None,
) -> bool:
    if license_type is None or maintenance_coverage is None:
        return False
    try:
        resolved_type = LicenseType(license_type)
        resolved_coverage = MaintenanceCoverage(maintenance_coverage)
    except ValueError:
        return False
    return resolved_type in BUNDLED_INCLUDED_SUPPORT_TYPES and resolved_coverage == MaintenanceCoverage.included


def calculate_acquisition_total(
    quantity: object,
    unit_price: object,
    total_po_price: object,
) -> str | None:
    try:
        total = parse_money(total_po_price)
        if total is not None:
            return format(total, "f")
        parsed_quantity = parse_money(quantity)
        parsed_unit_price = parse_money(unit_price)
    except MoneyParseError:
        return None
    if parsed_quantity is None or parsed_unit_price is None:
        return None
    return format(parsed_quantity * parsed_unit_price, "f")


def apply_bundled_included_support_defaults(data: dict[str, Any]) -> None:
    if not is_bundled_included_support(data.get("license_type"), data.get("maintenance_coverage")):
        return

    data["maintenance_start_date"] = data.get("start_date")
    data["maintenance_end_date"] = data.get("end_date")
    data["maintenance_pricing_basis"] = MaintenancePricingBasis.flat
    data["maintenance_quantity"] = None
    data["maintenance_unit_price"] = None

    acquisition_total = calculate_acquisition_total(
        data.get("quantity"),
        data.get("unit_price") or data.get("estimated_unit_price"),
        data.get("total_po_price") or data.get("estimated_total_price"),
    )
    if acquisition_total is not None:
        data["maintenance_cost"] = acquisition_total
