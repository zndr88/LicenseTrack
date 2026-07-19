# Native Linux packaging

Native packaging supports systemd-based Ubuntu 22.04 hosts with Python 3.12. It is intentionally separate from Docker packaging.

## Build

From the repository root:

```bash
python scripts/build_native_release.py --download-wheels
```

The builder runs `npm ci` and the production frontend build, assembles a backend-only runtime payload, downloads binary Python wheels for the build architecture, writes a per-file SHA-256 manifest, and creates `.tar.gz` and `.zip` archives plus `SHA256SUMS` under `dist/native`.

The tag workflow verifies that `v<git-tag>` matches `backend/app/version.py`, builds the x86_64 bundle on Ubuntu 22.04, stores it as a workflow artifact, and attaches it to the GitHub release.

## Installer boundaries

- `install.sh` and `upgrade.sh` are small Bash entrypoints.
- `packaging/native/libexec/installer.py` owns validation, staging, configuration, service installation, backups, migrations, health checks, and rollback.
- A fresh install defaults to Standard mode. Advanced mode changes only the initial questionnaire and the resulting protected environment; it does not create a separate installation layout or upgrade path.
- Every Advanced questionnaire value has a non-interactive CLI equivalent. `--yes` must never cause a prompt and defaults to Standard unless `--advanced` is explicit.
- SMTP and OIDC client credentials are application-managed encrypted settings. Do not add secret-bearing installer command-line flags; only deployment-level OIDC network allowances belong in the native environment.
- `packaging/native/libexec/native_operator.py` owns `doctor`, `backup`, and `version` commands used by the installed wrapper.
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
python scripts/build_native_release.py
bash scripts/test_native_runtime.sh /path/to/extracted-native-bundle
```

Final release verification must exercise fresh install, reboot persistence, upgrade, failed health-check rollback, database backup, document persistence, and plugin persistence on a clean Ubuntu 22.04 VM snapshot.

For upgrade-path testing without changing the tracked application version, the builder accepts `--version-override <next-version>-test`. Replace the placeholder with a semantic version newer than the installed release. This flag is for disposable VM artifacts only; the tag release workflow never uses it and independently requires the tag to match `APP_VERSION`.
