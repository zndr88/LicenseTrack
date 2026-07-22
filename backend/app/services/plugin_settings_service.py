from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.plugin import Plugin, PluginSettingDefinition, PluginSettingValue
from app.schemas.plugin import (
    PLUGIN_SECRET_MASK,
    PluginSettingValueRead,
    PluginSettingsReadResponse,
    PluginSettingsUpdateRequest,
)
from app.services.crypto_service import decrypt_secret, encrypt_secret


class PluginSettingsError(ValueError):
    """Raised when plugin settings cannot be read or updated."""


@dataclass(frozen=True)
class PluginSettingsUpdateResult:
    response: PluginSettingsReadResponse
    changed_keys: list[str]
    secret_keys: list[str]


async def read_plugin_settings(db: AsyncSession, plugin_key: str) -> PluginSettingsReadResponse:
    plugin = await _get_plugin_by_key(db, plugin_key)
    definitions = await _get_definitions(db, plugin.id)
    values = await _get_values_by_key(db, plugin.id)
    missing_required = _missing_required(definitions, values)
    return _build_response(plugin.key, definitions, values, missing_required)


async def update_plugin_settings(
    db: AsyncSession,
    plugin_key: str,
    payload: PluginSettingsUpdateRequest,
    *,
    updated_by: int | None,
) -> PluginSettingsUpdateResult:
    plugin = await _get_plugin_by_key(db, plugin_key)
    definitions = await _get_definitions(db, plugin.id)
    definitions_by_key = {definition.setting_key: definition for definition in definitions}
    values = await _get_values_by_key(db, plugin.id)
    changed_keys: list[str] = []
    secret_keys: list[str] = []

    for item in payload.values:
        definition = definitions_by_key.get(item.key)
        if definition is None:
            raise PluginSettingsError(f"Unknown Official Extension setting: {item.key}")
        existing = values.get(item.key)
        normalized = _validate_setting_value(definition, item.value)
        is_secret = definition.setting_type == "secret"

        if is_secret and (item.masked or item.value == PLUGIN_SECRET_MASK):
            if existing is not None and existing.encrypted_value:
                continue
            normalized = None

        encoded = _encode_value(definition, normalized)
        current_encoded = existing.encrypted_value if existing is not None else None
        if encoded == current_encoded:
            continue

        if existing is None:
            existing = PluginSettingValue(plugin_id=plugin.id, setting_key=item.key)
            db.add(existing)
            values[item.key] = existing

        existing.encrypted_value = encoded
        existing.value_metadata = {"type": definition.setting_type, "secret": is_secret}
        existing.updated_by = updated_by
        existing.updated_at = datetime.now(timezone.utc)
        changed_keys.append(item.key)
        if is_secret:
            secret_keys.append(item.key)

    missing_required = _missing_required(definitions, values)
    if missing_required:
        plugin.status = "misconfigured"
        plugin.enabled = False
        plugin.last_error = f"Missing required Official Extension setting(s): {', '.join(missing_required)}"
    elif (
        plugin.status == "misconfigured"
        and plugin.last_error
        and plugin.last_error.startswith(
            ("Missing required Official Extension setting", "Missing required plugin setting")
        )
    ):
        plugin.status = "disabled"
        plugin.last_error = None

    await db.flush()
    response = _build_response(plugin.key, definitions, values, missing_required)
    return PluginSettingsUpdateResult(response=response, changed_keys=changed_keys, secret_keys=secret_keys)


async def _get_plugin_by_key(db: AsyncSession, plugin_key: str) -> Plugin:
    plugin = await db.scalar(select(Plugin).where(Plugin.key == plugin_key))
    if plugin is None:
        raise PluginSettingsError(f"Official Extension '{plugin_key}' is not installed")
    return plugin


