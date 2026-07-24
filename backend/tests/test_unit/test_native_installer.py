from __future__ import annotations

import argparse
from contextlib import nullcontext
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys
import tarfile

import pytest


ROOT = Path(__file__).resolve().parents[3]
INSTALLER_PATH = ROOT / "packaging" / "native" / "libexec" / "installer.py"
SPEC = importlib.util.spec_from_file_location("licensetrack_native_installer", INSTALLER_PATH)
assert SPEC is not None and SPEC.loader is not None
installer = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = installer
SPEC.loader.exec_module(installer)


def install_paths(tmp_path: Path):
    return installer.InstallPaths(
        install_root=str(tmp_path / "opt" / "licensetrack"),
        data_root=str(tmp_path / "var" / "lib" / "licensetrack"),
        config_root=str(tmp_path / "etc" / "licensetrack"),
        upgrade_backup_root=str(tmp_path / "var" / "backups" / "licensetrack"),
        service_file=str(tmp_path / "etc" / "systemd" / "licensetrack.service"),
        cli_file=str(tmp_path / "usr" / "local" / "bin" / "licensetrack"),
        service_name="licensetrack.service",
        service_user="licensetrack",
        service_group="licensetrack",
    )


def configuration_args(**overrides):
    defaults = {
        "mode": "standard",
        "yes": True,
        "network_mode": None,
        "public_url": "http://localhost:8000",
        "admin_password_file": None,
        "port": 8000,
        "bind_host": "127.0.0.1",
        "log_level": "INFO",
        "token_expiry": 1440,
        "max_upload_size_mb": 20,
        "max_plugin_package_size_mb": 50,
        "max_plugin_document_size_mb": 10,
        "allowed_upload_extensions": ".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.txt,.docx",
        "expose_api_docs": False,
        "allow_http_oidc_discovery": False,
        "allow_private_oidc_discovery": False,
        "session_cookie_name": "license_lifecycle_session",
        "session_cookie_secure": False,
    }
    defaults.update(overrides)
    return argparse.Namespace(**defaults)


def test_semver_comparison_treats_stable_as_newer_than_prerelease():
    assert installer.parse_version("v1.0.9") > installer.parse_version("1.0.9-rc.1")
    assert installer.parse_version("1.1.0") > installer.parse_version("1.0.99")
    with pytest.raises(installer.InstallerError):
        installer.parse_version("release-nine")


def test_environment_encoding_round_trips_quotes_and_spaces(tmp_path: Path):
    values = {
        "PLAIN": "value",
        "EMPTY": "",
        "PASSWORD": 'spaces and "quotes" and \\ slashes',
    }
    env_file = tmp_path / "licensetrack.env"
    env_file.write_text(
        "\n".join(f"{key}={installer.encode_env_value(value)}" for key, value in values.items()) + "\n",
        encoding="utf-8",
    )
    assert installer.parse_env_file(env_file) == values


def test_environment_encoding_rejects_newlines():
    with pytest.raises(installer.InstallerError):
        installer.encode_env_value("first\nsecond")


def test_manifest_verification_detects_changed_file(tmp_path: Path):
    payload = tmp_path / "payload" / "file.txt"
    payload.parent.mkdir()
    payload.write_text("expected", encoding="utf-8")
    expected_hash = hashlib.sha256(b"expected").hexdigest()
    (tmp_path / "manifest.json").write_text(
        json.dumps({"version": "1.0.8", "files": {"payload/file.txt": expected_hash}}),
        encoding="utf-8",
    )
    installer.verify_release_manifest(tmp_path)
    payload.write_text("changed", encoding="utf-8")
    with pytest.raises(installer.InstallerError, match="checksum mismatch"):
        installer.verify_release_manifest(tmp_path)


def test_manifest_rejects_parent_traversal(tmp_path: Path):
    (tmp_path / "manifest.json").write_text(
        json.dumps({"version": "1.0.8", "files": {"../outside": "bad"}}),
        encoding="utf-8",
    )
    with pytest.raises(installer.InstallerError, match="Unsafe"):
        installer.verify_release_manifest(tmp_path)


@pytest.mark.parametrize(
    ("version", "expected"),
    [((3, 12), "cp312"), ((3, 13), "cp313"), ((3, 14), "cp314")],
)
def test_python_abi_policy_accepts_supported_cpython_versions(version, expected):
    assert installer.python_abi_for("cpython", version) == expected


@pytest.mark.parametrize(
    ("implementation", "version"),
    [("cpython", (3, 11)), ("cpython", (3, 15)), ("pypy", (3, 12))],
)
def test_python_abi_policy_rejects_unsupported_runtimes(implementation, version):
    with pytest.raises(installer.InstallerError, match="CPython 3.12, 3.13, or 3.14"):
        installer.python_abi_for(implementation, version)


