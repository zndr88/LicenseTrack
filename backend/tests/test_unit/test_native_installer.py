from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys

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
    assert args.expose_api_docs is False
    assert args.allow_http_oidc_discovery is False
    assert args.allow_private_oidc_discovery is False
    assert args.session_cookie_secure is False


def test_install_state_records_runtime_metadata(tmp_path: Path, monkeypatch):
    paths = install_paths(tmp_path)
    args = configuration_args()
    metadata = {
        "python_implementation": "cpython",
        "python_version": "3.14.4",
        "python_abi": "cp314",
        "python_executable": "/usr/bin/python3",
    }
    monkeypatch.setattr(installer, "python_runtime_metadata", lambda: metadata)

    state = installer.state_from_install("1.1.0", tmp_path / "release", paths, args)

    assert {key: state[key] for key in metadata} == metadata


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
    assert "native/libexec/native_operator.py" in cli


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
    restored = sqlite3.connect(db_path)
    try:
        assert restored.execute("SELECT value FROM records").fetchone() == ("before",)
    finally:
        restored.close()


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
