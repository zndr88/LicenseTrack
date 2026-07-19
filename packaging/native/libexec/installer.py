#!/usr/bin/env python3
"""Install and upgrade LicenseTrack as a native systemd service on Linux."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import getpass
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
from typing import Iterator
from urllib.error import URLError
from urllib.request import urlopen

try:
    import fcntl
except ImportError:  # pragma: no cover - importable for Windows-side unit tests
    fcntl = None  # type: ignore[assignment]


STATE_SCHEMA_VERSION = 1
MINIMUM_PYTHON = (3, 12)
DEFAULT_INSTALL_ROOT = Path("/opt/licensetrack")
DEFAULT_DATA_ROOT = Path("/var/lib/licensetrack")
DEFAULT_CONFIG_ROOT = Path("/etc/licensetrack")
DEFAULT_UPGRADE_BACKUP_ROOT = Path("/var/backups/licensetrack/upgrades")
DEFAULT_SERVICE_FILE = Path("/etc/systemd/system/licensetrack.service")
DEFAULT_CLI_FILE = Path("/usr/local/bin/licensetrack")
DEFAULT_LOCK_FILE = Path("/run/lock/licensetrack-installer.lock")
WEAK_PASSWORDS = {"", "admin", "password", "changeme", "changeme_required"}
VERSION_RE = re.compile(r'^APP_VERSION\s*=\s*["\']([^"\']+)["\']', re.MULTILINE)
SAFE_ENV_VALUE_RE = re.compile(r"^[A-Za-z0-9_./:@,+%=-]*$")
INSTALL_MODES = ("standard", "advanced")
LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")
DEFAULT_BIND_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
DEFAULT_LOG_LEVEL = "INFO"
DEFAULT_TOKEN_EXPIRY = 1440
DEFAULT_MAX_UPLOAD_SIZE_MB = 20
DEFAULT_MAX_PLUGIN_PACKAGE_SIZE_MB = 50
DEFAULT_MAX_PLUGIN_DOCUMENT_SIZE_MB = 10
DEFAULT_ALLOWED_UPLOAD_EXTENSIONS = ".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.txt,.docx"


class InstallerError(RuntimeError):
    """An expected installer failure with an operator-facing message."""


@dataclass(frozen=True)
class InstallPaths:
    install_root: str
    data_root: str
    config_root: str
    upgrade_backup_root: str
    service_file: str
    cli_file: str
    service_name: str
    service_user: str
    service_group: str

    @property
    def releases_root(self) -> Path:
        return Path(self.install_root) / "releases"

    @property
    def current_link(self) -> Path:
        return Path(self.install_root) / "current"

    @property
    def state_file(self) -> Path:
        return Path(self.config_root) / "install.json"

    @property
    def config_file(self) -> Path:
        return Path(self.config_root) / "licensetrack.env"


def info(message: str) -> None:
    print(f"[LicenseTrack] {message}", flush=True)


def run(
    command: list[str | os.PathLike[str]],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    capture: bool = False,
) -> subprocess.CompletedProcess[str]:
    printable = " ".join(shlex.quote(os.fspath(part)) for part in command)
    info(f"Running: {printable}")
    return subprocess.run(
        [os.fspath(part) for part in command],
        cwd=cwd,
        env=env,
        check=True,
        text=True,
        capture_output=capture,
    )


def require_supported_host() -> None:
    if os.name != "posix" or not Path("/proc").exists():
        raise InstallerError("Native installation is supported only on Linux.")
    if sys.version_info < MINIMUM_PYTHON:
        raise InstallerError("Python 3.12 or newer is required.")
    if os.geteuid() != 0:
        raise InstallerError("Run the installer with sudo.")
    if shutil.which("systemctl") is None:
        raise InstallerError("systemd is required but systemctl was not found.")


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def validate_install_paths(paths: InstallPaths) -> None:
    managed_directories = {
        "install root": Path(paths.install_root).resolve(),
        "data root": Path(paths.data_root).resolve(),
        "configuration root": Path(paths.config_root).resolve(),
        "upgrade backup root": Path(paths.upgrade_backup_root).resolve(),
    }
    for label, path in managed_directories.items():
        if not path.is_absolute() or path == Path("/") or len(path.parts) < 3:
            raise InstallerError(f"Refusing unsafe {label}: {path}")

    install_root = managed_directories["install root"]
    data_root = managed_directories["data root"]
    config_root = managed_directories["configuration root"]
    backup_root = managed_directories["upgrade backup root"]
    for first_name, first in managed_directories.items():
        for second_name, second in managed_directories.items():
            if first_name >= second_name:
                continue
            if _is_relative_to(first, second) or _is_relative_to(second, first):
                raise InstallerError(f"{first_name} and {second_name} must not overlap.")
    if backup_root == data_root or _is_relative_to(backup_root, data_root):
        raise InstallerError("Upgrade backups must be stored outside the managed data root.")
    if Path(paths.service_file).resolve().is_dir() or not paths.service_file.endswith(".service"):
        raise InstallerError("The systemd service target must be a .service file path.")
    if Path(paths.cli_file).resolve() in {Path("/"), install_root, data_root, config_root}:
        raise InstallerError("Refusing unsafe operator CLI target.")


@contextmanager
def installer_lock(path: Path) -> Iterator[None]:
    if fcntl is None:
        raise InstallerError("Native installation locking is available only on Linux.")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise InstallerError("Another LicenseTrack install or upgrade is already running.") from exc
        yield


def parse_version(value: str) -> tuple[int, int, int, int, str]:
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)(.*)", value.strip())
    if not match:
        raise InstallerError(f"Unsupported LicenseTrack version: {value!r}")
    suffix = match[4]
    return int(match[1]), int(match[2]), int(match[3]), 1 if not suffix else 0, suffix


def read_release_version(source_root: Path) -> str:
    manifest_path = source_root / "manifest.json"
    if manifest_path.exists():
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        version = str(data.get("version", "")).strip()
        parse_version(version)
        return version.removeprefix("v")

    version_file = source_root / "backend" / "app" / "version.py"
    if not version_file.exists():
        raise InstallerError("Could not find manifest.json or backend/app/version.py in the release.")
    match = VERSION_RE.search(version_file.read_text(encoding="utf-8"))
    if not match:
        raise InstallerError("Could not read APP_VERSION from backend/app/version.py.")
    version = match.group(1)
    parse_version(version)
    return version


def _safe_relative_path(value: str) -> Path:
    path = Path(value)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise InstallerError(f"Unsafe release manifest path: {value!r}")
    return path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_release_manifest(source_root: Path) -> None:
    manifest_path = source_root / "manifest.json"
    if not manifest_path.exists():
        info("Source archive has no native manifest; file checksum verification is unavailable.")
        return
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = manifest.get("files")
    if not isinstance(files, dict) or not files:
        raise InstallerError("Native release manifest does not contain file checksums.")
    for name, expected_hash in files.items():
        relative = _safe_relative_path(str(name))
        target = source_root / relative
        if not target.is_file():
            raise InstallerError(f"Release file listed in manifest is missing: {relative}")
        actual_hash = sha256_file(target)
        if not secrets.compare_digest(actual_hash, str(expected_hash)):
            raise InstallerError(f"Release checksum mismatch: {relative}")
    info(f"Verified {len(files)} release file checksums.")


def encode_env_value(value: str) -> str:
    if "\n" in value or "\r" in value or "\x00" in value:
        raise InstallerError("Configuration values cannot contain newlines or NUL bytes.")
    if SAFE_ENV_VALUE_RE.fullmatch(value):
        return value
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise InstallerError(f"Invalid environment line {line_number} in {path}.")
        key, raw_value = line.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise InstallerError(f"Invalid environment key {key!r} in {path}.")
        raw_value = raw_value.strip()
        if not raw_value:
            value = ""
        elif raw_value[0] in "\"'":
            try:
                parsed = shlex.split(raw_value, posix=True)
            except ValueError as exc:
                raise InstallerError(f"Invalid quoted value for {key} in {path}.") from exc
            if len(parsed) != 1:
                raise InstallerError(f"Invalid value for {key} in {path}.")
            value = parsed[0]
        else:
            value = raw_value
        values[key] = value
    return values


def write_env_file(path: Path, values: dict[str, str], service_group: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = "\n".join(f"{key}={encode_env_value(value)}" for key, value in values.items()) + "\n"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(content, encoding="utf-8")
    os.chmod(temporary, 0o640)
    shutil.chown(temporary, user="root", group=service_group)
    os.replace(temporary, path)


def write_json(path: Path, data: dict, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, mode)
    os.replace(temporary, path)


def prompt_text(label: str, default: str) -> str:
    value = input(f"{label} [{default}]: ").strip()
    return value or default


def prompt_integer(label: str, default: int, *, minimum: int = 1, maximum: int | None = None) -> int:
    while True:
        raw_value = input(f"{label} [{default}]: ").strip()
        if not raw_value:
            return default
        try:
            value = int(raw_value)
        except ValueError:
            print("Enter a whole number.")
            continue
        if value < minimum or (maximum is not None and value > maximum):
            allowed = f"{minimum} or greater" if maximum is None else f"between {minimum} and {maximum}"
            print(f"Enter a value {allowed}.")
            continue
        return value


def prompt_yes_no(label: str, default: bool) -> bool:
    suffix = "Y/n" if default else "y/N"
    while True:
        value = input(f"{label} [{suffix}]: ").strip().lower()
        if not value:
            return default
        if value in {"y", "yes"}:
            return True
        if value in {"n", "no"}:
            return False
        print("Enter yes or no.")


def prompt_log_level(default: str) -> str:
    choices = "/".join(LOG_LEVELS)
    while True:
        value = input(f"Application log level ({choices}) [{default}]: ").strip().upper()
        value = value or default
        if value in LOG_LEVELS:
            return value
        print(f"Choose one of: {', '.join(LOG_LEVELS)}.")


def select_install_mode(args: argparse.Namespace) -> str:
    if args.mode:
        return args.mode
    if args.yes:
        return "standard"

    print("LicenseTrack installation mode:")
    print("  1) Standard (recommended) - safe defaults and minimal questions")
    print("  2) Advanced - configure runtime, limits, and test-only OIDC allowances")
    while True:
        value = input("Select installation mode [1]: ").strip().lower()
        if value in {"", "1", "standard", "s"}:
            return "standard"
        if value in {"2", "advanced", "a"}:
            return "advanced"
        print("Enter 1 for Standard or 2 for Advanced.")


def default_public_url(bind_host: str, port: int) -> str:
    host = "localhost" if bind_host in {"127.0.0.1", "0.0.0.0", "::1", "::"} else bind_host
    return f"http://{host}:{port}"


def resolve_install_options(args: argparse.Namespace) -> None:
    args.mode = select_install_mode(args)
    is_advanced_prompt = args.mode == "advanced" and not args.yes

    if is_advanced_prompt:
        info("Advanced mode selected. Press Enter to accept each displayed default.")
        if args.bind_host is None:
            args.bind_host = prompt_text("Backend bind address", DEFAULT_BIND_HOST)
        if args.port is None:
            args.port = prompt_integer("Backend port", DEFAULT_PORT, maximum=65535)
    else:
        args.bind_host = args.bind_host or DEFAULT_BIND_HOST
        args.port = args.port or DEFAULT_PORT

    if args.public_url is None and not args.yes:
        args.public_url = prompt_text("Public LicenseTrack URL", default_public_url(args.bind_host, args.port))
    args.public_url = args.public_url or default_public_url(args.bind_host, args.port)

    if is_advanced_prompt:
        if args.log_level is None:
            args.log_level = prompt_log_level(DEFAULT_LOG_LEVEL)
        if args.token_expiry is None:
            args.token_expiry = prompt_integer("Browser session lifetime in minutes", DEFAULT_TOKEN_EXPIRY)
        if args.max_upload_size_mb is None:
            args.max_upload_size_mb = prompt_integer("Maximum document upload size in MB", DEFAULT_MAX_UPLOAD_SIZE_MB)
        if args.max_plugin_package_size_mb is None:
            args.max_plugin_package_size_mb = prompt_integer(
                "Maximum plugin package size in MB", DEFAULT_MAX_PLUGIN_PACKAGE_SIZE_MB
            )
        if args.max_plugin_document_size_mb is None:
            args.max_plugin_document_size_mb = prompt_integer(
                "Maximum document size supplied to plugins in MB",
                DEFAULT_MAX_PLUGIN_DOCUMENT_SIZE_MB,
            )
        if args.allowed_upload_extensions is None:
            args.allowed_upload_extensions = prompt_text("Allowed upload extensions", DEFAULT_ALLOWED_UPLOAD_EXTENSIONS)
        if args.expose_api_docs is None:
            args.expose_api_docs = prompt_yes_no("Expose interactive API documentation", False)
        if args.allow_http_oidc_discovery is None:
            args.allow_http_oidc_discovery = prompt_yes_no(
                "Allow plain-HTTP OIDC discovery (unsafe; testing only)", False
            )
        if args.allow_private_oidc_discovery is None:
            args.allow_private_oidc_discovery = prompt_yes_no(
                "Allow private-network OIDC discovery (unsafe; testing only)", False
            )
        if args.session_cookie_name is None:
            args.session_cookie_name = prompt_text("Session cookie name", "license_lifecycle_session")
        if args.session_cookie_secure is None:
            secure_default = args.public_url.lower().startswith("https://")
            args.session_cookie_secure = prompt_yes_no("Restrict session cookies to HTTPS", secure_default)

    args.log_level = args.log_level or DEFAULT_LOG_LEVEL
    args.token_expiry = args.token_expiry or DEFAULT_TOKEN_EXPIRY
    args.max_upload_size_mb = args.max_upload_size_mb or DEFAULT_MAX_UPLOAD_SIZE_MB
    args.max_plugin_package_size_mb = args.max_plugin_package_size_mb or DEFAULT_MAX_PLUGIN_PACKAGE_SIZE_MB
    args.max_plugin_document_size_mb = args.max_plugin_document_size_mb or DEFAULT_MAX_PLUGIN_DOCUMENT_SIZE_MB
    args.allowed_upload_extensions = args.allowed_upload_extensions or DEFAULT_ALLOWED_UPLOAD_EXTENSIONS
    if args.expose_api_docs is None:
        args.expose_api_docs = False
    if args.allow_http_oidc_discovery is None:
        args.allow_http_oidc_discovery = False
    if args.allow_private_oidc_discovery is None:
        args.allow_private_oidc_discovery = False
    args.session_cookie_name = args.session_cookie_name or "license_lifecycle_session"
    if args.session_cookie_secure is None:
        args.session_cookie_secure = args.public_url.lower().startswith("https://")


def copy_backend_source(source_root: Path, destination: Path) -> None:
    backend_source = source_root / "backend"
    if not backend_source.is_dir():
        raise InstallerError("Source archive is missing the backend directory.")

    ignored_names = {".venv", "build", "dist", "__pycache__", ".pytest_cache", ".ruff_cache"}

    def ignore(_directory: str, names: list[str]) -> set[str]:
        return {name for name in names if name in ignored_names or name.endswith((".pyc", ".pyo"))}

    shutil.copytree(backend_source, destination, ignore=ignore)


def ensure_frontend(source_root: Path, backend_destination: Path) -> None:
    prebuilt = source_root / "payload" / "backend" / "frontend" / "dist"
    source_dist = source_root / "frontend" / "dist"
    if prebuilt.is_dir():
        frontend_dist = prebuilt
    elif source_dist.is_dir():
        frontend_dist = source_dist
    else:
        frontend_source = source_root / "frontend"
        if not (frontend_source / "package-lock.json").exists():
            raise InstallerError("Release has no compiled frontend and no frontend source to build.")
        npm = shutil.which("npm")
        if npm is None:
            raise InstallerError(
                "This source archive does not contain a compiled frontend. Install Node.js 22/npm, "
                "or use the official LicenseTrack native release archive."
            )
        version_result = run([npm, "--version"], capture=True)
        npm_major = int(version_result.stdout.strip().split(".", 1)[0])
        if npm_major < 10:
            raise InstallerError("npm 10 or newer (normally supplied with Node.js 22) is required.")
        run([npm, "ci"], cwd=frontend_source)
        run([npm, "run", "build"], cwd=frontend_source)
        frontend_dist = source_dist

    target = backend_destination / "frontend" / "dist"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(frontend_dist, target)


def stage_release(source_root: Path, paths: InstallPaths, version: str) -> Path:
    target = paths.releases_root / version
    if target.exists():
        raise InstallerError(f"Release {version} is already installed at {target}.")

    paths.releases_root.mkdir(parents=True, exist_ok=True)
    stage = paths.releases_root / f".staging-{version}-{os.getpid()}"
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(mode=0o755)

    try:
        payload_backend = source_root / "payload" / "backend"
        backend_destination = stage / "backend"
        if payload_backend.is_dir():
            shutil.copytree(payload_backend, backend_destination)
        else:
            copy_backend_source(source_root, backend_destination)
            ensure_frontend(source_root, backend_destination)

        native_source = source_root / "packaging" / "native"
        if not native_source.is_dir():
            raise InstallerError("Release is missing packaging/native support files.")
        shutil.copytree(native_source, stage / "native")

        for notice in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
            notice_path = source_root / notice
            if notice_path.exists():
                shutil.copy2(notice_path, stage / notice)

        requirements = backend_destination / "requirements-runtime.txt"
        if not requirements.exists():
            raise InstallerError("Release is missing backend/requirements-runtime.txt.")

        venv_path = stage / "venv"
        run([sys.executable, "-m", "venv", venv_path])
        pip = venv_path / "bin" / "python"
        wheelhouse = source_root / "wheelhouse"
        pip_command: list[str | os.PathLike[str]] = [pip, "-m", "pip", "install"]
        if wheelhouse.is_dir():
            pip_command.extend(["--no-index", "--find-links", wheelhouse])
        pip_command.extend(["--requirement", requirements])
        run(pip_command)
        run(
            [
                pip,
                "-c",
                "import aiosqlite, alembic, fastapi, sqlalchemy, uvicorn; print('Runtime import check passed')",
            ]
        )

        os.replace(stage, target)
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise

    info(f"Staged LicenseTrack {version} at {target}.")
    return target


def ensure_service_account(paths: InstallPaths) -> None:
    result = subprocess.run(["getent", "passwd", paths.service_user], check=False, capture_output=True)
    if result.returncode != 0:
        command = ["useradd", "--system"]
        if paths.service_group == paths.service_user:
            command.append("--user-group")
        else:
            group_result = subprocess.run(["getent", "group", paths.service_group], check=False, capture_output=True)
            if group_result.returncode != 0:
                run(["groupadd", "--system", paths.service_group])
            command.extend(["--gid", paths.service_group])
        command.extend(
            [
                "--home-dir",
                paths.data_root,
                "--shell",
                "/usr/sbin/nologin",
                paths.service_user,
            ]
        )
        run(command)
    group_result = subprocess.run(["getent", "group", paths.service_group], check=False, capture_output=True)
    if group_result.returncode != 0:
        raise InstallerError(f"Service group {paths.service_group!r} does not exist.")


def prepare_data_directories(paths: InstallPaths) -> None:
    data_root = Path(paths.data_root)
    for directory in (data_root, data_root / "storage", data_root / "backups", data_root / "plugins"):
        directory.mkdir(parents=True, exist_ok=True)
        os.chmod(directory, 0o750)
    recursive_chown(data_root, paths.service_user, paths.service_group)

    upgrade_backup_root = Path(paths.upgrade_backup_root)
    upgrade_backup_root.mkdir(parents=True, exist_ok=True)
    os.chmod(upgrade_backup_root, 0o700)


def recursive_chown(root: Path, user: str, group: str) -> None:
    import grp
    import pwd

    uid = pwd.getpwnam(user).pw_uid
    gid = grp.getgrnam(group).gr_gid
    os.chown(root, uid, gid)
    for directory, directories, files in os.walk(root, followlinks=False):
        for name in [*directories, *files]:
            child = Path(directory) / name
            try:
                os.chown(child, uid, gid, follow_symlinks=False)
            except FileNotFoundError:
                continue


def atomic_symlink(target: Path, link: Path) -> None:
    link.parent.mkdir(parents=True, exist_ok=True)
    temporary = link.with_name(link.name + ".next")
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    os.replace(temporary, link)


def render_template(path: Path, replacements: dict[str, str]) -> str:
    content = path.read_text(encoding="utf-8")
    for key, value in replacements.items():
        content = content.replace(f"@{key}@", value)
    unresolved = re.findall(r"@[A-Z_]+@", content)
    if unresolved:
        raise InstallerError(f"Unresolved template variables in {path.name}: {', '.join(unresolved)}")
    return content


def install_service_files(source_root: Path, paths: InstallPaths, bind_host: str, port: int) -> None:
    template_root = source_root / "packaging" / "native" / "templates"
    replacements = {
        "SERVICE_USER": paths.service_user,
        "SERVICE_GROUP": paths.service_group,
        "CURRENT_LINK": os.fspath(paths.current_link),
        "CONFIG_FILE": os.fspath(paths.config_file),
        "PORT": str(port),
        "BIND_HOST": bind_host,
        "SERVICE_NAME": paths.service_name,
        "STATE_FILE": os.fspath(paths.state_file),
    }

    service_content = render_template(template_root / "licensetrack.service.in", replacements)
    service_file = Path(paths.service_file)
    service_file.parent.mkdir(parents=True, exist_ok=True)
    service_file.write_text(service_content, encoding="utf-8")
    os.chmod(service_file, 0o644)

    cli_content = render_template(template_root / "licensetrack-cli.in", replacements)
    cli_file = Path(paths.cli_file)
    cli_file.parent.mkdir(parents=True, exist_ok=True)
    cli_file.write_text(cli_content, encoding="utf-8")
    os.chmod(cli_file, 0o755)

    run(["systemctl", "daemon-reload"])
    run(["systemctl", "enable", paths.service_name])


def configuration_values(args: argparse.Namespace, paths: InstallPaths) -> dict[str, str]:
    if not 1 <= args.port <= 65535:
        raise InstallerError("Port must be between 1 and 65535.")
    try:
        ipaddress.ip_address(args.bind_host)
    except ValueError as exc:
        raise InstallerError("Bind host must be a numeric IPv4 or IPv6 address.") from exc
    public_url = args.public_url
    if not re.fullmatch(r"https?://[^\s/]+(?::\d+)?(?:/[^\s]*)?", public_url):
        raise InstallerError("Public URL must start with http:// or https:// and contain no spaces.")
    if args.log_level not in LOG_LEVELS:
        raise InstallerError(f"Log level must be one of: {', '.join(LOG_LEVELS)}.")
    positive_settings = {
        "Token expiry": args.token_expiry,
        "Maximum upload size": args.max_upload_size_mb,
        "Maximum plugin package size": args.max_plugin_package_size_mb,
        "Maximum plugin document size": args.max_plugin_document_size_mb,
    }
    for label, value in positive_settings.items():
        if value < 1:
            raise InstallerError(f"{label} must be at least 1.")
    extensions = [item.strip() for item in args.allowed_upload_extensions.split(",") if item.strip()]
    if not extensions or any(not re.fullmatch(r"\.[A-Za-z0-9]+", item) for item in extensions):
        raise InstallerError("Allowed upload extensions must be a comma-separated list such as .pdf,.png,.docx.")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", args.session_cookie_name):
        raise InstallerError("Session cookie name may contain only letters, numbers, _, ., and -.")

    password = os.environ.get("LT_ADMIN_PASSWORD", "")
    if args.admin_password_file:
        password = Path(args.admin_password_file).read_text(encoding="utf-8").rstrip("\r\n")
    if not password and not args.yes:
        password = getpass.getpass("Initial LicenseTrack admin password: ")
    if len(password) < 12 or password.strip().lower() in WEAK_PASSWORDS:
        raise InstallerError(
            "Set a strong initial admin password of at least 12 characters via the prompt, "
            "LT_ADMIN_PASSWORD, or --admin-password-file."
        )

    data_root = Path(paths.data_root)
    return {
        "JWT_SECRET": secrets.token_hex(32),
        "ADMIN_PASSWORD": password,
        "DATABASE_URL": f"sqlite+aiosqlite:////{(data_root / 'licenses.db').as_posix().lstrip('/')}",
        "STORAGE_PATH": os.fspath(data_root / "storage"),
        "PLUGIN_STORAGE_PATH": os.fspath(data_root / "plugins"),
        "PLUGIN_HOST_BASE_URL": f"http://127.0.0.1:{args.port}",
        "BACKUP_LOCATION": os.fspath(data_root / "backups"),
        "RESTART_AFTER_RESTORE": "true",
        "HOST": args.bind_host,
        "LOG_LEVEL": args.log_level,
        "EXPOSE_API_DOCS": str(args.expose_api_docs).lower(),
        "CORS_ORIGINS": public_url.rstrip("/"),
        "TOKEN_EXPIRY": str(args.token_expiry),
        "OIDC_STATE_SECRET": "",
        "ALLOW_HTTP_OIDC_DISCOVERY": str(args.allow_http_oidc_discovery).lower(),
        "ALLOW_PRIVATE_OIDC_DISCOVERY": str(args.allow_private_oidc_discovery).lower(),
        "SESSION_COOKIE_NAME": args.session_cookie_name,
        "SESSION_COOKIE_SECURE": str(args.session_cookie_secure).lower(),
        "MAX_UPLOAD_SIZE_MB": str(args.max_upload_size_mb),
        "MAX_PLUGIN_PACKAGE_SIZE_MB": str(args.max_plugin_package_size_mb),
        "MAX_PLUGIN_DOCUMENT_SIZE_MB": str(args.max_plugin_document_size_mb),
        "ALLOWED_UPLOAD_EXTENSIONS": ",".join(extensions),
    }


def merge_new_configuration_defaults(current: dict[str, str], paths: InstallPaths, state: dict) -> dict[str, str]:
    """Add new native defaults without replacing any operator-managed values."""
    data_root = Path(paths.data_root)
    defaults = {
        "STORAGE_PATH": os.fspath(data_root / "storage"),
        "PLUGIN_STORAGE_PATH": os.fspath(data_root / "plugins"),
        "PLUGIN_HOST_BASE_URL": f"http://127.0.0.1:{state['port']}",
        "BACKUP_LOCATION": os.fspath(data_root / "backups"),
        "RESTART_AFTER_RESTORE": "true",
        "MAX_PLUGIN_PACKAGE_SIZE_MB": "50",
        "MAX_PLUGIN_DOCUMENT_SIZE_MB": "10",
        "EXPOSE_API_DOCS": "false",
    }
    merged = current.copy()
    for key, value in defaults.items():
        merged.setdefault(key, value)
    return merged


def load_state(path: Path) -> dict:
    if not path.exists():
        raise InstallerError(f"Native installation state was not found at {path}.")
    state = json.loads(path.read_text(encoding="utf-8"))
    if state.get("schema_version") != STATE_SCHEMA_VERSION:
        raise InstallerError(f"Unsupported native installation state schema in {path}.")
    return state


def state_from_install(version: str, release: Path, paths: InstallPaths, args: argparse.Namespace) -> dict:
    return {
        "schema_version": STATE_SCHEMA_VERSION,
        "version": version,
        "release_path": os.fspath(release),
        "installed_at": datetime.now(timezone.utc).isoformat(),
        "install_mode": args.mode,
        "bind_host": args.bind_host,
        "port": args.port,
        **asdict(paths),
    }


def wait_for_health(bind_host: str, port: int, expected_version: str, timeout: int = 90) -> None:
    health_host = "127.0.0.1" if bind_host in {"0.0.0.0", "::"} else bind_host
    url = f"http://{health_host}:{port}/api/health"
    deadline = time.monotonic() + timeout
    last_error = "no response"
    while time.monotonic() < deadline:
        try:
            with urlopen(url, timeout=3) as response:  # noqa: S310 - loopback health URL
                payload = json.load(response)
            if payload.get("status") == "ok" and payload.get("version") == expected_version:
                info(f"Health check passed at {url} (version {expected_version}).")
                return
            last_error = f"unexpected health response: {payload}"
        except (OSError, URLError, ValueError) as exc:
            last_error = str(exc)
        time.sleep(2)
    raise InstallerError(f"Health check failed at {url}: {last_error}")


def install(args: argparse.Namespace) -> None:
    source_root = Path(args.source_root).resolve()
    verify_release_manifest(source_root)
    version = read_release_version(source_root)
    if args.verify_only:
        info(f"Release {version} verification completed.")
        return
    require_supported_host()
    resolve_install_options(args)
    paths = paths_from_args(args)
    validate_install_paths(paths)
    with installer_lock(Path(args.lock_file)):
        if paths.state_file.exists() or paths.current_link.exists():
            raise InstallerError(
                f"A managed LicenseTrack installation already exists under {paths.install_root}. "
                "Use upgrade.sh instead."
            )
        values = configuration_values(args, paths)
        ensure_service_account(paths)
        prepare_data_directories(paths)
        release = stage_release(source_root, paths, version)
        atomic_symlink(release, paths.current_link)
        write_env_file(paths.config_file, values, paths.service_group)
        state = state_from_install(version, release, paths, args)
        write_json(paths.state_file, state)
        install_service_files(source_root, paths, args.bind_host, args.port)

        if not args.no_start:
            run(["systemctl", "start", paths.service_name])
            try:
                wait_for_health(args.bind_host, args.port, version, args.health_timeout)
            except Exception:
                subprocess.run(["systemctl", "status", paths.service_name, "--no-pager"], check=False)
                raise
        info(f"LicenseTrack {version} native installation completed.")
        info(f"Installation mode: {args.mode.capitalize()}")
        info(f"Configuration: {paths.config_file}")
        info(f"Data: {paths.data_root}")


def database_path_from_url(database_url: str, working_directory: Path) -> Path:
    prefixes = ("sqlite+aiosqlite:///", "sqlite:///")
    for prefix in prefixes:
        if database_url.startswith(prefix):
            raw = database_url.removeprefix(prefix)
            if not raw or raw == ":memory:":
                raise InstallerError("Native upgrades require a file-backed SQLite database.")
            path = Path(raw)
            return path.resolve() if path.is_absolute() else (working_directory / path).resolve()
    raise InstallerError("Native upgrades currently support only SQLite DATABASE_URL values.")


def sqlite_snapshot(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    source_connection = sqlite3.connect(source)
    destination_connection = sqlite3.connect(destination)
    try:
        source_connection.backup(destination_connection)
    finally:
        destination_connection.close()
        source_connection.close()


def sqlite_integrity_check(path: Path) -> None:
    connection = sqlite3.connect(path)
    try:
        result = connection.execute("PRAGMA integrity_check").fetchone()
    finally:
        connection.close()
    if not result or result[0] != "ok":
        raise InstallerError(f"SQLite integrity check failed for {path}: {result}")


def configured_external_storage(db_path: Path, data_root: Path) -> list[Path]:
    if not db_path.exists():
        return []
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        row = connection.execute("SELECT storage_path FROM global_settings WHERE id = 1").fetchone()
    except sqlite3.DatabaseError:
        return []
    finally:
        connection.close()
    if not row or not row[0]:
        return []
    storage_path = Path(str(row[0])).resolve()
    try:
        storage_path.relative_to(data_root.resolve())
        return []
    except ValueError:
        if not storage_path.is_dir():
            raise InstallerError(f"Configured external storage path does not exist: {storage_path}")
        return [storage_path]


def directory_size(path: Path) -> int:
    total = 0
    for item in path.rglob("*"):
        try:
            if item.is_file() and not item.is_symlink():
                total += item.stat().st_size
        except FileNotFoundError:
            continue
    return total


def ensure_backup_space(destination_root: Path, paths_to_archive: list[Path]) -> None:
    required = sum(directory_size(path) if path.is_dir() else path.stat().st_size for path in paths_to_archive)
    required = max(required * 2, 100 * 1024 * 1024)
    free = shutil.disk_usage(destination_root).free
    if free < required:
        raise InstallerError(
            f"Insufficient free space for upgrade backup: need approximately {required // (1024 * 1024)} MB, "
            f"have {free // (1024 * 1024)} MB."
        )


def create_upgrade_backup(paths: InstallPaths, old_state: dict, db_path: Path) -> Path:
    data_root = Path(paths.data_root).resolve()
    backup_root = Path(paths.upgrade_backup_root).resolve()
    backup_root.mkdir(parents=True, exist_ok=True)
    external_paths = configured_external_storage(db_path, data_root)
    ensure_backup_space(backup_root, [data_root, paths.config_file, *external_paths])

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    archive = backup_root / f"licensetrack-pre-upgrade-{old_state['version']}-{timestamp}.tar.gz"
    with tempfile.TemporaryDirectory(prefix="licensetrack-backup-") as temp_name:
        temp_root = Path(temp_name)
        db_snapshot = temp_root / "database-snapshot.db"
        sqlite_snapshot(db_path, db_snapshot)
        sqlite_integrity_check(db_snapshot)
        manifest = {
            "schema_version": 1,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source_version": old_state["version"],
            "database_path": os.fspath(db_path),
            "data_root": os.fspath(data_root),
            "config_file": os.fspath(paths.config_file),
            "external_paths": [os.fspath(path) for path in external_paths],
        }
        manifest_path = temp_root / "manifest.json"
        write_json(manifest_path, manifest, 0o600)
        state_copy = temp_root / "install.json"
        shutil.copy2(paths.state_file, state_copy)

        with tarfile.open(archive, "w:gz") as tar:
            tar.add(data_root, arcname="data", recursive=True)
            tar.add(paths.config_file, arcname="config/licensetrack.env")
            tar.add(state_copy, arcname="state/install.json")
            tar.add(db_snapshot, arcname="database-snapshot.db")
            tar.add(manifest_path, arcname="manifest.json")
            for index, external_path in enumerate(external_paths):
                tar.add(external_path, arcname=f"external/{index}", recursive=True)
    os.chmod(archive, 0o600)
    info(f"Created pre-upgrade backup: {archive}")
    return archive


def migration_environment(config_file: Path, database_url: str | None = None) -> dict[str, str]:
    environment = os.environ.copy()
    environment.update(parse_env_file(config_file))
    if database_url is not None:
        environment["DATABASE_URL"] = database_url
    return environment


def run_migrations(release: Path, config_file: Path, database_url: str | None = None) -> None:
    backend = release / "backend"
    python = release / "venv" / "bin" / "python"
    run(
        [python, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        cwd=backend,
        env=migration_environment(config_file, database_url),
    )


def validate_migrations_on_copy(release: Path, paths: InstallPaths, db_path: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="licensetrack-migration-test-") as temp_name:
        test_db = Path(temp_name) / "licenses.db"
        sqlite_snapshot(db_path, test_db)
        test_url = f"sqlite+aiosqlite:////{test_db.as_posix().lstrip('/')}"
        run_migrations(release, paths.config_file, test_url)
        sqlite_integrity_check(test_db)
    info("Candidate migrations passed against a database snapshot.")


def _validate_archive_member(member: tarfile.TarInfo) -> None:
    path = Path(member.name)
    if path.is_absolute() or ".." in path.parts:
        raise InstallerError(f"Unsafe path in upgrade backup: {member.name}")
    if member.issym() or member.islnk():
        link = Path(member.linkname)
        if link.is_absolute() or ".." in link.parts:
            raise InstallerError(f"Unsafe link in upgrade backup: {member.name}")


def _assert_safe_restore_root(path: Path) -> None:
    resolved = path.resolve()
    if resolved == Path("/") or len(resolved.parts) < 3:
        raise InstallerError(f"Refusing to restore unsafe data root: {resolved}")


def restore_upgrade_backup(archive: Path, paths: InstallPaths) -> dict:
    data_root = Path(paths.data_root).resolve()
    _assert_safe_restore_root(data_root)
    with tempfile.TemporaryDirectory(prefix="licensetrack-rollback-") as temp_name:
        extraction_root = Path(temp_name)
        with tarfile.open(archive, "r:gz") as tar:
            for member in tar.getmembers():
                _validate_archive_member(member)
            tar.extractall(extraction_root, filter="data")

        manifest = json.loads((extraction_root / "manifest.json").read_text(encoding="utf-8"))
        if Path(manifest["data_root"]).resolve() != data_root:
            raise InstallerError("Upgrade backup data root does not match this installation.")

        restored_data = extraction_root / "data"
        if not restored_data.is_dir():
            raise InstallerError("Upgrade backup does not contain the data directory.")
        shutil.rmtree(data_root)
        shutil.copytree(restored_data, data_root, symlinks=True)

        db_path = Path(manifest["database_path"]).resolve()
        db_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(extraction_root / "database-snapshot.db", db_path)
        Path(str(db_path) + "-wal").unlink(missing_ok=True)
        Path(str(db_path) + "-shm").unlink(missing_ok=True)

        shutil.copy2(extraction_root / "config" / "licensetrack.env", paths.config_file)
        os.chmod(paths.config_file, 0o640)
        shutil.chown(paths.config_file, user="root", group=paths.service_group)
        previous_state = json.loads((extraction_root / "state" / "install.json").read_text(encoding="utf-8"))
        write_json(paths.state_file, previous_state)

        for index, external_name in enumerate(manifest.get("external_paths", [])):
            external_path = Path(external_name).resolve()
            _assert_safe_restore_root(external_path)
            source = extraction_root / "external" / str(index)
            shutil.rmtree(external_path, ignore_errors=True)
            shutil.copytree(source, external_path, symlinks=True)
            recursive_chown(external_path, paths.service_user, paths.service_group)

    prepare_data_directories(paths)
    info(f"Restored pre-upgrade backup {archive}.")
    return previous_state


def is_service_active(service_name: str) -> bool:
    return (
        subprocess.run(
            ["systemctl", "is-active", "--quiet", service_name],
            check=False,
        ).returncode
        == 0
    )


def paths_from_state(state: dict) -> InstallPaths:
    required = [field for field in InstallPaths.__dataclass_fields__ if field not in state]
    if required:
        raise InstallerError(f"Installation state is missing: {', '.join(required)}")
    return InstallPaths(**{field: state[field] for field in InstallPaths.__dataclass_fields__})


def upgrade(args: argparse.Namespace) -> None:
    source_root = Path(args.source_root).resolve()
    verify_release_manifest(source_root)
    target_version = read_release_version(source_root)
    if args.verify_only:
        info(f"Release {target_version} verification completed.")
        return
    require_supported_host()
    requested_state_file = Path(args.state_file).resolve()
    with installer_lock(Path(args.lock_file)):
        old_state = load_state(requested_state_file)
        paths = paths_from_state(old_state)
        validate_install_paths(paths)
        if paths.state_file.resolve() != requested_state_file:
            raise InstallerError("Requested state file does not match the managed installation.")

        if parse_version(target_version) <= parse_version(str(old_state["version"])):
            raise InstallerError(
                f"Target version {target_version} is not newer than installed version {old_state['version']}."
            )
        environment = parse_env_file(paths.config_file)
        merged_environment = merge_new_configuration_defaults(environment, paths, old_state)
        database_url = environment.get("DATABASE_URL", "")
        db_path = database_path_from_url(database_url, Path(old_state["release_path"]) / "backend")
        if not db_path.exists():
            raise InstallerError(f"Installed database was not found: {db_path}")

        candidate = stage_release(source_root, paths, target_version)
        was_active = is_service_active(paths.service_name)
        backup_archive: Path | None = None
        live_migration_started = False
        try:
            if was_active:
                run(["systemctl", "stop", paths.service_name])
            backup_archive = create_upgrade_backup(paths, old_state, db_path)
            validate_migrations_on_copy(candidate, paths, db_path)
            live_migration_started = True
            if merged_environment != environment:
                write_env_file(paths.config_file, merged_environment, paths.service_group)
                info("Added new native configuration defaults; existing values were preserved.")
            run_migrations(candidate, paths.config_file)
            sqlite_integrity_check(db_path)

            atomic_symlink(candidate, paths.current_link)
            new_state = {
                **old_state,
                "version": target_version,
                "release_path": os.fspath(candidate),
                "upgraded_at": datetime.now(timezone.utc).isoformat(),
                "previous_version": old_state["version"],
                "last_upgrade_backup": os.fspath(backup_archive),
            }
            write_json(paths.state_file, new_state)

            if not args.no_start:
                run(["systemctl", "start", paths.service_name])
                wait_for_health(
                    str(old_state["bind_host"]),
                    int(old_state["port"]),
                    target_version,
                    args.health_timeout,
                )
            info(f"LicenseTrack upgrade completed: {old_state['version']} -> {target_version}.")
        except Exception as exc:
            if not live_migration_started:
                if was_active:
                    subprocess.run(["systemctl", "start", paths.service_name], check=False)
                shutil.rmtree(candidate, ignore_errors=True)
                raise
            info(f"Upgrade failed after live migration began: {exc}")
            info("Starting automatic rollback.")
            subprocess.run(["systemctl", "stop", paths.service_name], check=False)
            if backup_archive is None:
                raise InstallerError("Upgrade failed and no rollback backup is available.") from exc
            previous_state = restore_upgrade_backup(backup_archive, paths)
            atomic_symlink(Path(previous_state["release_path"]), paths.current_link)
            run(["systemctl", "start", paths.service_name])
            wait_for_health(
                str(previous_state["bind_host"]),
                int(previous_state["port"]),
                str(previous_state["version"]),
                args.health_timeout,
            )
            shutil.rmtree(candidate, ignore_errors=True)
            raise InstallerError(f"Upgrade failed and was rolled back successfully: {exc}") from exc


def paths_from_args(args: argparse.Namespace) -> InstallPaths:
    return InstallPaths(
        install_root=os.fspath(Path(args.install_root).resolve()),
        data_root=os.fspath(Path(args.data_root).resolve()),
        config_root=os.fspath(Path(args.config_root).resolve()),
        upgrade_backup_root=os.fspath(Path(args.upgrade_backup_root).resolve()),
        service_file=os.fspath(Path(args.service_file).resolve()),
        cli_file=os.fspath(Path(args.cli_file).resolve()),
        service_name=args.service_name,
        service_user=args.service_user,
        service_group=args.service_group or args.service_user,
    )


def add_common_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--lock-file", default=os.fspath(DEFAULT_LOCK_FILE))
    parser.add_argument("--health-timeout", type=int, default=90)
    parser.add_argument("--no-start", action="store_true")
    parser.add_argument("--verify-only", action="store_true")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    install_parser = subparsers.add_parser("install", help="Install a new native LicenseTrack instance")
    add_common_arguments(install_parser)
    install_parser.add_argument("--install-root", default=os.fspath(DEFAULT_INSTALL_ROOT))
    install_parser.add_argument("--data-root", default=os.fspath(DEFAULT_DATA_ROOT))
    install_parser.add_argument("--config-root", default=os.fspath(DEFAULT_CONFIG_ROOT))
    install_parser.add_argument("--upgrade-backup-root", default=os.fspath(DEFAULT_UPGRADE_BACKUP_ROOT))
    install_parser.add_argument("--service-file", default=os.fspath(DEFAULT_SERVICE_FILE))
    install_parser.add_argument("--cli-file", default=os.fspath(DEFAULT_CLI_FILE))
    install_parser.add_argument("--service-name", default="licensetrack.service")
    install_parser.add_argument("--service-user", default="licensetrack")
    install_parser.add_argument("--service-group")
    mode_group = install_parser.add_mutually_exclusive_group()
    mode_group.add_argument("--mode", choices=INSTALL_MODES)
    mode_group.add_argument(
        "--standard",
        action="store_const",
        const="standard",
        dest="mode",
        help="Use the recommended minimal installation flow",
    )
    mode_group.add_argument(
        "--advanced",
        action="store_const",
        const="advanced",
        dest="mode",
        help="Configure runtime, limits, and OIDC network allowances interactively",
    )
    install_parser.add_argument("--bind-host")
    install_parser.add_argument("--port", type=int)
    install_parser.add_argument("--public-url")
    install_parser.add_argument("--admin-password-file")
    install_parser.add_argument("--log-level", choices=LOG_LEVELS)
    install_parser.add_argument("--token-expiry", type=int)
    install_parser.add_argument("--max-upload-size-mb", type=int)
    install_parser.add_argument("--max-plugin-package-size-mb", type=int)
    install_parser.add_argument("--max-plugin-document-size-mb", type=int)
    install_parser.add_argument("--allowed-upload-extensions")
    install_parser.add_argument("--expose-api-docs", action=argparse.BooleanOptionalAction, default=None)
    install_parser.add_argument("--allow-http-oidc-discovery", action=argparse.BooleanOptionalAction, default=None)
    install_parser.add_argument("--allow-private-oidc-discovery", action=argparse.BooleanOptionalAction, default=None)
    install_parser.add_argument("--session-cookie-name")
    install_parser.add_argument("--session-cookie-secure", action=argparse.BooleanOptionalAction, default=None)
    install_parser.add_argument("--yes", action="store_true")
    install_parser.set_defaults(func=install)

    upgrade_parser = subparsers.add_parser("upgrade", help="Upgrade an existing managed native installation")
    add_common_arguments(upgrade_parser)
    upgrade_parser.add_argument("--state-file", default=os.fspath(DEFAULT_CONFIG_ROOT / "install.json"))
    upgrade_parser.set_defaults(func=upgrade)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        args.func(args)
    except InstallerError as exc:
        print(f"[LicenseTrack] ERROR: {exc}", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as exc:
        print(f"[LicenseTrack] ERROR: command failed with exit code {exc.returncode}", file=sys.stderr)
        return exc.returncode or 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