def _write_v2_manifest(root: Path, abis: list[str], *, architecture: str | None = None):
    files = {"payload/example": "not-used-by-compatibility-check"}
    for abi in abis:
        wheelhouse = root / "wheelhouse" / abi
        wheelhouse.mkdir(parents=True, exist_ok=True)
        wheel = wheelhouse / "example-1.0-py3-none-any.whl"
        wheel.write_bytes(b"wheel")
        files[wheel.relative_to(root).as_posix()] = "not-used-by-compatibility-check"
    manifest = {
        "format": "licensetrack-native-v2",
        "version": "1.1.0-test",
        "platform": "linux",
        "architecture": architecture or installer.host_architecture(),
        "python": ">=3.12,<3.15",
        "python_implementation": "cpython",
        "python_abis": abis,
        "files": files,
    }
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def test_release_compatibility_selects_matching_nested_wheelhouse(tmp_path: Path, monkeypatch):
    _write_v2_manifest(tmp_path, ["cp312", "cp313", "cp314"])
    monkeypatch.setattr(installer, "current_python_abi", lambda: "cp313")

    selected = installer.validate_release_compatibility(tmp_path)

    assert selected == tmp_path / "wheelhouse" / "cp313"


def test_release_compatibility_rejects_manifest_without_running_abi(tmp_path: Path, monkeypatch):
    _write_v2_manifest(tmp_path, ["cp312"])
    monkeypatch.setattr(installer, "current_python_abi", lambda: "cp314")

    with pytest.raises(installer.InstallerError, match="does not include cp314"):
        installer.validate_release_compatibility(tmp_path)


def test_release_compatibility_rejects_unchecksummed_wheel(tmp_path: Path):
    abi = installer.current_python_abi()
    _write_v2_manifest(tmp_path, [abi])
    manifest_path = tmp_path / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"].pop(f"wheelhouse/{abi}/example-1.0-py3-none-any.whl")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(installer.InstallerError, match="not covered by the release manifest"):
        installer.validate_release_compatibility(tmp_path)


def test_release_compatibility_rejects_architecture_mismatch(tmp_path: Path):
    _write_v2_manifest(tmp_path, [installer.current_python_abi()], architecture="aarch64")

    with pytest.raises(installer.InstallerError, match="architecture"):
        installer.validate_release_compatibility(tmp_path)


def test_source_tree_without_manifest_uses_online_dependency_install(tmp_path: Path):
    assert installer.validate_release_compatibility(tmp_path) is None


def test_frontend_bundle_integrity_rejects_demo_marker(tmp_path: Path):
    frontend = tmp_path / "frontend" / "dist"
    assets = frontend / "assets"
    assets.mkdir(parents=True)
    (frontend / "index.html").write_text("<div>LicenseTrack</div>", encoding="utf-8")
    (assets / "app.js").write_text(
        'console.info("LICENSETRACK_DEMO_MARKER");',
        encoding="utf-8",
    )

    with pytest.raises(installer.InstallerError, match="demo frontend"):
        installer.assert_production_frontend_bundle(frontend)


def test_frontend_bundle_integrity_accepts_production_bundle(tmp_path: Path):
    frontend = tmp_path / "frontend" / "dist"
    frontend.mkdir(parents=True)
    (frontend / "index.html").write_text("<div>LicenseTrack</div>", encoding="utf-8")

    installer.assert_production_frontend_bundle(frontend)


@pytest.mark.skipif(os.name == "nt", reason="POSIX umask and permission modes are required")
def test_stage_release_normalizes_permissions_under_restrictive_umask(tmp_path: Path, monkeypatch):
    source_root = tmp_path / "source"
    backend = source_root / "payload" / "backend"
    backend.mkdir(parents=True)
    requirements = backend / "requirements-runtime.txt"
    requirements.write_text("fastapi==0\n", encoding="utf-8")
    frontend = backend / "frontend" / "dist"
    frontend.mkdir(parents=True)
    (frontend / "index.html").write_text("<div>LicenseTrack</div>", encoding="utf-8")
    native = source_root / "packaging" / "native"
    native.mkdir(parents=True)
    entrypoint = native / "install.sh"
    entrypoint.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    os.chmod(entrypoint, 0o700)

    monkeypatch.setattr(installer, "validate_release_compatibility", lambda _root: None)

    def fake_run(command, **_kwargs):
        arguments = [os.fspath(part) for part in command]
        if arguments[1:3] == ["-m", "venv"]:
            venv = Path(arguments[-1])
            (venv / "bin").mkdir(parents=True)
            python = venv / "bin" / "python"
            python.write_text("python", encoding="utf-8")
            os.chmod(python, 0o700)
            private_file = venv / "private.txt"
            private_file.write_text("runtime", encoding="utf-8")

    monkeypatch.setattr(installer, "run", fake_run)
    paths = install_paths(tmp_path)

    previous_umask = os.umask(0o077)
    try:
        release = installer.stage_release(source_root, paths, "1.1.0-test")
    finally:
        os.umask(previous_umask)

    directories = (
        Path(paths.install_root),
        paths.releases_root,
        release,
        release / "backend",
        release / "venv",
        release / "venv" / "bin",
    )
    for directory in directories:
        assert stat.S_IMODE(directory.stat().st_mode) == 0o755

    assert stat.S_IMODE((release / "venv" / "private.txt").stat().st_mode) == 0o644
    assert stat.S_IMODE((release / "venv" / "bin" / "python").stat().st_mode) == 0o755
    assert stat.S_IMODE((release / "native" / "install.sh").stat().st_mode) == 0o755


