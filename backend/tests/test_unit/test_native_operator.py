from __future__ import annotations

import argparse
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[3]
OPERATOR_PATH = ROOT / "packaging" / "native" / "libexec" / "native_operator.py"
SPEC = importlib.util.spec_from_file_location("licensetrack_native_operator", OPERATOR_PATH)
assert SPEC is not None and SPEC.loader is not None
operator = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = operator
SPEC.loader.exec_module(operator)


def test_inspect_release_python_reports_active_venv_runtime(tmp_path: Path, monkeypatch):
    release = tmp_path / "release"
    python = release / "venv" / "bin" / "python"
    python.parent.mkdir(parents=True)
    python.write_text("placeholder", encoding="utf-8")
    payload = {
        "python_implementation": "cpython",
        "python_version": "3.14.4",
        "python_abi": "cp314",
        "python_executable": str(python),
    }
    monkeypatch.setattr(
        operator.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0, json.dumps(payload), ""),
    )

    runtime, problem = operator.inspect_release_python(release)

    assert problem is None
    assert runtime == payload


def test_inspect_release_python_reports_missing_runtime(tmp_path: Path):
    runtime, problem = operator.inspect_release_python(tmp_path / "release")

    assert runtime is None
    assert problem is not None and "release Python is missing" in problem


def test_doctor_accepts_legacy_state_and_reports_active_python(tmp_path: Path, monkeypatch, capsys):
    release = tmp_path / "release"
    release.mkdir()
    data_root = tmp_path / "data"
    data_root.mkdir()
    database = data_root / "licenses.db"
    database.write_bytes(b"database-placeholder")
    config_root = tmp_path / "config"
    config_root.mkdir()
    (config_root / "licensetrack.env").write_text(
        f"DATABASE_URL=sqlite+aiosqlite:///{database.as_posix()}\n",
        encoding="utf-8",
    )
    state = {
        "schema_version": 1,
        "version": "1.0.9",
        "release_path": str(release),
        "data_root": str(data_root),
        "config_root": str(config_root),
        "service_name": "licensetrack.service",
        "bind_host": "127.0.0.1",
        "port": 8000,
    }
    state_path = config_root / "install.json"
    state_path.write_text(json.dumps(state), encoding="utf-8")
    runtime = {
        "python_implementation": "cpython",
        "python_version": "3.14.4",
        "python_abi": "cp314",
        "python_executable": str(release / "venv" / "bin" / "python"),
    }
    monkeypatch.setattr(operator, "inspect_release_python", lambda _release: (runtime, None))
    monkeypatch.setattr(
        operator.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0),
    )
    monkeypatch.setattr(
        operator,
        "urlopen",
        lambda *args, **kwargs: io.BytesIO(b'{"status":"ok","version":"1.0.9"}'),
    )

    result = operator.command_doctor(argparse.Namespace(state_file=str(state_path)))

    assert result == 0
    assert "Python 3.14.4 (cp314)" in capsys.readouterr().out


def test_runtime_state_problems_detects_abi_mismatch():
    state = {"python_implementation": "cpython", "python_abi": "cp312"}
    runtime = {"python_implementation": "cpython", "python_abi": "cp314"}

    assert operator.runtime_state_problems(state, runtime) == [
        "active Python ABI cp314 does not match installation state cp312"
    ]


def test_network_diagnostics_warns_for_legacy_reverse_proxy_state():
    state = {
        "bind_host": "127.0.0.1",
        "port": 8000,
    }
    environment = {"CORS_ORIGINS": "https://licenses.example.test"}

    summary, problems, warnings = operator.network_diagnostics(state, environment)

    assert "reverse-proxy" in summary
    assert problems == []
    assert warnings == [
        "non-local public URL uses a loopback bind; confirm that a reverse proxy is configured"
    ]


def test_network_diagnostics_accepts_confirmed_reverse_proxy_state():
    state = {
        "bind_host": "127.0.0.1",
        "port": 8000,
        "network_mode": "reverse-proxy",
        "public_url": "https://licenses.example.test",
    }

    summary, problems, warnings = operator.network_diagnostics(state, {})

    assert "reverse proxy must forward" in summary
    assert problems == []
    assert warnings == []


def test_network_diagnostics_reports_recorded_mode_mismatch():
    state = {
        "bind_host": "0.0.0.0",
        "port": 8000,
        "network_mode": "reverse-proxy",
        "public_url": "http://192.168.0.247:8000",
    }

    summary, problems, warnings = operator.network_diagnostics(state, {})

    assert "direct-network" in summary
    assert problems == [
        "recorded network mode 'reverse-proxy' does not match effective mode 'direct-network'"
    ]
    assert warnings == []
