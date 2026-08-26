from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class ReportFilters(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    include_retired: bool = False
    date_range: str = "all"
    date_from: date | None = None
    date_to: date | None = None
    cost_centres: list[str] = Field(default_factory=list)
    forecast_years: int = 5
    annual_uplift_pct: str = "0"
    fiscal_year_start_month: int = 1


class ReportCounts(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    records: int = 0
    total_records: int = 0
    active: int = 0
    upcoming: int = 0
    expiring: int = 0
    expired: int = 0
    unpriced: int = 0
    excluded: int = 0
    undated: int = 0
    unallocated: int = 0


class DetailedReportResponse(BaseModel):
    """Authoritative, presentation-ready report data.

    Monetary values inside the nested datasets are canonical decimal strings;
    maps are always keyed by their native ISO currency code.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    generated_at: datetime
    filters: ReportFilters
    available_cost_centres: list[str] = Field(default_factory=list)
    currency_disclaimer: str
    counts: ReportCounts
    financial_summaries: dict[str, Any]
    cost_overview: dict[str, Any]
    budget_forecast: dict[str, Any]
    publisher_data: list[dict[str, Any]]
    vendor_data: list[dict[str, Any]]
    portfolio_data: dict[str, Any]
    renewal_data: list[dict[str, Any]]
    perpetual_maintenance_data: dict[str, Any]
    purchase_order_data: dict[str, Any]


class PortfolioStatsResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    total_active: int
    total_upcoming: int
    total_expiring: int
    total_expired: int
    total_incomplete: int
    # The original key remains numeric for backwards compatibility. New
    # clients should use the canonical decimal-string companion.
    annual_cost_by_currency: dict[str, float]
    annual_cost_by_currency_decimal: dict[str, str] = Field(default_factory=dict)
    excluded_from_totals: int
    by_license_type: dict[str, int]
