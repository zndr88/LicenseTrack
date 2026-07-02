from __future__ import annotations

import hashlib
import io
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from app.config import settings
from app.schemas.plugin import (
    PLUGIN_PERMISSION_CATALOG,
    PluginActionCreate,
    PluginInstallPreview,
    PluginPackageIssue,
    PluginPermissionCreate,
    PluginPermissionPreview,
    PluginRegistryCreate,
    PluginSettingDefinitionCreate,
)
from app.services.plugin_manifest_service import get_compatibility_status, parse_manifest_json

PLUGIN_MANIFEST_FILENAME = "plugin.ltplugin"
REQUIRED_ROOT_ENTRIES = frozenset({PLUGIN_MANIFEST_FILENAME, "README.md", "LICENSE"})
REQUIRED_ROOT_DIRECTORIES = frozenset({"runtime"})


@dataclass(frozen=True)
class PluginPackageInspection:
    preview: PluginInstallPreview
    content: bytes
    safe_paths: dict[str, str]


@dataclass(frozen=True)
class PluginInstallFiles:
    install_path: Path
    package_path: Path


class PluginPackageError(ValueError):
    def __init__(self, preview: PluginInstallPreview):
        super().__init__("Plugin package is not installable")
        self.preview = preview


def inspect_plugin_package(content: bytes) -> PluginPackageInspection:
    checksum = hashlib.sha256(content).hexdigest()
    issues: list[PluginPackageIssue] = []
    max_bytes = settings.MAX_PLUGIN_PACKAGE_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        issues.append(
            PluginPackageIssue(
                code="package_too_large",
                message=f"Plugin package exceeds the maximum allowed size of {settings.MAX_PLUGIN_PACKAGE_SIZE_MB} MB.",
                severity="error",
            )
        )

    safe_paths: dict[str, str] = {}
    manifest = None
    try:
        with zipfile.ZipFile(io.BytesIO(content), "r") as archive:
            infos = archive.infolist()
            safe_paths, path_issues = _inspect_zip_paths(infos)
            issues.extend(path_issues)

            manifest_entries = [path for path in safe_paths if path.endswith(".ltplugin")]
            if manifest_entries != [PLUGIN_MANIFEST_FILENAME]:
                issues.append(
                    PluginPackageIssue(
                        code="manifest_location_invalid",
                        message="Package must contain exactly one root plugin.ltplugin manifest.",
                        severity="error",
                        path=", ".join(manifest_entries) if manifest_entries else None,
                    )
                )

            root_files = {path for path in safe_paths if "/" not in path and not path.endswith("/")}
            missing_files = sorted(REQUIRED_ROOT_ENTRIES - root_files)
            for missing in missing_files:
                issues.append(
                    PluginPackageIssue(
                        code="required_package_file_missing",
                        message=f"Required package file is missing: {missing}.",
                        severity="error",
                        path=missing,
                    )
                )

            root_dirs = {path.split("/", 1)[0] for path in safe_paths if "/" in path}
            for missing_dir in sorted(REQUIRED_ROOT_DIRECTORIES - root_dirs):
                issues.append(
                    PluginPackageIssue(
                        code="required_package_directory_missing",
                        message=f"Required package directory is missing: {missing_dir}/.",
                        severity="error",
                        path=f"{missing_dir}/",
                    )
                )

            if PLUGIN_MANIFEST_FILENAME in safe_paths:
                raw_manifest = archive.read(safe_paths[PLUGIN_MANIFEST_FILENAME])
                manifest, manifest_issues = parse_manifest_json(raw_manifest)
                issues.extend(manifest_issues)
                if manifest is not None and manifest.runtime.entrypoint not in safe_paths:
                    issues.append(
                        PluginPackageIssue(
                            code="runtime_entrypoint_missing",
                            message="Runtime entrypoint declared by the manifest is missing from the package.",
                            severity="error",
                            path=manifest.runtime.entrypoint,
                        )
                    )
    except zipfile.BadZipFile:
        issues.append(
            PluginPackageIssue(
                code="package_zip_invalid",
                message="Uploaded file is not a valid zip archive.",
                severity="error",
            )
        )

    permission_previews: list[PluginPermissionPreview] = []
    compatibility_status = "unknown"
    if manifest is not None:
        compatibility_status = get_compatibility_status(manifest)
        permission_previews = [
            PluginPermissionPreview(
                permission=permission,
                description=PLUGIN_PERMISSION_CATALOG[permission]["description"],
                risk=PLUGIN_PERMISSION_CATALOG[permission]["risk"],  # type: ignore[arg-type]
                rationale=manifest.permissionRationale.get(permission),
            )
            for permission in manifest.permissions
        ]

    installable = not any(issue.severity == "error" for issue in issues) and manifest is not None
    preview = PluginInstallPreview(
        manifest=manifest,
        checksum_sha256=checksum,
        package_size_bytes=len(content),
        compatibility_status=compatibility_status,  # type: ignore[arg-type]
        permissions=permission_previews,
        issues=issues,
        installable=installable,
    )
    return PluginPackageInspection(preview=preview, content=content, safe_paths=safe_paths)


