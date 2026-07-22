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


def test_official_extension_migration_disables_unsigned_installations_without_deleting_data(monkeypatch):
    versions_dir = Path(__file__).resolve().parents[2] / "alembic" / "versions"

    def load_migration(filename: str, module_name: str):
        spec = importlib.util.spec_from_file_location(module_name, versions_dir / filename)
        assert spec is not None and spec.loader is not None
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        return migration

    host_migration = load_migration("4b7c8d9e0f12_add_plugin_host_tables.py", "plugin_host_base_migration")
    trust_migration = load_migration(
        "7b8c9d0e1f2a_add_official_extension_trust.py", "official_extension_trust_migration"
    )
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        context = MigrationContext.configure(connection)
        operations = Operations(context)
        monkeypatch.setattr(host_migration, "op", operations)
        monkeypatch.setattr(trust_migration, "op", operations)
        host_migration.upgrade()
        connection.execute(
            text(
                "INSERT INTO plugins "
                "(id, key, name, publisher_name, installed_version, status, enabled, compatibility_status, "
                "install_path, manifest) VALUES "
                "(1, 'legacy', 'Legacy', 'Self declared', '1.0.0', 'enabled', 1, 'compatible', '/tmp/legacy', '{}')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO plugin_versions "
                "(id, plugin_id, version, package_path, checksum_sha256, manifest) VALUES "
                "(1, 1, '1.0.0', '/tmp/legacy.zip', :checksum, '{}')"
            ),
            {"checksum": "a" * 64},
        )
        connection.execute(
            text(
                "INSERT INTO plugin_setting_values (id, plugin_id, setting_key, encrypted_value) "
                "VALUES (1, 1, 'token', 'preserve-me')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO plugin_actions "
                "(id, plugin_id, action_key, label, slot, handler, required_role, enabled) "
                "VALUES (1, 1, 'run', 'Run', 'document.row.actions', 'run', 'admin', 1)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO plugin_runtime_status (id, plugin_id, pid, port, health) "
                "VALUES (1, 1, 1234, 8080, 'healthy')"
            )
        )

        trust_migration.upgrade()

        plugin = connection.execute(
            text("SELECT enabled, status, trust_status, last_error FROM plugins WHERE id = 1")
        ).mappings().one()
        action_enabled = connection.scalar(text("SELECT enabled FROM plugin_actions WHERE id = 1"))
        runtime = connection.execute(
            text("SELECT pid, port, health FROM plugin_runtime_status WHERE id = 1")
        ).mappings().one()
        setting_value = connection.scalar(
            text("SELECT encrypted_value FROM plugin_setting_values WHERE id = 1")
        )
        version_count = connection.scalar(text("SELECT COUNT(*) FROM plugin_versions WHERE plugin_id = 1"))

    assert plugin["enabled"] == 0
    assert plugin["status"] == "unverified"
    assert plugin["trust_status"] == "unverified"
    assert "reinstall" in plugin["last_error"].lower()
    assert action_enabled == 0
    assert runtime == {"pid": None, "port": None, "health": "stopped"}
    assert setting_value == "preserve-me"
    assert version_count == 1


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
    with pytest.raises(PluginRegistryError, match="Duplicate Official Extension setting"):
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
    with pytest.raises(PluginRegistryError, match="Duplicate Official Extension action"):
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
