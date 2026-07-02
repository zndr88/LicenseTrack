from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.custom_fields import CustomFieldDefinition, CustomFieldValue
from app.models.license import License
from app.models.pending_order import PendingOrder
from app.models.plugin import Plugin, PluginPermission
from app.models.plugin_suggestion import PluginSuggestion
from app.models.sourcing import SourcingItem, SourcingStatus
from app.models.user import User
from app.schemas.plugin_suggestion import PluginSuggestedField, PluginSuggestionLineItem
from app.services.access_service import can_view_license
from app.services.custom_fields_service import build_custom_field_value
from app.services.license_write_service import ALLOWED_PATCH_FIELDS, apply_license_field_patch, validate_patch_field_input


SUPPORTED_TARGET_TYPES = {
    "license",
    "license_draft",
    "sourcing_item",
    "sourcing_quote_draft",
    "pending_order_draft",
    "pending_order_item",
    "pending_order_conversion",
}
SUGGESTION_PERMISSION_BY_TARGET = {
    "license": "suggestions:license:write",
    "license_draft": "suggestions:license_draft:write",
    "sourcing_item": "suggestions:sourcing_item:write",
    "sourcing_quote_draft": "suggestions:sourcing_quote_draft:write",
    "pending_order_draft": "suggestions:pending_order_draft:write",
    "pending_order_item": "suggestions:pending_order_item:write",
    "pending_order_conversion": "suggestions:pending_order_conversion:write",
}
SOURCING_ITEM_FIELDS = {
    "publisherName",
    "softwareDescription",
    "quantity",
    "estimatedUnitPrice",
    "estimatedTotalPrice",
    "currency",
    "startDate",
    "endDate",
    "supplier",
    "contactEmail",
    "notes",
}
PO_ITEM_FIELDS = SOURCING_ITEM_FIELDS | {"poNumber"}
LICENSE_DRAFT_FIELDS = set(ALLOWED_PATCH_FIELDS) | {"parentLicenseId"}
PENDING_ORDER_CONVERSION_FIELDS = LICENSE_DRAFT_FIELDS | {"parentSourcingItemId"}
TARGET_FIELD_ALLOWLISTS = {
    "sourcing_item": SOURCING_ITEM_FIELDS,
    "sourcing_quote_draft": SOURCING_ITEM_FIELDS,
    "pending_order_draft": PO_ITEM_FIELDS,
    "pending_order_item": SOURCING_ITEM_FIELDS,
    "license_draft": LICENSE_DRAFT_FIELDS,
    "pending_order_conversion": PENDING_ORDER_CONVERSION_FIELDS,
}


class PluginSuggestionError(ValueError):
    """Raised when plugin suggestion payloads or review actions are invalid."""


@dataclass(frozen=True)
class PluginSuggestionCreationResult:
    suggestions: list[PluginSuggestion] = field(default_factory=list)
    superseded_count: int = 0


@dataclass(frozen=True)
class PluginSuggestionApplyResult:
    suggestion: PluginSuggestion
    applied_fields: list[str]
    applied_changes: list[str]


def _normalise_suggested_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _custom_field_lookup_key(value: str) -> str:
    return value.strip().lower().replace(" ", "_")