def test_install_rejects_incompatible_release_before_host_checks(tmp_path: Path, monkeypatch):
    args = argparse.Namespace(source_root=str(tmp_path), verify_only=False)
    host_check_called = False
    stage_called = False

    monkeypatch.setattr(installer, "verify_release_manifest", lambda _root: None)
    monkeypatch.setattr(installer, "read_release_version", lambda _root: "1.1.0-test")

    def reject(_root):
        raise installer.InstallerError("incompatible runtime")

    def host_check():
        nonlocal host_check_called
        host_check_called = True

    def stage(*_args, **_kwargs):
        nonlocal stage_called
        stage_called = True

    monkeypatch.setattr(installer, "validate_release_compatibility", reject)
    monkeypatch.setattr(installer, "require_supported_host", host_check)
    monkeypatch.setattr(installer, "stage_release", stage)

    with pytest.raises(installer.InstallerError, match="incompatible runtime"):
        installer.install(args)
    assert host_check_called is False
    assert stage_called is False


@pytest.mark.skipif(os.name == "nt", reason="native database URLs use Linux absolute paths")
def test_database_url_resolves_absolute_and_release_relative_paths(tmp_path: Path):
    working = tmp_path / "release" / "backend"
    working.mkdir(parents=True)
    absolute = tmp_path / "data" / "licenses.db"
    absolute_url = f"sqlite+aiosqlite:////{absolute.as_posix().lstrip('/')}"
    assert installer.database_path_from_url(absolute_url, working) == absolute.resolve()
    assert (
        installer.database_path_from_url("sqlite+aiosqlite:///./licenses.db", working)
        == (working / "licenses.db").resolve()
    )


def test_sqlite_snapshot_is_consistent(tmp_path: Path):
    source = tmp_path / "source.db"
    destination = tmp_path / "destination.db"
    connection = sqlite3.connect(source)
    connection.execute("CREATE TABLE records (value TEXT NOT NULL)")
    connection.execute("INSERT INTO records VALUES ('preserved')")
    connection.commit()
    connection.close()

    installer.sqlite_snapshot(source, destination)
    installer.sqlite_integrity_check(destination)
    copied = sqlite3.connect(destination)
    try:
        assert copied.execute("SELECT value FROM records").fetchone() == ("preserved",)
    finally:
        copied.close()


def test_external_storage_is_detected_for_upgrade_backup(tmp_path: Path):
    data_root = tmp_path / "data"
    external = tmp_path / "external-documents"
    data_root.mkdir()
    external.mkdir()
    db_path = data_root / "licenses.db"
    connection = sqlite3.connect(db_path)
    connection.execute("CREATE TABLE global_settings (id INTEGER PRIMARY KEY, storage_path TEXT)")
    connection.execute("INSERT INTO global_settings VALUES (1, ?)", (str(external),))
    connection.commit()
    connection.close()
    assert installer.configured_external_storage(db_path, data_root) == [external.resolve()]


def test_native_configuration_uses_persistent_paths(tmp_path: Path, monkeypatch):
    paths = install_paths(tmp_path)
    monkeypatch.setenv("LT_ADMIN_PASSWORD", "test-password-long-enough")
    args = configuration_args(
        network_mode="reverse-proxy",
        public_url="https://licenses.example.test",
        session_cookie_secure=True,
    )
    values = installer.configuration_values(args, paths)
    assert values["DATABASE_URL"].endswith("/var/lib/licensetrack/licenses.db")
    assert values["PLUGIN_STORAGE_PATH"].replace("\\", "/").endswith("/var/lib/licensetrack/plugins")
    assert values["SESSION_COOKIE_SECURE"] == "true"


def test_standard_mode_resolves_safe_defaults():
    args = configuration_args(
        mode=None,
        yes=True,
        public_url=None,
        port=None,
        bind_host=None,
        log_level=None,
        token_expiry=None,
        max_upload_size_mb=None,
        max_plugin_package_size_mb=None,
        max_plugin_document_size_mb=None,
        allowed_upload_extensions=None,
        expose_api_docs=None,
        allow_http_oidc_discovery=None,
        allow_private_oidc_discovery=None,
        session_cookie_name=None,
        session_cookie_secure=None,
    )
    installer.resolve_install_options(args)
    assert args.mode == "standard"
    assert args.bind_host == "127.0.0.1"
    assert args.port == 8000
    assert args.public_url == "http://localhost:8000"
    assert args.network_mode == "local-only"
    assert args.expose_api_docs is False
    assert args.allow_http_oidc_discovery is False
    assert args.allow_private_oidc_discovery is False
    assert args.session_cookie_secure is False


