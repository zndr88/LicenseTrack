import pytest
from sqlalchemy import select

from app.models.plugin import PluginSettingValue
from app.schemas.plugin import (
    PLUGIN_SECRET_MASK,
    PluginActionCreate,
    PluginPermissionCreate,
    PluginRegistryCreate,
    PluginSettingDefinitionCreate,
    PluginSettingValueUpdate,
    PluginSettingsUpdateRequest,
)
from app.services.crypto_service import decrypt_secret
from app.services.plugin_registry_service import create_plugin_registry_record
from app.services.plugin_settings_service import (
    PluginSettingsError,
    read_plugin_settings,
    update_plugin_settings,
)


def _registry_payload() -> PluginRegistryCreate:
    return PluginRegistryCreate(
        key="settings-plugin",
        name="Settings Plugin",
        publisher_name="LicenseTrack",
        installed_version="0.1.0",
        compatibility_status="compatible",
        install_path="/data/plugins/settings-plugin/0.1.0",
        package_path="/data/plugins/settings-plugin/0.1.0/package.zip",
        checksum_sha256="b" * 64,
        manifest={"manifestVersion": 1, "key": "settings-plugin"},
        permissions=[PluginPermissionCreate(permission="plugin:settings:read")],
        settings=[
            PluginSettingDefinitionCreate(
                key="apiKey",
                type="secret",
                label="API Key",
                required=True,
                order=10,
            ),
            PluginSettingDefinitionCreate(
                key="model",
                type="select",
                label="Model",
                required=True,
                options=["fast", "accurate"],
                default="fast",
                order=20,
            ),
            PluginSettingDefinitionCreate(
                key="endpoint",
                type="url",
                label="Endpoint",
                required=False,
                order=30,
            ),
            PluginSettingDefinitionCreate(
                key="enabled",
                type="boolean",
                label="Enabled",
                required=False,
                order=40,
            ),
        ],
        actions=[
            PluginActionCreate(
                key="parseDocument",
                label="Parse Document",
                slot="document.row.actions",
                handler="parse_document",
                required_role="editor",
            )
        ],
    )


async def _create_plugin(db_session):
    plugin = await create_plugin_registry_record(db_session, _registry_payload())
    await db_session.commit()
    return plugin


async def test_plugin_settings_read_shows_missing_required(db_session):
    await _create_plugin(db_session)

    response = await read_plugin_settings(db_session, "settings-plugin")

    assert response.plugin_key == "settings-plugin"
    assert response.missing_required == ["apiKey", "model"]
    assert [definition.setting_key for definition in response.definitions] == ["apiKey", "model", "endpoint", "enabled"]


async def test_plugin_secret_setting_is_encrypted_and_masked(db_session):
    plugin = await _create_plugin(db_session)

    result = await update_plugin_settings(
        db_session,
        "settings-plugin",
        PluginSettingsUpdateRequest(
            values=[
                PluginSettingValueUpdate(key="apiKey", value="sk-test"),
                PluginSettingValueUpdate(key="model", value="fast"),
            ]
        ),
        updated_by=None,
    )
    await db_session.commit()

    stored = await db_session.scalar(
        select(PluginSettingValue).where(
            PluginSettingValue.plugin_id == plugin.id,
            PluginSettingValue.setting_key == "apiKey",
        )
    )
    assert stored is not None
    assert stored.encrypted_value != "sk-test"
    assert decrypt_secret(stored.encrypted_value) == "sk-test"
    assert result.response.missing_required == []
    assert result.response.values[0].value == PLUGIN_SECRET_MASK
    assert result.response.values[0].masked is True


async def test_mask_placeholder_preserves_existing_secret(db_session):
    plugin = await _create_plugin(db_session)
    await update_plugin_settings(
        db_session,
        "settings-plugin",
        PluginSettingsUpdateRequest(values=[PluginSettingValueUpdate(key="apiKey", value="sk-original")]),
        updated_by=None,
    )
    await db_session.commit()
    before = await db_session.scalar(
        select(PluginSettingValue.encrypted_value).where(
            PluginSettingValue.plugin_id == plugin.id,
            PluginSettingValue.setting_key == "apiKey",
        )
    )

    result = await update_plugin_settings(
        db_session,
        "settings-plugin",
        PluginSettingsUpdateRequest(values=[PluginSettingValueUpdate(key="apiKey", value=PLUGIN_SECRET_MASK, masked=True)]),
        updated_by=None,
    )
    await db_session.commit()
    after = await db_session.scalar(
        select(PluginSettingValue.encrypted_value).where(
            PluginSettingValue.plugin_id == plugin.id,
            PluginSettingValue.setting_key == "apiKey",
        )
    )

    assert before == after
    assert result.changed_keys == []


async def test_missing_required_settings_mark_plugin_misconfigured(db_session):
    plugin = await _create_plugin(db_session)

    await update_plugin_settings(
        db_session,
        "settings-plugin",
        PluginSettingsUpdateRequest(values=[PluginSettingValueUpdate(key="model", value="fast")]),
        updated_by=None,
    )
    await db_session.commit()
    await db_session.refresh(plugin)

    assert plugin.status == "misconfigured"
    assert plugin.enabled is False
    assert "apiKey" in (plugin.last_error or "")


async def test_invalid_select_and_url_values_are_rejected(db_session):
    await _create_plugin(db_session)

    with pytest.raises(PluginSettingsError, match="configured options"):
        await update_plugin_settings(
            db_session,
            "settings-plugin",
            PluginSettingsUpdateRequest(values=[PluginSettingValueUpdate(key="model", value="slow")]),
            updated_by=None,
        )

    with pytest.raises(PluginSettingsError, match="valid http"):
        await update_plugin_settings(
            db_session,
            "settings-plugin",
            PluginSettingsUpdateRequest(values=[PluginSettingValueUpdate(key="endpoint", value="not-a-url")]),
            updated_by=None,
        )


async def test_configured_required_settings_restore_disabled_status(db_session):
    plugin = await _create_plugin(db_session)
    plugin.status = "misconfigured"
    plugin.last_error = "Missing required plugin setting(s): apiKey, model"
    await db_session.commit()

    await update_plugin_settings(
        db_session,
        "settings-plugin",
        PluginSettingsUpdateRequest(
            values=[
                PluginSettingValueUpdate(key="apiKey", value="sk-test"),
                PluginSettingValueUpdate(key="model", value="accurate"),
            ]
        ),
        updated_by=None,
    )
    await db_session.commit()
    await db_session.refresh(plugin)

    assert plugin.status == "disabled"
    assert plugin.last_error is None
