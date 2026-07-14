"""
Service layer for custom field definitions and per-license values.
"""

from __future__ import annotations

import re
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.custom_fields import CustomFieldDefinition, CustomFieldValue
from app.models.license import License
from app.schemas.custom_fields import CustomFieldDefinitionCreate, CustomFieldDefinitionUpdate, CustomFieldValuesUpsert
from app.services.money import MoneyParseError, parse_localized_money, parse_money


async def generate_field_key(name: str) -> str:
    """
    Convert display name to a URL/storage-safe slug.
    Lowercase, replace spaces and special chars with underscores,
    collapse multiple underscores, strip leading/trailing underscores.
    """
    key = name.lower()
    key = re.sub(r"[^a-z0-9]+", "_", key)
    key = re.sub(r"_+", "_", key)
    key = key.strip("_")
    return f"cf_{key}"


async def get_all_definitions(db: AsyncSession) -> list[CustomFieldDefinition]:
    """Return all definitions ordered by display_order ASC, then id ASC."""
    result = await db.execute(
        select(CustomFieldDefinition).order_by(
            CustomFieldDefinition.display_order.asc(),
            CustomFieldDefinition.id.asc(),
        )
    )
    return list(result.scalars().all())


async def get_definition_by_id(db: AsyncSession, def_id: int) -> CustomFieldDefinition | None:
    result = await db.execute(select(CustomFieldDefinition).where(CustomFieldDefinition.id == def_id))
    return result.scalar_one_or_none()


async def create_definition(db: AsyncSession, data: CustomFieldDefinitionCreate) -> CustomFieldDefinition:
    """
    Generate field_key from name. Check uniqueness of both name and field_key
    before inserting - raise HTTPException 409 on conflict.
    """
    field_key = await generate_field_key(data.name)

    # Check name uniqueness
    existing_name = await db.scalar(
        select(CustomFieldDefinition).where(func.lower(CustomFieldDefinition.name) == func.lower(data.name))
    )
    if existing_name is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A custom field with name '{data.name}' already exists.",
        )

    # Check field_key uniqueness
    existing_key = await db.scalar(select(CustomFieldDefinition).where(CustomFieldDefinition.field_key == field_key))
    if existing_key is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A custom field with key '{field_key}' already exists.",
        )

    definition = CustomFieldDefinition(
        name=data.name,
        field_key=field_key,
        field_type=data.field_type,
        display_order=data.display_order,
    )
    db.add(definition)
    await db.flush()
    await db.refresh(definition)
    return definition