def test_unattended_reverse_proxy_requires_explicit_network_mode():
    args = configuration_args(
        mode="standard",
        yes=True,
        network_mode=None,
        public_url="https://licenses.example.test",
        bind_host=None,
        port=None,
    )

    with pytest.raises(installer.InstallerError, match="--network-mode reverse-proxy"):
        installer.resolve_install_options(args)


def test_unattended_reverse_proxy_accepts_explicit_network_mode():
    args = configuration_args(
        mode="standard",
        yes=True,
        network_mode="reverse-proxy",
        public_url="https://licenses.example.test",
        bind_host=None,
        port=None,
    )

    installer.resolve_install_options(args)

    assert args.bind_host == "127.0.0.1"
    assert args.network_mode == "reverse-proxy"


def test_direct_network_mode_defaults_to_wildcard_bind():
    args = configuration_args(
        mode="standard",
        yes=True,
        network_mode="direct-network",
        public_url="http://192.168.0.247:8000",
        bind_host=None,
        port=None,
    )

    installer.resolve_install_options(args)

    assert args.bind_host == "0.0.0.0"
    assert args.network_mode == "direct-network"


def test_network_mode_rejects_mismatched_bind_and_public_url():
    args = configuration_args(
        mode="standard",
        yes=True,
        network_mode="direct-network",
        public_url="https://licenses.example.test",
        bind_host="127.0.0.1",
    )

    with pytest.raises(installer.InstallerError, match="effective mode is 'reverse-proxy'"):
        installer.resolve_install_options(args)


def test_interactive_reverse_proxy_requires_confirmation(monkeypatch):
    args = configuration_args(
        mode="standard",
        yes=False,
        network_mode=None,
        public_url="https://licenses.example.test",
        bind_host=None,
        port=None,
    )
    monkeypatch.setattr("builtins.input", lambda _prompt: "yes")

    installer.resolve_install_options(args)

    assert args.network_mode == "reverse-proxy"


def test_network_mode_summary_explains_reachability():
    assert "connect from this host" in installer.network_mode_summary("local-only")
    assert "proxy must forward" in installer.network_mode_summary("reverse-proxy")
    assert "firewall" in installer.network_mode_summary("direct-network")


def test_install_state_records_runtime_metadata(tmp_path: Path, monkeypatch):
    paths = install_paths(tmp_path)
    args = configuration_args(network_mode="local-only")
    metadata = {
        "python_implementation": "cpython",
        "python_version": "3.14.4",
        "python_abi": "cp314",
        "python_executable": "/usr/bin/python3",
    }
    monkeypatch.setattr(installer, "python_runtime_metadata", lambda: metadata)

    state = installer.state_from_install("1.1.0", tmp_path / "release", paths, args)

    assert {key: state[key] for key in metadata} == metadata
    assert state["network_mode"] == "local-only"
    assert state["public_url"] == "http://localhost:8000"


def test_upgrade_state_adds_runtime_metadata_to_legacy_state(tmp_path: Path, monkeypatch):
    old_state = {"schema_version": 1, "version": "1.0.9", "release_path": "/old"}
    metadata = {
        "python_implementation": "cpython",
        "python_version": "3.13.14",
        "python_abi": "cp313",
        "python_executable": "/usr/bin/python3",
    }
    monkeypatch.setattr(installer, "python_runtime_metadata", lambda: metadata)

    state = installer.state_from_upgrade(
        old_state,
        "1.1.0",
        tmp_path / "release",
        tmp_path / "backup.tar.gz",
    )

    assert state["previous_version"] == "1.0.9"
    assert {key: state[key] for key in metadata} == metadata


def test_install_mode_menu_selects_advanced(monkeypatch):
    args = argparse.Namespace(mode=None, yes=False)
    answers = iter(["invalid", "2"])
    monkeypatch.setattr("builtins.input", lambda _prompt: next(answers))
    assert installer.select_install_mode(args) == "advanced"


def test_parser_exposes_network_mode():
    args = installer.build_parser().parse_args(
        [
            "install",
            "--source-root",
            ".",
            "--network-mode",
            "direct-network",
        ]
    )

    assert args.network_mode == "direct-network"


def test_advanced_questionnaire_accepts_safe_defaults(monkeypatch):
    args = configuration_args(
        mode="advanced",
        yes=False,
        public_url=None,
        port=None,
        bind_host=None,
        log_level=None,
        token_expiry=None,
        max_upload_size_mb=None,
        max_plugin_package_size_mb=None,
        max_plugin_document_size_mb=None,
        allowed_upload_extensions=None,
        expose_api_docs=None,
        allow_http_oidc_discovery=None,
        allow_private_oidc_discovery=None,
        session_cookie_name=None,
        session_cookie_secure=None,
    )
    answers = iter([""] * 14)
    monkeypatch.setattr("builtins.input", lambda _prompt: next(answers))
    installer.resolve_install_options(args)
    assert args.public_url == "http://localhost:8000"
    assert args.log_level == "INFO"
    assert args.token_expiry == 1440
    assert args.max_upload_size_mb == 20
    assert args.allowed_upload_extensions.startswith(".pdf,")
    assert args.expose_api_docs is False
    assert args.allow_http_oidc_discovery is False
    assert args.allow_private_oidc_discovery is False


