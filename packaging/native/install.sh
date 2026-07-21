#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/libexec/select_python.sh"
PYTHON_BIN="$(select_licensetrack_python "$SOURCE_ROOT")"

exec "$PYTHON_BIN" "$SCRIPT_DIR/libexec/installer.py" install \
  --source-root "$SOURCE_ROOT" "$@"