def _normalise_boolean_value(value: object) -> str | None:
    """Keep boolean custom fields tri-state: true, false, or unset."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None or value == "":
        return None

    normalized = str(value).strip().lower()
    if normalized in {"true", "t", "yes", "y", "1"}:
        return "true"
    if normalized in {"false", "f", "no", "n", "0"}:
        return "false"

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail="Boolean custom field values must be true/false, yes/no, 1/0, or null.",
    )


def _normalise_date_value(value: object) -> str | None:
    if value is None or value == "":
        return None
    try:
        return date.fromisoformat(str(value)).isoformat()
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Date custom field values must use YYYY-MM-DD.",
        )


def _normalise_currency_value(
    value: object,
    number_format_locale: str | None = None,
) -> str | None:
    if value is None or value == "":
        return None
    raw = str(value).strip()
    if number_format_locale is not None:
        try:
            return parse_localized_money(raw, number_format_locale)
        except MoneyParseError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=str(exc),
            ) from exc
    try:
        parse_money(raw)
    except MoneyParseError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    return raw


def normalize_custom_field_value(
    definition: CustomFieldDefinition,
    value_text: str | bool | None = None,
    value_currency: str | None = None,
    number_format_locale: str | None = None,
) -> tuple[str | None, str | None]:
    """Normalize a custom field value according to its definition."""
    if definition.field_type == "boolean":
        return _normalise_boolean_value(value_text), None
    if definition.field_type == "date":
        return _normalise_date_value(value_text), None
    if definition.field_type == "currency":
        return None, _normalise_currency_value(value_currency, number_format_locale)
    return value_text, value_currency


def build_custom_field_value(
    license_id: int,
    definition: CustomFieldDefinition,
    raw_value: str | None,
    number_format_locale: str | None = None,
) -> CustomFieldValue:
    """Build a CustomFieldValue row using the shared normalization path."""
    value_text = None if definition.field_type == "currency" else raw_value
    value_currency = raw_value if definition.field_type == "currency" else None
    normalized_text, normalized_currency = normalize_custom_field_value(
        definition,
        value_text=value_text,
        value_currency=value_currency,
        number_format_locale=number_format_locale,
    )
    return CustomFieldValue(
        license_id=license_id,
        custom_field_def_id=definition.id,
        value_text=normalized_text,
        value_currency=normalized_currency,
    )


async def upsert_imported_values_for_license(
    db: AsyncSession,
    license_id: int,
    values_by_field_key: dict[str, str],
    number_format_locale: str | None = None,
) -> list[str]:
    """
    Add/update imported custom field values without committing.

    Returns any unknown field keys so callers can preserve existing logging and
    import response behavior.
    """
    if not values_by_field_key:
        return []

    result = await db.execute(
        select(CustomFieldDefinition).where(CustomFieldDefinition.field_key.in_(values_by_field_key.keys()))
    )
    definitions_by_key = {definition.field_key: definition for definition in result.scalars().all()}

    missing_keys: list[str] = []
    for field_key, raw_value in values_by_field_key.items():
        definition = definitions_by_key.get(field_key)
        if definition is None:
            missing_keys.append(field_key)
            continue

        existing = await db.scalar(
            select(CustomFieldValue).where(
                CustomFieldValue.license_id == license_id,
                CustomFieldValue.custom_field_def_id == definition.id,
            )
        )
        if existing is not None:
            value = build_custom_field_value(license_id, definition, raw_value, number_format_locale)
            existing.value_text = value.value_text
            existing.value_currency = value.value_currency
        else:
            db.add(build_custom_field_value(license_id, definition, raw_value, number_format_locale))

    return missing_keys


async def validate_imported_custom_rows(
    db: AsyncSession,
    rows: list[object],
    custom_rows: list[dict[str, str]],
    number_format_locale: str | None = None,
) -> None:
    """Attach row-level import errors for unknown or invalid mapped custom fields."""
    field_keys = {
        field_key
        for custom_data in custom_rows
        for field_key, raw_value in custom_data.items()
        if raw_value not in (None, "")
    }
    if not field_keys:
        return

    result = await db.execute(select(CustomFieldDefinition).where(CustomFieldDefinition.field_key.in_(field_keys)))
    definitions_by_key = {definition.field_key: definition for definition in result.scalars().all()}

    for row, custom_data in zip(rows, custom_rows):
        for field_key, raw_value in custom_data.items():
            definition = definitions_by_key.get(field_key)
            if definition is None:
                row.validation_errors.append(f"Unknown custom field: {field_key}")
                continue
            try:
                build_custom_field_value(
                    license_id=0,
                    definition=definition,
                    raw_value=raw_value,
                    number_format_locale=number_format_locale,
                )
            except HTTPException as exc:
                row.validation_errors.append(f"{definition.name}: {exc.detail}")
        if row.validation_errors:
            row.import_status = "error"


async def update_definition(db: AsyncSession, def_id: int, data: CustomFieldDefinitionUpdate) -> CustomFieldDefinition:
    """
    Only name and display_order are mutable. If name changes, do NOT regenerate
    field_key - it is immutable after creation.
    Raise HTTPException 404 if not found, 409 if new name conflicts.
    """
    definition = await get_definition_by_id(db, def_id)
    if definition is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Custom field definition {def_id} not found.",
        )

    if data.name is not None and data.name != definition.name:
        existing = await db.scalar(
            select(CustomFieldDefinition).where(
                func.lower(CustomFieldDefinition.name) == func.lower(data.name),
                CustomFieldDefinition.id != def_id,
            )
        )
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A custom field with name '{data.name}' already exists.",
            )
        definition.name = data.name

    if data.display_order is not None:
        definition.display_order = data.display_order

    if "section" in data.model_fields_set:
        definition.section = data.section

    await db.flush()
    await db.refresh(definition)
    return definition


async def delete_definition(db: AsyncSession, def_id: int) -> dict:
    """
    Returns {"deleted_id": def_id, "affected_licenses": N} where N is the count
    of license_custom_values rows that will be cascade-deleted.
    Raise HTTPException 404 if not found.
    """
    definition = await get_definition_by_id(db, def_id)
    if definition is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Custom field definition {def_id} not found.",
        )

    count_result = await db.scalar(select(func.count()).where(CustomFieldValue.custom_field_def_id == def_id))
    affected = count_result or 0

    await db.delete(definition)
    await db.flush()

    return {"deleted_id": def_id, "affected_licenses": affected}


async def get_all_values(
    db: AsyncSession,
    departments: list[str] | None = None,
) -> list[CustomFieldValue]:
    """Return all CustomFieldValue rows with definitions eagerly loaded."""
    query = select(CustomFieldValue).options(selectinload(CustomFieldValue.definition))
    if departments is not None:
        query = query.join(License, License.id == CustomFieldValue.license_id)
        if not departments:
            query = query.where(False)
        else:
            query = query.where(License.cost_centre.in_(departments))
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_values_for_license(db: AsyncSession, license_id: int) -> list[CustomFieldValue]:
    """
    Return all CustomFieldValue rows for the given license_id,
    with definition eagerly loaded (selectinload).
    """
    result = await db.execute(
        select(CustomFieldValue)
        .where(CustomFieldValue.license_id == license_id)
        .options(selectinload(CustomFieldValue.definition))
    )
    return list(result.scalars().all())


async def upsert_values_for_license(
    db: AsyncSession, license_id: int, data: CustomFieldValuesUpsert
) -> list[CustomFieldValue]:
    """
    For each item in data.values:
    - If a row exists for (license_id, custom_field_def_id): update it.
    - If no row exists: insert it.
    Items not present in the payload are left untouched (partial update).
    Validate that each custom_field_def_id exists - raise 422 if any are unknown.
    Return updated rows with definitions loaded.
    """
    if not data.values:
        return await get_values_for_license(db, license_id)

    # Validate all def IDs exist
    def_ids = [item.custom_field_def_id for item in data.values]
    existing_defs_result = await db.execute(select(CustomFieldDefinition).where(CustomFieldDefinition.id.in_(def_ids)))
    definitions_by_id = {definition.id: definition for definition in existing_defs_result.scalars().all()}
    found_ids = set(definitions_by_id)
    missing = [d for d in def_ids if d not in found_ids]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown custom_field_def_id(s): {missing}",
        )

    for item in data.values:
        definition = definitions_by_id[item.custom_field_def_id]
        value_text, value_currency = normalize_custom_field_value(
            definition,
            value_text=item.value_text,
            value_currency=item.value_currency,
        )

        existing = await db.scalar(
            select(CustomFieldValue).where(
                CustomFieldValue.license_id == license_id,
                CustomFieldValue.custom_field_def_id == item.custom_field_def_id,
            )
        )
        if existing is not None:
            existing.value_text = value_text
            existing.value_currency = value_currency
        else:
            new_value = CustomFieldValue(
                license_id=license_id,
                custom_field_def_id=item.custom_field_def_id,
                value_text=value_text,
                value_currency=value_currency,
            )
            db.add(new_value)

    return await get_values_for_license(db, license_id)
