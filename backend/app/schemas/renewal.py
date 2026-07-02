from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.models.license import LicenseMetric, LicenseType, LifecycleStatus


RenewalStatus = Literal[
    "expired_unresolved",
    "due_soon",
    "pending_renewal",
    "in_sourcing",
    "pending_order",
]


class RenewalRiskFlag(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    code: str
    label: str
    severity: Literal["high", "medium", "low"]


class RenewalCustomFieldValue(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    field_key: str
    name: str
    field_type: str
    value_text: str | None = None
    value_currency: str | None = None
    section: str | None = None


class RenewalWorkbenchRow(BaseModel):
    """Read-only row returned by GET /api/renewals/workbench."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    license_id: int
    license_ref: str | None = None
    publisher_name: str
    software_description: str
    license_type: LicenseType
    license_metric: LicenseMetric
    end_date: date | None = None
    days_until_expiry: int | None = None
    renewal_status: RenewalStatus
    lifecycle_status: LifecycleStatus | None = None
    contract_number: str
    po_number: str
    supplier: str
    cost_centre: str
    budget_owner_email: str
    contact_email: str
    currency: str
    quantity: str
    unit_price: str
    estimated_annual_value: float
    completeness_pct: int | None = None
    document_count: int
    risk_flags: list[RenewalRiskFlag]
    sourcing_item_id: int | None = None
    pending_order_id: int | None = None
    pending_order_number: str | None = None
    custom_fields: list[RenewalCustomFieldValue]
