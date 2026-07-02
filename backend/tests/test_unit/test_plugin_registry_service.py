import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, select, text

from app.models.plugin import Plugin, PluginAction, PluginSettingDefinition
from app.schemas.plugin import (
    PluginActionCreate,
    PluginPermissionCreate,
    PluginRegistryCreate,
    PluginRegistryUpdate,
    PluginSettingDefinitionCreate,
)
from app.services.plugin_registry_service import (
    PluginRegistryError,
    create_plugin_registry_record,
    get_plugin,
    list_plugins,
    update_plugin_registry_record,
)


def _payload(key: str = "licensetrack-ai") -> PluginRegistryCreate:
    return PluginRegistryCreate(
        key=key,
        name="LicenseTrack AI",
        publisher_name="LicenseTrack",
        publisher_url="https://licensetrack.example",
        description="AI-assisted document parsing.",
        installed_version="0.1.0",
        compatibility_status="compatible",
        install_path=f"/data/plugins/{key}/0.1.0",
        package_path=f"/data/plugin-packages/{key}-0.1.0.zip",
        checksum_sha256="a" * 64,
        manifest={
            "manifestVersion": 1,
            "key": key,
            "name": "LicenseTrack AI",
            "version": "0.1.0",
        },
        permissions=[
            PluginPermissionCreate(permission="documents:read", granted=True),
            PluginPermissionCreate(permission="actions:invoke", granted=True),
        ],
        settings=[
            PluginSettingDefinitionCreate(
                key="anthropicApiKey",
                type="secret",
                label="Anthropic API Key",
                required=True,
                order=10,
            )
        ],
        actions=[
            PluginActionCreate(
                key="parseQuote",
                label="Parse Quote",
                slot="sourcing.item.edit.actions",
                handler="parse_quote",
                required_role="editor",
            )
        ],
    )


def test_plugin_host_migration_creates_expected_tables(monkeypatch):
    migration_path = (
        Path(__file__).resolve().parents[2]
        / "alembic"
        / "versions"
        / "4b7c8d9e0f12_add_plugin_host_tables.py"
    )
    spec = importlib.util.spec_from_file_location("plugin_host_migration", migration_path)
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        context = MigrationContext.configure(connection)
        monkeypatch.setattr(migration, "op", Operations(context))

        migration.upgrade()

        table_names = set(inspect(connection).get_table_names())

    assert {
        "plugins",
        "plugin_versions",
        "plugin_permissions",
        "plugin_setting_definitions",
        "plugin_setting_values",
        "plugin_actions",
        "plugin_runtime_status",
    } <= table_names


async def test_create_read_update_plugin_registry_record(db_session):
    plugin = await create_plugin_registry_record(db_session, _payload())
    await db_session.commit()

    loaded = await get_plugin(db_session, "licensetrack-ai")
    assert loaded is not None
    assert loaded.id == plugin.id
    assert loaded.status == "disabled"
    assert loaded.enabled is False
    assert loaded.compatibility_status == "compatible"
    assert loaded.runtime_status is not None
    assert loaded.runtime_status.health == "unknown"
    assert [version.version for version in loaded.versions] == ["0.1.0"]
    assert sorted(permission.permission for permission in loaded.permissions) == ["actions:invoke", "documents:read"]
    assert loaded.setting_definitions[0].setting_key == "anthropicApiKey"
    assert loaded.actions[0].action_key == "parseQuote"
    assert loaded.actions[0].enabled is False

    updated = await update_plugin_registry_record(
        db_session,
        "licensetrack-ai",
        PluginRegistryUpdate(status="misconfigured", last_error="Missing required settings"),
    )
    await db_session.commit()

    assert updated.status == "misconfigured"
    assert updated.enabled is False
    assert updated.last_error == "Missing required settings"

    plugins = await list_plugins(db_session)
    assert [item.key for item in plugins] == ["licensetrack-ai"]


async def test_plugin_key_must_be_unique(db_session):
    await create_plugin_registry_record(db_session, _payload())
    await db_session.commit()

    with pytest.raises(PluginRegistryError, match="already installed"):
        await create_plugin_registry_record(db_session, _payload())


async def test_setting_and_action_keys_must_be_unique_per_plugin(db_session):
    payload = _payload()
    payload.settings.append(
        PluginSettingDefinitionCreate(
            key="anthropicApiKey",
            type="text",
            label="Duplicate key",
        )
    )
    with pytest.raises(PluginRegistryError, match="Duplicate plugin setting"):
        await create_plugin_registry_record(db_session, payload)

    payload = _payload("licensetrack-ai-actions")
    payload.actions.append(
        PluginActionCreate(
            key="parseQuote",
            label="Duplicate action",
            slot="document.row.actions",
            handler="parse_quote_again",
            required_role="editor",
        )
    )
    with pytest.raises(PluginRegistryError, match="Duplicate plugin action"):
        await create_plugin_registry_record(db_session, payload)


async def test_database_constraints_enforce_child_uniqueness(db_session):
    plugin = await create_plugin_registry_record(db_session, _payload())
    await db_session.commit()
    plugin_id = plugin.id

    db_session.add(
        PluginSettingDefinition(
            plugin_id=plugin_id,
            setting_key="anthropicApiKey",
            setting_type="text",
            label="Duplicate setting",
        )
    )
    with pytest.raises(Exception):
        await db_session.commit()
    await db_session.rollback()

    db_session.add(
        PluginAction(
            plugin_id=plugin_id,
            action_key="parseQuote",
            label="Duplicate action",
            slot="document.row.actions",
            handler="parse_quote_again",
            required_role="editor",
        )
    )
    with pytest.raises(Exception):
        await db_session.commit()
    await db_session.rollback()


async def test_metadata_uninstall_preserves_registry_history(db_session):
    await create_plugin_registry_record(db_session, _payload())
    await db_session.commit()

    await update_plugin_registry_record(
        db_session,
        "licensetrack-ai",
        PluginRegistryUpdate(status="uninstalled", enabled=False),
    )
    await db_session.commit()

    stored = await db_session.scalar(select(Plugin).where(Plugin.key == "licensetrack-ai"))
    assert stored is not None
    assert stored.status == "uninstalled"
