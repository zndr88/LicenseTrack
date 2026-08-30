"""
CSV import service for the license lifecycle system.

parse_csv(file_contents) reads a CSV file and returns a ParsedImportResult
containing per-row classification, validation errors, and warnings.  The
parsed result is used by:
  - POST /api/import/preview  - returns the result without writing to DB
  - POST /api/import/confirm  - re-parses and persists valid rows
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Optional

import logging

from app.services.import_.date_parser import DATE_FORMAT_VARIANTS, parse_import_date
from app.services.money import MoneyParseError, parse_localized_money

logger = logging.getLogger("license_lifecycle.csv_importer")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Maps normalised CSV header → internal field name.
# Normalised = lowercase, spaces replaced with underscores.
_HEADER_MAP: dict[str, str] = {
    "publisher_name": "publisher_name",
    "publisher": "publisher_name",
    "software_description": "software_description",
    "description": "software_description",
    "start_date": "start_date",
    "end_date": "end_date",
    "notice_date": "notice_date",
    "contract_number": "contract_number",
    "contract": "contract_number",
    "po_number": "po_number",
    "po": "po_number",
    "procurement_reference": "procurement_reference",
    "procurement_ref": "procurement_reference",
    "request_date": "request_date",
    "purchase_date": "purchase_date",
    "invoice_number": "invoice_number",
    "invoice": "invoice_number",
    "contact_email": "contact_email",
    "supplier": "supplier",
    "cost_centre": "cost_centre",
    "cost_center": "cost_centre",
    "department": "cost_centre",
    "license_type": "license_type",
    "type": "license_type",
    "purchase_type": "license_type",
    "license_metric": "license_metric",
    "metric": "license_metric",
    "parent_license_ref": "parent_license_ref",
    "parent_ref": "parent_license_ref",
    "parent": "parent_license_ref",
    "quantity": "quantity",
    "qty": "quantity",
    "purchase_quantity": "quantity",  # "Purchase Quantity" (v1.0.3 export label)
    "quantity_per_unit": "quantity_per_unit",
    "qty_per_unit": "quantity_per_unit",
    "effective_quantity": "effective_quantity",
    "sku_code": "sku_code",
    "sku": "sku_code",
    "unit_price": "unit_price",
    "total_po_price": "total_po_price",
    "currency": "currency",
    "notes": "notes",
    "budget_owner_email": "budget_owner_email",
    "secondary_contacts": "secondary_contacts",
    "secondary_contact": "secondary_contacts",
    "secondary_contact_email": "secondary_contacts",
    "application_owner": "secondary_contacts",
    "application_owner_email": "secondary_contacts",
    "app_owner": "secondary_contacts",
    "app_owner_email": "secondary_contacts",
    "technical_owner": "secondary_contacts",
    "technical_owner_email": "secondary_contacts",
    "external_ref": "external_ref",
    "license_ref": "license_ref",
    # Flexera aliases - normalised from Flexera column names
    "purchase_order_no": "po_number",  # "Purchase Order No."
    "unit_price_eur": "unit_price",  # "Unit Price (EUR)"
    "total_price_eur": "total_po_price",  # "Total Price (EUR)"
    "effective_date": "start_date",  # "Effective Date"
    "expiry_date": "end_date",  # "Expiry Date"
    "vendor": "supplier",  # "Vendor"
    "part_no_sku": "sku_code",  # "Part No./SKU"
    "contract_no": "contract_number",  # "Contract No."
    # Flexera fallback columns
    "item": "software_description",  # "Item" (fallback for description)
    # NOTE: "purchase_date" now maps to the real purchase_date procurement
    # milestone field (see above), not start_date. Flexera exports that relied
    # on Purchase Date as a start-date fallback now populate purchase_date.
    "contractenddate": "end_date",  # "ContractEndDate" (fallback for end)
    # LicenseTrack export display-label aliases (pre-round-trip-fix exports)
    "lt_ref": "license_ref",  # "LT Ref"
    "publisher_contact": "contact_email",  # "Publisher Contact"
    "budget_owner": "budget_owner_email",  # "Budget Owner"
    "application_owner_email_address": "secondary_contacts",
    "notice_deadline": "notice_date",  # "Notice Deadline"
    "portal_url": "portal_url",  # "Portal URL"
    "maintenance_coverage": "maintenance_coverage",
    "maintenance_support_coverage": "maintenance_coverage",  # "Maintenance / Support Coverage"
    "maintenance_start": "maintenance_start_date",
    "maintenance_start_date": "maintenance_start_date",
    "support_start": "maintenance_start_date",
    "support_start_date": "maintenance_start_date",
    "coverage_start": "maintenance_start_date",
    "coverage_start_date": "maintenance_start_date",
    "maintenance_end": "maintenance_end_date",
    "maintenance_end_date": "maintenance_end_date",
    "support_end": "maintenance_end_date",
    "support_end_date": "maintenance_end_date",
    "coverage_end": "maintenance_end_date",
    "coverage_end_date": "maintenance_end_date",
    "maintenance_cost": "maintenance_cost",
    "support_cost": "maintenance_cost",
    "total_support_cost": "maintenance_cost",
    "total_support_cost_eur": "maintenance_cost",
    "coverage_cost": "maintenance_cost",
    "includes_maintenance": "maintenance_coverage",
    "include_maintenance": "maintenance_coverage",
    "maintenance_included": "maintenance_coverage",
    "purchase_includes_maintenance": "maintenance_coverage",
    "purchase_includes_support": "maintenance_coverage",
    "includes_support": "maintenance_coverage",
}

_FALLBACK_HEADER_ALIASES: frozenset[str] = frozenset(
    {
        "item",
    }
)

# Export-only / computed columns (normalised header form). These are recognised
# on import but intentionally mapped to nothing, so round-tripping a full
# LicenseTrack export does not prompt the user to create custom fields for them.
# Covers computed/metadata columns. Maintenance coverage fields are importable
# for included-support rows, but linked child-maintenance mirror fields are
# ignored by the builder unless the row itself says coverage is included.
_IGNORED_HEADERS: frozenset[str] = frozenset(
    {
        "id",
        "license_record_id",
        "docs",
        "calc_total",
        "expiration",
        "complete",
        # "Total PO Value" (v1.0.3 export label) is a derived whole-PO aggregate  -
        # importing it into the per-license total_po_price column would be wrong.
        # The legacy "Total PO Price" header still maps to the stored column above
        # so pre-1.0.3 exports round-trip unchanged.
        "total_po_value",
        "created",
        "created_at",
        "created_by",
        "last_updated",
        "updated_at",
        "last_synced",
        "last_synced_at",
        "lifecycle_status",
        "sync_status",
    }
)

# Ordered list used for headers_missing reporting.
_RECOMMENDED_FIELDS = [
    "publisher_name",
    "software_description",
    "start_date",
    "end_date",
    "notice_date",
    "contract_number",
    "po_number",
    "license_type",
]
_REQUIRED_IMPORT_FIELDS = ("publisher_name", "software_description")

_VALID_LICENSE_TYPES = {
    "subscription",
    "perpetual",
    "maintenance",
    "saas",
    "oem",
    "freeware",
    "service",
    "other",
}


_VALID_LICENSE_METRICS = {
    "per_user",
    "per_device",
    "per_cpu",
    "per_core",
    "site",
    "concurrent",
    "enterprise",
    "other",
}

_INCLUDED_SUPPORT_PARENT_TYPES = {"perpetual", "oem", "freeware"}

_VALID_MAINTENANCE_COVERAGE = {
    "unknown",
    "not_applicable",
    "included",
    "separately_tracked",
}
_MAINTENANCE_COVERAGE_VALUE_ALIASES = {
    "true": "included",
    "yes": "included",
    "y": "included",
    "1": "included",
    "false": "",
    "no": "",
    "n": "",
    "0": "",
}

_TOTAL_PRICE_MISMATCH_RATIO = Decimal("10")
_TOTAL_PRICE_MISMATCH_MIN_DELTA = Decimal("1")
PRICE_MISMATCH_WARNING_PREFIX = "Calculated total (quantity x unit_price) differs from total_po_price"
EXPIRED_MAINTENANCE_WARNING = "Included maintenance coverage has expired"
MULTI_VALUE_TARGETS = frozenset({"secondary_contacts"})
_CSV_DELIMITERS = (",", ";", "\t")

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class ParsedRow:
    """Represents one parsed CSV row.

    String fields (publisher_name, end_date, ...) hold display/preview values.
    db_* fields hold typed values ready for database insertion.
    """

    row_number: int
    publisher_name: str
    software_description: str
    start_date: Optional[str]  # ISO string or None
    end_date: Optional[str]  # ISO string or None (None = perpetual)
    contract_number: str
    po_number: str
    invoice_number: str
    contact_email: str
    supplier: str
    cost_centre: str
    license_type: str  # validated enum value, or "" if unrecognised
    license_metric: str  # validated enum value, or "" if unrecognised
    quantity: str
    sku_code: str
    unit_price: str
    total_po_price: str
    currency: str
    notes: Optional[str]
    budget_owner_email: str
    external_ref: Optional[str]
    license_ref: Optional[str]
    parent_license_ref: Optional[str]
    portal_url: Optional[str]
    maintenance_coverage: Optional[str]

    # Classification
    import_status: str  # "legacy_exempt" | "active" | "legacy_incomplete" | "error"
    maintenance_start_date: Optional[str] = None
    maintenance_end_date: Optional[str] = None
    maintenance_cost: str = ""
    quantity_per_unit: str = ""
    effective_quantity: str = ""
    procurement_reference: str = ""
    secondary_contacts: list[str] = field(default_factory=list)
    validation_errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    duplicate_warnings: list[object] = field(default_factory=list)
    parent_import_row_number: Optional[int] = None
    selected_parent_license_id: Optional[int] = None
    # Explicit CSV-only maintenance parent action. This is separate from
    # selected/inferred parent state so inference cannot erase user intent.
    maintenance_parent_action: str | None = None

    # Warning tracking - not exposed in preview response directly
    currency_defaulted: bool = field(default=False, repr=False)

    # DB insertion values - not exposed in the preview response
    db_start_date: Optional[date] = field(default=None, repr=False)
    db_end_date: Optional[date] = field(default=None, repr=False)
    db_notice_date: Optional[date] = field(default=None, repr=False)
    db_maintenance_start_date: Optional[date] = field(default=None, repr=False)
    db_maintenance_end_date: Optional[date] = field(default=None, repr=False)
    db_request_date: Optional[datetime] = field(default=None, repr=False)
    db_purchase_date: Optional[datetime] = field(default=None, repr=False)

    # Update-on-LT-Ref annotation - set during preview/execute, not by parsing.
    import_action: str = field(default="create")  # "create" | "update"
    matched_license_id: Optional[int] = field(default=None)
    is_completeness_exempt: bool = field(default=False, repr=False)
    lifecycle_status: Optional[str] = field(default=None, repr=False)
    notice_date: Optional[str] = None  # ISO string or None
    resolved_publisher_id: Optional[int] = field(default=None, repr=False)
    resolved_supplier_id: Optional[int] = field(default=None, repr=False)
    resolved_cost_centre_id: Optional[int] = field(default=None, repr=False)


@dataclass
class ParsedImportResult:
    rows: list[ParsedRow]
    headers_found: list[str]  # internal field names detected in the file
    headers_missing: list[str]  # recommended fields not present in the file
    custom_rows: list[dict[str, str]] = field(default_factory=list)


@dataclass(frozen=True)
class HeaderColumnMatch:
    raw_header: str
    internal_field: str
    sample_values: list[str]


@dataclass(frozen=True)
class UnrecognizedHeader:
    raw_header: str
    sample_values: list[str]


@dataclass(frozen=True)
class CSVHeaderAnalysis:
    total_rows: int
    matched_columns: list[HeaderColumnMatch]
    unrecognized_columns: list[UnrecognizedHeader]
    missing_required: list[str]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _normalise_header(raw: str) -> str:
    """Lowercase, strip whitespace, replace any sequence of non-alphanumeric
    characters (spaces, dots, slashes, parentheses, etc.) with a single
    underscore, then strip leading/trailing underscores."""
    s = raw.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


def build_custom_field_header_map(definitions: list[object]) -> dict[str, str]:
    """Build safe normalized-header aliases for existing custom fields.

    Stable field keys always resolve. Display names resolve only when their
    normalized form is unique and does not conflict with a native or ignored
    header. This keeps native fields authoritative and avoids guessing between
    custom fields such as ``Asset Owner`` and ``Asset-Owner``.
    """
    aliases: dict[str, str] = {}
    display_candidates: dict[str, list[str]] = {}

    for definition in definitions:
        field_key = str(getattr(definition, "field_key", "") or "")
        name = str(getattr(definition, "name", "") or "")
        key_header = _normalise_header(field_key)
        name_header = _normalise_header(name)

        if key_header:
            aliases[key_header] = field_key
        if name_header:
            display_candidates.setdefault(name_header, []).append(field_key)

    reserved_headers = set(_HEADER_MAP) | set(_IGNORED_HEADERS)
    for normalized_name, field_keys in display_candidates.items():
        if normalized_name in reserved_headers or normalized_name in aliases:
            continue
        unique_keys = list(dict.fromkeys(field_keys))
        if len(unique_keys) == 1:
            aliases[normalized_name] = unique_keys[0]

    return aliases


def _parse_localized_numeric_field(
    val: str,
    field_name: str,
    errors: list[str],
    number_format_locale: str,
) -> str:
    """Parse a localized CSV numeric field into its canonical decimal string."""
    try:
        return parse_localized_money(val, number_format_locale) or ""
    except MoneyParseError as exc:
        errors.append(f"{field_name}: {exc}")
        return ""


def _add_total_price_mismatch_warning(
    quantity: str,
    unit_price: str,
    total_po_price: str,
    warnings: list[str],
) -> None:
    """Warn when Qty x Unit Price is wildly inconsistent with Total PO Price."""
    if not quantity or not unit_price or not total_po_price:
        return
    try:
        qty = Decimal(quantity)
        unit = Decimal(unit_price)
        total = Decimal(total_po_price)
    except InvalidOperation:
        return

    calculated = qty * unit
    if calculated <= 0 or total <= 0:
        return

    larger = max(calculated, total)
    smaller = min(calculated, total)
    if larger - smaller < _TOTAL_PRICE_MISMATCH_MIN_DELTA:
        return
    if larger / smaller < _TOTAL_PRICE_MISMATCH_RATIO:
        return

    warnings.append(
        f"{PRICE_MISMATCH_WARNING_PREFIX} by 10x or more; "
        "check whether the mapped quantity is a purchase quantity rather than an entitlement quantity per unit"
    )


def _calculate_line_total(quantity: str, unit_price: str, total_po_price: str) -> str | None:
    if total_po_price:
        return total_po_price
    if not quantity or not unit_price:
        return None
    try:
        return format(Decimal(quantity) * Decimal(unit_price), "f")
    except (InvalidOperation, ValueError):
        return None


def _derive_quantity_per_unit(
    quantity: str,
    quantity_per_unit: str,
    effective_quantity: str,
    warnings: list[str],
    *,
    quantity_per_unit_provided: bool,
) -> str:
    """Resolve quantity_per_unit from native/mapped import values.

    The stored commercial quantity remains ``quantity``. ``effective_quantity``
    is accepted as native source data only to derive or verify the multiplier.
    """
    if not quantity or not effective_quantity:
        return quantity_per_unit

    try:
        qty = Decimal(quantity)
        effective = Decimal(effective_quantity)
        per_unit = Decimal(quantity_per_unit) if quantity_per_unit else None
    except InvalidOperation:
        return quantity_per_unit

    if qty <= 0:
        return quantity_per_unit

    if per_unit is None:
        derived = effective / qty
        return format(derived.normalize(), "f")

    calculated = qty * per_unit
    if calculated != effective:
        warnings.append(
            "effective_quantity does not equal quantity x quantity_per_unit; "
            "effective quantity will be recalculated from stored values"
        )
    if quantity_per_unit_provided:
        return quantity_per_unit

    derived = effective / qty
    return format(derived.normalize(), "f")


def _split_secondary_contact_values(values: object) -> list[str]:
    raw_values = values if isinstance(values, list) else [values]
    contacts: list[str] = []
    seen: set[str] = set()
    for raw_value in raw_values:
        for part in re.split(r"[;,]", str(raw_value or "")):
            contact = part.strip()
            if not contact:
                continue
            key = contact.lower()
            if key in seen:
                continue
            seen.add(key)
            contacts.append(contact)
    return contacts


def _field_text(data: dict[str, object], field: str) -> str:
    return str(data.get(field, "") or "").strip()


def _normalise_enum_value(raw: str) -> str:
    """Normalize human labels like "Per User" to enum values like "per_user"."""
    value = raw.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return value.strip("_")


def _normalise_maintenance_coverage_value(raw: str) -> str | None:
    normalised = _normalise_enum_value(raw)
    normalised = _MAINTENANCE_COVERAGE_VALUE_ALIASES.get(normalised, normalised)
    return normalised or None


# Value-level aliases for human labels the LicenseTrack export (pre-round-trip-fix) wrote.
_LICENSE_TYPE_VALUE_ALIASES: dict[str, str] = {
    "freeware_open_source": "freeware",
    "open_source": "freeware",
    "software_subscription": "subscription",
    "software_maintenance": "maintenance",
    "software_baseline": "perpetual",
    "software": "perpetual",
    "baseline": "perpetual",
    "software_service": "service",
}
_LICENSE_METRIC_VALUE_ALIASES: dict[str, str] = {
    "site_license": "site",
    "concurrent_user": "concurrent",
    "concurrent_users": "concurrent",
    "enterprise_wide": "enterprise",
    "named_user": "per_user",
    "saas_user": "per_user",
    "user": "per_user",
    "named_device": "per_device",
    "device": "per_device",
    "device_core_limited": "per_core",
    "microsoft_server_core": "per_core",
    "microsoft_server_management_core": "per_core",
    "server_management_core": "per_core",
    "core_points": "per_core",
    "processor": "per_cpu",
    "processor_points": "per_cpu",
    "custom_metric": "other",
    "unknown": "other",
}

_LICENSE_TYPE_FILLER_TOKENS = {"license", "type", "set", "plan", "a", "an", "the"}


def _extract_license_type(normalised: str) -> str:
    """Normalize decorated license-type labels to a known enum value by stripping
    generic filler words and checking that all remaining tokens are a single
    known type.

    Only normalises when every non-filler token is a known license type and
    exactly one type is present - otherwise returns *normalised* unchanged so
    the validator can reject it.

    Examples:
        "perpetual_license"        → "perpetual"   (filler: "license")
        "perpetual license"        → "perpetual"   (after _normalise_enum_value)
        "set_subscription_license" → "subscription" (fillers: "set", "license")
        "saas"                     → "saas"         (already valid)
        "perpetual_site"           → "perpetual_site" ("site" is not filler → reject)
        "maintenance_subscription" → "maintenance_subscription" (ambiguous → reject)
    """
    if not normalised:
        return normalised
    tokens = set(normalised.split("_")) - _LICENSE_TYPE_FILLER_TOKENS
    type_tokens = tokens & _VALID_LICENSE_TYPES
    non_type_tokens = tokens - _VALID_LICENSE_TYPES
    if len(type_tokens) == 1 and len(non_type_tokens) == 0:
        return type_tokens.pop()
    return normalised


def _parse_datetime(raw: str, date_format: str) -> tuple[Optional[datetime], str]:
    """Parse a procurement-milestone datetime (request_date / purchase_date).

    Accepts ISO 8601 dates/datetimes (as emitted by LicenseTrack exports, so
    imports round-trip) and plain dates in the declared date_format (for
    hand-authored CSVs). Returns a timezone-aware UTC datetime, or a non-empty
    error message when the value is present but unparseable.
    """
    raw = raw.strip().strip("'\"")
    if not raw:
        return None, ""

    # ISO 8601 date or datetime - the export round-trip path.
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return (parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)), ""
    except ValueError:
        pass

    # Declared date format (DD/MM/YYYY, MM/DD/YYYY, ...) - hand-authored CSVs.
    for fmt in DATE_FORMAT_VARIANTS.get(date_format, ("%d/%m/%Y",)):
        try:
            parsed = datetime.strptime(raw, fmt)
            return parsed.replace(tzinfo=timezone.utc), ""
        except ValueError:
            continue
    return None, (f"Unrecognised date format: {raw!r}; expected ISO YYYY-MM-DD or declared format {date_format}")


def _parse_date_field(
    data: dict[str, object],
    field_name: str,
    date_format: str,
    errors: list[str],
    warnings: list[str],
) -> tuple[date | None, str | None, bool]:
    raw = _field_text(data, field_name)
    if not raw:
        return None, None, False
    parsed, _is_perpetual, error, warning = parse_import_date(raw, date_format)
    if error:
        errors.append(f"{field_name}: {error}")
        return None, None, True
    if warning:
        warnings.append(f"{field_name}: {warning}")
    return parsed, parsed.isoformat() if parsed is not None else None, False


def _classify_row(
    publisher_name: str,
    software_description: str,
    db_end_date: Optional[date],
    license_type: str,
) -> tuple[str, str | None, bool]:
    """Return (import_status, lifecycle_status, is_completeness_exempt).

    Priority:
      1. "error"             - both required fields missing
      2. "legacy_incomplete" - expiring end_date in past + a required field missing
      3. "legacy_exempt"     - expiring end_date in past, all required fields present
      4. "active"            - everything else (future/perpetual/no date)

    Perpetual, OEM, and freeware rows are non-expiring license records. Their
    imported expiry dates represent included support coverage and must not make
    the license itself legacy.
    """
    today = date.today()
    has_publisher = bool(publisher_name)
    has_description = bool(software_description)
    non_expiring_license = license_type in _INCLUDED_SUPPORT_PARENT_TYPES
    end_in_past = not non_expiring_license and db_end_date is not None and db_end_date < today

    if not has_publisher and not has_description:
        return "error", None, False

    if end_in_past and (not has_publisher or not has_description):
        return "legacy_incomplete", "legacy", False

    if end_in_past:
        return "legacy_exempt", "legacy", True

    return "active", None, False


def _parse_row(
    row_number: int,
    data: dict[str, object],
    default_currency: str = "EUR",
    number_format_locale: str = "en-US",
    date_format: str = "DD/MM/YYYY",
) -> ParsedRow:
    """Parse and validate one CSV row."""
    errors: list[str] = []
    warnings: list[str] = []
    has_parse_error = False

    # -- Required fields --------------------------------------------------
    publisher_name = _field_text(data, "publisher_name")
    software_description = _field_text(data, "software_description")

    # -- Date fields ------------------------------------------------------
    db_start_date, start_date_str, start_error = _parse_date_field(
        data, "start_date", date_format, errors, warnings
    )
    db_end_date, end_date_str, end_error = _parse_date_field(
        data, "end_date", date_format, errors, warnings
    )
    db_notice_date, notice_date_str, notice_error = _parse_date_field(
        data, "notice_date", date_format, errors, warnings
    )
    db_maintenance_start_date, maintenance_start_date_str, maintenance_start_error = _parse_date_field(
        data, "maintenance_start_date", date_format, errors, warnings
    )
    db_maintenance_end_date, maintenance_end_date_str, maintenance_end_error = _parse_date_field(
        data, "maintenance_end_date", date_format, errors, warnings
    )
    has_parse_error = any(
        (start_error, end_error, notice_error, maintenance_start_error, maintenance_end_error)
    )
    if db_notice_date is not None and db_end_date is not None and db_notice_date > db_end_date:
        warnings.append("notice_date falls after end_date")

    # -- Procurement milestone datetimes ----------------------------------
    db_request_date, request_err = _parse_datetime(_field_text(data, "request_date"), date_format)
    if request_err:
        errors.append(f"request_date: {request_err}")
        has_parse_error = True

    db_purchase_date, purchase_err = _parse_datetime(_field_text(data, "purchase_date"), date_format)
    if purchase_err:
        errors.append(f"purchase_date: {purchase_err}")
        has_parse_error = True

    # -- Enum fields -------------------------------------------------------
    has_enum_error = False

    license_type = _extract_license_type(_normalise_enum_value(_field_text(data, "license_type")))
    license_type = _LICENSE_TYPE_VALUE_ALIASES.get(license_type, license_type)
    if license_type and license_type not in _VALID_LICENSE_TYPES:
        errors.append(f"Unrecognised license_type {license_type!r}; correct the value or remove the column")
        license_type = ""
        has_enum_error = True

    license_metric = _normalise_enum_value(_field_text(data, "license_metric"))
    license_metric = _LICENSE_METRIC_VALUE_ALIASES.get(license_metric, license_metric)
    if license_metric and license_metric not in _VALID_LICENSE_METRICS:
        errors.append(f"Unrecognised license_metric {license_metric!r}; correct the value or remove the column")
        license_metric = ""
        has_enum_error = True

    # -- Currency default -------------------------------------------------
    _currency_raw = _field_text(data, "currency")
    currency = _currency_raw or default_currency
    currency_defaulted = not bool(_currency_raw)
    numeric_error_count = len(errors)
    quantity = _parse_localized_numeric_field(_field_text(data, "quantity"), "quantity", errors, number_format_locale)
    quantity_per_unit_raw = _field_text(data, "quantity_per_unit")
    quantity_per_unit = _parse_localized_numeric_field(
        quantity_per_unit_raw, "quantity_per_unit", errors, number_format_locale
    )
    effective_quantity = _parse_localized_numeric_field(
        _field_text(data, "effective_quantity"), "effective_quantity", errors, number_format_locale
    )
    unit_price = _parse_localized_numeric_field(_field_text(data, "unit_price"), "unit_price", errors, number_format_locale)
    total_po_price = _parse_localized_numeric_field(
        _field_text(data, "total_po_price"), "total_po_price", errors, number_format_locale
    )
    maintenance_cost = _parse_localized_numeric_field(
        _field_text(data, "maintenance_cost"), "maintenance_cost", errors, number_format_locale
    )
    has_parse_error = has_parse_error or len(errors) > numeric_error_count
    quantity_per_unit = _derive_quantity_per_unit(
        quantity,
        quantity_per_unit,
        effective_quantity,
        warnings,
        quantity_per_unit_provided=bool(quantity_per_unit_raw.strip()),
    )
    _add_total_price_mismatch_warning(quantity, unit_price, total_po_price, warnings)

    # -- Budget owner email - reject SMTP command-injection payloads ------
    # (CVE-2026-53533 hardening: this value eventually reaches
    # aiosmtplib.send(recipients=...) via the daily notification job.)
    budget_owner_email = _field_text(data, "budget_owner_email")
    if any(ch in budget_owner_email for ch in ("\r", "\n", "\x00")):
        errors.append("budget_owner_email contains invalid characters (line breaks or null bytes)")
        has_parse_error = True
        budget_owner_email = ""

    secondary_contacts = _split_secondary_contact_values(data.get("secondary_contacts", []))
    if any(any(ch in contact for ch in ("\r", "\n", "\x00")) for contact in secondary_contacts):
        errors.append("secondary_contacts contains invalid characters (line breaks or null bytes)")
        has_parse_error = True
        secondary_contacts = []

    # -- Parent linkage (for maintenance rows) ----------------------------
    parent_license_ref = _field_text(data, "parent_license_ref") or None

    # -- Optional enrichment fields ----------------------------------------
    portal_url = _field_text(data, "portal_url") or None

    maintenance_coverage_raw = _normalise_maintenance_coverage_value(_field_text(data, "maintenance_coverage"))
    if maintenance_coverage_raw and maintenance_coverage_raw not in _VALID_MAINTENANCE_COVERAGE:
        warnings.append(f"Unrecognised maintenance_coverage {maintenance_coverage_raw!r}; defaulting to 'unknown'")
        maintenance_coverage_raw = None
    maintenance_coverage = maintenance_coverage_raw or None

    if maintenance_coverage == "included" and license_type in _INCLUDED_SUPPORT_PARENT_TYPES:
        if db_maintenance_start_date is None and db_start_date is not None:
            db_maintenance_start_date = db_start_date
            maintenance_start_date_str = start_date_str
        if db_maintenance_end_date is None and db_end_date is not None:
            db_maintenance_end_date = db_end_date
            maintenance_end_date_str = end_date_str
        if not maintenance_cost:
            fallback_cost = _calculate_line_total(quantity, unit_price, total_po_price)
            if fallback_cost:
                maintenance_cost = fallback_cost
                warnings.append(
                    "maintenance_cost defaulted from the license line total for included support; "
                    "verify this is not the perpetual acquisition value."
                )

    # -- Classification ---------------------------------------------------
    if (
        maintenance_coverage == "included"
        and license_type in _INCLUDED_SUPPORT_PARENT_TYPES
        and db_maintenance_end_date is not None
        and db_maintenance_end_date < date.today()
    ):
        warnings.append(EXPIRED_MAINTENANCE_WARNING)

    import_status, lifecycle_status, is_completeness_exempt = _classify_row(
        publisher_name, software_description, db_end_date, license_type
    )

    if import_status == "error":
        if not publisher_name and not software_description:
            errors.append("Both publisher_name and software_description are missing; row cannot be imported")
    elif import_status == "legacy_incomplete":
        if not publisher_name:
            errors.append("publisher_name is missing")
        if not software_description:
            errors.append("software_description is missing")
    elif import_status == "active":
        # Non-blocking warnings for active licenses with missing identity fields
        if not publisher_name:
            errors.append("publisher_name is missing")
        if not software_description:
            errors.append("software_description is missing")

    if has_enum_error or has_parse_error:
        import_status = "error"

    return ParsedRow(
        row_number=row_number,
        publisher_name=publisher_name,
        software_description=software_description,
        start_date=start_date_str,
        end_date=end_date_str,
        notice_date=notice_date_str,
        contract_number=_field_text(data, "contract_number"),
        po_number=_field_text(data, "po_number"),
        procurement_reference=_field_text(data, "procurement_reference"),
        invoice_number=_field_text(data, "invoice_number"),
        contact_email=_field_text(data, "contact_email"),
        supplier=_field_text(data, "supplier"),
        cost_centre=_field_text(data, "cost_centre"),
        license_type=license_type,
        license_metric=license_metric,
        quantity=quantity,
        quantity_per_unit=quantity_per_unit,
        effective_quantity=effective_quantity,
        sku_code=_field_text(data, "sku_code"),
        unit_price=unit_price,
        total_po_price=total_po_price,
        currency=currency,
        notes=_field_text(data, "notes") or None,
        budget_owner_email=budget_owner_email,
        secondary_contacts=secondary_contacts,
        external_ref=_field_text(data, "external_ref") or None,
        license_ref=_field_text(data, "license_ref") or None,
        parent_license_ref=parent_license_ref,
        portal_url=portal_url,
        maintenance_coverage=maintenance_coverage,
        maintenance_start_date=maintenance_start_date_str,
        maintenance_end_date=maintenance_end_date_str,
        maintenance_cost=maintenance_cost,
        import_status=import_status,
        validation_errors=errors,
        warnings=warnings,
        currency_defaulted=currency_defaulted,
        db_start_date=db_start_date,
        db_end_date=db_end_date,
        db_notice_date=db_notice_date,
        db_maintenance_start_date=db_maintenance_start_date,
        db_maintenance_end_date=db_maintenance_end_date,
        db_request_date=db_request_date,
        db_purchase_date=db_purchase_date,
        is_completeness_exempt=is_completeness_exempt,
        lifecycle_status=lifecycle_status,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def decode_csv(contents: bytes) -> str:
    """Decode raw CSV bytes, handling UTF-8 BOM and latin-1 fallback."""
    try:
        return contents.decode("utf-8-sig")
    except UnicodeDecodeError:
        return contents.decode("latin-1")


def _strip_excel_separator_directive(text: str) -> tuple[str, str | None]:
    """Return CSV text and an Excel ``sep=`` delimiter override if present."""
    lines = text.splitlines(keepends=True)
    if not lines:
        return text, None
    first_line = lines[0].strip()
    if len(first_line) >= 5 and first_line[:4].lower() == "sep=":
        delimiter = first_line[4]
        if delimiter in _CSV_DELIMITERS:
            return "".join(lines[1:]), delimiter
    return text, None


def _detect_csv_delimiter(text: str) -> str:
    """Detect a delimiter using the CSV reader so quoted punctuation is ignored."""
    for line in text.splitlines():
        if line.strip():
            candidates = []
            for delimiter in _CSV_DELIMITERS:
                try:
                    fields = next(csv.reader([line], delimiter=delimiter))
                except csv.Error:
                    continue
                candidates.append((len(fields), delimiter))
            field_count, delimiter = max(candidates, default=(1, ","))
            return delimiter if field_count > 1 else ","
    return ","


def read_csv_dict_rows(contents: bytes) -> tuple[list[str], list[dict[str, str]]]:
    """Read CSV bytes with LicenseTrack's supported Excel-friendly dialects."""
    text, delimiter = _strip_excel_separator_directive(decode_csv(contents))
    selected_delimiter = delimiter or _detect_csv_delimiter(text)
    reader = csv.reader(io.StringIO(text), delimiter=selected_delimiter)
    try:
        raw_headers = next(reader)
    except StopIteration:
        return [], []
    if len(raw_headers) != len(set(raw_headers)):
        duplicates = sorted({header for header in raw_headers if raw_headers.count(header) > 1})
        raise ValueError(f"CSV contains duplicate header name(s): {', '.join(repr(item) for item in duplicates)}")
    rows = [dict(zip(raw_headers, row + [""] * (len(raw_headers) - len(row)))) for row in reader]
    return raw_headers, rows


