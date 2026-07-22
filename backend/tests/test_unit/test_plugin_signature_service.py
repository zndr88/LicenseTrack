import base64
import io
import json
import zipfile

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.services.plugin_package_service import inspect_plugin_package
from app.services.plugin_signature_service import _signed_content_digest


def _manifest(*, publisher: str = "LicenseTrack Project") -> dict:
    return {
        "manifestVersion": 1,
        "key": "official-test",
        "name": "Official Test",
        "version": "1.0.0",
        "publisher": {"name": publisher},
        "licenseTrack": {"minVersion": "1.0.0", "maxVersionExclusive": "2.0.0"},
        "runtime": {
            "type": "managedProcess",
            "entrypoint": "runtime/main.py",
            "healthPath": "/health",
        },
        "permissions": ["actions:invoke"],
        "settings": [],
        "actions": [],
    }


def _entries(*, publisher: str = "LicenseTrack Project") -> dict[str, bytes]:
    return {
        "plugin.ltplugin": json.dumps(_manifest(publisher=publisher)).encode(),
        "README.md": b"Official extension test fixture",
        "LICENSE": b"Test fixture only",
        "runtime/main.py": b"print('official extension')\n",
    }


def _zip(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, content in entries.items():
            archive.writestr(path, content)
    return buffer.getvalue()


def _raw_public_key(private_key: Ed25519PrivateKey) -> str:
    raw = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return base64.b64encode(raw).decode()


def _trust_store(*entries: tuple[str, str, Ed25519PrivateKey]) -> str:
    return json.dumps(
        [
            {"keyId": key_id, "signer": signer, "publicKey": _raw_public_key(private_key)}
            for key_id, signer, private_key in entries
        ]
    )


def _signed_package(entries: dict[str, bytes], private_key: Ed25519PrivateKey, key_id: str) -> bytes:
    unsigned = _zip(entries)
    digest = _signed_content_digest(unsigned, {path: path for path in entries})
    signature = private_key.sign(bytes.fromhex(digest))
    return _zip(
        {
            **entries,
            "SIGNATURE.json": json.dumps(
                {
                    "schemaVersion": 1,
                    "algorithm": "Ed25519",
                    "keyId": key_id,
                    "signature": base64.b64encode(signature).decode(),
                }
            ).encode(),
        }
    )


def test_unsigned_self_declared_publisher_is_not_trusted(monkeypatch):
    monkeypatch.setattr("app.config.settings.PLUGIN_HOST_DEVELOPER_MODE", False)
    monkeypatch.setattr("app.config.settings.OFFICIAL_EXTENSION_PUBLIC_KEYS", "[]")

    preview = inspect_plugin_package(_zip(_entries(publisher="LicenseTrack Project"))).preview

    assert preview.installable is False
    assert preview.trust_status == "unverified"
    assert "official_signature_missing" in {issue.code for issue in preview.issues}


def test_valid_signature_uses_pinned_signer_not_declared_publisher(monkeypatch):
    private_key = Ed25519PrivateKey.generate()
    monkeypatch.setattr("app.config.settings.PLUGIN_HOST_DEVELOPER_MODE", False)
    monkeypatch.setattr(
        "app.config.settings.OFFICIAL_EXTENSION_PUBLIC_KEYS",
        _trust_store(("release-2026-a", "LicenseTrack Project", private_key)),
    )

    preview = inspect_plugin_package(
        _signed_package(_entries(publisher="Forged Publisher Metadata"), private_key, "release-2026-a")
    ).preview

    assert preview.installable is True
    assert preview.trust_status == "verified"
    assert preview.signer_key_id == "release-2026-a"
    assert preview.signer_identity == "LicenseTrack Project"
    assert preview.manifest is not None
    assert preview.manifest.publisher.name == "Forged Publisher Metadata"
    assert preview.verified_at is not None


def test_tampered_package_is_rejected(monkeypatch):
    private_key = Ed25519PrivateKey.generate()
    monkeypatch.setattr("app.config.settings.PLUGIN_HOST_DEVELOPER_MODE", False)
    monkeypatch.setattr(
        "app.config.settings.OFFICIAL_EXTENSION_PUBLIC_KEYS",
        _trust_store(("release-2026-a", "LicenseTrack Project", private_key)),
    )
    signed = _signed_package(_entries(), private_key, "release-2026-a")
    with zipfile.ZipFile(io.BytesIO(signed), "r") as archive:
        tampered_entries = {info.filename: archive.read(info) for info in archive.infolist() if not info.is_dir()}
    tampered_entries["runtime/main.py"] = b"print('tampered')\n"

    preview = inspect_plugin_package(_zip(tampered_entries)).preview

    assert preview.installable is False
    assert preview.trust_status == "unverified"
    assert "official_signature_mismatch" in {issue.code for issue in preview.issues}


def test_key_rotation_accepts_any_pinned_release_key(monkeypatch):
    old_key = Ed25519PrivateKey.generate()
    current_key = Ed25519PrivateKey.generate()
    monkeypatch.setattr("app.config.settings.PLUGIN_HOST_DEVELOPER_MODE", False)
    monkeypatch.setattr(
        "app.config.settings.OFFICIAL_EXTENSION_PUBLIC_KEYS",
        _trust_store(
            ("release-2025", "LicenseTrack Project", old_key),
            ("release-2026", "LicenseTrack Project", current_key),
        ),
    )

    old_preview = inspect_plugin_package(_signed_package(_entries(), old_key, "release-2025")).preview
    current_preview = inspect_plugin_package(_signed_package(_entries(), current_key, "release-2026")).preview

    assert old_preview.trust_status == "verified"
    assert current_preview.trust_status == "verified"
    assert {old_preview.signer_key_id, current_preview.signer_key_id} == {"release-2025", "release-2026"}


def test_unsigned_package_is_visibly_developer_only_when_opted_in(monkeypatch):
    monkeypatch.setattr("app.config.settings.PLUGIN_HOST_DEVELOPER_MODE", True)
    monkeypatch.setattr("app.config.settings.OFFICIAL_EXTENSION_PUBLIC_KEYS", "[]")

    preview = inspect_plugin_package(_zip(_entries())).preview

    assert preview.installable is True
    assert preview.trust_status == "developer"
    assert preview.developer_mode is True
    assert any(issue.severity == "warning" for issue in preview.issues)
