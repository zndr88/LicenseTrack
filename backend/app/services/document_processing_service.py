"""Document-processing result review and suggestion application workflows."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.custom_fields import CustomFieldDefinition
from app.models.document_processing import DocumentProcessingResult
from app.models.license import License
from app.schemas.custom_fields import CustomFieldValueItem, CustomFieldValuesUpsert
from app.schemas.document_processing import DocumentProcessingResultCreate
from app.services.custom_fields_service import (
    build_custom_field_value,
    get_values_for_license,
    upsert_values_for_license,
)
from app.services.license_write_service import (
    ALLOWED_PATCH_FIELDS,
    apply_license_field_patch,
    validate_patch_field_input,
)


@dataclass(frozen=True)
class DocumentProcessingCreateResult:
    result: DocumentProcessingResult
    superseded: tuple[DocumentProcessingResult, ...]


@dataclass(frozen=True)
class DocumentProcessingReviewResult:
    result: DocumentProcessingResult
    applied_fields: tuple[str, ...]
    applied_changes: tuple[str, ...]


def _normalise_suggested_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _custom_field_lookup_key(value: str) -> str:
    return value.strip().lower().replace(" ", "_")


async def _custom_field_lookup(
    db: AsyncSession,
) -> dict[str, CustomFieldDefinition]:
    definitions = list((await db.scalars(select(CustomFieldDefinition))).all())
    lookup: dict[str, CustomFieldDefinition] = {}
    for definition in definitions:
        lookup[_custom_field_lookup_key(definition.field_key)] = definition
        lookup[_custom_field_lookup_key(definition.field_key.removeprefix("cf_"))] = definition
        lookup[_custom_field_lookup_key(definition.name)] = definition
    return lookup


async def create_document_processing_result_record(
    db: AsyncSession,
    payload: DocumentProcessingResultCreate,
    *,
    license_id: int | None,
    created_by: int,
) -> DocumentProcessingCreateResult:
    now = datetime.now(timezone.utc)
    previous = await db.scalars(
        select(DocumentProcessingResult).where(
            DocumentProcessingResult.document_type == payload.document_type,
            DocumentProcessingResult.document_id == payload.document_id,
            DocumentProcessingResult.capability_key == payload.capability_key,
            DocumentProcessingResult.status == "pending",
        )
    )
    superseded = tuple(previous.all())
    for row in superseded:
        row.status = "superseded"
        row.reviewed_by = created_by
        row.reviewed_at = now

    result = DocumentProcessingResult(
        document_type=payload.document_type,
        document_id=payload.document_id,
        license_id=license_id,
        capability_key=payload.capability_key,
        status="pending",
        suggested_fields=[
            field.model_dump(mode="json", by_alias=True)
            for field in payload.suggested_fields
        ],
        summary=payload.summary,
        raw_output=payload.raw_output,
        error=payload.error,
        created_by=created_by,
    )
    db.add(result)
    await db.flush()
    return DocumentProcessingCreateResult(result=result, superseded=superseded)


def _selected_suggestions(
    result: DocumentProcessingResult,
    suggested_field_indexes: list[int] | None,
) -> list[dict]:
    if suggested_field_indexes is None:
        return list(result.suggested_fields)
    selected_indexes = sorted(set(suggested_field_indexes))
    invalid_indexes = [
        index
        for index in selected_indexes
        if index < 0 or index >= len(result.suggested_fields)
    ]
    if invalid_indexes:
        raise HTTPException(
            status_code=422,
            detail=(
                "Invalid suggested field index(es): "
                f"{', '.join(str(index) for index in invalid_indexes)}"
            ),
        )
    return [result.suggested_fields[index] for index in selected_indexes]


async def apply_document_processing_suggestions(
    db: AsyncSession,
    result: DocumentProcessingResult,
    suggested_field_indexes: list[int] | None,
) -> tuple[list[str], list[str]]:
    if result.license_id is None:
        raise HTTPException(status_code=422, detail="Processing result is not linked to a license")

    custom_by_key = await _custom_field_lookup(db)
    unknown_fields: list[str] = []
    license_field_ops: list[tuple[str, str | None]] = []
    custom_field_ops: list[tuple[CustomFieldDefinition, str | None]] = []
    for suggestion in _selected_suggestions(result, suggested_field_indexes):
        field = str(suggestion.get("field", "")).strip()
        if not field:
            unknown_fields.append(field)
            continue
        raw_value = _normalise_suggested_value(suggestion.get("value"))
        if field in ALLOWED_PATCH_FIELDS:
            validate_patch_field_input(field, raw_value)
            license_field_ops.append((field, raw_value))
            continue
        definition = custom_by_key.get(_custom_field_lookup_key(field))
        if definition is not None:
            custom_field_ops.append((definition, raw_value))
            continue
        unknown_fields.append(field)

    if unknown_fields:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported suggested field(s): {', '.join(unknown_fields)}",
        )
    if not license_field_ops and not custom_field_ops:
        raise HTTPException(status_code=422, detail="No suggested fields to apply")

    custom_payload_items: list[CustomFieldValueItem] = []
    custom_changes: list[str] = []
    if custom_field_ops:
        existing_values = await get_values_for_license(db, result.license_id)
        current_values = {
            value.custom_field_def_id: (value.value_text, value.value_currency)
            for value in existing_values
        }
        for definition, raw_value in custom_field_ops:
            normalized = build_custom_field_value(
                result.license_id,
                definition,
                raw_value,
            )
            before_text, before_currency = current_values.get(
                definition.id,
                (None, None),
            )
            before_value = (
                before_currency
                if definition.field_type == "currency"
                else before_text
            )
            after_value = (
                normalized.value_currency
                if definition.field_type == "currency"
                else normalized.value_text
            )
            custom_changes.append(
                f"{definition.field_key}: {before_value or ''} → {after_value or ''}"
            )
            current_values[definition.id] = (
                normalized.value_text,
                normalized.value_currency,
            )
            custom_payload_items.append(
                CustomFieldValueItem(
                    custom_field_def_id=definition.id,
                    value_text=(
                        None
                        if definition.field_type == "currency"
                        else raw_value
                    ),
                    value_currency=(
                        raw_value
                        if definition.field_type == "currency"
                        else None
                    ),
                )
            )

    applied_fields: list[str] = []
    applied_changes: list[str] = []
    for field, raw_value in license_field_ops:
        license_obj = await db.get(License, result.license_id)
        snake_field = ALLOWED_PATCH_FIELDS[field]
        before_value = getattr(license_obj, snake_field) if license_obj is not None else None
        updated_license = await apply_license_field_patch(
            db,
            result.license_id,
            field=field,
            value=raw_value,
        )
        after_value = getattr(updated_license, snake_field)
        applied_fields.append(field)
        applied_changes.append(
            f"{field}: {before_value or ''} → {after_value or ''}"
        )

    if custom_payload_items:
        await upsert_values_for_license(
            db,
            result.license_id,
            CustomFieldValuesUpsert(values=custom_payload_items),
        )
        applied_fields.extend(
            definition.field_key for definition, _ in custom_field_ops
        )
        applied_changes.extend(custom_changes)
    return applied_fields, applied_changes


async def accept_document_processing_result_record(
    db: AsyncSession,
    result: DocumentProcessingResult,
    *,
    reviewed_by: int,
    suggested_field_indexes: list[int] | None,
) -> DocumentProcessingReviewResult:
    applied_fields, applied_changes = await apply_document_processing_suggestions(
        db,
        result,
        suggested_field_indexes,
    )
    result.status = "accepted"
    result.reviewed_by = reviewed_by
    result.reviewed_at = datetime.now(timezone.utc)
    return DocumentProcessingReviewResult(
        result=result,
        applied_fields=tuple(applied_fields),
        applied_changes=tuple(applied_changes),
    )


def reject_document_processing_result_record(
    result: DocumentProcessingResult,
    *,
    reviewed_by: int,
) -> DocumentProcessingReviewResult:
    result.status = "rejected"
    result.reviewed_by = reviewed_by
    result.reviewed_at = datetime.now(timezone.utc)
    return DocumentProcessingReviewResult(
        result=result,
        applied_fields=(),
        applied_changes=(),
    )