def analyze_csv_headers(
    contents: bytes,
    custom_field_header_map: dict[str, str] | None = None,
) -> CSVHeaderAnalysis:
    """Resolve native and custom CSV headers with parser-compatible precedence."""
    raw_headers, rows = read_csv_dict_rows(contents)
    sample_rows = rows[:3]
    custom_headers = custom_field_header_map or {}
    matched_fields: set[str] = set()
    matched_columns: list[HeaderColumnMatch] = []
    matched_column_indexes: dict[str, int] = {}
    unrecognized_columns: list[UnrecognizedHeader] = []

    for raw_header in raw_headers:
        normalized = _normalise_header(raw_header)
        if normalized in _IGNORED_HEADERS:
            continue
        internal_field = _HEADER_MAP.get(normalized) or custom_headers.get(normalized)
        samples = [
            row.get(raw_header, "").strip()
            for row in sample_rows
            if row.get(raw_header, "").strip()
        ][:3]
        if internal_field and internal_field not in matched_fields:
            matched_fields.add(internal_field)
            matched_column_indexes[internal_field] = len(matched_columns)
            matched_columns.append(
                HeaderColumnMatch(
                    raw_header=raw_header,
                    internal_field=internal_field,
                    sample_values=samples,
                )
            )
            continue
        if internal_field:
            existing_index = matched_column_indexes[internal_field]
            existing = matched_columns[existing_index]
            existing_normalized = _normalise_header(existing.raw_header)
            if existing_normalized in _FALLBACK_HEADER_ALIASES and normalized not in _FALLBACK_HEADER_ALIASES:
                matched_columns[existing_index] = HeaderColumnMatch(
                    raw_header=raw_header,
                    internal_field=internal_field,
                    sample_values=samples,
                )
                unrecognized_columns.append(
                    UnrecognizedHeader(
                        raw_header=existing.raw_header,
                        sample_values=existing.sample_values,
                    )
                )
            else:
                unrecognized_columns.append(
                    UnrecognizedHeader(raw_header=raw_header, sample_values=samples)
                )
            continue
        unrecognized_columns.append(
            UnrecognizedHeader(raw_header=raw_header, sample_values=samples)
        )

    return CSVHeaderAnalysis(
        total_rows=len(rows),
        matched_columns=matched_columns,
        unrecognized_columns=unrecognized_columns,
        missing_required=[
            field_name
            for field_name in _REQUIRED_IMPORT_FIELDS
            if field_name not in matched_fields
        ],
    )


