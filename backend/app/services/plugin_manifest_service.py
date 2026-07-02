from __future__ import annotations

import re
from pathlib import PurePosixPath

from pydantic import ValidationError

from app.schemas.plugin import PluginManifest, PluginPackageIssue
from app.version import APP_VERSION


_SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")


def parse_manifest_json(raw: bytes) -> tuple[PluginManifest | None, list[PluginPackageIssue]]:
    try:
        manifest = PluginManifest.model_validate_json(raw)
    except ValidationError as exc:
        return None, [
            PluginPackageIssue(
                code="manifest_schema_invalid",
                message=str(exc.errors()[0]["msg"]) if exc.errors() else "Manifest schema is invalid.",
                severity="error",
                path="plugin.ltplugin",
            )
        ]
    except ValueError:
        return None, [
            PluginPackageIssue(
                code="manifest_json_invalid",
                message="plugin.ltplugin must be valid JSON.",
                severity="error",
                path="plugin.ltplugin",
            )
        ]
    return manifest, validate_manifest_contract(manifest)


def validate_manifest_contract(manifest: PluginManifest) -> list[PluginPackageIssue]:
    issues: list[PluginPackageIssue] = []
    for field_name, version in (
        ("version", manifest.version),
        ("licenseTrack.minVersion", manifest.licenseTrack.minVersion),
        ("licenseTrack.maxVersionExclusive", manifest.licenseTrack.maxVersionExclusive),
    ):
        if version and not _is_semver(version):
            issues.append(
                PluginPackageIssue(
                    code="manifest_version_invalid",
                    message=f"{field_name} must be semantic version format.",
                    severity="error",
                    path="plugin.ltplugin",
                )
            )

    entrypoint_issue = validate_relative_package_path(manifest.runtime.entrypoint, require_runtime_prefix=True)
    if entrypoint_issue is not None:
        issues.append(entrypoint_issue)

    compatibility = get_compatibility_status(manifest)
    if compatibility == "incompatible":
        issues.append(
            PluginPackageIssue(
                code="license_track_version_incompatible",
                message=(
                    f"Plugin supports LicenseTrack >= {manifest.licenseTrack.minVersion}"
                    + (
                        f" and < {manifest.licenseTrack.maxVersionExclusive}"
                        if manifest.licenseTrack.maxVersionExclusive
                        else ""
                    )
                    + f"; current version is {APP_VERSION}."
                ),
                severity="error",
                path="plugin.ltplugin",
            )
        )
    return issues


def validate_relative_package_path(path: str, *, require_runtime_prefix: bool = False) -> PluginPackageIssue | None:
    if "\\" in path or ":" in path:
        return _path_issue(path)
    candidate = PurePosixPath(path)
    if candidate.is_absolute():
        return _path_issue(path)
    parts = candidate.parts
    if not parts or any(part in ("", ".", "..") for part in parts):
        return _path_issue(path)
    if require_runtime_prefix and (parts[0] != "runtime" or len(parts) == 1):
        return PluginPackageIssue(
            code="runtime_entrypoint_invalid",
            message="Runtime entrypoint must be a relative path inside runtime/.",
            severity="error",
            path="plugin.ltplugin",
        )
    return None


def get_compatibility_status(manifest: PluginManifest) -> str:
    current = _version_tuple(APP_VERSION)
    min_version = _version_tuple(manifest.licenseTrack.minVersion)
    max_version = _version_tuple(manifest.licenseTrack.maxVersionExclusive) if manifest.licenseTrack.maxVersionExclusive else None
    if current is None or min_version is None:
        return "unknown"
    if current < min_version:
        return "incompatible"
    if max_version is not None and current >= max_version:
        return "incompatible"
    return "compatible"


def _is_semver(value: str) -> bool:
    return bool(_SEMVER_RE.fullmatch(value))


def _version_tuple(value: str | None) -> tuple[int, int, int] | None:
    if not value:
        return None
    match = _SEMVER_RE.fullmatch(value)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def _path_issue(path: str) -> PluginPackageIssue:
    return PluginPackageIssue(
        code="package_path_invalid",
        message="Package paths must be relative normalized POSIX paths without traversal.",
        severity="error",
        path=path,
    )
