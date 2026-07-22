from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import io
import json
import struct
import zipfile

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from app.config import settings
from app.schemas.plugin import PluginPackageIssue


PLUGIN_SIGNATURE_FILENAME = "SIGNATURE.json"
SIGNATURE_SCHEMA_VERSION = 1
SIGNATURE_ALGORITHM = "Ed25519"


@dataclass(frozen=True)
class TrustedExtensionKey:
    key_id: str
    signer: str
    public_key: Ed25519PublicKey


@dataclass(frozen=True)
class PluginTrustInspection:
    trust_status: str
    signer_key_id: str | None
    signer_identity: str | None
    verified_at: datetime | None
    signed_content_sha256: str
    issues: list[PluginPackageIssue]


def inspect_package_trust(content: bytes, safe_paths: dict[str, str]) -> PluginTrustInspection:
    signed_digest = _signed_content_digest(content, safe_paths)
    developer_mode = bool(settings.PLUGIN_HOST_DEVELOPER_MODE)
    signature_path = safe_paths.get(PLUGIN_SIGNATURE_FILENAME)
    if signature_path is None:
        return _unverified_result(
            signed_digest,
            code="official_signature_missing",
            message="Package is not signed by a trusted LicenseTrack release key.",
            developer_mode=developer_mode,
        )

    try:
        with zipfile.ZipFile(io.BytesIO(content), "r") as archive:
            raw_signature = archive.read(signature_path)
        signature_document = json.loads(raw_signature)
        if not isinstance(signature_document, dict):
            raise ValueError("Signature document must be an object")
        if signature_document.get("schemaVersion") != SIGNATURE_SCHEMA_VERSION:
            raise ValueError("Unsupported signature schema version")
        if signature_document.get("algorithm") != SIGNATURE_ALGORITHM:
            raise ValueError("Unsupported signature algorithm")
        key_id = str(signature_document.get("keyId") or "").strip()
        signature = base64.b64decode(str(signature_document.get("signature") or ""), validate=True)
        if not key_id or len(signature) != 64:
            raise ValueError("Signature key ID or value is invalid")
    except (ValueError, TypeError, json.JSONDecodeError, zipfile.BadZipFile):
        return _unverified_result(
            signed_digest,
            code="official_signature_invalid",
            message="Package signature metadata is invalid.",
            developer_mode=developer_mode,
            path=PLUGIN_SIGNATURE_FILENAME,
        )

    trusted_keys, trust_store_issue = load_trusted_extension_keys()
    if trust_store_issue is not None:
        return _unverified_result(
            signed_digest,
            code="official_trust_store_invalid",
            message=trust_store_issue,
            developer_mode=developer_mode,
            path=PLUGIN_SIGNATURE_FILENAME,
        )
    trusted_key = trusted_keys.get(key_id)
    if trusted_key is None:
        return _unverified_result(
            signed_digest,
            code="official_signer_unknown",
            message=f"Package signer key '{key_id}' is not trusted by this LicenseTrack build.",
            developer_mode=developer_mode,
            path=PLUGIN_SIGNATURE_FILENAME,
            signer_key_id=key_id,
        )

    try:
        trusted_key.public_key.verify(signature, bytes.fromhex(signed_digest))
    except InvalidSignature:
        return _unverified_result(
            signed_digest,
            code="official_signature_mismatch",
            message="Package contents do not match the trusted LicenseTrack signature.",
            developer_mode=developer_mode,
            path=PLUGIN_SIGNATURE_FILENAME,
            signer_key_id=key_id,
        )

    return PluginTrustInspection(
        trust_status="verified",
        signer_key_id=trusted_key.key_id,
        signer_identity=trusted_key.signer,
        verified_at=datetime.now(timezone.utc),
        signed_content_sha256=signed_digest,
        issues=[],
    )


def load_trusted_extension_keys() -> tuple[dict[str, TrustedExtensionKey], str | None]:
    try:
        raw_entries = json.loads(settings.OFFICIAL_EXTENSION_PUBLIC_KEYS or "[]")
        if not isinstance(raw_entries, list):
            raise ValueError("trust store must be a JSON array")
        keys: dict[str, TrustedExtensionKey] = {}
        for entry in raw_entries:
            if not isinstance(entry, dict):
                raise ValueError("trust store entries must be objects")
            key_id = str(entry.get("keyId") or "").strip()
            signer = str(entry.get("signer") or "").strip()
            raw_key = base64.b64decode(str(entry.get("publicKey") or ""), validate=True)
            if not key_id or not signer or len(raw_key) != 32 or key_id in keys:
                raise ValueError("each trust store entry needs a unique keyId, signer, and 32-byte publicKey")
            keys[key_id] = TrustedExtensionKey(
                key_id=key_id,
                signer=signer,
                public_key=Ed25519PublicKey.from_public_bytes(raw_key),
            )
        return keys, None
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        return {}, f"Official extension trust store is invalid: {exc}"


def _signed_content_digest(content: bytes, safe_paths: dict[str, str]) -> str:
    digest = hashlib.sha256()
    try:
        with zipfile.ZipFile(io.BytesIO(content), "r") as archive:
            for normalized_path in sorted(safe_paths):
                if normalized_path == PLUGIN_SIGNATURE_FILENAME:
                    continue
                info = archive.getinfo(safe_paths[normalized_path])
                if info.is_dir():
                    continue
                path_bytes = normalized_path.encode("utf-8")
                file_bytes = archive.read(info)
                digest.update(struct.pack(">I", len(path_bytes)))
                digest.update(path_bytes)
                digest.update(struct.pack(">Q", len(file_bytes)))
                digest.update(file_bytes)
    except zipfile.BadZipFile:
        return hashlib.sha256(content).hexdigest()
    return digest.hexdigest()


def _unverified_result(
    signed_digest: str,
    *,
    code: str,
    message: str,
    developer_mode: bool,
    path: str | None = None,
    signer_key_id: str | None = None,
) -> PluginTrustInspection:
    return PluginTrustInspection(
        trust_status="developer" if developer_mode else "unverified",
        signer_key_id=signer_key_id,
        signer_identity=None,
        verified_at=None,
        signed_content_sha256=signed_digest,
        issues=[
            PluginPackageIssue(
                code=code,
                message=(
                    f"{message} Developer mode allows installation, but this package is not an Official Extension."
                    if developer_mode
                    else message
                ),
                severity="warning" if developer_mode else "error",
                path=path,
            )
        ],
    )
