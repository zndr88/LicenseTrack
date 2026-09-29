"""Single registry of CSV fields for export, import-create and import-update.

Every exporter, the importer's header map and the update path read from this
list. A field that must survive export -> import is marked ``round_trip``; the
generated round-trip test covers each of them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class CsvField:
    target: str | None
    header: str
    aliases: tuple[str, ...] = field(default=())
    export: bool = True
    create: bool = True
    update: bool = False
    round_trip: bool = False


def normalise_header(raw: str) -> str:
    """Normalize a CSV header to the importer's matching form."""
    s = raw.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


FIELDS: tuple[CsvField, ...] = (
    CsvField("license_ref", "license_ref", aliases=("lt_ref",)),
    CsvField("external_ref", "external_ref", update=True, round_trip=True),
    CsvField("publisher_name", "publisher_name", aliases=("publisher",), update=True, round_trip=True),
    CsvField(
        "software_description",
        "software_description",
        aliases=("description", "item"),
        update=True,
        round_trip=True,
    ),
    CsvField(
        "contract_number",
        "contract_number",
        aliases=("contract", "contract_no"),
        update=True,
        round_trip=True,
    ),
    CsvField(
        "po_number",
        "po_number",
        aliases=("po", "purchase_order_no"),
        update=True,
        round_trip=True,
    ),
    CsvField(
        "procurement_reference",
        "procurement_reference",
        aliases=("procurement_ref",),
        update=True,
        round_trip=True,
    ),
    CsvField(
        "invoice_number",
        "invoice_number",
        aliases=("invoice",),
        update=True,
        round_trip=True,
    ),
    CsvField(
        "contact_email",
        "contact_email",
        aliases=("publisher_contact", "supplier_contact"),
        update=True,
        round_trip=True,
    ),
    CsvField("supplier", "supplier", aliases=("vendor",), update=True, round_trip=True),
    CsvField(
        "cost_centre",
        "cost_centre",
        aliases=("cost_center", "department"),
        update=True,
        round_trip=True,
    ),
    CsvField(
        "budget_owner_email",
        "budget_owner_email",
        aliases=("budget_owner",),
        update=True,
        round_trip=True,
    ),
    CsvField(
        "secondary_contacts",
        "secondary_contacts",
        aliases=(
            "secondary_contact",
            "secondary_contact_email",
            "application_owner",
            "application_owner_email",
            "app_owner",
            "app_owner_email",
            "technical_owner",
            "technical_owner_email",
            "application_owner_email_address",
        ),
        update=True,
        round_trip=True,
    ),
    CsvField(
        "license_type",
        "license_type",
        aliases=("type", "purchase_type"),
        round_trip=True,
    ),
    CsvField("type_description", "type_description", update=True, round_trip=True),
    CsvField(
        "is_renewable",
        "is_renewable",
        aliases=("renewable",),
        update=True,
        round_trip=True,
    ),
    CsvField("license_metric", "license_metric", aliases=("metric",), update=True, round_trip=True),
    CsvField(
        "quantity",
        "quantity",
        aliases=("qty", "purchase_quantity"),
        update=True,
        round_trip=True,
    ),
    CsvField("effective_quantity", "effective_quantity"),
    CsvField(
        "quantity_per_unit",
        "quantity_per_unit",
        aliases=("qty_per_unit",),
        update=True,
        round_trip=True,
    ),
    CsvField(
        "sku_code",
        "sku_code",
        aliases=("sku", "part_no_sku"),
        update=True,
        round_trip=True,
    ),
    CsvField(
        "unit_price",
        "unit_price",
        aliases=("unit_price_eur",),
        update=True,
        round_trip=True,
    ),
    CsvField(
        "total_po_price",
        "total_po_price",
        aliases=("total_price_eur",),
        update=True,
    ),
    CsvField("currency", "currency", update=True, round_trip=True),
    CsvField(
        "start_date",
        "start_date",
        aliases=("effective_date",),
        update=True,
        round_trip=True,
    ),
    CsvField(
        "end_date",
        "end_date",
        aliases=("expiry_date", "contractenddate"),
        update=True,
        round_trip=True,
    ),
    CsvField(
        "notice_date",
        "notice_date",
        aliases=("notice_deadline",),
        update=True,
        round_trip=True,
    ),
    CsvField("request_date", "request_date", update=True, round_trip=True),
    # Purchase Date is a procurement milestone, not a Flexera start-date fallback.
    CsvField("purchase_date", "purchase_date", update=True, round_trip=True),
    CsvField("portal_url", "portal_url", update=True, round_trip=True),
    CsvField("notes", "notes", update=True, round_trip=True),
    CsvField(
        "parent_license_ref",
        "parent_license_ref",
        aliases=("parent_ref", "parent"),
    ),
    CsvField(
        "maintenance_coverage",
        "maintenance_coverage",
        aliases=(
            "maintenance_support_coverage",
            "includes_maintenance",
            "include_maintenance",
            "maintenance_included",
            "purchase_includes_maintenance",
            "purchase_includes_support",
            "includes_support",
        ),
    ),
    CsvField(
        "maintenance_start_date",
        "maintenance_start_date",
        aliases=(
            "maintenance_start",
            "support_start",
            "support_start_date",
            "coverage_start",
            "coverage_start_date",
        ),
    ),
    CsvField(
        "maintenance_end_date",
        "maintenance_end_date",
        aliases=(
            "maintenance_end",
            "support_end",
            "support_end_date",
            "coverage_end",
            "coverage_end_date",
        ),
    ),
    CsvField(
        "maintenance_cost",
        "maintenance_cost",
        aliases=(
            "support_cost",
            "total_support_cost",
            "total_support_cost_eur",
            "coverage_cost",
        ),
    ),
    # Export-only / computed fields recognized but intentionally ignored on import.
    CsvField(None, "license_record_id", aliases=("id",), create=False),
    CsvField(None, "docs", create=False),
    CsvField(None, "calc_total", create=False),
    CsvField(None, "expiration", create=False),
    CsvField(None, "complete", create=False),
    # Total PO Value is a derived whole-PO aggregate, not a per-license line total.
    CsvField(None, "total_po_value", create=False),
    CsvField(None, "created_at", aliases=("created",), create=False),
    CsvField(None, "created_by", create=False),
    CsvField(None, "updated_at", aliases=("last_updated",), create=False),
    CsvField(None, "last_synced_at", aliases=("last_synced",), create=False),
    CsvField(None, "lifecycle_status", create=False),
    CsvField(None, "sync_status", create=False),
)


def header_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for csv_field in FIELDS:
        if csv_field.target is None:
            continue
        for name in (csv_field.header, *csv_field.aliases):
            mapping[normalise_header(name)] = csv_field.target
    return mapping


def ignored_headers() -> frozenset[str]:
    names: set[str] = set()
    for csv_field in FIELDS:
        if csv_field.target is None:
            names.update(normalise_header(name) for name in (csv_field.header, *csv_field.aliases))
    return frozenset(names)
