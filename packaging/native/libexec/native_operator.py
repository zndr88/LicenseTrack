#!/usr/bin/env python3
"""Operator commands for a managed native LicenseTrack installation."""

from __future__ import annotations

import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import pwd
import sqlite3
import subprocess
import sys
import tempfile
from urllib.request import urlopen
import zipfile


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


def command_doctor(args: argparse.Namespace) -> int:
    state, environment = load(args)
    problems: list[str] = []
    release = Path(state["release_path"])
    if not release.is_dir():
        problems.append(f"release directory is missing: {release}")
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

    if problems:
        print("LicenseTrack doctor found problems:")
        for problem in problems:
            print(f"- {problem}")
        return 1
    print(f"LicenseTrack {state['version']} is healthy at {url}.")
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
