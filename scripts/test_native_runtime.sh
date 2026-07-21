#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/extracted-native-bundle" >&2
  exit 2
fi

BUNDLE_ROOT="$(cd -- "$1" && pwd)"
source "$BUNDLE_ROOT/packaging/native/libexec/select_python.sh"
PYTHON_BIN="$(select_licensetrack_python "$BUNDLE_ROOT")"
PYTHON_ABI="$(licensetrack_python_abi "$PYTHON_BIN")"
TEST_PORT="${LT_NATIVE_TEST_PORT:-18080}"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/licensetrack-native-smoke.XXXXXX")"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/licensetrack-native-smoke.*)
      rm -rf -- "$TEST_ROOT"
      ;;
    *)
      echo "Refusing to remove unexpected smoke-test path: $TEST_ROOT" >&2
      ;;
  esac
}
trap cleanup EXIT

test -f "$BUNDLE_ROOT/manifest.json"
test -f "$BUNDLE_ROOT/payload/backend/requirements-runtime.txt"
test -f "$BUNDLE_ROOT/payload/backend/frontend/dist/index.html"

"$PYTHON_BIN" -m venv "$TEST_ROOT/venv"
PIP_COMMAND=("$TEST_ROOT/venv/bin/python" -m pip install)
if [[ -d "$BUNDLE_ROOT/wheelhouse" ]]; then
  SELECTED_WHEELHOUSE="$BUNDLE_ROOT/wheelhouse/$PYTHON_ABI"
  if [[ ! -d "$SELECTED_WHEELHOUSE" ]]; then
    echo "Bundle does not contain the selected $PYTHON_ABI wheelhouse." >&2
    exit 1
  fi
  PIP_COMMAND+=(--no-index --find-links "$SELECTED_WHEELHOUSE")
fi
PIP_COMMAND+=(--requirement "$BUNDLE_ROOT/payload/backend/requirements-runtime.txt")
"${PIP_COMMAND[@]}"

cp -a "$BUNDLE_ROOT/payload/backend" "$TEST_ROOT/backend"
mkdir -p "$TEST_ROOT/data/storage" "$TEST_ROOT/data/backups" "$TEST_ROOT/data/plugins"

export JWT_SECRET="native-smoke-test-secret-that-is-not-used-in-production"
export ADMIN_PASSWORD="native-smoke-test-password"
export DATABASE_URL="sqlite+aiosqlite:////${TEST_ROOT#/}/data/licenses.db"
export STORAGE_PATH="$TEST_ROOT/data/storage"
export BACKUP_LOCATION="$TEST_ROOT/data/backups"
export PLUGIN_STORAGE_PATH="$TEST_ROOT/data/plugins"
export PLUGIN_HOST_BASE_URL="http://127.0.0.1:$TEST_PORT"
export CORS_ORIGINS="http://127.0.0.1:$TEST_PORT"
export RESTART_AFTER_RESTORE="false"
export HOST="127.0.0.1"

cd "$TEST_ROOT/backend"
"$TEST_ROOT/venv/bin/python" -m uvicorn app.main:app \
  --host 127.0.0.1 --port "$TEST_PORT" --workers 1 \
  >"$TEST_ROOT/server.log" 2>&1 &
SERVER_PID=$!

for _attempt in $(seq 1 45); do
  if curl --fail --silent "http://127.0.0.1:$TEST_PORT/api/health" >"$TEST_ROOT/health.json"; then
    break
  fi
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    cat "$TEST_ROOT/server.log" >&2
    exit 1
  fi
  sleep 1
done

"$TEST_ROOT/venv/bin/python" - "$BUNDLE_ROOT/manifest.json" "$TEST_ROOT/health.json" <<'PY'
import json
from pathlib import Path
import sys

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
health = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
expected = {"status": "ok", "version": manifest["version"]}
if health != expected:
    raise SystemExit(f"Unexpected health response: {health!r}; expected {expected!r}")
PY

curl --fail --silent --show-error "http://127.0.0.1:$TEST_PORT/" | grep --quiet '<div id="root"></div>'
echo "Native runtime smoke test passed on port $TEST_PORT."
