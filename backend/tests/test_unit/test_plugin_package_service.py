import io
import stat
import zipfile

import pytest

from app.services.plugin_package_service import _normalize_zip_path, inspect_plugin_package


@pytest.fixture(autouse=True)
def enable_plugin_developer_mode(monkeypatch):
    monkeypatch.setattr("app.config.settings.PLUGIN_HOST_DEVELOPER_MODE", True)


def _manifest(**overrides) -> dict:
    manifest = {
        "manifestVersion": 1,
        "key": "test-plugin",
        "name": "Test Plugin",
        "version": "0.1.0",
        "publisher": {"name": "Test Publisher"},
        "licenseTrack": {"minVersion": "1.0.0", "maxVersionExclusive": "2.0.0"},
        "runtime": {
            "type": "managedProcess",
            "entrypoint": "runtime/test-plugin.py",
            "healthPath": "/health",
        },
        "permissions": ["documents:read", "actions:invoke"],
        "settings": [
            {
                "key": "apiKey",
                "label": "API Key",
                "type": "secret",
                "required": True,
            }
        ],
        "actions": [
            {
                "key": "parseDocument",
                "label": "Parse Document",
                "slot": "document.row.actions",
                "handler": "parse_document",
                "requiredRole": "editor",
            }
        ],
    }
    manifest.update(overrides)
    return manifest


def _zip_bytes(manifest: dict | None = None, extra_entries: dict[str, bytes] | None = None) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        if manifest is not None:
            archive.writestr("plugin.ltplugin", __import__("json").dumps(manifest))
        archive.writestr("README.md", "read me")
        archive.writestr("LICENSE", "license")
        archive.writestr("runtime/test-plugin.py", "print('ok')")
        for name, content in (extra_entries or {}).items():
            archive.writestr(name, content)
    return buffer.getvalue()


def _issue_codes(content: bytes) -> set[str]:
    return {issue.code for issue in inspect_plugin_package(content).preview.issues}


def test_valid_plugin_package_returns_installable_preview():
    inspection = inspect_plugin_package(_zip_bytes(_manifest()))

    assert inspection.preview.installable is True
    assert inspection.preview.manifest is not None
    assert inspection.preview.manifest.key == "test-plugin"
    assert inspection.preview.compatibility_status == "compatible"
    assert [item.permission for item in inspection.preview.permissions] == ["documents:read", "actions:invoke"]


def test_missing_manifest_is_rejected():
    assert "manifest_location_invalid" in _issue_codes(_zip_bytes(None))


def test_multiple_or_nested_manifests_are_rejected():
    content = _zip_bytes(_manifest(), {"nested/plugin.ltplugin": b"{}"})

    assert "manifest_location_invalid" in _issue_codes(content)


def test_unknown_permission_is_rejected():
    manifest = _manifest(permissions=["documents:read", "unknown:permission"])

    assert "manifest_schema_invalid" in _issue_codes(_zip_bytes(manifest))


def test_unknown_slot_is_rejected():
    manifest = _manifest(
        actions=[
            {
                "key": "parseDocument",
                "label": "Parse Document",
                "slot": "unknown.slot",
                "handler": "parse_document",
                "requiredRole": "editor",
            }
        ]
    )

    assert "manifest_schema_invalid" in _issue_codes(_zip_bytes(manifest))


def test_incompatible_license_track_version_is_rejected():
    manifest = _manifest(licenseTrack={"minVersion": "9.0.0", "maxVersionExclusive": "10.0.0"})

    inspection = inspect_plugin_package(_zip_bytes(manifest))

    assert inspection.preview.installable is False
    assert inspection.preview.compatibility_status == "incompatible"
    assert "license_track_version_incompatible" in {issue.code for issue in inspection.preview.issues}


def test_path_traversal_and_absolute_paths_are_rejected():
    traversal = _zip_bytes(_manifest(), {"../escape.txt": b"bad"})
    absolute = _zip_bytes(_manifest(), {"/escape.txt": b"bad"})

    assert "package_path_invalid" in _issue_codes(traversal)
    assert "package_path_invalid" in _issue_codes(absolute)


def test_backslash_paths_are_rejected():
    assert _normalize_zip_path("runtime\\evil.py") is None


def test_symlink_entry_is_rejected():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("plugin.ltplugin", __import__("json").dumps(_manifest()))
        archive.writestr("README.md", "read me")
        archive.writestr("LICENSE", "license")
        archive.writestr("runtime/test-plugin.py", "print('ok')")
        symlink = zipfile.ZipInfo("runtime/link")
        symlink.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(symlink, "target")

    assert "package_symlink_rejected" in _issue_codes(buffer.getvalue())


def test_missing_runtime_entrypoint_is_rejected():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("plugin.ltplugin", __import__("json").dumps(_manifest()))
        archive.writestr("README.md", "read me")
        archive.writestr("LICENSE", "license")
        archive.writestr("runtime/other.py", "print('wrong')")

    assert "runtime_entrypoint_missing" in _issue_codes(buffer.getvalue())
