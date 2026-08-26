# backend/app/services/import_/mapped_parser.py
from __future__ import annotations

from app.services.csv_importer import (
    MULTI_VALUE_TARGETS,
    ParsedImportResult,
    ParsedRow,
    _RECOMMENDED_FIELDS,
    _parse_row,
    read_csv_dict_rows,
)


def validate_mapped_import(
    headers: list[str],
    mapping: list[object],
    *,
    supported_targets: set[str],
    custom_field_keys: set[str],
) -> dict[str, str]:
    """Validate an explicit mapping before either preview or execution."""
    seen_headers: set[str] = set()
    target_headers: dict[str, str] = {}
    multi_value_targets = MULTI_VALUE_TARGETS
    header_set = set(headers)
    for entry in mapping:
        raw_header = entry.raw_header
        target = entry.target
        if raw_header in seen_headers:
            raise ValueError(f"Mapping header {raw_header!r} is listed more than once")
        seen_headers.add(raw_header)
        if raw_header not in header_set:
            raise ValueError(f"Mapping header {raw_header!r} does not exist in the uploaded CSV")
        if target != "skip" and target not in supported_targets and target not in custom_field_keys:
            raise ValueError(f"Mapping target {target!r} for header {raw_header!r} is unknown or stale")
        if target == "skip":
            continue
        previous = target_headers.get(target)
        if previous is not None and target not in multi_value_targets:
            raise ValueError(
                f"Headers {previous!r} and {raw_header!r} both target single-value field {target!r}"
            )
        target_headers[target] = raw_header
    return {entry.raw_header: entry.target for entry in mapping if entry.target != "skip"}


def parse_mapped_csv(
    contents: bytes,
    column_to_target: dict[str, str],
    default_currency: str,
    number_format_locale: str = "en-US",
    date_format: str = "DD/MM/YYYY",
) -> tuple[ParsedImportResult, list[dict[str, str]]]:
    """Parse a CSV using an explicit column→target mapping.

    Returns (ParsedImportResult, custom_rows) where custom_rows is a parallel
    list of dicts containing only cf_* key/value pairs for each row.
    """
    _, all_raw_rows = read_csv_dict_rows(contents)

    rows: list[ParsedRow] = []
    custom_rows: list[dict[str, str]] = []
    native_targets = [t for t in column_to_target.values() if not t.startswith("cf_")]
    headers_found = list(dict.fromkeys(native_targets))
    headers_missing = [f for f in _RECOMMENDED_FIELDS if f not in headers_found]

    for row_idx, raw_row in enumerate(all_raw_rows, start=1):
        native_data: dict[str, object] = {}
        custom_data: dict[str, str] = {}
        for raw_h, target in column_to_target.items():
            value = raw_row.get(raw_h, "").strip()
            if not value:
                continue
            if target.startswith("cf_"):
                custom_data[target] = value
            elif target in MULTI_VALUE_TARGETS:
                native_data.setdefault(target, []).append(value)
            else:
                native_data[target] = value
        rows.append(
            _parse_row(
                row_idx,
                native_data,
                default_currency,
                number_format_locale,
                date_format,
            )
        )
        custom_rows.append(custom_data)

    return ParsedImportResult(
        rows=rows,
        headers_found=headers_found,
        headers_missing=headers_missing,
        custom_rows=custom_rows,
    ), custom_rows
