"""
CSV import endpoints.

POST /api/import/analyze        - inspect headers, return column match info
POST /api/import/preview        - native flow: auto-map and preview rows
POST /api/import/preview-mapped - external-tool flow: preview with resolved mapping
POST /api/import/execute        - external-tool flow: persist with resolved mapping
POST /api/import/confirm        - native flow: persist auto-mapped rows
GET  /api/import/template       - download blank CSV template

Editor and admin roles required for all write endpoints.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_editor_or_admin
from app.models.import_mapping import ImportMapping
from app.models.user import User, UserRole
from app.schemas.csv_import import (
    CSVAnalyzeResponse,
    CSVImportConfirmResponse,
    CSVImportPreviewResponse,
    ColumnMatch,
    ImportExecuteRequest,
    ImportReferenceOverride,
    ImportWarningSummary,
    MappingEntry,
    UnrecognizedColumn,
)
from app.services.audit_service import format_audit_detail, log_event
from app.services.csv_importer import (
    _FALLBACK_HEADER_ALIASES,
    _HEADER_MAP,
    _IGNORED_HEADERS,
    _normalise_header,
    build_custom_field_header_map,
    parse_csv,
    read_csv_dict_rows,
)
from app.services.custom_fields_service import get_all_definitions, validate_imported_custom_rows
from app.services.import_.import_workflow import (
    build_preview_response,
    build_warning_summary,
    expand_skipped_inferred_rows,
    get_import_defaults,
    prepare_import_rows,
    run_import_rows,
)
from app.services.import_.reference_resolution import (
    build_reference_summary,
    parse_reference_overrides,
    validate_reference_overrides,
)
from app.services.import_.mapped_parser import parse_mapped_csv
from app.services.import_.mapped_parser import validate_mapped_import
from app.services.money import SUPPORTED_NUMBER_FORMAT_LOCALES

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/import", tags=["import"])

DbSession = Annotated[AsyncSession, Depends(get_db)]

_ACCEPTED_CONTENT_TYPES = {
    "text/csv",
    "application/csv",
    "application/vnd.ms-excel",
    "text/plain",
    "application/octet-stream",
}

_REQUIRED_FOR_IMPORT = ["publisher_name", "software_description"]
_SUPPORTED_DATE_FORMATS = {"DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"}


# ---------------------------------------------------------------------------
# Request helpers
# ---------------------------------------------------------------------------


def _reject_non_csv(file: UploadFile) -> None:
    filename = file.filename or ""
    content_type = file.content_type or ""
    if not filename.lower().endswith(".csv") and content_type not in _ACCEPTED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only CSV files are accepted (.csv extension required)",
        )


def _load_execute_request(mapping_json: str) -> ImportExecuteRequest:
    try:
        raw = json.loads(mapping_json)
        return ImportExecuteRequest.model_validate(raw)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="mapping_json is not valid JSON or does not match expected schema",
        )


def _load_skipped_rows(skipped_rows_json: str | None) -> set[int]:
    if not skipped_rows_json:
        return set()
    try:
        raw = json.loads(skipped_rows_json)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="skipped_rows_json is not valid JSON",
        )
    if not isinstance(raw, list) or not all(isinstance(row, int) for row in raw):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="skipped_rows_json must be a JSON array of row numbers",
        )
    return set(raw)


def _load_row_parent_overrides(row_overrides_json: str | None) -> dict[int, dict[str, int | str]]:
    if not row_overrides_json:
        return {}
    try:
        raw = json.loads(row_overrides_json)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="row_overrides_json is not valid JSON",
        )
    if not isinstance(raw, list):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="row_overrides_json must be a JSON array",
        )

    overrides: dict[int, dict[str, int | str]] = {}
    for item in raw:
        if not isinstance(item, dict):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="row_overrides_json entries must be objects",
            )
        allowed_keys = {"rowNumber", "row_number", "action", "parentLicenseId", "parent_license_id"}
        if set(item) - allowed_keys:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="row_overrides_json entries contain unknown fields",
            )
        row_number = item.get("rowNumber", item.get("row_number"))
        action = item.get("action")
        parent_license_id = item.get("parentLicenseId", item.get("parent_license_id"))
        if isinstance(row_number, bool) or not isinstance(row_number, int) or row_number <= 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="row_overrides_json entries require a positive integer rowNumber",
            )
        if action is None and parent_license_id is not None:
            action = "link_existing"
        if action not in {"link_existing", "import_legacy_unlinked"}:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="row_overrides_json entries require a supported action",
            )
        if row_number in overrides:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"row_overrides_json contains duplicate rowNumber {row_number}",
            )
        if action == "link_existing":
            if isinstance(parent_license_id, bool) or not isinstance(parent_license_id, int) or parent_license_id <= 0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="link_existing requires a positive integer parentLicenseId",
                )
            overrides[row_number] = {"action": action, "parent_license_id": parent_license_id}
        else:
            if parent_license_id is not None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="import_legacy_unlinked must not include parentLicenseId",
                )
            overrides[row_number] = {"action": action}
    return overrides


def _load_reference_overrides(reference_overrides_json: str | None) -> dict:
    if not reference_overrides_json:
        return {}
    try:
        raw = json.loads(reference_overrides_json)
        if not isinstance(raw, list):
            raise ValueError
        return parse_reference_overrides([ImportReferenceOverride.model_validate(item) for item in raw])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="reference_overrides_json is not valid JSON or does not match expected schema",
        ) from exc


async def _validated_column_to_target(
    db: AsyncSession, contents: bytes, mapping: list[MappingEntry]
) -> dict[str, str]:
    try:
        headers, _ = read_csv_dict_rows(contents)
        definitions = await get_all_definitions(db)
        supported_targets = set(_HEADER_MAP.values())
        custom_field_keys = {definition.field_key for definition in definitions}
        return validate_mapped_import(
            headers,
            mapping,
            supported_targets=supported_targets,
            custom_field_keys=custom_field_keys,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


def _validate_csv_headers(contents: bytes) -> None:
    """Reject non-empty uploads that do not contain a usable CSV header row."""
    try:
        headers, _ = read_csv_dict_rows(contents)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    if not headers or not any(header and header.strip() for header in headers):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded CSV does not contain a header row",
        )


async def _resolve_import_formats(
    db: AsyncSession,
    user_id: int,
    number_format_locale: str | None,
    date_format: str | None,
) -> tuple[str, str, str]:
    default_currency, default_number_locale, default_date_format = await get_import_defaults(db, user_id)
    locale = number_format_locale or default_number_locale
    declared_date_format = date_format or default_date_format
    if locale not in SUPPORTED_NUMBER_FORMAT_LOCALES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unsupported number_format_locale: {locale!r}",
        )
    if declared_date_format not in _SUPPORTED_DATE_FORMATS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unsupported date_format: {declared_date_format!r}",
        )
    return default_currency, locale, declared_date_format


async def _custom_field_header_map(db: AsyncSession) -> dict[str, str]:
    definitions = await get_all_definitions(db)
    return build_custom_field_header_map(definitions)


def _parse_native_csv(contents: bytes, *args, **kwargs):
    try:
        return parse_csv(contents, *args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/analyze", response_model=CSVAnalyzeResponse)
async def analyze_import(
    db: DbSession,
    file: UploadFile,
    current_user: User = Depends(require_editor_or_admin),
) -> CSVAnalyzeResponse:
    """Analyze a CSV file: return matched columns, unrecognized columns with
    sample values, and missing required fields. Nothing is written to the database."""
    _reject_non_csv(file)
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file is empty")
    _validate_csv_headers(contents)

    raw_headers, all_rows = read_csv_dict_rows(contents)
    sample_rows = all_rows[:3]
    total_rows = len(all_rows)

    matched_fields: set[str] = set()
    matched_columns: list[ColumnMatch] = []
    matched_column_indexes: dict[str, int] = {}
    unrecognized_columns: list[UnrecognizedColumn] = []
    custom_headers = await _custom_field_header_map(db)

    for raw_h in raw_headers:
        norm = _normalise_header(raw_h)
        # Export-only/computed columns are recognised but silently dropped, so
        # round-tripping a full export does not prompt custom-field creation.
        if norm in _IGNORED_HEADERS:
            continue
        internal = _HEADER_MAP.get(norm) or custom_headers.get(norm)
        samples = [r.get(raw_h, "").strip() for r in sample_rows if r.get(raw_h, "").strip()][:3]
        if internal and internal not in matched_fields:
            matched_fields.add(internal)
            matched_column_indexes[internal] = len(matched_columns)
            matched_columns.append(ColumnMatch(raw_header=raw_h, internal_field=internal, sample_values=samples))
        elif internal:
            existing_index = matched_column_indexes[internal]
            existing = matched_columns[existing_index]
            existing_norm = _normalise_header(existing.raw_header)
            if existing_norm in _FALLBACK_HEADER_ALIASES and norm not in _FALLBACK_HEADER_ALIASES:
                matched_columns[existing_index] = ColumnMatch(
                    raw_header=raw_h,
                    internal_field=internal,
                    sample_values=samples,
                )
                unrecognized_columns.append(
                    UnrecognizedColumn(raw_header=existing.raw_header, sample_values=existing.sample_values)
                )
            else:
                unrecognized_columns.append(UnrecognizedColumn(raw_header=raw_h, sample_values=samples))
        elif not internal:
            unrecognized_columns.append(UnrecognizedColumn(raw_header=raw_h, sample_values=samples))

    missing_required = [f for f in _REQUIRED_FOR_IMPORT if f not in matched_fields]
    return CSVAnalyzeResponse(
        total_rows=total_rows,
        matched_columns=matched_columns,
        unrecognized_columns=unrecognized_columns,
        missing_required=missing_required,
    )


@router.post("/preview", response_model=CSVImportPreviewResponse)
async def preview_import(
    db: DbSession,
    file: UploadFile,
    update_existing: bool = Form(False),
    number_format_locale: str | None = Form(None),
    date_format: str | None = Form(None),
    current_user: User = Depends(require_editor_or_admin),
) -> CSVImportPreviewResponse:
    """Parse and validate a CSV file (native auto-map flow). Returns per-row
    classification and counts - nothing is written to the database."""
    _reject_non_csv(file)
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file is empty")
    _validate_csv_headers(contents)

    default_currency, locale, declared_date_format = await _resolve_import_formats(
        db, current_user.id, number_format_locale, date_format
    )
    custom_headers = await _custom_field_header_map(db)
    result = _parse_native_csv(
        contents,
        default_currency,
        locale,
        declared_date_format,
        custom_field_header_map=custom_headers,
    )
    await validate_imported_custom_rows(db, result.rows, result.custom_rows, locale, declared_date_format)
    await prepare_import_rows(result.rows, db, update_existing=update_existing)
    return build_preview_response(result, await build_reference_summary(db, result.rows))


@router.post("/preview-mapped", response_model=CSVImportPreviewResponse)
async def preview_mapped_import(
    db: DbSession,
    file: UploadFile,
    mapping_json: str = Form(...),
    update_existing: bool = Form(False),
    number_format_locale: str | None = Form(None),
    date_format: str | None = Form(None),
    current_user: User = Depends(require_editor_or_admin),
) -> CSVImportPreviewResponse:
    """Preview a CSV import after the user has resolved column mappings."""
    _reject_non_csv(file)
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file is empty")
    _validate_csv_headers(contents)

    execute_request = _load_execute_request(mapping_json)
    column_to_target = await _validated_column_to_target(db, contents, execute_request.mapping)
    default_currency, locale, declared_date_format = await _resolve_import_formats(
        db, current_user.id, number_format_locale, date_format
    )
    result, _custom_rows = parse_mapped_csv(contents, column_to_target, default_currency, locale, declared_date_format)
    await validate_imported_custom_rows(db, result.rows, _custom_rows, locale, declared_date_format)
    await prepare_import_rows(result.rows, db, update_existing=update_existing)
    return build_preview_response(result, await build_reference_summary(db, result.rows))


@router.post("/execute", response_model=CSVImportConfirmResponse)
async def execute_import(
    request: Request,
    db: DbSession,
    file: UploadFile,
    mapping_json: str = Form(...),
    skipped_rows_json: str = Form("[]"),
    row_overrides_json: str = Form("[]"),
    reference_overrides_json: str = Form("[]"),
    acknowledge_warnings: bool = Form(False),
    update_existing: bool = Form(False),
    number_format_locale: str | None = Form(None),
    date_format: str | None = Form(None),
    current_user: User = Depends(require_editor_or_admin),
) -> CSVImportConfirmResponse:
    """Execute a CSV import using a resolved column mapping.

    If mapping_json includes mapping_name, upserts the mapping before executing.
    If the parsed rows have non-fatal warnings, acknowledge_warnings must be True
    or the endpoint returns 409 with the warning summary.
    """
    _reject_non_csv(file)
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file is empty")
    _validate_csv_headers(contents)

    execute_request = _load_execute_request(mapping_json)
    skipped_rows = _load_skipped_rows(skipped_rows_json)
    row_parent_overrides = _load_row_parent_overrides(row_overrides_json)
    reference_overrides = _load_reference_overrides(reference_overrides_json)

    if execute_request.mapping_name and current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access is required to save import mapping presets",
        )

    if execute_request.mapping_name:
        mapping_data = [{"raw_header": e.raw_header, "target": e.target} for e in execute_request.mapping]
        existing_result = await db.execute(
            sa_select(ImportMapping).where(ImportMapping.name == execute_request.mapping_name)
        )
        existing_row = existing_result.scalar_one_or_none()
        if existing_row:
            existing_row.mapping = mapping_data
            existing_row.updated_at = datetime.now(timezone.utc)
        else:
            db.add(ImportMapping(name=execute_request.mapping_name, mapping=mapping_data))
        await db.flush()

    column_to_target = await _validated_column_to_target(db, contents, execute_request.mapping)
    default_currency, locale, declared_date_format = await _resolve_import_formats(
        db, current_user.id, number_format_locale, date_format
    )
    parsed_result, custom_rows = parse_mapped_csv(
        contents, column_to_target, default_currency, locale, declared_date_format
    )
    await validate_imported_custom_rows(db, parsed_result.rows, custom_rows, locale, declared_date_format)
    await prepare_import_rows(
        parsed_result.rows,
        db,
        update_existing=update_existing,
        row_parent_overrides=row_parent_overrides,
    )
    skipped_rows = expand_skipped_inferred_rows(parsed_result.rows, skipped_rows)
    await validate_reference_overrides(db, parsed_result.rows, skipped_rows, reference_overrides)

    warning_summary: ImportWarningSummary = build_warning_summary(parsed_result.rows, skipped_rows)
    if warning_summary.has_warnings and not acknowledge_warnings:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "warnings_require_acknowledgement",
                "message": "Import has warnings that require acknowledgement. Resubmit with acknowledgeWarnings=true.",
                "warningSummary": warning_summary.model_dump(by_alias=True),
            },
        )

    imported_count, updated_count, skipped_count, import_errors, cf_failures, reference_result = await run_import_rows(
        parsed_result.rows,
        custom_rows,
        skipped_rows,
        current_user.id,
        db,
        locale,
        declared_date_format,
        update_existing=update_existing,
        reference_overrides=reference_overrides,
        include_reference_result=True,
    )

    if imported_count > 0 or updated_count > 0:
        ip = request.client.host if request.client else None
        detail = format_audit_detail(
            "csv_import",
            {
                "importMode": "mapped_csv",
                "insertedCount": str(imported_count),
                "updatedCount": str(updated_count),
                "skippedCount": str(skipped_count),
                "errorCount": str(len(import_errors)),
                "defaultedEnumCount": str(warning_summary.defaulted_enum_count),
                "ambiguousDateCount": str(warning_summary.ambiguous_date_count),
                "inferredParentCount": str(warning_summary.inferred_parent_count),
                "duplicateWarningCount": str(warning_summary.duplicate_warning_count),
                "priceMismatchCount": str(warning_summary.price_mismatch_count),
                "expiredMaintenanceCount": str(warning_summary.expired_maintenance_count),
                "legacyUnlinkedMaintenanceCount": str(warning_summary.legacy_unlinked_maintenance_count),
                "customFieldFailureCount": str(cf_failures),
                "acknowledgedWarnings": str(acknowledge_warnings).lower(),
                "referenceCreatedCount": str(reference_result.created_count),
                "referenceReusedCount": str(reference_result.reused_count),
            },
        )
        await log_event(
            db,
            "license.csv_imported",
            actor=current_user,
            ip_address=ip,
            target_type="license",
            detail=detail,
        )

    await db.commit()
    return CSVImportConfirmResponse(
        imported_count=imported_count,
        updated_count=updated_count,
        skipped_count=skipped_count,
        error_count=len(import_errors),
        errors=import_errors,
        warning_summary=warning_summary,
        warnings_acknowledged=acknowledge_warnings,
        reference_result=reference_result,
    )


@router.post("/confirm", response_model=CSVImportConfirmResponse)
async def confirm_import(
    request: Request,
    db: DbSession,
    file: UploadFile,
    skipped_rows_json: str = Form("[]"),
    row_overrides_json: str = Form("[]"),
    reference_overrides_json: str = Form("[]"),
    acknowledge_warnings: bool = Form(False),
    update_existing: bool = Form(False),
    number_format_locale: str | None = Form(None),
    date_format: str | None = Form(None),
    current_user: User = Depends(require_editor_or_admin),
) -> CSVImportConfirmResponse:
    """Re-parse the CSV file (native auto-map flow) and persist all importable rows.

    If the parsed rows have non-fatal warnings, acknowledge_warnings must be True
    or the endpoint returns 409 with the warning summary.
    """
    _reject_non_csv(file)
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file is empty")
    _validate_csv_headers(contents)

    default_currency, locale, declared_date_format = await _resolve_import_formats(
        db, current_user.id, number_format_locale, date_format
    )
    custom_headers = await _custom_field_header_map(db)
    result = _parse_native_csv(
        contents,
        default_currency,
        locale,
        declared_date_format,
        custom_field_header_map=custom_headers,
    )
    await validate_imported_custom_rows(db, result.rows, result.custom_rows, locale, declared_date_format)
    skipped_rows = _load_skipped_rows(skipped_rows_json)
    row_parent_overrides = _load_row_parent_overrides(row_overrides_json)
    reference_overrides = _load_reference_overrides(reference_overrides_json)
    await prepare_import_rows(
        result.rows,
        db,
        update_existing=update_existing,
        row_parent_overrides=row_parent_overrides,
    )
    skipped_rows = expand_skipped_inferred_rows(result.rows, skipped_rows)
    await validate_reference_overrides(db, result.rows, skipped_rows, reference_overrides)

    warning_summary: ImportWarningSummary = build_warning_summary(result.rows, skipped_rows)
    if warning_summary.has_warnings and not acknowledge_warnings:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "warnings_require_acknowledgement",
                "message": "Import has warnings that require acknowledgement. Resubmit with acknowledgeWarnings=true.",
                "warningSummary": warning_summary.model_dump(by_alias=True),
            },
        )

    imported_count, updated_count, skipped_count, import_errors, cf_failures, reference_result = await run_import_rows(
        result.rows,
        result.custom_rows,
        skipped_rows,
        current_user.id,
        db,
        locale,
        declared_date_format,
        update_existing=update_existing,
        reference_overrides=reference_overrides,
        include_reference_result=True,
    )

    if imported_count > 0 or updated_count > 0:
        ip = request.client.host if request.client else None
        detail = format_audit_detail(
            "csv_import",
            {
                "importMode": "bulk_csv",
                "insertedCount": str(imported_count),
                "updatedCount": str(updated_count),
                "skippedCount": str(skipped_count),
                "errorCount": str(len(import_errors)),
                "defaultedEnumCount": str(warning_summary.defaulted_enum_count),
                "ambiguousDateCount": str(warning_summary.ambiguous_date_count),
                "inferredParentCount": str(warning_summary.inferred_parent_count),
                "duplicateWarningCount": str(warning_summary.duplicate_warning_count),
                "priceMismatchCount": str(warning_summary.price_mismatch_count),
                "expiredMaintenanceCount": str(warning_summary.expired_maintenance_count),
                "legacyUnlinkedMaintenanceCount": str(warning_summary.legacy_unlinked_maintenance_count),
                "customFieldFailureCount": str(cf_failures),
                "acknowledgedWarnings": str(acknowledge_warnings).lower(),
                "referenceCreatedCount": str(reference_result.created_count),
                "referenceReusedCount": str(reference_result.reused_count),
            },
        )
        await log_event(
            db,
            "license.csv_imported",
            actor=current_user,
            ip_address=ip,
            target_type="license",
            detail=detail,
        )

    await db.commit()
    return CSVImportConfirmResponse(
        imported_count=imported_count,
        updated_count=updated_count,
        skipped_count=skipped_count,
        error_count=len(import_errors),
        errors=import_errors,
        warning_summary=warning_summary,
        warnings_acknowledged=acknowledge_warnings,
        reference_result=reference_result,
    )


@router.get("/template")
async def download_template(
    _editor: User = Depends(require_editor_or_admin),
) -> FileResponse:
    """Serve the blank CSV import template as a file download."""
    template_path = Path(__file__).parent.parent / "services" / "csv_template.csv"
    if not template_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template file not found")
    return FileResponse(
        path=str(template_path),
        media_type="text/csv",
        filename="license_lifecycle_template.csv",
        headers={"Content-Disposition": 'attachment; filename="license_lifecycle_template.csv"'},
    )
