#!/usr/bin/env bash
set -euo pipefail

STATE_FILE="${1:-/etc/licensetrack/install.json}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this permission check as root." >&2
  exit 2
fi
if [[ ! -f "$STATE_FILE" ]]; then
  echo "Native installation state was not found: $STATE_FILE" >&2
  exit 2
fi
if ! command -v runuser >/dev/null 2>&1; then
  echo "runuser is required for the native permission check." >&2
  exit 2
fi

mapfile -t STATE_VALUES < <(python3 - "$STATE_FILE" <<'PY'
import json
from pathlib import Path
import sys

state = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
values = (
    state["service_user"],
    state["release_path"],
    state["data_root"],
    str(Path(state["config_root"]) / "licensetrack.env"),
    state["service_file"],
    state["cli_file"],
    state["upgrade_backup_root"],
)
for value in values:
    print(value)
PY
)

if [[ ${#STATE_VALUES[@]} -ne 7 ]]; then
  echo "Installation state did not contain the required permission paths." >&2
  exit 1
fi

SERVICE_USER="${STATE_VALUES[0]}"
RELEASE_PATH="${STATE_VALUES[1]}"
DATA_ROOT="${STATE_VALUES[2]}"
CONFIG_FILE="${STATE_VALUES[3]}"
SERVICE_FILE="${STATE_VALUES[4]}"
CLI_FILE="${STATE_VALUES[5]}"
UPGRADE_BACKUP_ROOT="${STATE_VALUES[6]}"

assert_service_cannot_write() {
  local path="$1"
  if runuser -u "$SERVICE_USER" -- test -w "$path"; then
    echo "Service account can unexpectedly write: $path" >&2
    exit 1
  fi
}

runuser -u "$SERVICE_USER" -- test -r "$CONFIG_FILE"
runuser -u "$SERVICE_USER" -- test -w "$DATA_ROOT"
assert_service_cannot_write "$RELEASE_PATH"
assert_service_cannot_write "$CONFIG_FILE"
assert_service_cannot_write "$SERVICE_FILE"
assert_service_cannot_write "$CLI_FILE"
assert_service_cannot_write "$UPGRADE_BACKUP_ROOT"

echo "Native permission contract passed for service account $SERVICE_USER."
