# Native Linux packaging

Native packaging supports systemd-based Debian 13 and Ubuntu 22.04 hosts with
CPython 3.12, 3.13, or 3.14. It is intentionally separate from Docker
packaging.

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

Demo builds use `frontend/dist-demo`, while production builds use
`frontend/dist`. Native assembly rejects any selected production bundle that
contains `LICENSETRACK_DEMO_MARKER`, including when
`--skip-frontend-build` accepts an existing bundle. The installer repeats this
integrity check after staging both official payloads and source-archive builds.

The backend release payload is allow-listed. Native archives contain only
`backend/app`, `backend/alembic`, `backend/alembic.ini`,
`backend/requirements-runtime.txt`, and the compiled production frontend.
Never replace this with a broad backend-directory copy: local `.env` files,
SQLite databases, backups, document storage, coverage output, tests, and
development plugin storage must not enter a release archive.

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

The tag workflow verifies that `v<git-tag>` matches `backend/app/version.py`,
then prepares the `cp312`, `cp313`, and `cp314` wheelhouses independently under
their matching interpreters. A single assembly job downloads those internal
artifacts, builds the frontend once, and creates one combined x86_64 candidate.
Python 3.12, 3.13, and 3.14 smoke jobs all install offline from that exact
candidate and check the API health response plus frontend root. Only the
publication job can write release assets, and it downloads the already-tested
candidate rather than rebuilding it.

Maintainers can run the workflow manually to exercise the complete wheelhouse,
assembly, and smoke matrix without publishing a release. Only a `v*` tag push
runs the tag/version check and publication job.

Normal pull-request and main-branch CI builds a lighter source-style bundle
without wheelhouses. It verifies `SHA256SUMS`, tests both archive formats, and
runs `install.sh --verify-only` against the extracted manifest so structural
packaging failures are caught before a release tag is created.

## Installer boundaries

- `install.sh` and `upgrade.sh` are small Bash entrypoints.
- `packaging/native/libexec/select_python.sh` discovers the distribution's supported CPython interpreter, honors an explicit `PYTHON_BIN`, verifies venv support, and rejects an offline bundle that lacks the selected ABI.
- `packaging/native/libexec/installer.py` owns manifest/runtime compatibility validation, staging, configuration, service installation and upgrade refresh, backups, migrations, health checks, automatic rollback, and operator-initiated rollback.
- Compatibility validation accepts exactly CPython 3.12, 3.13, and 3.14. For manifest v2 bundles it checks Linux/x86_64, the declared Python range, included ABI directories, and checksum coverage before any host mutation.
- A fresh install defaults to Standard mode. Advanced mode changes only the initial questionnaire and the resulting protected environment; it does not create a separate installation layout or upgrade path.
- Every Advanced questionnaire value has a non-interactive CLI equivalent. `--yes` must never cause a prompt and defaults to Standard unless `--advanced` is explicit.
- Network reachability is explicit: `local-only` uses a local public URL and loopback bind, `reverse-proxy` requires a non-local public URL plus loopback bind, and `direct-network` requires both a non-loopback bind and non-local public URL. Unattended reverse-proxy installs must declare their mode; direct-network mode may explicitly default the bind to `0.0.0.0`.
- SMTP and OIDC client credentials are application-managed encrypted settings. Do not add secret-bearing installer command-line flags; only deployment-level OIDC network allowances belong in the native environment.
- `packaging/native/libexec/native_operator.py` owns `doctor`, `backup`, and `version` commands used by the installed wrapper.
- The installed wrapper routes `licensetrack rollback` to the active release's installer module. A successful upgrade atomically refreshes that wrapper after the target health check so installations upgraded from older releases receive the new command without exposing it during a failed upgrade.
- Manual rollback accepts only archives under the installation's configured upgrade-backup root. It validates archive/install identity, the older installed target release, archived configuration/database consistency, and SQLite integrity before stopping the service. New backups include the managed operator wrapper so it is restored atomically with the matched release. Rollback creates a pre-rollback safety archive and automatically recovers the starting version if target restoration or health verification fails.
- New installation state records the selected Python implementation, version, ABI, and executable without changing state schema version 1. Upgrades accept older state without those optional keys. `licensetrack doctor` inspects the active release venv and reports missing, broken, or ABI-mismatched runtimes.
- New installation state also records the confirmed network mode and public URL. `licensetrack doctor` compares that intent with the effective bind/public-URL combination and warns when legacy state implies an unconfirmed reverse proxy.
- `backend/requirements-runtime.txt` contains production dependencies only. Keep every entry pinned and aligned with the corresponding entry in `backend/requirements.txt`.
- Native releases are immutable under `/opt/licensetrack/releases`; mutable state belongs under `/var/lib/licensetrack` and `/etc/licensetrack`.

Never make the installer parse configuration by sourcing it as shell code. Never use Alembic downgrade as the automatic rollback mechanism. A rollback restores the matched application release, data snapshot, and configuration together.

## Verification

Run the focused tests and build smoke check:

```bash
cd backend
python -m pytest tests/test_unit/test_native_installer.py
cd ..
for entrypoint in install.sh upgrade.sh packaging/native/install.sh \
  packaging/native/upgrade.sh packaging/native/libexec/select_python.sh \
  scripts/test_native_bundle_structure.sh scripts/test_native_permissions.sh \
  scripts/test_native_runtime.sh \
  scripts/test_native_python_selector.sh; do bash -n "$entrypoint"; done
bash scripts/test_native_python_selector.sh . "$(command -v python3)" cpXY
python scripts/build_native_release.py
bash scripts/test_native_runtime.sh /path/to/extracted-native-bundle
sudo bash scripts/test_native_permissions.sh
```

Final release verification must exercise fresh install, reboot persistence, upgrade, failed health-check rollback, database backup, document persistence, the native permission contract, and Official Extension persistence on a clean supported VM snapshot.

For upgrade-path testing without changing the tracked application version, the builder accepts `--version-override <next-version>-test`. Replace the placeholder with a release version newer than the installed release. This flag is for disposable VM artifacts only; the tag release workflow never uses it and independently requires the tag to match `APP_VERSION`.
