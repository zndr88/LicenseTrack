# Production deployment & hardening

You've got a basic instance running from the [Installation guide](../getting-started/installation.md). This page is the production reference: running under Podman, hardening a network-reachable install, the full configuration variable list, the Official Extensions runtime constraint, persistent data, and reverse-proxy setup.

!!! note "This page does not repeat the basics"
    For requirements and the initial `cp .env` → generate `JWT_SECRET` → `docker compose up` steps, see [Prerequisites](../getting-started/prerequisites.md) and [Installation](../getting-started/installation.md).

The Docker image serves the React frontend and FastAPI backend from the same origin. Browser API calls use `/api/...` by default, so the backend container port `8000` does not need to be exposed directly to end users.

## Running with Podman

The image is a standard OCI image and runs under Podman without changes. The most reliable path is a plain build and run (it avoids differences between compose providers):

```bash
podman build -t license-lifecycle-system:1.1.7 .

podman run -d --name licensetrack -p 8080:8000 \
  --env-file .env \
  -v license_lifecycle_data:/data \
  license-lifecycle-system:1.1.7
```

Notes:

- `podman compose up -d --build` also works, but only if a compose provider (`podman-compose` or `docker-compose`) is installed; without one, use the `podman run` form above.
- Rootless Podman is supported — the published port (`8080`) is above 1024 and the container already runs as a non-root user.
- The Compose healthcheck is not applied by `podman run`; verify health with `curl http://localhost:8080/api/health` (expects `{"status":"ok", ...}`).

## Production hardening

!!! danger "For any deployment reachable beyond your own machine"
    Do not skip these steps for a network-reachable install.

- **Serve over HTTPS behind a reverse proxy** (nginx, Caddy, Traefik) and set `SESSION_COOKIE_SECURE=true` so session cookies are only sent over TLS.
- **Set `CORS_ORIGINS`** to the exact browser origin(s) you serve from — not the default localhost value.
- **Do not expose the container port directly to an untrusted network.** Publish it only to the reverse proxy (e.g. bind to `127.0.0.1` on the host, or keep it on an internal network).
- **Keep a single Uvicorn worker** (the default) when the Official Extensions host is enabled. Managed extension subprocess state lives in the worker's memory.
- The bundled `docker-compose.yml` already sets `no-new-privileges` and runs the app as a non-root user.

## Configuration

All variables are read from `.env` at container start. Restart the container after changing configuration.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | none | Secret key used to sign authentication tokens. |
| `APP_PORT` | No | `8080` | Host port exposed by Docker Compose. |
| `HOST` | No | `0.0.0.0` | Backend bind host inside the container. |
| `LOG_LEVEL` | No | `INFO` | Backend log level. |
| `EXPOSE_API_DOCS` | No | `false` | Exposes `/docs`, `/redoc`, and `/openapi.json`. Enable only for local development. |
| `CORS_ORIGINS` | No | `http://localhost:8080` | Browser URL(s) allowed to call the API. Must match exactly. |
| `DATABASE_URL` | No | `sqlite+aiosqlite:////data/licenses.db` | SQLite database connection string. |
| `STORAGE_PATH` | No | `/data/storage` | Uploaded document storage path. |
| `BACKUP_LOCATION` | No | `/data/backups` | Database backup output path. |
| `RESTART_AFTER_RESTORE` | No | `true` in Docker Compose, `false` in direct backend runs | Exit the backend after database restore so a process manager can restart it. Set `false` for local development without a restart supervisor. |
| `ADMIN_PASSWORD` | Operationally yes | none | Initial admin password for the seeded local `admin` account. Startup rejects blank/common defaults. |
| `TOKEN_EXPIRY` | No | `1440` | JWT session lifetime in minutes. |
| `OIDC_STATE_SECRET` | No | falls back to `JWT_SECRET` | Secret used for OIDC flow state. |
| `ALLOW_HTTP_OIDC_DISCOVERY` | No | `false` | Unsafe testing-only allowance for plain-HTTP OIDC discovery. Leave disabled in production. |
| `ALLOW_PRIVATE_OIDC_DISCOVERY` | No | `false` | Unsafe testing-only allowance for private, loopback, link-local, or reserved OIDC hosts. Leave disabled in production. |
| `SESSION_COOKIE_NAME` | No | `license_lifecycle_session` | Browser session cookie name. |
| `SESSION_COOKIE_SECURE` | No | `false` | Set to `true` behind HTTPS. |
| `MAX_UPLOAD_SIZE_MB` | No | `20` | Maximum upload size in megabytes. |
| `ALLOWED_UPLOAD_EXTENSIONS` | No | common office/document extensions | Comma-separated upload extension allow-list. |
| `PLUGIN_HOST_ENABLED` | No | `false` | Enables the internal Official Extensions host. Leave disabled unless an official signed extension is required. |
| `PLUGIN_HOST_DEVELOPER_MODE` | No | `false` | Allows unsigned developer packages and marks them non-official. Unsupported for production. |
| `OFFICIAL_EXTENSION_PUBLIC_KEYS` | No | `[]` | JSON array of pinned Ed25519 release keys with `keyId`, `signer`, and base64 raw `publicKey`. Obtain values only from official LicenseTrack releases. |
| `PLUGIN_STORAGE_PATH` | No | `/data/plugins` | Directory where Official Extension packages are extracted. |
| `PLUGIN_HOST_BASE_URL` | No | `http://127.0.0.1:8000` | Internal callback base URL for managed Official Extension runtimes. |
| `MAX_PLUGIN_PACKAGE_SIZE_MB` | No | `50` | Maximum Official Extension package size in megabytes. |
| `MAX_PLUGIN_DOCUMENT_SIZE_MB` | No | `10` | Maximum document size delivered to an extension runtime. |
| `PLUGIN_RUNTIME_LOG_MAX_BYTES` | No | `65536` | Maximum bytes returned from an extension runtime log tail. |

