from decimal import Decimal

from app.models.license import MaintenanceCoverage
from app.services.money import MoneyParseError, parse_money
from app.services.support_coverage_defaults import is_bundled_included_support


def _optional_money(value: object) -> Decimal | None:
    try:
        return parse_money(value)
    except MoneyParseError:
        return None


def procurement_line_total(item: object) -> Decimal | None:
    """Return acquisition plus paid included support for one procurement line."""
    acquisition_total = _optional_money(getattr(item, "estimated_total_price", None))
    support_total = None
    coverage = getattr(item, "maintenance_coverage", None)
    if (
        (coverage == MaintenanceCoverage.included or coverage == MaintenanceCoverage.included.value)
        and not is_bundled_included_support(getattr(item, "license_type", None), coverage)
    ):
        support_total = _optional_money(getattr(item, "maintenance_cost", None))

    if acquisition_total is None and support_total is None:
        return None
    return (acquisition_total or Decimal("0")) + (support_total or Decimal("0"))


def calculate_per_unit_support_total(quantity: object, unit_price: object) -> str | None:
    parsed_quantity = _optional_money(quantity)
    parsed_unit_price = _optional_money(unit_price)
    if parsed_quantity is None or parsed_unit_price is None:
        return None
    return format(parsed_quantity * parsed_unit_price, "f")
