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
import tarfile
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parents[1]
VERSION_RE = re.compile(r'^APP_VERSION\s*=\s*["\']([^"\']+)["\']', re.MULTILINE)
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


def assemble(stage: Path, frontend_dist: Path, include_wheels: bool, release_version: str) -> Path:
    architecture = platform.machine().lower().replace("amd64", "x86_64")
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

    if include_wheels:
        wheelhouse = bundle / "wheelhouse"
        wheelhouse.mkdir()
        run(
            [
                os.fspath(Path(os.sys.executable)),
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

    files = {
        path.relative_to(bundle).as_posix(): sha256(path)
        for path in sorted(bundle.rglob("*"))
        if path.is_file()
    }
    manifest = {
        "format": "licensetrack-native-v1",
        "version": release_version,
        "platform": "linux",
        "architecture": architecture,
        "python": ">=3.12,<3.13",
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
    parser.add_argument("--download-wheels", action="store_true")
    parser.add_argument(
        "--version-override",
        help="Build a non-release version for install/upgrade testing without changing tracked version files.",
    )
    args = parser.parse_args()

    release_version = args.version_override or version()
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", release_version):
        parser.error("--version-override must be a semantic version without a leading v")

    with tempfile.TemporaryDirectory(prefix="licensetrack-native-build-") as temp_name:
        frontend_dist = build_frontend(args.skip_frontend_build)
        bundle = assemble(Path(temp_name), frontend_dist, args.download_wheels, release_version)
        archives = make_archives(bundle, Path(args.output_dir).resolve())

    checksum_path = Path(args.output_dir).resolve() / "SHA256SUMS"
    with checksum_path.open("w", encoding="utf-8", newline="\n") as checksum_file:
        checksum_file.write("".join(f"{sha256(path)}  {path.name}\n" for path in archives))
    for path in [*archives, checksum_path]:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
