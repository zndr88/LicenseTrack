#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3.12}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "LicenseTrack native upgrades require Python 3.12." >&2
  exit 1
fi

exec "$PYTHON_BIN" "$SCRIPT_DIR/libexec/installer.py" upgrade \
  --source-root "$SOURCE_ROOT" "$@"
