#!/usr/bin/env python3
"""Build a self-contained LicenseTrack native Linux release archive."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parents[1]
VERSION_RE = re.compile(r'^APP_VERSION\s*=\s*["\']([^"\']+)["\']', re.MULTILINE)
REQUIREMENT_RE = re.compile(
    r"^\s*([A-Za-z0-9_.-]+)(?:\[[^]]+\])?\s*==\s*([^\s;]+)\s*$"
)
SUPPORTED_PYTHON_ABIS = ("cp312", "cp313", "cp314")
SUPPORTED_PYTHON_RANGE = ">=3.12,<3.15"
NATIVE_MANIFEST_FORMAT = "licensetrack-native-v2"
IGNORED_NAMES = {
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "test-results",
}


def run(command: list[str], *, cwd: Path | None = None) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def version() -> str:
    content = (ROOT / "backend" / "app" / "version.py").read_text(encoding="utf-8")
    match = VERSION_RE.search(content)
    if not match:
        raise RuntimeError("Could not read APP_VERSION.")
    return match.group(1)


def normalize_distribution_name(value: str) -> str:
    return re.sub(r"[-_.]+", "-", value).lower()


def normalize_wheel_version(value: str) -> str:
    return value.replace("_", "-").lower()


def runtime_requirements() -> dict[str, str]:
    requirements_path = ROOT / "backend" / "requirements-runtime.txt"
    requirements: dict[str, str] = {}
    for line_number, raw_line in enumerate(requirements_path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = REQUIREMENT_RE.fullmatch(line)
        if not match:
            raise RuntimeError(
                f"Runtime requirement line {line_number} must be a direct == pin: {raw_line!r}"
            )
        name = normalize_distribution_name(match.group(1))
        requirements[name] = match.group(2)
    if not requirements:
        raise RuntimeError("Runtime requirements are empty.")
    return requirements


def wheel_inventory(wheelhouse: Path) -> dict[str, set[str]]:
    inventory: dict[str, set[str]] = {}
    for wheel in wheelhouse.glob("*.whl"):
        parts = wheel.name.split("-")
        if len(parts) < 5:
            continue
        name = normalize_distribution_name(parts[0])
        inventory.setdefault(name, set()).add(normalize_wheel_version(parts[1]))
    return inventory


def validate_wheelhouse(abi: str, wheelhouse: Path) -> None:
    if abi not in SUPPORTED_PYTHON_ABIS:
        raise RuntimeError(f"Unsupported Python ABI: {abi}")
    if not wheelhouse.is_dir():
        raise RuntimeError(f"Wheelhouse for {abi} was not found: {wheelhouse}")
    inventory = wheel_inventory(wheelhouse)
    if not inventory:
        raise RuntimeError(f"Wheelhouse for {abi} contains no wheel files: {wheelhouse}")

    missing = []
    for name, version_value in runtime_requirements().items():
        normalized_version = normalize_wheel_version(version_value)
        if normalized_version not in inventory.get(name, set()):
            missing.append(f"{name}=={version_value}")
    if missing:
        raise RuntimeError(
            f"Wheelhouse {abi} is missing pinned runtime wheels: {', '.join(sorted(missing))}"
        )


def parse_wheelhouse_arguments(values: list[str]) -> dict[str, Path]:
    wheelhouses: dict[str, Path] = {}
    for value in values:
        if "=" not in value:
            raise ValueError(f"Wheelhouse must use ABI=PATH syntax: {value!r}")
        abi, raw_path = value.split("=", 1)
        abi = abi.strip().lower()
        if abi not in SUPPORTED_PYTHON_ABIS:
            raise ValueError(f"Unsupported Python ABI: {abi}")
        if abi in wheelhouses:
            raise ValueError(f"Python ABI {abi} was provided more than once.")
        if not raw_path.strip():
            raise ValueError(f"Wheelhouse path is empty for {abi}.")
        wheelhouses[abi] = Path(raw_path).expanduser().resolve()
    return wheelhouses


def require_all_python_abis(wheelhouses: dict[str, Path]) -> None:
    missing = [abi for abi in SUPPORTED_PYTHON_ABIS if abi not in wheelhouses]
    if missing:
        raise RuntimeError(f"Full native release is missing Python ABIs: {', '.join(missing)}")


def current_python_abi() -> str:
    if platform.python_implementation() != "CPython":
        raise RuntimeError("Native release wheelhouses must be built with CPython.")
    abi = f"cp{sys.version_info.major}{sys.version_info.minor}"
    if abi not in SUPPORTED_PYTHON_ABIS:
        raise RuntimeError(
            "Native release wheelhouses require CPython 3.12, 3.13, or 3.14; "
            f"the current interpreter is {platform.python_version()}."
        )
    return abi


def download_current_wheelhouse(destination_root: Path) -> dict[str, Path]:
    if platform.system() != "Linux":
        raise RuntimeError(
            "--download-wheels must run on Linux so the native archive cannot accidentally contain "
            "wheels for another operating system."
        )
    abi = current_python_abi()
    wheelhouse = destination_root / abi
    wheelhouse.mkdir(parents=True)
    run(
        [
            os.fspath(Path(sys.executable)),
            "-m",
            "pip",
            "download",
            "--only-binary=:all:",
            "--dest",
            os.fspath(wheelhouse),
            "--requirement",
            os.fspath(ROOT / "backend" / "requirements-runtime.txt"),
        ]
    )
    validate_wheelhouse(abi, wheelhouse)
    return {abi: wheelhouse}


def ignore(_directory: str, names: list[str]) -> set[str]:
    return {
        name
        for name in names
        if name in IGNORED_NAMES or name.endswith((".pyc", ".pyo"))
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_frontend(skip_build: bool) -> Path:
    frontend = ROOT / "frontend"
    output = frontend / "dist"
    if not skip_build:
        run(["npm", "ci"], cwd=frontend)
        run(["npm", "run", "build"], cwd=frontend)
    if not (output / "index.html").is_file():
        raise RuntimeError("Compiled frontend was not found. Run without --skip-frontend-build.")
    return output


def assemble(
    stage: Path,
    frontend_dist: Path,
    release_version: str,
    wheelhouses: dict[str, Path],
) -> Path:
    for abi, wheelhouse in wheelhouses.items():
        validate_wheelhouse(abi, wheelhouse)

    architecture = platform.machine().lower().replace("amd64", "x86_64")
    stage.mkdir(parents=True, exist_ok=True)
    bundle = stage / f"licensetrack-native-{release_version}-linux-{architecture}"
    bundle.mkdir()

    for name in ("install.sh", "upgrade.sh", "LICENSE", "THIRD_PARTY_NOTICES.md"):
        shutil.copy2(ROOT / name, bundle / name)
    shutil.copytree(ROOT / "packaging" / "native", bundle / "packaging" / "native", ignore=ignore)

    backend_target = bundle / "payload" / "backend"
    shutil.copytree(ROOT / "backend", backend_target, ignore=ignore)
    tests = backend_target / "tests"
    if tests.exists():
        shutil.rmtree(tests)
    full_requirements = backend_target / "requirements.txt"
    full_requirements.unlink(missing_ok=True)
    shutil.copytree(frontend_dist, backend_target / "frontend" / "dist")

    source_version = version()
    if release_version != source_version:
        version_file = backend_target / "app" / "version.py"
        with version_file.open("w", encoding="utf-8", newline="\n") as output:
            output.write(f'APP_VERSION = "{release_version}"\n')
        for asset in (backend_target / "frontend" / "dist").rglob("*"):
            if asset.is_file() and asset.suffix in {".html", ".js", ".css"}:
                content = asset.read_text(encoding="utf-8")
                if source_version in content:
                    with asset.open("w", encoding="utf-8", newline="\n") as output:
                        output.write(content.replace(source_version, release_version))

    if wheelhouses:
        wheelhouse_root = bundle / "wheelhouse"
        wheelhouse_root.mkdir()
        for abi in SUPPORTED_PYTHON_ABIS:
            source = wheelhouses.get(abi)
            if source is not None:
                shutil.copytree(source, wheelhouse_root / abi)

    files = {
        path.relative_to(bundle).as_posix(): sha256(path)
        for path in sorted(bundle.rglob("*"))
        if path.is_file()
    }
    manifest = {
        "format": NATIVE_MANIFEST_FORMAT,
        "version": release_version,
        "platform": "linux",
        "architecture": architecture,
        "python": SUPPORTED_PYTHON_RANGE,
        "python_implementation": "cpython",
        "python_abis": [abi for abi in SUPPORTED_PYTHON_ABIS if abi in wheelhouses],
        "built_at": datetime.now(timezone.utc).isoformat(),
        "files": files,
    }
    (bundle / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return bundle


def make_archives(bundle: Path, output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    tar_path = output_dir / f"{bundle.name}.tar.gz"
    zip_path = output_dir / f"{bundle.name}.zip"
    def normalized_tar_info(info: tarfile.TarInfo) -> tarfile.TarInfo:
        info.uid = 0
        info.gid = 0
        info.uname = "root"
        info.gname = "root"
        info.mtime = int(os.environ.get("SOURCE_DATE_EPOCH", "0"))
        suffix = Path(info.name).suffix
        info.mode = 0o755 if info.isdir() or suffix in {".sh", ".py"} else 0o644
        return info

    with tarfile.open(tar_path, "w:gz") as archive:
        archive.add(bundle, arcname=bundle.name, filter=normalized_tar_info)
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(bundle.rglob("*")):
            if path.is_file():
                archive_name = (Path(bundle.name) / path.relative_to(bundle)).as_posix()
                file_info = zipfile.ZipInfo(archive_name)
                file_info.create_system = 3
                file_info.compress_type = zipfile.ZIP_DEFLATED
                mode = 0o755 if path.suffix in {".sh", ".py"} else 0o644
                file_info.external_attr = (0o100000 | mode) << 16
                file_info.date_time = (1980, 1, 1, 0, 0, 0)
                archive.writestr(file_info, path.read_bytes())
    return [tar_path, zip_path]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default=os.fspath(ROOT / "dist" / "native"))
    parser.add_argument("--skip-frontend-build", action="store_true")
    wheelhouse_group = parser.add_mutually_exclusive_group()
    wheelhouse_group.add_argument(
        "--download-wheels",
        action="store_true",
        help="On Linux, download wheels for the executing supported CPython ABI.",
    )
    wheelhouse_group.add_argument(
        "--wheelhouse",
        action="append",
        default=[],
        metavar="ABI=PATH",
        help="Include a prepared ABI wheelhouse; repeat for cp312, cp313, and cp314.",
    )
    parser.add_argument(
        "--require-all-python-abis",
        action="store_true",
        help="Refuse the build unless cp312, cp313, and cp314 wheelhouses are supplied.",
    )
    parser.add_argument(
        "--version-override",
        help="Build a non-release version for install/upgrade testing without changing tracked version files.",
    )
    args = parser.parse_args()

    release_version = args.version_override or version()
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", release_version):
        parser.error("--version-override must be a semantic version without a leading v")

    with tempfile.TemporaryDirectory(prefix="licensetrack-native-build-") as temp_name:
        temporary_root = Path(temp_name)
        try:
            if args.download_wheels:
                wheelhouses = download_current_wheelhouse(temporary_root / "prepared-wheelhouses")
            else:
                wheelhouses = parse_wheelhouse_arguments(args.wheelhouse)
                for abi, wheelhouse in wheelhouses.items():
                    validate_wheelhouse(abi, wheelhouse)
            if args.require_all_python_abis:
                require_all_python_abis(wheelhouses)
        except (RuntimeError, ValueError) as exc:
            parser.error(str(exc))

        frontend_dist = build_frontend(args.skip_frontend_build)
        bundle = assemble(temporary_root / "bundle", frontend_dist, release_version, wheelhouses)
        archives = make_archives(bundle, Path(args.output_dir).resolve())

    checksum_path = Path(args.output_dir).resolve() / "SHA256SUMS"
    with checksum_path.open("w", encoding="utf-8", newline="\n") as checksum_file:
        checksum_file.write("".join(f"{sha256(path)}  {path.name}\n" for path in archives))
    for path in [*archives, checksum_path]:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
