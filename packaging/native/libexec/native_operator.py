#!/usr/bin/env python3
"""Operator commands for a managed native LicenseTrack installation."""

from __future__ import annotations

import argparse
from datetime import datetime
import ipaddress
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from urllib.parse import urlparse
from urllib.request import urlopen
import zipfile

try:
    import pwd
except ImportError:  # pragma: no cover - importable for Windows-side unit tests
    pwd = None  # type: ignore[assignment]


PYTHON_METADATA_SCRIPT = """
import json
import sys
print(json.dumps({
    "python_implementation": sys.implementation.name,
    "python_version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
    "python_abi": f"cp{sys.version_info.major}{sys.version_info.minor}",
    "python_executable": sys.executable,
}))
"""


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] == '"':
            value = value[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        values[key.strip()] = value
    return values


def database_path(database_url: str, working_directory: Path) -> Path:
    for prefix in ("sqlite+aiosqlite:///", "sqlite:///"):
        if database_url.startswith(prefix):
            path = Path(database_url.removeprefix(prefix))
            return path.resolve() if path.is_absolute() else (working_directory / path).resolve()
    raise RuntimeError("Only file-backed SQLite databases are supported.")


def load(args: argparse.Namespace) -> tuple[dict, dict[str, str]]:
    state = json.loads(Path(args.state_file).read_text(encoding="utf-8"))
    environment = parse_env_file(Path(state["config_root"]) / "licensetrack.env")
    return state, environment


def command_version(args: argparse.Namespace) -> int:
    state, _environment = load(args)
    print(state["version"])
    return 0


def inspect_release_python(release: Path) -> tuple[dict[str, str] | None, str | None]:
    python = release / "venv" / "bin" / "python"
    if not python.is_file():
        return None, f"release Python is missing: {python}"
    try:
        result = subprocess.run(
            [python, "-c", PYTHON_METADATA_SCRIPT],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, f"release Python is not runnable: {exc}"
    if result.returncode != 0:
        detail = result.stderr.strip() or f"exit status {result.returncode}"
        return None, f"release Python is not runnable: {detail}"
    try:
        metadata = json.loads(result.stdout)
    except ValueError as exc:
        return None, f"release Python returned invalid metadata: {exc}"
    required = {"python_implementation", "python_version", "python_abi", "python_executable"}
    if not isinstance(metadata, dict) or not required <= metadata.keys():
        return None, "release Python returned incomplete metadata"
    return {key: str(metadata[key]) for key in required}, None


def runtime_state_problems(state: dict, runtime: dict[str, str]) -> list[str]:
    problems: list[str] = []
    state_implementation = state.get("python_implementation")
    if state_implementation and runtime["python_implementation"] != state_implementation:
        problems.append(
            f"active Python implementation {runtime['python_implementation']} does not match "
            f"installation state {state_implementation}"
        )
    state_abi = state.get("python_abi")
    if state_abi and runtime["python_abi"] != state_abi:
        problems.append(
            f"active Python ABI {runtime['python_abi']} does not match installation state {state_abi}"
        )
    return problems


def is_loopback_public_url(public_url: str) -> bool:
    hostname = urlparse(public_url).hostname
    if hostname is None:
        return False
    normalized = hostname.rstrip(".").casefold()
    if normalized == "localhost" or normalized.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


def network_diagnostics(
    state: dict,
    environment: dict[str, str],
) -> tuple[str, list[str], list[str]]:
    bind_host = str(state["bind_host"])
    port = int(state["port"])
    public_url = str(state.get("public_url") or environment.get("CORS_ORIGINS") or "").split(",", 1)[0].strip()
    if not public_url:
        return f"bind {bind_host}:{port}; public URL unavailable", [], []

    try:
        bind_is_loopback = ipaddress.ip_address(bind_host).is_loopback
    except ValueError:
        return (
            f"bind {bind_host}:{port}; public {public_url}",
            [f"bind address is not a numeric IPv4 or IPv6 address: {bind_host}"],
            [],
        )

    public_is_loopback = is_loopback_public_url(public_url)
    if bind_is_loopback and public_is_loopback:
        inferred_mode = "local-only"
        detail = "clients can connect only from this host"
    elif bind_is_loopback:
        inferred_mode = "reverse-proxy"
        detail = "an existing reverse proxy must forward the public URL to the loopback bind"
    elif not public_is_loopback:
        inferred_mode = "direct-network"
        detail = "host firewall rules control remote access"
    else:
        return (
            f"bind {bind_host}:{port}; public {public_url}",
            [],
            ["non-loopback bind address is paired with a localhost public URL"],
        )

    recorded_mode = state.get("network_mode")
    problems = []
    warnings = []
    if recorded_mode is not None and recorded_mode != inferred_mode:
        problems.append(
            f"recorded network mode {recorded_mode!r} does not match effective mode {inferred_mode!r}"
        )
    elif recorded_mode is None and inferred_mode == "reverse-proxy":
        warnings.append(
            "non-local public URL uses a loopback bind; confirm that a reverse proxy is configured"
        )

    summary = f"{inferred_mode}; bind {bind_host}:{port}; public {public_url}; {detail}"
    return summary, problems, warnings


def command_doctor(args: argparse.Namespace) -> int:
    state, environment = load(args)
    problems: list[str] = []
    warnings: list[str] = []
    release = Path(state["release_path"])
    if not release.is_dir():
        problems.append(f"release directory is missing: {release}")
    runtime, runtime_problem = inspect_release_python(release)
    if runtime_problem:
        problems.append(runtime_problem)
    elif runtime is not None:
        problems.extend(runtime_state_problems(state, runtime))
    if not Path(state["data_root"]).is_dir():
        problems.append(f"data directory is missing: {state['data_root']}")
    db_path = database_path(environment["DATABASE_URL"], release / "backend")
    if not db_path.is_file():
        problems.append(f"database is missing: {db_path}")
    service_result = subprocess.run(
        ["systemctl", "is-active", "--quiet", state["service_name"]],
        check=False,
    )
    if service_result.returncode != 0:
        problems.append(f"service is not active: {state['service_name']}")
    host = "127.0.0.1" if state["bind_host"] in {"0.0.0.0", "::"} else state["bind_host"]
    url = f"http://{host}:{state['port']}/api/health"
    try:
        with urlopen(url, timeout=5) as response:  # noqa: S310 - managed loopback address
            health = json.load(response)
        if health.get("status") != "ok" or health.get("version") != state["version"]:
            problems.append(f"unexpected health response: {health}")
    except Exception as exc:
        problems.append(f"health request failed: {exc}")

    network_summary, network_problems, network_warnings = network_diagnostics(state, environment)
    problems.extend(network_problems)
    warnings.extend(network_warnings)

    if problems:
        print("LicenseTrack doctor found problems:")
        for problem in problems:
            print(f"- {problem}")
        if warnings:
            print("LicenseTrack doctor warnings:")
            for warning in warnings:
                print(f"- {warning}")
        return 1
    if warnings:
        print("LicenseTrack doctor warnings:")
        for warning in warnings:
            print(f"- {warning}")
    runtime_label = (
        f"Python {runtime['python_version']} ({runtime['python_abi']})"
        if runtime is not None
        else "Python runtime unavailable"
    )
    print(f"LicenseTrack {state['version']} is healthy at {url}. {runtime_label}.")
    print(f"Network: {network_summary}.")
    return 0


def configured_backup_location(db_path: Path, default: str, working_directory: Path) -> Path:
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        row = connection.execute("SELECT backup_location FROM global_settings WHERE id = 1").fetchone()
    except sqlite3.DatabaseError:
        row = None
    finally:
        connection.close()
    configured = Path(str(row[0]) if row and row[0] else default)
    return configured.resolve() if configured.is_absolute() else (working_directory / configured).resolve()


def command_backup(args: argparse.Namespace) -> int:
    if pwd is None:
        raise RuntimeError("Native backups require POSIX account support.")
    state, environment = load(args)
    release = Path(state["release_path"])
    db_path = database_path(environment["DATABASE_URL"], release / "backend")
    backup_root = configured_backup_location(db_path, environment["BACKUP_LOCATION"], release / "backend")
    backup_root.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    archive = backup_root / f"license_lifecycle_backup_{timestamp}.zip"
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as temporary:
        snapshot = Path(temporary.name)
    try:
        source_connection = sqlite3.connect(db_path)
        destination_connection = sqlite3.connect(snapshot)
        try:
            source_connection.backup(destination_connection)
        finally:
            destination_connection.close()
            source_connection.close()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
            output.write(snapshot, arcname=db_path.name)
        with zipfile.ZipFile(archive) as verification:
            if verification.testzip() is not None:
                raise RuntimeError("Backup ZIP integrity verification failed.")
    finally:
        snapshot.unlink(missing_ok=True)

    service_account = pwd.getpwnam(state["service_user"])
    os.chown(archive, service_account.pw_uid, service_account.pw_gid)
    os.chmod(archive, 0o600)
    print(archive)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("doctor", "backup", "version"))
    parser.add_argument("--state-file", required=True)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    commands = {
        "doctor": command_doctor,
        "backup": command_backup,
        "version": command_version,
    }
    try:
        return commands[args.command](args)
    except Exception as exc:
        print(f"LicenseTrack {args.command} failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