async def _get_definitions(db: AsyncSession, plugin_id: int) -> list[PluginSettingDefinition]:
    result = await db.execute(
        select(PluginSettingDefinition)
        .where(PluginSettingDefinition.plugin_id == plugin_id)
        .order_by(PluginSettingDefinition.display_order.asc(), PluginSettingDefinition.setting_key.asc())
    )
    return list(result.scalars().all())


async def _get_values_by_key(db: AsyncSession, plugin_id: int) -> dict[str, PluginSettingValue]:
    result = await db.execute(select(PluginSettingValue).where(PluginSettingValue.plugin_id == plugin_id))
    return {value.setting_key: value for value in result.scalars().all()}


def _build_response(
    plugin_key: str,
    definitions: list[PluginSettingDefinition],
    values: dict[str, PluginSettingValue],
    missing_required: list[str],
) -> PluginSettingsReadResponse:
    read_values = [
        PluginSettingValueRead(
            key=definition.setting_key,
            value=_read_value(definition, values.get(definition.setting_key)),
            masked=definition.setting_type == "secret"
            and _is_configured(definition, values.get(definition.setting_key)),
            required=definition.required,
            configured=_is_configured(definition, values.get(definition.setting_key)),
        )
        for definition in definitions
    ]
    return PluginSettingsReadResponse(
        plugin_key=plugin_key,
        definitions=definitions,
        values=read_values,
        missing_required=missing_required,
    )


def _missing_required(
    definitions: list[PluginSettingDefinition],
    values: dict[str, PluginSettingValue],
) -> list[str]:
    return [
        definition.setting_key
        for definition in definitions
        if definition.required and not _is_configured(definition, values.get(definition.setting_key))
    ]


def _is_configured(definition: PluginSettingDefinition, value: PluginSettingValue | None) -> bool:
    if value is None or value.encrypted_value is None:
        return False
    decoded = _decode_value(definition, value)
    if decoded is None:
        return False
    if isinstance(decoded, str):
        return bool(decoded.strip())
    return True


def _read_value(definition: PluginSettingDefinition, value: PluginSettingValue | None):
    if value is None or value.encrypted_value is None:
        return None
    if definition.setting_type == "secret":
        return PLUGIN_SECRET_MASK
    return _decode_value(definition, value)


def _encode_value(definition: PluginSettingDefinition, value) -> str | None:
    if value is None:
        return None
    if definition.setting_type == "secret":
        return encrypt_secret(str(value))
    return json.dumps(value)


def _decode_value(definition: PluginSettingDefinition, value: PluginSettingValue):
    if value.encrypted_value is None:
        return None
    if definition.setting_type == "secret":
        return decrypt_secret(value.encrypted_value)
    try:
        return json.loads(value.encrypted_value)
    except json.JSONDecodeError:
        return value.encrypted_value


def _validate_setting_value(definition: PluginSettingDefinition, value):
    if value is None:
        return None

    setting_type = definition.setting_type
    if setting_type in {"text", "textarea", "secret"}:
        if not isinstance(value, str):
            raise PluginSettingsError(f"{definition.setting_key} must be text")
        return value
    if setting_type == "url":
        if not isinstance(value, str):
            raise PluginSettingsError(f"{definition.setting_key} must be a URL")
        if not value.strip():
            return value
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise PluginSettingsError(f"{definition.setting_key} must be a valid http(s) URL")
        return value
    if setting_type == "boolean":
        if not isinstance(value, bool):
            raise PluginSettingsError(f"{definition.setting_key} must be true or false")
        return value
    if setting_type == "number":
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise PluginSettingsError(f"{definition.setting_key} must be a number")
        return value
    if setting_type == "select":
        if not isinstance(value, str):
            raise PluginSettingsError(f"{definition.setting_key} must be one of the configured options")
        options = set(definition.options or [])
        if value and value not in options:
            raise PluginSettingsError(f"{definition.setting_key} must be one of the configured options")
        return value
    raise PluginSettingsError(f"Unsupported Official Extension setting type: {setting_type}")
