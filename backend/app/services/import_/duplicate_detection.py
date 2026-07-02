# backend/app/services/import_/duplicate_detection.py
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Optional

from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.license import License
from app.schemas.csv_import import DuplicateWarning
from app.services.csv_importer import ParsedRow


def _norm_text(value: object) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).strip()).casefold()


def _norm_date(value: object) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    text = str(value).strip()
    return text or None


def _date_bounds(start: Optional[str], end: Optional[str]) -> tuple[date, date]:
    start_date = datetime.strptime(start, "%Y-%m-%d").date() if start else date.min
    end_date = datetime.strptime(end, "%Y-%m-%d").date() if end else date.max
    return start_date, end_date


def _dates_overlap(
    left_start: Optional[str],
    left_end: Optional[str],
    right_start: Optional[str],
    right_end: Optional[str],
) -> bool:
    left_start_date, left_end_date = _date_bounds(left_start, left_end)
    right_start_date, right_end_date = _date_bounds(right_start, right_end)
    return left_start_date <= right_end_date and right_start_date <= left_end_date


def _row_match_value(row: ParsedRow, field: str) -> str | None:
    value = getattr(row, field)
    if field in {"start_date", "end_date"}:
        return _norm_date(value)
    return _norm_text(value)


def _license_match_value(license_obj: License, field: str) -> str | None:
    value = getattr(license_obj, field)
    if field in {"start_date", "end_date"}:
        return _norm_date(value)
    return _norm_text(value)


def _license_label(license_obj: License) -> str:
    return license_obj.license_ref or f"license ID {license_obj.id}"


def _match_by_license_ref(row: ParsedRow, license_obj: License) -> DuplicateWarning | None:
    row_ref = _norm_text(row.license_ref)
    license_ref = _norm_text(license_obj.license_ref)
    if not row_ref or row_ref != license_ref:
        return None
    label = _license_label(license_obj)
    return DuplicateWarning(
        type="existing_license",
        severity="high",
        message=f"Possible duplicate of existing license {label}. License ref matches.",
        matched_license_id=license_obj.id,
        matched_license_ref=license_obj.license_ref,
        match_fields=["license_ref"],
    )


def _match_duplicate(
    row: ParsedRow,
    candidate: ParsedRow | License,
) -> tuple[str, list[str]] | None:
    fields = [
        "publisher_name",
        "software_description",
        "contract_number",
        "po_number",
        "start_date",
        "end_date",
    ]
    is_license = isinstance(candidate, License)
    getter = _license_match_value if is_license else _row_match_value

    row_publisher = _row_match_value(row, "publisher_name")
    row_software = _row_match_value(row, "software_description")
    candidate_publisher = getter(candidate, "publisher_name")
    candidate_software = getter(candidate, "software_description")
    if not row_publisher or not row_software:
        return None
    if row_publisher != candidate_publisher or row_software != candidate_software:
        return None

    match_fields = ["publisher_name", "software_description"]
    all_available_match = True
    for field in fields[2:]:
        row_value = _row_match_value(row, field)
        candidate_value = getter(candidate, field)
        if row_value in ("", None) and candidate_value in ("", None):
            continue
        if row_value in ("", None) or candidate_value in ("", None):
            all_available_match = False
            continue
        if row_value == candidate_value:
            match_fields.append(field)
        else:
            all_available_match = False

    has_contract = bool(_row_match_value(row, "contract_number")) and (
        _row_match_value(row, "contract_number") == getter(candidate, "contract_number")
    )
    has_po = bool(_row_match_value(row, "po_number")) and (
        _row_match_value(row, "po_number") == getter(candidate, "po_number")
    )
    has_date = (
        _row_match_value(row, "start_date") == getter(candidate, "start_date")
        and _row_match_value(row, "end_date") == getter(candidate, "end_date")
        and (
            _row_match_value(row, "start_date") is not None
            or _row_match_value(row, "end_date") is not None
        )
    )
    if all_available_match and (has_contract or has_po) and has_date:
        return "high", match_fields

    start = _row_match_value(row, "start_date")
    end = _row_match_value(row, "end_date")
    candidate_start = getter(candidate, "start_date")
    candidate_end = getter(candidate, "end_date")
    if has_contract and _dates_overlap(start, end, candidate_start, candidate_end):
        near_fields = ["publisher_name", "software_description", "contract_number"]
        return "medium", near_fields + ["start_date", "end_date"]
    if has_po and _dates_overlap(start, end, candidate_start, candidate_end):
        near_fields = ["publisher_name", "software_description", "po_number"]
        return "medium", near_fields + ["start_date", "end_date"]

    return None


def _match_fields_sentence(fields: list[str]) -> str:
    labels = {
        "publisher_name": "publisher",
        "software_description": "software",
        "contract_number": "contract",
        "po_number": "PO",
        "start_date": "start date",
        "end_date": "end date",
    }
    names = [labels.get(field, field) for field in fields]
    if len(names) <= 1:
        return f"{names[0].capitalize()} matches."
    return f"{', '.join(names[:-1]).capitalize()}, and {names[-1]} match."


async def add_duplicate_warnings(rows: list[ParsedRow], db: AsyncSession) -> None:
    """Populate `duplicate_warnings` on each non-error row."""
    license_result = await db.execute(sa_select(License).where(License.is_retired.is_(False)))
    existing_licenses = license_result.scalars().all()

    for row in rows:
        row.duplicate_warnings = []

    for row in rows:
        if row.import_status == "error":
            continue
        for license_obj in existing_licenses:
            ref_warning = _match_by_license_ref(row, license_obj)
            if ref_warning:
                row.duplicate_warnings.append(ref_warning)
                break
            match = _match_duplicate(row, license_obj)
            if not match:
                continue
            severity, match_fields = match
            label = _license_label(license_obj)
            row.duplicate_warnings.append(DuplicateWarning(
                type="existing_license",
                severity=severity,
                message=f"Possible duplicate of existing license {label}. {_match_fields_sentence(match_fields)}",
                matched_license_id=license_obj.id,
                matched_license_ref=license_obj.license_ref,
                match_fields=match_fields,
            ))
            break

    for index, row in enumerate(rows):
        if row.import_status == "error":
            continue
        for earlier in rows[:index]:
            if earlier.import_status == "error":
                continue
            match = _match_duplicate(row, earlier)
            if not match:
                continue
            severity, match_fields = match
            row.duplicate_warnings.append(DuplicateWarning(
                type="import_row",
                severity=severity,
                message=f"Possible duplicate of row {earlier.row_number} in this import. {_match_fields_sentence(match_fields)}",
                matched_row_number=earlier.row_number,
                match_fields=match_fields,
            ))
            break