def _payload_value(payload: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in payload:
            return payload[key]
    return default


def _plugin_has_permission(plugin: Plugin, permission_name: str) -> bool:
    return any(
        isinstance(permission, PluginPermission)
        and permission.permission == permission_name
        and permission.granted
        for permission in plugin.permissions
    )


async def _custom_field_lookup(db: AsyncSession) -> dict[str, CustomFieldDefinition]:
    definitions = await db.scalars(select(CustomFieldDefinition))
    custom_by_key: dict[str, CustomFieldDefinition] = {}
    for definition in definitions.all():
        custom_by_key[_custom_field_lookup_key(definition.field_key)] = definition
        custom_by_key[_custom_field_lookup_key(definition.field_key.removeprefix("cf_"))] = definition
        custom_by_key[_custom_field_lookup_key(definition.name)] = definition
    return custom_by_key


async def _validate_license_suggestion_fields(
    db: AsyncSession,
    *,
    license_id: int,
    fields: list[PluginSuggestedField],
) -> None:
    if not fields:
        raise PluginSuggestionError("Plugin suggestions must include at least one field")

    custom_by_key = await _custom_field_lookup(db)
    unknown_fields: list[str] = []
    for suggestion in fields:
        field_name = suggestion.field.strip()
        raw_value = _normalise_suggested_value(suggestion.value)
        if field_name in ALLOWED_PATCH_FIELDS:
            try:
                validate_patch_field_input(field_name, raw_value)
            except HTTPException as exc:
                raise PluginSuggestionError(str(exc.detail)) from exc
            continue
        definition = custom_by_key.get(_custom_field_lookup_key(field_name))
        if definition is not None:
            try:
                build_custom_field_value(license_id, definition, raw_value)
            except HTTPException as exc:
                raise PluginSuggestionError(str(exc.detail)) from exc
            continue
        unknown_fields.append(field_name)

    if unknown_fields:
        raise PluginSuggestionError(f"Unsupported suggested field(s): {', '.join(unknown_fields)}")


def _validate_allowlisted_fields(
    *,
    target_type: str,
    fields: list[PluginSuggestedField],
    line_items: list[PluginSuggestionLineItem],
) -> None:
    allowlist = TARGET_FIELD_ALLOWLISTS.get(target_type)
    if allowlist is None:
        raise PluginSuggestionError(f"Plugin suggestion target '{target_type}' is not implemented yet")
    if not fields and not line_items:
        raise PluginSuggestionError("Plugin suggestions must include at least one field or line item")

    unknown_fields = [
        suggestion.field.strip()
        for suggestion in fields
        if suggestion.field.strip() not in allowlist
    ]
    for line_item in line_items:
        unknown_fields.extend(
            suggestion.field.strip()
            for suggestion in line_item.fields
            if suggestion.field.strip() not in allowlist
        )
    if unknown_fields:
        raise PluginSuggestionError(f"Unsupported suggested field(s): {', '.join(sorted(set(unknown_fields)))}")


async def _resolve_target_license_id(
    db: AsyncSession,
    *,
    target_type: str,
    target_id: str,
    actor: User,
) -> int | None:
    if target_type == "license":
        try:
            license_id = int(target_id)
        except ValueError as exc:
            raise PluginSuggestionError("License suggestion targetId must be an integer") from exc
        license_obj = await db.get(License, license_id)
        if license_obj is None or not await can_view_license(actor, license_obj, db):
            raise PluginSuggestionError("License suggestion target not found")
        return license_id

    if target_type == "sourcing_item":
        item = await db.get(SourcingItem, _parse_int_target_id(target_id, "Sourcing item suggestion targetId must be an integer"))
        if item is None or item.status == SourcingStatus.converted:
            raise PluginSuggestionError("Sourcing item suggestion target not found")
        return None

    if target_type == "pending_order_item":
        item = await db.get(SourcingItem, _parse_int_target_id(target_id, "Pending order item suggestion targetId must be an integer"))
        if item is None or item.pending_order_id is None:
            raise PluginSuggestionError("Pending order item suggestion target not found")
        return None

    if target_type == "pending_order_conversion":
        order = await db.get(PendingOrder, _parse_int_target_id(target_id, "Pending order conversion suggestion targetId must be an integer"))
        if order is None:
            raise PluginSuggestionError("Pending order conversion suggestion target not found")
        return None

    if target_type == "license_draft":
        if not target_id:
            raise PluginSuggestionError("License draft suggestions must include targetId")
        return None

    if target_type in {"sourcing_quote_draft", "pending_order_draft"}:
        return None

    raise PluginSuggestionError(f"Plugin suggestion target '{target_type}' is not implemented yet")


def _parse_int_target_id(value: str, message: str) -> int:
    try:
        return int(value)
    except ValueError as exc:
        raise PluginSuggestionError(message) from exc


def _parse_suggestion_fields(raw_fields: Any) -> list[PluginSuggestedField]:
    if not isinstance(raw_fields, list):
        raise PluginSuggestionError("Plugin suggestion fields must be a list")
    try:
        return [PluginSuggestedField.model_validate(item) for item in raw_fields]
    except ValueError as exc:
        raise PluginSuggestionError(str(exc)) from exc


def _parse_line_items(raw_line_items: Any) -> list[PluginSuggestionLineItem]:
    if raw_line_items is None:
        return []
    if not isinstance(raw_line_items, list):
        raise PluginSuggestionError("Plugin suggestion lineItems must be a list")
    try:
        return [PluginSuggestionLineItem.model_validate(item) for item in raw_line_items]
    except ValueError as exc:
        raise PluginSuggestionError(str(exc)) from exc


async def create_plugin_suggestions_from_runtime_output(
    db: AsyncSession,
    *,
    plugin: Plugin,
    action_key: str,
    raw_output: Any,
    actor: User,
) -> PluginSuggestionCreationResult:
    if not isinstance(raw_output, dict) or "suggestions" not in raw_output:
        return PluginSuggestionCreationResult()

    raw_suggestions = raw_output.get("suggestions")
    if raw_suggestions in (None, []):
        return PluginSuggestionCreationResult()
    if not isinstance(raw_suggestions, list):
        raise PluginSuggestionError("Plugin action suggestions must be a list")

    custom_now = datetime.now(timezone.utc)
    created: list[PluginSuggestion] = []
    superseded_count = 0
    for raw_suggestion in raw_suggestions:
        if not isinstance(raw_suggestion, dict):
            raise PluginSuggestionError("Each plugin suggestion must be an object")

        target_type = str(_payload_value(raw_suggestion, "targetType", "target_type") or "").strip()
        if target_type not in SUPPORTED_TARGET_TYPES:
            raise PluginSuggestionError(f"Unsupported plugin suggestion target: {target_type or '(missing)'}")
        required_permission = SUGGESTION_PERMISSION_BY_TARGET[target_type]
        if not _plugin_has_permission(plugin, required_permission):
            raise PluginSuggestionError(f"Plugin is missing required suggestion permission: {required_permission}")

        target_id = str(_payload_value(raw_suggestion, "targetId", "target_id") or "").strip()
        if not target_id:
            raise PluginSuggestionError("Plugin suggestions must include targetId")

        fields = _parse_suggestion_fields(
            _payload_value(raw_suggestion, "fields", "suggestedFields", "suggested_fields", default=[])
        )
        line_items = _parse_line_items(_payload_value(raw_suggestion, "lineItems", "line_items"))
        license_id = await _resolve_target_license_id(
            db,
            target_type=target_type,
            target_id=target_id,
            actor=actor,
        )
        if target_type == "license":
            await _validate_license_suggestion_fields(db, license_id=license_id, fields=fields)
        else:
            _validate_allowlisted_fields(target_type=target_type, fields=fields, line_items=line_items)

        pending = await db.scalars(
            select(PluginSuggestion).where(
                PluginSuggestion.plugin_key == plugin.key,
                PluginSuggestion.action_key == action_key,
                PluginSuggestion.target_type == target_type,
                PluginSuggestion.target_id == target_id,
                PluginSuggestion.status == "pending",
            )
        )
        for previous in pending.all():
            previous.status = "superseded"
            previous.reviewed_by = actor.id
            previous.reviewed_at = custom_now
            superseded_count += 1

        confidence = _payload_value(raw_suggestion, "confidence")
        summary = _payload_value(raw_suggestion, "summary")
        suggestion = PluginSuggestion(
            plugin_id=plugin.id,
            plugin_key=plugin.key,
            action_key=action_key,
            target_type=target_type,
            target_id=target_id,
            license_id=license_id,
            status="pending",
            suggested_fields=[item.model_dump(mode="json", by_alias=True) for item in fields],
            line_items=[item.model_dump(mode="json", by_alias=True) for item in line_items],
            summary=summary if isinstance(summary, str) else None,
            confidence=float(confidence) if isinstance(confidence, (int, float)) else None,
            raw_output=_payload_value(raw_suggestion, "rawOutput", "raw_output", default=raw_suggestion),
            created_by=actor.id,
        )
        db.add(suggestion)
        created.append(suggestion)

    await db.flush()
    return PluginSuggestionCreationResult(suggestions=created, superseded_count=superseded_count)


async def list_plugin_suggestions(
    db: AsyncSession,
    *,
    actor: User,
    license_id: int | None = None,
    status_filter: str | None = None,
) -> list[PluginSuggestion]:
    query = select(PluginSuggestion).order_by(PluginSuggestion.created_at.desc(), PluginSuggestion.id.desc())
    if license_id is not None:
        license_obj = await db.get(License, license_id)
        if license_obj is None or not await can_view_license(actor, license_obj, db):
            raise PluginSuggestionError("License not found")
        query = query.where(PluginSuggestion.license_id == license_id)
    if status_filter is not None:
        query = query.where(PluginSuggestion.status == status_filter)

    result = await db.execute(query)
    rows = list(result.scalars().all())
    if str(getattr(actor.role, "value", actor.role)) != "viewer":
        return rows

    visible: list[PluginSuggestion] = []
    for row in rows:
        if row.license_id is None:
            continue
        license_obj = await db.get(License, row.license_id)
        if license_obj is not None and await can_view_license(actor, license_obj, db):
            visible.append(row)
    return visible


async def _get_pending_suggestion(
    db: AsyncSession,
    *,
    suggestion_id: int,
    actor: User,
) -> PluginSuggestion:
    suggestion = await db.get(PluginSuggestion, suggestion_id)
    if suggestion is None:
        raise PluginSuggestionError("Plugin suggestion not found")
    if suggestion.license_id is not None:
        license_obj = await db.get(License, suggestion.license_id)
        if license_obj is None or not await can_view_license(actor, license_obj, db):
            raise PluginSuggestionError("Plugin suggestion not found")
    if suggestion.status != "pending":
        raise PluginSuggestionError(f"Plugin suggestion is already {suggestion.status}")
    return suggestion


async def _apply_custom_field_value(
    db: AsyncSession,
    *,
    license_id: int,
    definition: CustomFieldDefinition,
    raw_value: str | None,
) -> None:
    value = build_custom_field_value(license_id, definition, raw_value)
    existing = await db.scalar(
        select(CustomFieldValue).where(
            CustomFieldValue.license_id == license_id,
            CustomFieldValue.custom_field_def_id == definition.id,
        )
    )
    if existing is not None:
        existing.value_text = value.value_text
        existing.value_currency = value.value_currency
    else:
        db.add(value)


async def accept_plugin_suggestion(
    db: AsyncSession,
    *,
    suggestion_id: int,
    actor: User,
    suggested_field_indexes: list[int] | None = None,
) -> PluginSuggestionApplyResult:
    suggestion = await _get_pending_suggestion(db, suggestion_id=suggestion_id, actor=actor)
    if suggestion.target_type != "license" or suggestion.license_id is None:
        raise PluginSuggestionError(f"Plugin suggestion target '{suggestion.target_type}' cannot be applied")

    selected_indexes: list[int] | None = None
    if suggested_field_indexes is not None:
        selected_indexes = sorted(set(suggested_field_indexes))
        invalid_indexes = [
            index
            for index in selected_indexes
            if index < 0 or index >= len(suggestion.suggested_fields)
        ]
        if invalid_indexes:
            raise PluginSuggestionError(f"Invalid suggested field index(es): {', '.join(str(index) for index in invalid_indexes)}")

    raw_suggestions = (
        [suggestion.suggested_fields[index] for index in selected_indexes]
        if selected_indexes is not None
        else list(suggestion.suggested_fields)
    )
    fields = _parse_suggestion_fields(raw_suggestions)
    await _validate_license_suggestion_fields(db, license_id=suggestion.license_id, fields=fields)

    custom_by_key = await _custom_field_lookup(db)
    license_field_ops: list[tuple[str, str | None]] = []
    custom_field_ops: list[tuple[CustomFieldDefinition, str | None]] = []
    for item in fields:
        field_name = item.field.strip()
        raw_value = _normalise_suggested_value(item.value)
        if field_name in ALLOWED_PATCH_FIELDS:
            license_field_ops.append((field_name, raw_value))
            continue
        definition = custom_by_key.get(_custom_field_lookup_key(field_name))
        if definition is not None:
            custom_field_ops.append((definition, raw_value))

    if not license_field_ops and not custom_field_ops:
        raise PluginSuggestionError("No suggested fields to apply")

    applied_fields: list[str] = []
    applied_changes: list[str] = []
    for field_name, raw_value in license_field_ops:
        license_obj = await db.get(License, suggestion.license_id)
        snake_field = ALLOWED_PATCH_FIELDS[field_name]
        before_value = getattr(license_obj, snake_field) if license_obj is not None else None
        updated_license = await apply_license_field_patch(db, suggestion.license_id, field=field_name, value=raw_value)
        after_value = getattr(updated_license, snake_field)
        applied_fields.append(field_name)
        applied_changes.append(f"{field_name}: {before_value or ''} -> {after_value or ''}")

    for definition, raw_value in custom_field_ops:
        existing = await db.scalar(
            select(CustomFieldValue).where(
                CustomFieldValue.license_id == suggestion.license_id,
                CustomFieldValue.custom_field_def_id == definition.id,
            )
        )
        before_value = existing.value_currency if definition.field_type == "currency" and existing else existing.value_text if existing else None
        await _apply_custom_field_value(
            db,
            license_id=suggestion.license_id,
            definition=definition,
            raw_value=raw_value,
        )
        applied_fields.append(definition.field_key)
        applied_changes.append(f"{definition.field_key}: {before_value or ''} -> {raw_value or ''}")

    suggestion.status = "accepted"
    suggestion.reviewed_by = actor.id
    suggestion.reviewed_at = datetime.now(timezone.utc)
    return PluginSuggestionApplyResult(
        suggestion=suggestion,
        applied_fields=applied_fields,
        applied_changes=applied_changes,
    )


async def reject_plugin_suggestion(
    db: AsyncSession,
    *,
    suggestion_id: int,
    actor: User,
) -> PluginSuggestion:
    suggestion = await _get_pending_suggestion(db, suggestion_id=suggestion_id, actor=actor)
    suggestion.status = "rejected"
    suggestion.reviewed_by = actor.id
    suggestion.reviewed_at = datetime.now(timezone.utc)
    return suggestion
