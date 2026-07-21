#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 || $# -gt 4 ]]; then
  echo "Usage: $0 SOURCE_ROOT PYTHON_BIN EXPECTED_ABI [UNSUPPORTED_PYTHON_BIN]" >&2
  exit 2
fi

SOURCE_ROOT="$(cd -- "$1" && pwd)"
EXPECTED_PYTHON="$2"
EXPECTED_ABI="$3"
UNSUPPORTED_PYTHON="${4:-}"

source "$SOURCE_ROOT/packaging/native/libexec/select_python.sh"

PYTHON_BIN="$EXPECTED_PYTHON"
selected="$(select_licensetrack_python "$SOURCE_ROOT")"
if [[ "$selected" != "$EXPECTED_PYTHON" ]]; then
  echo "Selector returned $selected; expected $EXPECTED_PYTHON." >&2
  exit 1
fi
actual_abi="$(licensetrack_python_abi "$selected")"
if [[ "$actual_abi" != "$EXPECTED_ABI" ]]; then
  echo "Selector reported $actual_abi; expected $EXPECTED_ABI." >&2
  exit 1
fi

if [[ -n "$UNSUPPORTED_PYTHON" ]]; then
  PYTHON_BIN="$UNSUPPORTED_PYTHON"
  if select_licensetrack_python "$SOURCE_ROOT" >/dev/null 2>&1; then
    echo "Selector accepted unsupported interpreter $UNSUPPORTED_PYTHON." >&2
    exit 1
  fi
fi

echo "Native Python selector accepted $EXPECTED_ABI and enforced the supported range."
