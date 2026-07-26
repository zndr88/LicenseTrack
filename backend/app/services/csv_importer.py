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
from typing import Optional

import logging

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
    "license_metric": "license_metric",
    "metric": "license_metric",
    "parent_license_ref": "parent_license_ref",
    "parent_ref": "parent_license_ref",
    "parent": "parent_license_ref",
    "quantity": "quantity",
    "qty": "quantity",
    "purchase_quantity": "quantity",  # "Purchase Quantity" (v1.0.3 export label)
    "sku_code": "sku_code",
    "sku": "sku_code",
    "unit_price": "unit_price",
    "total_po_price": "total_po_price",
    "currency": "currency",
    "notes": "notes",
    "budget_owner_email": "budget_owner_email",
    "external_ref": "external_ref",
    "license_ref": "license_ref",
    # Flexera aliases - normalised from Flexera column names
    "purchase_order_no": "po_number",  # "Purchase Order No."
    "effective_quantity": "quantity",  # "Effective Quantity"
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
    "notice_deadline": "notice_date",  # "Notice Deadline"
    "portal_url": "portal_url",  # "Portal URL"
    "maintenance_coverage": "maintenance_coverage",
    "maintenance_support_coverage": "maintenance_coverage",  # "Maintenance / Support Coverage"
}