def test_advanced_configuration_maps_runtime_and_oidc_values(tmp_path: Path, monkeypatch):
    paths = install_paths(tmp_path)
    monkeypatch.setenv("LT_ADMIN_PASSWORD", "test-password-long-enough")
    args = configuration_args(
        mode="advanced",
        public_url="http://192.168.0.247:9000",
        port=9000,
        bind_host="0.0.0.0",
        log_level="DEBUG",
        token_expiry=60,
        max_upload_size_mb=25,
        max_plugin_package_size_mb=75,
        max_plugin_document_size_mb=15,
        allowed_upload_extensions=".pdf, .png",
        expose_api_docs=True,
        allow_http_oidc_discovery=True,
        allow_private_oidc_discovery=True,
        session_cookie_name="licensetrack_test_session",
        session_cookie_secure=False,
    )
    installer.resolve_install_options(args)
    values = installer.configuration_values(args, paths)
    assert values["HOST"] == "0.0.0.0"
    assert values["LOG_LEVEL"] == "DEBUG"
    assert values["TOKEN_EXPIRY"] == "60"
    assert values["MAX_UPLOAD_SIZE_MB"] == "25"
    assert values["MAX_PLUGIN_PACKAGE_SIZE_MB"] == "75"
    assert values["MAX_PLUGIN_DOCUMENT_SIZE_MB"] == "15"
    assert values["ALLOWED_UPLOAD_EXTENSIONS"] == ".pdf,.png"
    assert values["EXPOSE_API_DOCS"] == "true"
    assert values["ALLOW_HTTP_OIDC_DISCOVERY"] == "true"
    assert values["ALLOW_PRIVATE_OIDC_DISCOVERY"] == "true"
    assert values["SESSION_COOKIE_NAME"] == "licensetrack_test_session"


def test_runtime_requirements_exclude_test_dependencies():
    runtime = (ROOT / "backend" / "requirements-runtime.txt").read_text(encoding="utf-8")
    full = (ROOT / "backend" / "requirements.txt").read_text(encoding="utf-8")
    runtime_packages = {line.strip() for line in runtime.splitlines() if line.strip() and not line.startswith("#")}
    full_packages = {line.strip() for line in full.splitlines() if line.strip() and not line.startswith("#")}
    assert runtime_packages <= full_packages
    assert not any(package.startswith(("pytest", "ruff", "respx")) for package in runtime_packages)


def test_service_and_cli_templates_resolve_all_placeholders(tmp_path: Path):
    paths = install_paths(tmp_path)
    replacements = {
        "SERVICE_USER": paths.service_user,
        "SERVICE_GROUP": paths.service_group,
        "CURRENT_LINK": str(paths.current_link),
        "CONFIG_FILE": str(paths.config_file),
        "PORT": "8000",
        "BIND_HOST": "127.0.0.1",
        "SERVICE_NAME": paths.service_name,
        "STATE_FILE": str(paths.state_file),
    }
    template_root = ROOT / "packaging" / "native" / "templates"
    service = installer.render_template(template_root / "licensetrack.service.in", replacements)
    cli = installer.render_template(template_root / "licensetrack-cli.in", replacements)
    assert "@" not in service
    assert "--workers 1" in service
    assert "Restart=always" in service
    assert "RestartSec=2s" in service
    assert "native/libexec/native_operator.py" in cli
    assert "native/libexec/installer.py" in cli
    assert "rollback --state-file" in cli


def test_service_template_preserves_runtime_privilege_boundary(tmp_path: Path):
    paths = install_paths(tmp_path)
    replacements = {
        "SERVICE_USER": paths.service_user,
        "SERVICE_GROUP": paths.service_group,
        "CURRENT_LINK": str(paths.current_link),
        "CONFIG_FILE": str(paths.config_file),
        "PORT": "8000",
        "BIND_HOST": "127.0.0.1",
    }
    template = ROOT / "packaging" / "native" / "templates" / "licensetrack.service.in"

    service = installer.render_template(template, replacements)

    assert "User=licensetrack" in service
    assert "Group=licensetrack" in service
    assert "UMask=0077" in service
    assert "NoNewPrivileges=true" in service
    assert "PrivateTmp=true" in service
    assert "ProtectSystem=full" in service
    assert "ProtectHome=true" in service
    assert "Restart=always" in service


@pytest.mark.skipif(os.name == "nt", reason="POSIX file modes are required")
def test_installed_control_files_are_not_service_writable(tmp_path: Path, monkeypatch):
    paths = install_paths(tmp_path)
    monkeypatch.setattr(installer.shutil, "chown", lambda *args, **kwargs: None)
    monkeypatch.setattr(installer, "run", lambda *args, **kwargs: None)

    installer.write_env_file(
        paths.config_file,
        {"JWT_SECRET": "test-secret"},
        paths.service_group,
    )
    installer.install_service_files(ROOT, paths, "127.0.0.1", 8000)

    assert stat.S_IMODE(paths.config_file.stat().st_mode) == 0o640
    assert stat.S_IMODE(Path(paths.service_file).stat().st_mode) == 0o644
    assert stat.S_IMODE(Path(paths.cli_file).stat().st_mode) == 0o755
    assert stat.S_IMODE(paths.config_file.stat().st_mode) & 0o020 == 0
    assert stat.S_IMODE(Path(paths.service_file).stat().st_mode) & 0o022 == 0
    assert stat.S_IMODE(Path(paths.cli_file).stat().st_mode) & 0o022 == 0