def build_registry_payload(inspection: PluginPackageInspection, files: PluginInstallFiles) -> PluginRegistryCreate:
    manifest = inspection.preview.manifest
    if manifest is None or not inspection.preview.installable:
        raise PluginPackageError(inspection.preview)

    return PluginRegistryCreate(
        key=manifest.key,
        name=manifest.name,
        publisher_name=manifest.publisher.name,
        publisher_url=manifest.publisher.url,
        description=manifest.description,
        installed_version=manifest.version,
        compatibility_status=inspection.preview.compatibility_status,
        install_path=str(files.install_path),
        package_path=str(files.package_path),
        checksum_sha256=inspection.preview.checksum_sha256,
        manifest=manifest.model_dump(mode="json"),
        permissions=[PluginPermissionCreate(permission=permission, granted=False) for permission in manifest.permissions],
        settings=[
            PluginSettingDefinitionCreate(
                key=setting.key,
                type=setting.type,
                label=setting.label,
                required=setting.required,
                default=setting.default,
                options=setting.options,
                help_text=setting.helpText,
                order=setting.order,
            )
            for setting in manifest.settings
        ],
        actions=[
            PluginActionCreate(
                key=action.key,
                label=action.label,
                slot=action.slot,
                handler=action.handler,
                required_role=action.requiredRole,
                enabled=False,
                icon=action.icon,
                description=action.description,
                timeout_seconds=action.timeoutSeconds,
            )
            for action in manifest.actions
        ],
    )


def stage_and_extract_plugin_package(inspection: PluginPackageInspection) -> PluginInstallFiles:
    manifest = inspection.preview.manifest
    if manifest is None or not inspection.preview.installable:
        raise PluginPackageError(inspection.preview)

    storage_root = Path(settings.PLUGIN_STORAGE_PATH).resolve()
    staging_root = storage_root / ".staging"
    final_path = storage_root / manifest.key / manifest.version
    package_path = final_path / "package.zip"
    if final_path.exists():
        raise FileExistsError(f"Plugin version already exists at {final_path}")

    staging_root.mkdir(parents=True, exist_ok=True)
    storage_root.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(tempfile.mkdtemp(prefix=f"{manifest.key}-{manifest.version}-", dir=staging_root))
    try:
        with zipfile.ZipFile(io.BytesIO(inspection.content), "r") as archive:
            for normalized_path, archive_name in inspection.safe_paths.items():
                info = archive.getinfo(archive_name)
                if info.is_dir():
                    (temp_dir / normalized_path).mkdir(parents=True, exist_ok=True)
                    continue
                destination = (temp_dir / normalized_path).resolve()
                if not destination.is_relative_to(temp_dir.resolve()):
                    raise ValueError("Package extraction path escaped staging directory")
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info, "r") as source, destination.open("wb") as target:
                    shutil.copyfileobj(source, target)
        (temp_dir / "package.zip").write_bytes(inspection.content)
        final_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(temp_dir), str(final_path))
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    return PluginInstallFiles(install_path=final_path, package_path=package_path)


def cleanup_installed_plugin_files(files: PluginInstallFiles) -> None:
    shutil.rmtree(files.install_path, ignore_errors=True)


def _inspect_zip_paths(infos: list[zipfile.ZipInfo]) -> tuple[dict[str, str], list[PluginPackageIssue]]:
    safe_paths: dict[str, str] = {}
    issues: list[PluginPackageIssue] = []
    for info in infos:
        raw_name = info.filename
        normalized = _normalize_zip_path(raw_name)
        if normalized is None:
            issues.append(
                PluginPackageIssue(
                    code="package_path_invalid",
                    message="Package entries must be relative normalized POSIX paths without traversal.",
                    severity="error",
                    path=raw_name,
                )
            )
            continue
        if _is_symlink(info):
            issues.append(
                PluginPackageIssue(
                    code="package_symlink_rejected",
                    message="Symlinks are not allowed in plugin packages.",
                    severity="error",
                    path=normalized,
                )
            )
            continue
        if normalized in safe_paths:
            issues.append(
                PluginPackageIssue(
                    code="package_duplicate_path",
                    message="Duplicate package entry after path normalization.",
                    severity="error",
                    path=normalized,
                )
            )
            continue
        safe_paths[normalized] = raw_name
    return safe_paths, issues


def _normalize_zip_path(path: str) -> str | None:
    if not path or "\\" in path or ":" in path or path.startswith("/"):
        return None
    candidate = PurePosixPath(path)
    if candidate.is_absolute():
        return None
    parts = candidate.parts
    if not parts or any(part in ("", ".", "..") for part in parts):
        return None
    normalized = candidate.as_posix().rstrip("/")
    if not normalized or normalized == "." or normalized.startswith("../"):
        return None
    return normalized


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0o170000
    return mode == 0o120000