# Export-only / computed columns (normalised header form). These are recognised
# on import but intentionally mapped to nothing, so round-tripping a full
# LicenseTrack export does not prompt the user to create custom fields for them.
# Covers computed/metadata columns and the maintenance mirror fields, which are
# derived from the linked child maintenance license and must not be imported
# directly. Both the export display-label form and the snake_case field form are
# listed so either survives a round-trip.
_IGNORED_HEADERS: frozenset[str] = frozenset(
    {
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
        "maintenance_start",
        "maintenance_start_date",
        "maintenance_end",
        "maintenance_end_date",
        "maintenance_cost",
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

_VALID_LICENSE_TYPES = {
    "subscription",
    "perpetual",
    "maintenance",
    "saas",
    "oem",
    "freeware",
}


_VALID_LICENSE_METRICS = {
    "per_user",
    "per_device",
    "per_cpu",
    "per_core",
    "site",
    "concurrent",
    "enterprise",
}

_VALID_MAINTENANCE_COVERAGE = {
    "unknown",
    "not_applicable",
    "included",
    "separately_tracked",
}

# Date formats tried in order (most common first).
_DATE_FORMATS = {
    "DD/MM/YYYY": "%d/%m/%Y",
    "MM/DD/YYYY": "%m/%d/%Y",
    "YYYY-MM-DD": "%Y-%m-%d",
}


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
    validation_errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    duplicate_warnings: list[object] = field(default_factory=list)
    parent_import_row_number: Optional[int] = None

    # Warning tracking - not exposed in preview response directly
    currency_defaulted: bool = field(default=False, repr=False)

    # DB insertion values - not exposed in the preview response
    db_start_date: Optional[date] = field(default=None, repr=False)
    db_end_date: Optional[date] = field(default=None, repr=False)
    db_notice_date: Optional[date] = field(default=None, repr=False)
    db_request_date: Optional[datetime] = field(default=None, repr=False)
    db_purchase_date: Optional[datetime] = field(default=None, repr=False)

    # Update-on-LT-Ref annotation - set during preview/execute, not by parsing.
    import_action: str = field(default="create")  # "create" | "update"
    matched_license_id: Optional[int] = field(default=None)
    is_completeness_exempt: bool = field(default=False, repr=False)
    lifecycle_status: Optional[str] = field(default=None, repr=False)
    notice_date: Optional[str] = None  # ISO string or None


@dataclass
class ParsedImportResult:
    rows: list[ParsedRow]
    headers_found: list[str]  # internal field names detected in the file
    headers_missing: list[str]  # recommended fields not present in the file
    custom_rows: list[dict[str, str]] = field(default_factory=list)


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


def _normalise_enum_value(raw: str) -> str:
    """Normalize human labels like "Per User" to enum values like "per_user"."""
    value = raw.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return value.strip("_")


# Value-level aliases for human labels the LicenseTrack export (pre-round-trip-fix) wrote.
_LICENSE_TYPE_VALUE_ALIASES: dict[str, str] = {
    "freeware_open_source": "freeware",
    "open_source": "freeware",
}
_LICENSE_METRIC_VALUE_ALIASES: dict[str, str] = {
    "site_license": "site",
    "concurrent_users": "concurrent",
    "enterprise_wide": "enterprise",
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


def _parse_date(raw: str, date_format: str) -> tuple[Optional[date], bool, str]:
    """Parse a date string.

    Returns:
        (parsed_date, is_perpetual, error_message)
        is_perpetual = True when the value means "no end date".
        error_message is non-empty only when the value looks like a date
        but could not be parsed.
    """
    raw = raw.strip()
    if not raw:
        return None, False, ""

    if raw.lower() == "perpetual":
        return None, True, ""

    formats = ("%Y-%m-%d", _DATE_FORMATS.get(date_format, "%d/%m/%Y"))
    for fmt in dict.fromkeys(formats):
        try:
            d = datetime.strptime(raw, fmt).date()
            if d.year >= 2099:
                return None, True, f"Date {raw!r} has year >= 2099 - treated as perpetual"
            return d, False, ""
        except ValueError:
            continue

    return None, False, (f"Unrecognised date format: {raw!r}; expected ISO YYYY-MM-DD or declared format {date_format}")


def _parse_datetime(raw: str, date_format: str) -> tuple[Optional[datetime], str]:
    """Parse a procurement-milestone datetime (request_date / purchase_date).

    Accepts ISO 8601 dates/datetimes (as emitted by LicenseTrack exports, so
    imports round-trip) and plain dates in the declared date_format (for
    hand-authored CSVs). Returns a timezone-aware UTC datetime, or a non-empty
    error message when the value is present but unparseable.
    """
    raw = raw.strip()
    if not raw:
        return None, ""

    # ISO 8601 date or datetime - the export round-trip path.
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return (parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)), ""
    except ValueError:
        pass

    # Declared date format (DD/MM/YYYY, MM/DD/YYYY, ...) - hand-authored CSVs.
    fmt = _DATE_FORMATS.get(date_format, "%d/%m/%Y")
    try:
        parsed = datetime.strptime(raw, fmt)
        return parsed.replace(tzinfo=timezone.utc), ""
    except ValueError:
        return None, (f"Unrecognised date format: {raw!r}; expected ISO YYYY-MM-DD or declared format {date_format}")


def _classify_row(
    publisher_name: str,
    software_description: str,
    db_end_date: Optional[date],
    is_perpetual: bool,
    db_start_date: Optional[date],
) -> tuple[str, str | None, bool]:
    """Return (import_status, lifecycle_status, is_completeness_exempt).

    Priority:
      1. "error"             - both required fields missing
      2. "legacy_incomplete" - end_date in past + a required field missing
      3. "legacy_exempt"     - end_date in past, all required fields present
      4. "active"            - everything else (future/perpetual/no date)
    """
    today = date.today()
    has_publisher = bool(publisher_name)
    has_description = bool(software_description)
    end_in_past = db_end_date is not None and db_end_date < today

    if not has_publisher and not has_description:
        return "error", None, False

    if end_in_past and (not has_publisher or not has_description):
        return "legacy_incomplete", "legacy", False

    if end_in_past:
        return "legacy_exempt", "legacy", True

    return "active", None, False


def _parse_row(
    row_number: int,
    data: dict[str, str],
    default_currency: str = "EUR",
    number_format_locale: str = "en-US",
    date_format: str = "DD/MM/YYYY",
) -> ParsedRow:
    """Parse and validate one CSV row."""
    errors: list[str] = []
    warnings: list[str] = []
    has_parse_error = False

    # -- Required fields --------------------------------------------------
    publisher_name = data.get("publisher_name", "").strip()
    software_description = data.get("software_description", "").strip()

    # -- Date fields ------------------------------------------------------
    db_start_date: Optional[date] = None
    db_end_date: Optional[date] = None
    db_notice_date: Optional[date] = None
    start_date_str: Optional[str] = None
    end_date_str: Optional[str] = None
    notice_date_str: Optional[str] = None
    is_perpetual = False

    start_raw = data.get("start_date", "").strip()
    if start_raw:
        sd, _, sd_err = _parse_date(start_raw, date_format)
        if sd_err:
            errors.append(f"start_date: {sd_err}")
            has_parse_error = True
        else:
            if sd is not None:
                db_start_date = sd
                start_date_str = sd.isoformat()

    end_raw = data.get("end_date", "").strip()
    if end_raw:
        ed, ed_perp, ed_err = _parse_date(end_raw, date_format)
        if ed_err:
            errors.append(f"end_date: {ed_err}")
            has_parse_error = True
        else:
            is_perpetual = ed_perp
            if ed is not None:
                db_end_date = ed
                end_date_str = ed.isoformat()
            # perpetual → db_end_date stays None, end_date_str stays None

    notice_raw = data.get("notice_date", "").strip()
    if notice_raw:
        nd, _, nd_err = _parse_date(notice_raw, date_format)
        if nd_err:
            errors.append(f"notice_date: {nd_err}")
            has_parse_error = True
        else:
            if nd is not None:
                db_notice_date = nd
                notice_date_str = nd.isoformat()
                if db_end_date is not None and nd > db_end_date:
                    warnings.append("notice_date falls after end_date")

    # -- Procurement milestone datetimes ----------------------------------
    db_request_date, request_err = _parse_datetime(data.get("request_date", ""), date_format)
    if request_err:
        errors.append(f"request_date: {request_err}")
        has_parse_error = True

    db_purchase_date, purchase_err = _parse_datetime(data.get("purchase_date", ""), date_format)
    if purchase_err:
        errors.append(f"purchase_date: {purchase_err}")
        has_parse_error = True

    # -- Enum fields -------------------------------------------------------
    has_enum_error = False

    license_type = _extract_license_type(_normalise_enum_value(data.get("license_type", "")))
    license_type = _LICENSE_TYPE_VALUE_ALIASES.get(license_type, license_type)
    if license_type and license_type not in _VALID_LICENSE_TYPES:
        errors.append(f"Unrecognised license_type {license_type!r}; correct the value or remove the column")
        license_type = ""
        has_enum_error = True

    license_metric = _normalise_enum_value(data.get("license_metric", ""))
    license_metric = _LICENSE_METRIC_VALUE_ALIASES.get(license_metric, license_metric)
    if license_metric and license_metric not in _VALID_LICENSE_METRICS:
        errors.append(f"Unrecognised license_metric {license_metric!r}; correct the value or remove the column")
        license_metric = ""
        has_enum_error = True

    # -- Currency default -------------------------------------------------
    _currency_raw = data.get("currency", "").strip()
    currency = _currency_raw or default_currency
    currency_defaulted = not bool(_currency_raw)
    numeric_error_count = len(errors)
    quantity = _parse_localized_numeric_field(data.get("quantity", ""), "quantity", errors, number_format_locale)
    unit_price = _parse_localized_numeric_field(data.get("unit_price", ""), "unit_price", errors, number_format_locale)
    total_po_price = _parse_localized_numeric_field(
        data.get("total_po_price", ""), "total_po_price", errors, number_format_locale
    )
    has_parse_error = has_parse_error or len(errors) > numeric_error_count

    # -- Budget owner email - reject SMTP command-injection payloads ------
    # (CVE-2026-53533 hardening: this value eventually reaches
    # aiosmtplib.send(recipients=...) via the daily notification job.)
    budget_owner_email = data.get("budget_owner_email", "").strip()
    if any(ch in budget_owner_email for ch in ("\r", "\n", "\x00")):
        errors.append("budget_owner_email contains invalid characters (line breaks or null bytes)")
        has_parse_error = True
        budget_owner_email = ""

    # -- Parent linkage (for maintenance rows) ----------------------------
    parent_license_ref = data.get("parent_license_ref", "").strip() or None

    # -- Optional enrichment fields ----------------------------------------
    portal_url = data.get("portal_url", "").strip() or None

    maintenance_coverage_raw = _normalise_enum_value(data.get("maintenance_coverage", ""))
    if maintenance_coverage_raw and maintenance_coverage_raw not in _VALID_MAINTENANCE_COVERAGE:
        warnings.append(f"Unrecognised maintenance_coverage {maintenance_coverage_raw!r}; defaulting to 'unknown'")
        maintenance_coverage_raw = None
    maintenance_coverage = maintenance_coverage_raw or None

    # -- Classification ---------------------------------------------------
    import_status, lifecycle_status, is_completeness_exempt = _classify_row(
        publisher_name, software_description, db_end_date, is_perpetual, db_start_date
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
        contract_number=data.get("contract_number", "").strip(),
        po_number=data.get("po_number", "").strip(),
        invoice_number=data.get("invoice_number", "").strip(),
        contact_email=data.get("contact_email", "").strip(),
        supplier=data.get("supplier", "").strip(),
        cost_centre=data.get("cost_centre", "").strip(),
        license_type=license_type,
        license_metric=license_metric,
        quantity=quantity,
        sku_code=data.get("sku_code", "").strip(),
        unit_price=unit_price,
        total_po_price=total_po_price,
        currency=currency,
        notes=data.get("notes", "").strip() or None,
        budget_owner_email=budget_owner_email,
        external_ref=data.get("external_ref", "").strip() or None,
        license_ref=data.get("license_ref", "").strip() or None,
        parent_license_ref=parent_license_ref,
        portal_url=portal_url,
        maintenance_coverage=maintenance_coverage,
        import_status=import_status,
        validation_errors=errors,
        warnings=warnings,
        currency_defaulted=currency_defaulted,
        db_start_date=db_start_date,
        db_end_date=db_end_date,
        db_notice_date=db_notice_date,
        db_request_date=db_request_date,
        db_purchase_date=db_purchase_date,
        is_completeness_exempt=is_completeness_exempt,
        lifecycle_status=lifecycle_status,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def parse_csv(
    file_contents: bytes,
    default_currency: str = "EUR",
    number_format_locale: str = "en-US",
    date_format: str = "DD/MM/YYYY",
    custom_field_header_map: dict[str, str] | None = None,
) -> ParsedImportResult:
    """Parse *file_contents* (raw bytes of a CSV file) and return a
    ParsedImportResult describing every row.

    Decodes with utf-8-sig so that files saved with a BOM (common from Excel)
    are handled transparently.
    """
    try:
        text = file_contents.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = file_contents.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    raw_headers: list[str] = list(reader.fieldnames or [])

    # Build raw_header → native/custom target mapping (first match wins for
    # duplicates). Native and ignored headers take precedence over custom names.
    header_mapping: dict[str, str] = {}
    mapped_fields: set[str] = set()
    for raw_h in raw_headers:
        normalized = _normalise_header(raw_h)
        target = _HEADER_MAP.get(normalized)
        if target is None and normalized not in _IGNORED_HEADERS:
            target = (custom_field_header_map or {}).get(normalized)
        if target and target not in mapped_fields:
            header_mapping[raw_h] = target
            mapped_fields.add(target)

    # Preserve order of first appearance for headers_found
    headers_found: list[str] = list(dict.fromkeys(header_mapping.values()))
    headers_missing = [f for f in _RECOMMENDED_FIELDS if f not in mapped_fields]

    logger.info("CSV import: parsing started")
    rows: list[ParsedRow] = []
    custom_rows: list[dict[str, str]] = []
    for row_idx, raw_row in enumerate(reader, start=1):
        row_data: dict[str, str] = {
            target: (raw_row.get(raw_h) or "")
            for raw_h, target in header_mapping.items()
            if not target.startswith("cf_")
        }
        custom_data: dict[str, str] = {
            target: (raw_row.get(raw_h) or "").strip()
            for raw_h, target in header_mapping.items()
            if target.startswith("cf_") and (raw_row.get(raw_h) or "").strip()
        }
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
