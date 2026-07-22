#!/usr/bin/env python3
"""Validate repository documentation links, ownership, and release references."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]
MARKDOWN_LINK = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")


def repository_files() -> list[Path]:
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode("utf-8").split("\0")
    untracked = subprocess.check_output(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd=ROOT
    ).decode("utf-8").split("\0")
    return sorted({ROOT / name for name in tracked + untracked if name and (ROOT / name).exists()})


def markdown_files() -> list[Path]:
    return [path for path in repository_files() if path.suffix.lower() == ".md"]


def link_target(raw_target: str) -> str:
    target = raw_target.strip()
    if target.startswith("<") and ">" in target:
        return target[1 : target.index(">")]
    return target.split(maxsplit=1)[0]


def check_relative_links() -> list[str]:
    errors: list[str] = []
    for document in markdown_files():
        text = document.read_text(encoding="utf-8")
        for match in MARKDOWN_LINK.finditer(text):
            target = link_target(match.group(1))
            if not target or target.startswith(("#", "http://", "https://", "mailto:", "data:")):
                continue
            relative_target = unquote(target.split("#", 1)[0])
            destination = (document.parent / relative_target).resolve()
            if destination.exists():
                continue
            line = text.count("\n", 0, match.start()) + 1
            display = document.relative_to(ROOT).as_posix()
            errors.append(f"{display}:{line}: missing relative link target {target}")
    return errors


def check_release_references() -> list[str]:
    errors: list[str] = []
    version_source = (ROOT / "backend" / "app" / "version.py").read_text(encoding="utf-8")
    match = re.search(r'APP_VERSION = "([^"]+)"', version_source)
    if match is None:
        return ["backend/app/version.py: APP_VERSION was not found"]
    version = match.group(1)

    package_version = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))["version"]
    if package_version != version:
        errors.append(f"frontend/package.json: version {package_version} does not match {version}")

    required_fragments = {
        "README.md": [f"Version {version}."],
        "docker-compose.yml": [f"image: license-lifecycle-system:{version}"],
        "wiki/getting-started/installation.md": [
            f"refs/tags/v{version}.zip",
            f"cd LicenseTrack-{version}",
        ],
        "wiki/operations/deployment.md": [f"license-lifecycle-system:{version}"],
        "wiki/operations/upgrade.md": [
            f'{{"status":"ok","version":"{version}"}}',
            f"license-lifecycle-system:{version}",
        ],
    }
    for name, fragments in required_fragments.items():
        text = (ROOT / name).read_text(encoding="utf-8")
        for fragment in fragments:
            if fragment not in text:
                errors.append(f"{name}: missing current release reference {fragment!r}")
    return errors


def check_help_ownership() -> list[str]:
    errors: list[str] = []
    help_dir = ROOT / "docs" / "in-app-help"
    mirrors = sorted(path.name for path in help_dir.glob("*.txt"))
    if mirrors:
        errors.append(f"docs/in-app-help: duplicate article mirrors remain: {', '.join(mirrors)}")

    readme = (help_dir / "README.md").read_text(encoding="utf-8")
    if "frontend/src/components/pages/HelpPage.jsx" not in readme:
        errors.append("docs/in-app-help/README.md: canonical HelpPage.jsx ownership is not documented")
    return errors


def main() -> int:
    errors = check_relative_links() + check_release_references() + check_help_ownership()
    if errors:
        print("Documentation checks failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print("Documentation checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
