#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3.12}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "LicenseTrack native installation requires Python 3.12 with venv support." >&2
  echo "Install python3.12 and python3.12-venv, then run this script again." >&2
  exit 1
fi

exec "$PYTHON_BIN" "$SCRIPT_DIR/libexec/installer.py" install \
  --source-root "$SOURCE_ROOT" "$@"