def test_install_operator_cli_publishes_rollback_dispatch_atomically(tmp_path: Path):
    paths = install_paths(tmp_path)

    installer.install_operator_cli(ROOT, paths)

    content = Path(paths.cli_file).read_text(encoding="utf-8")
    assert "rollback --state-file" in content
    assert str(paths.current_link) in content
    assert not Path(paths.cli_file + ".next").exists()


def test_parser_exposes_noninteractive_manual_rollback():
    args = installer.build_parser().parse_args(["rollback", "--yes", "--health-timeout", "15"])

    assert args.func is installer.rollback
    assert args.yes is True
    assert args.health_timeout == 15


def test_upgrade_backup_restores_database_data_config_and_state(tmp_path: Path, monkeypatch):
    paths = install_paths(tmp_path)
    data_root = Path(paths.data_root)
    data_root.mkdir(parents=True)
    Path(paths.config_root).mkdir(parents=True)
    Path(paths.upgrade_backup_root).mkdir(parents=True)
    document = data_root / "storage" / "evidence.txt"
    document.parent.mkdir()
    document.write_text("before", encoding="utf-8")

    db_path = data_root / "licenses.db"
    connection = sqlite3.connect(db_path)
    connection.execute("CREATE TABLE global_settings (id INTEGER PRIMARY KEY, storage_path TEXT, backup_location TEXT)")
    connection.execute("CREATE TABLE records (value TEXT NOT NULL)")
    connection.execute("INSERT INTO global_settings VALUES (1, '', '')")
    connection.execute("INSERT INTO records VALUES ('before')")
    connection.commit()
    connection.close()

    paths.config_file.write_text("DATABASE_URL=test-before\n", encoding="utf-8")
    Path(paths.cli_file).parent.mkdir(parents=True)
    Path(paths.cli_file).write_text("cli-before\n", encoding="utf-8")
    old_state = {
        "schema_version": installer.STATE_SCHEMA_VERSION,
        "version": "1.0.8",
        "release_path": str(tmp_path / "release-1.0.8"),
        **{field: getattr(paths, field) for field in installer.InstallPaths.__dataclass_fields__},
    }
    installer.write_json(paths.state_file, old_state)
    archive = installer.create_upgrade_backup(paths, old_state, db_path)

    document.write_text("after", encoding="utf-8")
    paths.config_file.write_text("DATABASE_URL=test-after\n", encoding="utf-8")
    Path(paths.cli_file).write_text("cli-after\n", encoding="utf-8")
    changed = sqlite3.connect(db_path)
    changed.execute("UPDATE records SET value = 'after'")
    changed.commit()
    changed.close()

    monkeypatch.setattr(installer, "prepare_data_directories", lambda _paths: None)
    monkeypatch.setattr(installer.shutil, "chown", lambda *args, **kwargs: None)
    restored_state = installer.restore_upgrade_backup(archive, paths)

    assert restored_state["version"] == "1.0.8"
    assert document.read_text(encoding="utf-8") == "before"
    assert paths.config_file.read_text(encoding="utf-8") == "DATABASE_URL=test-before\n"
    assert Path(paths.cli_file).read_text(encoding="utf-8") == "cli-before\n"
    restored = sqlite3.connect(db_path)
    try:
        assert restored.execute("SELECT value FROM records").fetchone() == ("before",)
    finally:
        restored.close()


def test_resolve_rollback_archive_uses_recorded_backup_and_confines_explicit_paths(tmp_path: Path):
    paths = install_paths(tmp_path)
    backup_root = Path(paths.upgrade_backup_root)
    backup_root.mkdir(parents=True)
    recorded = backup_root / "recorded.tar.gz"
    recorded.write_bytes(b"backup")
    state = {"last_upgrade_backup": str(recorded)}

    assert installer.resolve_rollback_archive(None, state, paths) == recorded.resolve()

    outside = tmp_path / "outside.tar.gz"
    outside.write_bytes(b"backup")
    with pytest.raises(installer.InstallerError, match="must be located under"):
        installer.resolve_rollback_archive(str(outside), state, paths)


def test_extract_upgrade_backup_rejects_parent_traversal(tmp_path: Path):
    archive = tmp_path / "unsafe.tar.gz"
    with tarfile.open(archive, "w:gz") as output:
        member = tarfile.TarInfo("../outside")
        payload = b"unsafe"
        member.size = len(payload)
        output.addfile(member, io.BytesIO(payload))

    with pytest.raises(installer.InstallerError, match="Unsafe path"):
        installer.extract_upgrade_backup(archive, tmp_path / "extract")