def _assemble_import_row(
    raw_row: dict[str, str],
    column_to_target: dict[str, str],
    *,
    omit_blank_native_values: bool,
) -> tuple[dict[str, object], dict[str, str]]:
    """Split one mapped raw row into native and custom-field input."""
    native_data: dict[str, object] = {}
    custom_data: dict[str, str] = {}
    for raw_header, target in column_to_target.items():
        raw_value = raw_row.get(raw_header) or ""
        stripped = raw_value.strip()
        if target.startswith("cf_"):
            if stripped:
                custom_data[target] = stripped
            continue
        if omit_blank_native_values and not stripped:
            continue
        value = stripped if omit_blank_native_values else raw_value
        if target in MULTI_VALUE_TARGETS:
            native_data.setdefault(target, []).append(value)
        else:
            native_data[target] = value
    return native_data, custom_data


def parse_csv(
    file_contents: bytes,
    default_currency: str = "EUR",
    number_format_locale: str = "en-US",
    date_format: str = "DD/MM/YYYY",
    custom_field_header_map: dict[str, str] | None = None,
) -> ParsedImportResult:
    """Parse *file_contents* (raw bytes of a CSV file) and return a
    ParsedImportResult describing every row.

    Handles UTF-8 BOMs, latin-1 fallback, semicolon and tab delimiters, and
    Excel's ``sep=;`` style delimiter directive.
    """
    raw_headers, raw_rows = read_csv_dict_rows(file_contents)

    # Build raw_header → native/custom target mapping (first match wins for
    # duplicates, except explicit multi-value targets). Native and ignored
    # headers take precedence over custom names.
    # Weak fallback aliases can still be replaced by stronger headers below.
    header_mapping: dict[str, str] = {}
    mapped_fields: set[str] = set()
    target_to_header: dict[str, str] = {}
    for raw_h in raw_headers:
        normalized = _normalise_header(raw_h)
        target = _HEADER_MAP.get(normalized)
        if target is None and normalized not in _IGNORED_HEADERS:
            target = (custom_field_header_map or {}).get(normalized)
        if target in MULTI_VALUE_TARGETS:
            header_mapping[raw_h] = target
            mapped_fields.add(target)
            continue
        if not target:
            continue

        previous_header = target_to_header.get(target)
        if previous_header is None:
            header_mapping[raw_h] = target
            mapped_fields.add(target)
            target_to_header[target] = raw_h
            continue

        previous_normalized = _normalise_header(previous_header)
        if previous_normalized in _FALLBACK_HEADER_ALIASES and normalized not in _FALLBACK_HEADER_ALIASES:
            header_mapping.pop(previous_header, None)
            header_mapping[raw_h] = target
            target_to_header[target] = raw_h
        elif normalized in _FALLBACK_HEADER_ALIASES:
            # A weak fallback after an established header is intentionally
            # ignored, regardless of source-column order.
            continue
        else:
            raise ValueError(
                f"CSV headers {previous_header!r} and {raw_h!r} both map to single-value field {target!r}"
            )

    # Preserve order of first appearance for headers_found
    headers_found: list[str] = list(dict.fromkeys(header_mapping.values()))
    headers_missing = [f for f in _RECOMMENDED_FIELDS if f not in mapped_fields]

    logger.info("CSV import: parsing started")
    rows: list[ParsedRow] = []
    custom_rows: list[dict[str, str]] = []
    for row_idx, raw_row in enumerate(raw_rows, start=1):
        row_data, custom_data = _assemble_import_row(
            raw_row,
            header_mapping,
            omit_blank_native_values=False,
        )
        rows.append(
            _parse_row(
                row_idx,
                row_data,
                default_currency,
                number_format_locale,
                date_format,
            )
        )
        custom_rows.append(custom_data)

    error_count = sum(1 for r in rows if r.import_status == "error")
    logger.info(
        "CSV import: %d rows parsed, %d errors",
        len(rows),
        error_count,
    )

    return ParsedImportResult(
        rows=rows,
        headers_found=headers_found,
        headers_missing=headers_missing,
        custom_rows=custom_rows,
    )
