#!/usr/bin/env bash

# Shared interpreter selection for the native install and upgrade entrypoints.
# This file is sourced; it intentionally does not change the caller's shell options.

licensetrack_python_abi() {
  local candidate="$1"
  "$candidate" -c '
import sys
if sys.implementation.name != "cpython":
    raise SystemExit(2)
version = (sys.version_info.major, sys.version_info.minor)
if version not in {(3, 12), (3, 13), (3, 14)}:
    raise SystemExit(3)
import ensurepip
import venv
print(f"cp{version[0]}{version[1]}")
' 2>/dev/null
}

select_licensetrack_python() {
  local source_root="$1"
  local wheelhouse_root="$source_root/wheelhouse"
  local explicit="${PYTHON_BIN:-}"
  local candidate abi
  local -a candidates=()
  local -a detected=()

  if [[ -n "$explicit" ]]; then
    candidates=("$explicit")
  else
    candidates=(python3 python3.14 python3.13 python3.12)
  fi

  for candidate in "${candidates[@]}"; do
    if ! command -v "$candidate" >/dev/null 2>&1; then
      detected+=("$candidate: not found")
      continue
    fi
    if ! abi="$(licensetrack_python_abi "$candidate")"; then
      detected+=("$candidate: unsupported or missing venv support")
      continue
    fi
    if [[ -d "$wheelhouse_root" && ! -d "$wheelhouse_root/$abi" ]]; then
      detected+=("$candidate: $abi wheelhouse not included")
      continue
    fi
    printf '%s\n' "$candidate"
    return 0
  done

  echo "[LicenseTrack] ERROR: No compatible native Python interpreter was found." >&2
  echo "[LicenseTrack] LicenseTrack requires CPython 3.12, 3.13, or 3.14 with venv support." >&2
  if [[ -n "$explicit" ]]; then
    echo "[LicenseTrack] PYTHON_BIN was set to: $explicit" >&2
  fi
  if [[ -d "$wheelhouse_root" ]]; then
    local -a included=()
    for abi in cp312 cp313 cp314; do
      [[ -d "$wheelhouse_root/$abi" ]] && included+=("$abi")
    done
    echo "[LicenseTrack] Bundle wheelhouses: ${included[*]:-none}" >&2
  fi
  for candidate in "${detected[@]}"; do
    echo "[LicenseTrack] - $candidate" >&2
  done
  echo "[LicenseTrack] Install your distribution's Python and venv packages; do not replace /usr/bin/python3." >&2
  return 1
}