def _rollback_archive_fixture(tmp_path: Path, monkeypatch):
    paths = install_paths(tmp_path)
    data_root = Path(paths.data_root)
    data_root.mkdir(parents=True)
    Path(paths.config_root).mkdir(parents=True)
    Path(paths.upgrade_backup_root).mkdir(parents=True)
    database = data_root / "licenses.db"
    connection = sqlite3.connect(database)
    connection.execute("CREATE TABLE global_settings (id INTEGER PRIMARY KEY, storage_path TEXT)")
    connection.execute("INSERT INTO global_settings VALUES (1, '')")
    connection.commit()
    connection.close()
    paths.config_file.write_text("DATABASE_URL=fixture\n", encoding="utf-8")
    Path(paths.cli_file).parent.mkdir(parents=True)
    Path(paths.cli_file).write_text("operator-cli\n", encoding="utf-8")

    old_release = paths.releases_root / "1.0.9"
    old_python = old_release / "venv" / "bin" / "python"
    old_python.parent.mkdir(parents=True)
    old_python.write_text("python", encoding="utf-8")
    old_state = {
        "schema_version": installer.STATE_SCHEMA_VERSION,
        "version": "1.0.9",
        "release_path": str(old_release),
        "bind_host": "127.0.0.1",
        "port": 8000,
        **{field: getattr(paths, field) for field in installer.InstallPaths.__dataclass_fields__},
    }
    installer.write_json(paths.state_file, old_state)
    archive = installer.create_upgrade_backup(paths, old_state, database)
    monkeypatch.setattr(installer, "database_path_from_url", lambda *_args, **_kwargs: database.resolve())
    return paths, database, old_state, archive


def test_validate_rollback_target_accepts_matched_older_release(tmp_path: Path, monkeypatch):
    paths, _database, old_state, archive = _rollback_archive_fixture(tmp_path, monkeypatch)
    current_state = {**old_state, "version": "1.1.0", "release_path": str(paths.releases_root / "1.1.0")}

    target = installer.validate_rollback_target(archive, paths, current_state)

    assert target.archive == archive
    assert target.state["version"] == "1.0.9"
    assert target.release == Path(old_state["release_path"]).resolve()


def test_validate_rollback_target_rejects_non_older_release(tmp_path: Path, monkeypatch):
    paths, _database, old_state, archive = _rollback_archive_fixture(tmp_path, monkeypatch)
    current_state = {**old_state, "version": "1.0.8", "release_path": str(paths.releases_root / "1.0.8")}

    with pytest.raises(installer.InstallerError, match="must be older"):
        installer.validate_rollback_target(archive, paths, current_state)


