"""Unit tests for the native Linux release builder."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest


ROOT = Path(__file__).resolve().parents[3]
BUILDER_PATH = ROOT / "scripts" / "build_native_release.py"
SPEC = importlib.util.spec_from_file_location("licensetrack_native_release_builder", BUILDER_PATH)
assert SPEC and SPEC.loader
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


def _fake_repository(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path]:
    root = tmp_path / "repo"
    (root / "packaging" / "native").mkdir(parents=True)
    (root / "packaging" / "native" / "marker.txt").write_text("native", encoding="utf-8")
    (root / "backend" / "app").mkdir(parents=True)
    (root / "backend" / "app" / "version.py").write_text('APP_VERSION = "1.0.9"\n', encoding="utf-8")
    (root / "backend" / "alembic" / "versions").mkdir(parents=True)
    (root / "backend" / "alembic" / "env.py").write_text("# migration environment\n", encoding="utf-8")
    (root / "backend" / "alembic.ini").write_text("[alembic]\n", encoding="utf-8")
    requirements = "alpha==1.0\nbravo-package[asyncio]==2.0\n"
    (root / "backend" / "requirements-runtime.txt").write_text(requirements, encoding="utf-8")
    (root / "backend" / "requirements.txt").write_text(requirements + "pytest==9.1.1\n", encoding="utf-8")
    (root / "backend" / "tests").mkdir()
    (root / "backend" / "tests" / "not-packaged.txt").write_text("test", encoding="utf-8")
    (root / "backend" / ".env").write_text("JWT_SECRET=local-secret\n", encoding="utf-8")
    (root / "backend" / ".coverage").write_text("local coverage\n", encoding="utf-8")
    (root / "backend" / "licenses.db").write_bytes(b"local database")
    (root / "backend" / "backups").mkdir()
    (root / "backend" / "backups" / "local.zip").write_bytes(b"local backup")
    (root / "backend" / "storage").mkdir()
    (root / "backend" / "storage" / "document.pdf").write_bytes(b"local document")
    (root / "backend" / "plugins").mkdir()
    (root / "backend" / "plugins" / "local-package.zip").write_bytes(b"local plugin")
    for name in ("install.sh", "upgrade.sh", "LICENSE", "THIRD_PARTY_NOTICES.md"):
        (root / name).write_text(name, encoding="utf-8")

    frontend = root / "frontend" / "dist"
    frontend.mkdir(parents=True)
    (frontend / "index.html").write_text("<div>1.0.9</div>", encoding="utf-8")

    monkeypatch.setattr(builder, "ROOT", root)
    monkeypatch.setattr(builder.platform, "machine", lambda: "x86_64")
    return root, frontend


def _complete_wheelhouse(parent: Path, abi: str) -> Path:
    wheelhouse = parent / abi
    wheelhouse.mkdir(parents=True)
    (wheelhouse / "alpha-1.0-py3-none-any.whl").write_bytes(b"alpha")
    (wheelhouse / "bravo_package-2.0-py3-none-any.whl").write_bytes(b"bravo")
    return wheelhouse


def test_run_resolves_platform_command_shims(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    calls: list[tuple[list[str], Path | None, bool]] = []
    monkeypatch.setattr(builder.shutil, "which", lambda command: f"/resolved/{command}")
    monkeypatch.setattr(
        builder.subprocess,
        "run",
        lambda command, *, cwd, check: calls.append((command, cwd, check)),
    )

    builder.run(["npm", "ci"], cwd=tmp_path)

    assert calls == [(["/resolved/npm", "ci"], tmp_path, True)]


def test_validate_wheelhouse_rejects_missing_direct_requirement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    _fake_repository(tmp_path, monkeypatch)
    wheelhouse = tmp_path / "cp312"
    wheelhouse.mkdir()
    (wheelhouse / "alpha-1.0-py3-none-any.whl").write_bytes(b"alpha")

    with pytest.raises(RuntimeError, match="bravo-package"):
        builder.validate_wheelhouse("cp312", wheelhouse)


def test_validate_wheelhouse_rejects_wrong_pinned_version(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    _fake_repository(tmp_path, monkeypatch)
    wheelhouse = _complete_wheelhouse(tmp_path, "cp312")
    (wheelhouse / "bravo_package-2.0-py3-none-any.whl").unlink()
    (wheelhouse / "bravo_package-1.9-py3-none-any.whl").write_bytes(b"old")

    with pytest.raises(RuntimeError, match="bravo-package==2.0"):
        builder.validate_wheelhouse("cp312", wheelhouse)


def test_parse_wheelhouse_arguments_rejects_unsupported_and_duplicate_abis(tmp_path: Path):
    cp312 = tmp_path / "cp312"
    cp312.mkdir()

    with pytest.raises(ValueError, match="Unsupported Python ABI"):
        builder.parse_wheelhouse_arguments([f"cp311={cp312}"])
    with pytest.raises(ValueError, match="more than once"):
        builder.parse_wheelhouse_arguments([f"cp312={cp312}", f"cp312={cp312}"])


def test_require_all_python_abis_rejects_partial_input(tmp_path: Path):
    cp312 = tmp_path / "cp312"
    cp312.mkdir()

    with pytest.raises(RuntimeError, match="cp313, cp314"):
        builder.require_all_python_abis({"cp312": cp312})


def test_current_python_abi_accepts_supported_cpython_and_rejects_other_runtimes(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(builder.platform, "python_implementation", lambda: "CPython")
    monkeypatch.setattr(builder.sys, "version_info", SimpleNamespace(major=3, minor=13))
    assert builder.current_python_abi() == "cp313"

    monkeypatch.setattr(builder.sys, "version_info", SimpleNamespace(major=3, minor=15))
    with pytest.raises(RuntimeError, match="3.12, 3.13, or 3.14"):
        builder.current_python_abi()

    monkeypatch.setattr(builder.platform, "python_implementation", lambda: "PyPy")
    with pytest.raises(RuntimeError, match="CPython"):
        builder.current_python_abi()


def test_download_current_wheelhouse_refuses_non_linux(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setattr(builder.platform, "system", lambda: "Windows")

    with pytest.raises(RuntimeError, match="must run on Linux"):
        builder.download_current_wheelhouse(tmp_path)


def test_assemble_writes_v2_manifest_and_nested_wheelhouses(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    _root, frontend = _fake_repository(tmp_path, monkeypatch)
    prepared = tmp_path / "prepared"
    wheelhouses = {
        abi: _complete_wheelhouse(prepared, abi)
        for abi in builder.SUPPORTED_PYTHON_ABIS
    }

    bundle = builder.assemble(tmp_path / "stage", frontend, "1.1.0-test", wheelhouses)

    assert bundle.name == "licensetrack-native-1.1.0-test-linux-x86_64"
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["format"] == "licensetrack-native-v2"
    assert manifest["python"] == ">=3.12,<3.15"
    assert manifest["python_implementation"] == "cpython"
    assert manifest["python_abis"] == ["cp312", "cp313", "cp314"]
    for abi in builder.SUPPORTED_PYTHON_ABIS:
        relative = f"wheelhouse/{abi}/alpha-1.0-py3-none-any.whl"
        assert (bundle / relative).is_file()
        assert manifest["files"][relative] == builder.sha256(bundle / relative)
    assert not (bundle / "payload" / "backend" / "requirements.txt").exists()
    assert not (bundle / "payload" / "backend" / "tests").exists()
    for local_artifact in (
        ".coverage",
        ".env",
        "backups",
        "licenses.db",
        "plugins",
        "storage",
    ):
        assert not (bundle / "payload" / "backend" / local_artifact).exists()


def test_assemble_rejects_demo_frontend_bundle(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    _root, frontend = _fake_repository(tmp_path, monkeypatch)
    assets = frontend / "assets"
    assets.mkdir()
    (assets / "app.js").write_text(
        'console.info("LICENSETRACK_DEMO_MARKER");',
        encoding="utf-8",
    )

    with pytest.raises(RuntimeError, match="demo frontend"):
        builder.assemble(tmp_path / "stage", frontend, "1.1.0-test", {})


def test_archive_names_remain_operator_facing_and_stable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    _root, frontend = _fake_repository(tmp_path, monkeypatch)
    bundle = builder.assemble(tmp_path / "stage", frontend, "1.1.0-test", {})

    archives = builder.make_archives(bundle, tmp_path / "output")

    assert [archive.name for archive in archives] == [
        "licensetrack-native-1.1.0-test-linux-x86_64.tar.gz",
        "licensetrack-native-1.1.0-test-linux-x86_64.zip",
    ]
