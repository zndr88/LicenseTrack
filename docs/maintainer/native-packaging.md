# Native Linux packaging

Native packaging supports systemd-based Ubuntu 22.04 hosts with Python 3.12. It is intentionally separate from Docker packaging.

## Build

From the repository root on Linux, build a local single-ABI bundle with the
executing supported CPython interpreter:

```bash
python scripts/build_native_release.py --download-wheels
```

`--download-wheels` accepts CPython 3.12, 3.13, or 3.14 and writes the resolved
wheels under the matching `wheelhouse/cpXY` directory. It deliberately refuses
to download native-release wheels on non-Linux hosts.

Assemble a full-range bundle from wheelhouses prepared under their matching
interpreters:

```bash
python scripts/build_native_release.py \
  --wheelhouse cp312=/path/to/cp312 \
  --wheelhouse cp313=/path/to/cp313 \
  --wheelhouse cp314=/path/to/cp314 \
  --require-all-python-abis
```

The builder validates that each supplied wheelhouse contains every exact direct
pin from `backend/requirements-runtime.txt`. A full-range build fails unless all
three ABI directories are present. It then runs `npm ci` and the production
frontend build, assembles a backend-only runtime payload, writes a v2 per-file
SHA-256 manifest, and creates `.tar.gz` and `.zip` archives plus `SHA256SUMS`
under `dist/native`. Public archive names remain independent of the ABI because
one full release archive carries all supported wheelhouses.

The v2 bundle layout is:

```text
wheelhouse/
  cp312/
  cp313/
  cp314/
```

A local single-ABI bundle lists only its included ABI in `manifest.json`. The
official release bundle must list all three. The runtime smoke matrix remains
responsible for proving that the complete transitive wheel set installs under
each matching interpreter.

The tag workflow currently verifies that `v<git-tag>` matches
`backend/app/version.py`, builds the x86_64 bundle on Ubuntu 22.04, stores it as
a workflow artifact, and attaches it to the GitHub release. It must be converted
to the multi-interpreter wheelhouse/assembly/smoke pipeline before the expanded
Python support is released.

## Installer boundaries

- `install.sh` and `upgrade.sh` are small Bash entrypoints.
- `packaging/native/libexec/select_python.sh` discovers the distribution's supported CPython interpreter, honors an explicit `PYTHON_BIN`, verifies venv support, and rejects an offline bundle that lacks the selected ABI.
- `packaging/native/libexec/installer.py` owns manifest/runtime compatibility validation, staging, configuration, service installation, backups, migrations, health checks, and rollback.
- Compatibility validation accepts exactly CPython 3.12, 3.13, and 3.14. For manifest v2 bundles it checks Linux/x86_64, the declared Python range, included ABI directories, and checksum coverage before any host mutation.
- A fresh install defaults to Standard mode. Advanced mode changes only the initial questionnaire and the resulting protected environment; it does not create a separate installation layout or upgrade path.
- Every Advanced questionnaire value has a non-interactive CLI equivalent. `--yes` must never cause a prompt and defaults to Standard unless `--advanced` is explicit.
- SMTP and OIDC client credentials are application-managed encrypted settings. Do not add secret-bearing installer command-line flags; only deployment-level OIDC network allowances belong in the native environment.
- `packaging/native/libexec/native_operator.py` owns `doctor`, `backup`, and `version` commands used by the installed wrapper.
- New installation state records the selected Python implementation, version, ABI, and executable without changing state schema version 1. Upgrades accept older state without those optional keys. `licensetrack doctor` inspects the active release venv and reports missing, broken, or ABI-mismatched runtimes.
- `backend/requirements-runtime.txt` contains production dependencies only. Keep every entry pinned and aligned with the corresponding entry in `backend/requirements.txt`.
- Native releases are immutable under `/opt/licensetrack/releases`; mutable state belongs under `/var/lib/licensetrack` and `/etc/licensetrack`.

Never make the installer parse configuration by sourcing it as shell code. Never use Alembic downgrade as the automatic rollback mechanism. A rollback restores the matched application release, data snapshot, and configuration together.

## Verification

Run the focused tests and build smoke check:

```bash
cd backend
python -m pytest tests/test_unit/test_native_installer.py
cd ..
bash -n install.sh upgrade.sh packaging/native/install.sh packaging/native/upgrade.sh
bash scripts/test_native_python_selector.sh . "$(command -v python3)" cpXY
python scripts/build_native_release.py
bash scripts/test_native_runtime.sh /path/to/extracted-native-bundle
```

Final release verification must exercise fresh install, reboot persistence, upgrade, failed health-check rollback, database backup, document persistence, and plugin persistence on a clean Ubuntu 22.04 VM snapshot.

For upgrade-path testing without changing the tracked application version, the builder accepts `--version-override <next-version>-test`. Replace the placeholder with a semantic version newer than the installed release. This flag is for disposable VM artifacts only; the tag release workflow never uses it and independently requires the tag to match `APP_VERSION`.