def test_manual_rollback_requires_terminal_confirmation_without_yes(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(installer.sys.stdin, "isatty", lambda: False)

    with pytest.raises(installer.InstallerError, match="interactive terminal or --yes"):
        installer.confirm_manual_rollback("1.1.0", "1.0.9", tmp_path / "backup.tar.gz", False)


def test_manual_rollback_restores_target_and_records_safety_backup(tmp_path: Path, monkeypatch):
    paths = install_paths(tmp_path)
    Path(paths.config_root).mkdir(parents=True)
    paths.config_file.write_text("DATABASE_URL=current\n", encoding="utf-8")
    current_release = paths.releases_root / "1.1.0"
    target_release = paths.releases_root / "1.0.9"
    current_release.mkdir(parents=True)
    target_release.mkdir(parents=True)
    database = Path(paths.data_root) / "licenses.db"
    database.parent.mkdir(parents=True)
    database.write_bytes(b"database")
    selected_archive = Path(paths.upgrade_backup_root) / "selected.tar.gz"
    safety_archive = Path(paths.upgrade_backup_root) / "safety.tar.gz"
    current_state = {
        "schema_version": 1,
        "version": "1.1.0",
        "release_path": str(current_release),
        "bind_host": "127.0.0.1",
        "port": 8000,
        **{field: getattr(paths, field) for field in installer.InstallPaths.__dataclass_fields__},
    }
    target_state = {**current_state, "version": "1.0.9", "release_path": str(target_release)}
    target = installer.RollbackTarget(selected_archive, target_state, target_release)
    commands = []
    symlinks = []
    written_states = []

    monkeypatch.setattr(installer, "require_supported_host", lambda: None)
    monkeypatch.setattr(installer, "installer_lock", lambda _path: nullcontext())
    monkeypatch.setattr(installer, "load_state", lambda _path: current_state)
    monkeypatch.setattr(installer, "resolve_rollback_archive", lambda *_args: selected_archive)
    monkeypatch.setattr(installer, "validate_rollback_target", lambda *_args: target)
    monkeypatch.setattr(installer, "confirm_manual_rollback", lambda *_args: None)
    monkeypatch.setattr(installer, "database_path_from_url", lambda *_args: database)
    monkeypatch.setattr(installer, "is_service_active", lambda _name: True)
    monkeypatch.setattr(
        installer,
        "create_upgrade_backup",
        lambda *_args, **kwargs: safety_archive if kwargs["purpose"] == "rollback" else None,
    )
    monkeypatch.setattr(installer, "restore_upgrade_backup", lambda *_args: target_state)
    monkeypatch.setattr(installer, "atomic_symlink", lambda target_path, link: symlinks.append((target_path, link)))
    monkeypatch.setattr(installer, "write_json", lambda _path, value: written_states.append(value))
    monkeypatch.setattr(installer, "run", lambda command, **_kwargs: commands.append(command))
    monkeypatch.setattr(installer, "wait_for_health", lambda *_args: None)

    installer.rollback(
        argparse.Namespace(
            state_file=str(paths.state_file),
            lock_file=str(tmp_path / "installer.lock"),
            backup=None,
            yes=True,
            no_start=False,
            health_timeout=10,
        )
    )

    assert commands == [
        ["systemctl", "stop", paths.service_name],
        ["systemctl", "start", paths.service_name],
    ]
    assert symlinks == [(target_release, paths.current_link)]
    assert written_states[-1]["version"] == "1.0.9"
    assert written_states[-1]["rolled_back_from_version"] == "1.1.0"
    assert written_states[-1]["last_manual_rollback_backup"] == str(safety_archive)


def test_manual_rollback_health_failure_recovers_original_version(tmp_path: Path, monkeypatch):
    paths = install_paths(tmp_path)
    Path(paths.config_root).mkdir(parents=True)
    paths.config_file.write_text("DATABASE_URL=current\n", encoding="utf-8")
    current_release = paths.releases_root / "1.1.0"
    target_release = paths.releases_root / "1.0.9"
    current_release.mkdir(parents=True)
    target_release.mkdir(parents=True)
    database = Path(paths.data_root) / "licenses.db"
    database.parent.mkdir(parents=True)
    database.write_bytes(b"database")
    selected_archive = Path(paths.upgrade_backup_root) / "selected.tar.gz"
    safety_archive = Path(paths.upgrade_backup_root) / "safety.tar.gz"
    current_state = {
        "schema_version": 1,
        "version": "1.1.0",
        "release_path": str(current_release),
        "bind_host": "127.0.0.1",
        "port": 8000,
        **{field: getattr(paths, field) for field in installer.InstallPaths.__dataclass_fields__},
    }
    target_state = {**current_state, "version": "1.0.9", "release_path": str(target_release)}
    target = installer.RollbackTarget(selected_archive, target_state, target_release)
    restored_archives = []
    health_versions = []

    monkeypatch.setattr(installer, "require_supported_host", lambda: None)
    monkeypatch.setattr(installer, "installer_lock", lambda _path: nullcontext())
    monkeypatch.setattr(installer, "load_state", lambda _path: current_state)
    monkeypatch.setattr(installer, "resolve_rollback_archive", lambda *_args: selected_archive)
    monkeypatch.setattr(installer, "validate_rollback_target", lambda *_args: target)
    monkeypatch.setattr(installer, "confirm_manual_rollback", lambda *_args: None)
    monkeypatch.setattr(installer, "database_path_from_url", lambda *_args: database)
    monkeypatch.setattr(installer, "is_service_active", lambda _name: True)
    monkeypatch.setattr(installer, "create_upgrade_backup", lambda *_args, **_kwargs: safety_archive)

    def restore(archive, _paths):
        restored_archives.append(archive)
        return target_state if archive == selected_archive else current_state

    def health(_host, _port, version, _timeout):
        health_versions.append(version)
        if version == "1.0.9":
            raise installer.InstallerError("target unhealthy")

    monkeypatch.setattr(installer, "restore_upgrade_backup", restore)
    monkeypatch.setattr(installer, "atomic_symlink", lambda *_args: None)
    monkeypatch.setattr(installer, "write_json", lambda *_args: None)
    monkeypatch.setattr(installer, "run", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(installer.subprocess, "run", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(installer, "wait_for_health", health)

    with pytest.raises(installer.InstallerError, match="1.1.0 was restored successfully"):
        installer.rollback(
            argparse.Namespace(
                state_file=str(paths.state_file),
                lock_file=str(tmp_path / "installer.lock"),
                backup=None,
                yes=True,
                no_start=False,
                health_timeout=10,
            )
        )

    assert restored_archives == [selected_archive, safety_archive]
    assert health_versions == ["1.0.9", "1.1.0"]


@pytest.mark.skipif(os.name == "nt", reason="native ownership uses POSIX accounts")
def test_recursive_chown_accepts_supported_posix_api(tmp_path: Path):
    import grp
    import pwd

    child = tmp_path / "child.txt"
    child.write_text("owned", encoding="utf-8")
    account = pwd.getpwuid(os.getuid())
    group = grp.getgrgid(os.getgid())
    installer.recursive_chown(tmp_path, account.pw_name, group.gr_name)
    assert child.stat().st_uid == os.getuid()
    assert child.stat().st_gid == os.getgid()