SMTP and OIDC credentials are configured after startup in **Admin > Settings**;
they are not container environment settings. The supplied Compose file passes
every environment variable in the table above into the application container,
so values placed in `.env` take effect after the container is recreated.

## Local Keycloak OIDC testing

LicenseTrack requires HTTPS OIDC discovery and blocks private, loopback,
link-local, and reserved discovery hosts by default. For isolated development or
test networks only, you can allow a local Keycloak instance by setting both of
these environment variables before starting the backend:

```env
ALLOW_HTTP_OIDC_DISCOVERY=true
ALLOW_PRIVATE_OIDC_DISCOVERY=true
```

Do not enable these flags in production or on networks you do not fully trust.
They intentionally relax OIDC discovery URL protections so a test IdP on plain
HTTP or a private VM address can be reached.

When testing Keycloak on a VM:

- Make Keycloak advertise the VM or otherwise reachable hostname/IP as its
  issuer, not `localhost`, unless LicenseTrack is running on the same host.
- Set `CORS_ORIGINS` to the exact LicenseTrack frontend URL used in the browser.
- The LicenseTrack OIDC user's email must match the email claim sent by the IdP.
- An incorrect Keycloak client secret appears in LicenseTrack logs as an OIDC
  token exchange/client credentials failure.
- OIDC callback failures are logged with safe stage names. `callback_failed`
  means an unexpected server-side callback step failed after provider
  validation; auth codes, tokens, client secrets, and raw ID tokens are not
  logged.

## Official Extensions runtime

The internal host runs only packages published and signed by the LicenseTrack project. It is disabled by default. Enable it only when an official release provides both an extension package and its pinned public-key configuration. Custom and third-party automation belongs in the API, webhook, or sidecar framework.

!!! danger "Trusted application code, not a sandbox"
    Official Extensions run under the LicenseTrack operating-system account. Declared access, managed processes, callback tokens, environment allow-listing, and process-tree termination are lifecycle and least-exposure controls; they do not contain hostile code. An extension may access application files and the SQLite database wherever the LicenseTrack account can.

!!! warning "Single-worker constraint"
    Extension subprocess state (process handles, bearer tokens, per-action document scopes) lives in the FastAPI process. When the host is enabled, run exactly one Uvicorn worker. Do not set `--workers N` with `N > 1`.

The Docker Compose configuration uses the default of one worker. If you override the Uvicorn command in your deployment, do not add `--workers`.

**Extension storage volume.** Installed packages are extracted to `PLUGIN_STORAGE_PATH` (default `/data/plugins`). Add this path to your volume or bind-mount alongside `/data/storage` and `/data/backups`.

```yaml
volumes:
  - license_lifecycle_data:/data
```

The named `license_lifecycle_data` volume covers `/data`, including `/data/plugins`, `/data/storage`, and `/data/backups`.

**Entrypoints.** Only Python (`.py`) entrypoints are supported. The backend rejects other runtime entrypoints.

**Runtime callback URL.** `PLUGIN_RUNTIME_LOG_MAX_BYTES` controls how much log an admin can view. `PLUGIN_HOST_BASE_URL` is injected as the runtime callback base URL. Set it to the internal URL on which the backend is reachable from the same host.

**Upgrade migration.** Installations created before signature verification are retained but marked `unverified`, disabled, and prevented from starting. Settings, version records, audit history, and suggestions are preserved. Reinstall an official signed release to restore an extension; do not reclassify a legacy package by editing the database.

## Startup behavior

On startup the backend:

- runs Alembic migrations to `head`;
- validates `JWT_SECRET` and `ADMIN_PASSWORD`;
- seeds the local break-glass `admin` user, `GlobalSettings`, and admin `UserSettings` if the database has not been seeded;
- starts the background scheduler.

For local development you may still run `alembic upgrade head` and `python -m app.seed` manually before starting Uvicorn. In Docker, startup performs those operational steps automatically after configuration validation.

## Persistent data

Docker Compose creates a named volume called `license_lifecycle_data` inside the current Compose project.

The volume is mounted at `/data` and contains:

- `/data/licenses.db`
- `/data/storage/`
- `/data/backups/`

Back up the full volume for a complete snapshot of the database, uploaded documents, and database backup files.

```bash
docker run --rm \
  -v license_lifecycle_data:/data \
  -v "$(pwd)":/backup \
  alpine \
  tar -czf /backup/license-lifecycle-data-$(date +%Y%m%d).tar.gz -C /data .
```

Docker Compose prefixes named volumes with the Compose project name, which usually comes from the install folder name. If you move an install from one folder/project name to another, Compose may create a new empty volume unless you point it at the existing one. See [Upgrading LicenseTrack](upgrade.md) before replacing release folders.

## Database backup and restore

Admins can create and restore database backups in Settings. Database restore creates a pre-restore database safety snapshot before replacing the database.

Database backups contain the SQLite database only. Uploaded documents are data files stored separately under `/data/storage`; operators must back them up separately, usually by backing up the full `/data` volume.

For the full behavior - scheduled backups, retention, and the restore safety snapshot - see [Backup & restore](backup-restore.md). For ongoing operational checks (health monitoring, log review, upgrades, incident response), see the [Operations runbook](runbook.md).

## Reverse proxy

When deploying behind HTTPS, set:

```env
CORS_ORIGINS=https://licenses.example.com
SESSION_COOKIE_SECURE=true
```

Ensure the reverse proxy forwards `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto` headers.

Reverse proxies should route both the SPA and `/api/*` paths to this service. A separate browser-facing API origin is only needed for custom split-host deployments that build the frontend with `VITE_API_URL`.
