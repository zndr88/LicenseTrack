#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/native-build-output" >&2
  exit 2
fi

OUTPUT_DIR="$(cd -- "$1" && pwd)"
shopt -s nullglob
TARBALLS=("$OUTPUT_DIR"/*.tar.gz)
ZIPFILES=("$OUTPUT_DIR"/*.zip)
if [[ ${#TARBALLS[@]} -ne 1 || ${#ZIPFILES[@]} -ne 1 ]]; then
  echo "Expected exactly one native tar archive and one native zip archive." >&2
  exit 1
fi

(cd "$OUTPUT_DIR" && sha256sum --check SHA256SUMS)
unzip -t "${ZIPFILES[0]}" >/dev/null

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/licensetrack-native-structure.XXXXXX")"
cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/licensetrack-native-structure.*)
      rm -rf -- "$TEST_ROOT"
      ;;
    *)
      echo "Refusing to remove unexpected structure-test path: $TEST_ROOT" >&2
      ;;
  esac
}
trap cleanup EXIT

tar -xzf "${TARBALLS[0]}" -C "$TEST_ROOT"
BUNDLE_DIRS=("$TEST_ROOT"/licensetrack-native-*)
if [[ ${#BUNDLE_DIRS[@]} -ne 1 || ! -d "${BUNDLE_DIRS[0]}" ]]; then
  echo "Expected exactly one extracted native bundle directory." >&2
  exit 1
fi

bash "${BUNDLE_DIRS[0]}/install.sh" --verify-only
echo "Native bundle structure verification passed."
