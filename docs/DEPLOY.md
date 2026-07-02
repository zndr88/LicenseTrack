# Deployment Guide

## Requirements

| Component | Minimum |
|-----------|---------|
| Docker Engine | 24+ |
| Docker Compose | v2 plugin |
| RAM | 512 MB |
| Disk | 1 GB plus stored documents and database backups |

## Quick Start

1. Copy the environment file:

```bash
cp .env.example .env
```

2. Generate and set `JWT_SECRET`:

```bash
openssl rand -hex 32
```

Windows PowerShell:

```powershell
-join ((0..31) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

3. Start the application:

Before starting, also set a strong `ADMIN_PASSWORD` in `.env`. Startup fails if `JWT_SECRET` is missing/unsafe or if `ADMIN_PASSWORD` is blank or a common default such as `admin`, `password`, or `changeme`.

```bash
docker compose up -d --build
```

4. Open `http://<your-server>:8080`.

Log in with username `admin` and the password configured in `ADMIN_PASSWORD`. Change and store the break-glass admin password according to your operational policy.

The Docker image serves the React frontend and FastAPI backend from the same origin. Browser API calls use `/api/...` by default, so the backend container port `8000` does not need to be exposed directly to end users.

## Configuration

All variables are read from `.env` at container start. Restart the container after changing configuration.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | none | Secret key used to sign authentication tokens. |
| `APP_PORT` | No | `8080` | Host port exposed by Docker Compose. |
| `HOST` | No | `0.0.0.0` | Backend bind host inside the container. |
| `LOG_LEVEL` | No | `INFO` | Backend log level. |
| `CORS_ORIGINS` | No | `http://localhost:8080` | Browser URL(s) allowed to call the API. Must match exactly. |
| `DATABASE_URL` | No | `sqlite+aiosqlite:////data/licenses.db` | SQLite database connection string. |
| `STORAGE_PATH` | No | `/data/storage` | Uploaded document storage path. |
| `BACKUP_LOCATION` | No | `/data/backups` | Database backup output path. |
| `ADMIN_PASSWORD` | Operationally yes | none | Initial admin password for the seeded local `admin` account. Startup rejects blank/common defaults. |
| `TOKEN_EXPIRY` | No | `1440` | JWT session lifetime in minutes. |
| `OIDC_STATE_SECRET` | No | falls back to `JWT_SECRET` | Secret used for OIDC flow state. |
| `SESSION_COOKIE_NAME` | No | `license_lifecycle_session` | Browser session cookie name. |
| `SESSION_COOKIE_SECURE` | No | `false` | Set to `true` behind HTTPS. |
| `SMTP_HOST` | No | empty | Deployment placeholder. Configure active SMTP settings in the application Settings UI. |
| `SMTP_PORT` | No | `587` | SMTP port. |
| `SMTP_USERNAME` | No | empty | SMTP username. |
| `SMTP_PASSWORD` | No | empty | SMTP password. |
| `SMTP_FROM` | No | empty | Sender address for notification emails. |
| `MAX_UPLOAD_SIZE_MB` | No | `20` | Maximum upload size in megabytes. |
| `ALLOWED_UPLOAD_EXTENSIONS` | No | common office/document extensions | Comma-separated upload extension allow-list. |
| `PLUGIN_STORAGE_PATH` | No | `/data/plugins` | Directory where installed plugin packages are extracted. |
| `PLUGIN_HOST_BASE_URL` | No | `http://localhost:8000` | Base URL the plugin runtime uses to call back into LicenseTrack. Set this to the internal URL the backend is reachable on from within the same host (not the browser-facing URL). |
| `MAX_PLUGIN_PACKAGE_SIZE_MB` | No | `50` | Maximum plugin zip size in megabytes. |
| `MAX_PLUGIN_DOCUMENT_SIZE_MB` | No | `10` | Maximum size of a single document a plugin may read at runtime. |
| `PLUGIN_RUNTIME_LOG_MAX_BYTES` | No | `524288` | Maximum bytes returned when viewing plugin runtime logs (tail). |

## Plugin Runtime

LicenseTrack v1 includes a Plugin Host that runs installable plugin packages as managed local processes.

**Single-worker constraint.** Plugin subprocess state (process handles, bearer tokens, per-action document scopes) lives in the FastAPI process. You must run exactly one Uvicorn worker. Do not set `--workers N` with `N > 1` in any process manager. Running multiple workers silently partitions plugin state: worker A starts a subprocess and records its token; worker B cannot find it and rejects all runtime requests from that plugin with 401.

The Docker Compose configuration uses the default of one worker. If you override the Uvicorn command in your deployment, do not add `--workers`.

**Plugin storage volume.** Installed plugin packages are extracted to `PLUGIN_STORAGE_PATH` (default `/data/plugins`). Add this path to your volume or bind-mount alongside `/data/storage` and `/data/backups`. Without a persistent volume, installed plugins are lost on container restart.

```yaml
volumes:
  - license_lifecycle_data:/data
```

The named `license_lifecycle_data` volume covers `/data`, including `/data/plugins`, `/data/storage`, and `/data/backups`.

**Plugin entrypoints.** Only Python (`.py`) entrypoints are supported in v1. The backend rejects a plugin runtime at enable time if the declared entrypoint does not end in `.py`.

**Runtime callback URL.** `PLUGIN_RUNTIME_LOG_MAX_BYTES` controls how much log the admin can view. `PLUGIN_HOST_BASE_URL` controls the URL injected into plugin runtime env as `LT_PLUGIN_BASE_URL`. Set it to the internal URL the backend is reachable on from within the same host.

## Startup Behavior

On startup the backend:

- runs Alembic migrations to `head`;
- validates `JWT_SECRET` and `ADMIN_PASSWORD`;
- seeds the local break-glass `admin` user, `GlobalSettings`, and admin `UserSettings` if the database has not been seeded;
- starts the background scheduler.

For local development you may still run `alembic upgrade head` and `python -m app.seed` manually before starting Uvicorn. In Docker, startup performs those operational steps automatically after configuration validation.

## Persistent Data

Docker Compose creates a named volume called `license_lifecycle_data`.

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

## Database Backup And Restore

Admins can create and restore database backups in Settings. Database restore creates a pre-restore database safety snapshot before replacing the database.

Database backups contain the SQLite database only. Uploaded documents are data files stored separately under `/data/storage`; operators must back them up separately, usually by backing up the full `/data` volume.

## Operations

Monitor `/api/health`, Docker container health, logs, disk space for `/data`, and database backup freshness. Forward container logs to your normal log platform if centralized retention or alerting is required.

See `docs/operations-runbook.md` for baseline health checks, log review, database backup checks, vulnerability-management cadence, upgrade checks, and incident-response notes.

## Reverse Proxy

When deploying behind HTTPS, set:

```env
CORS_ORIGINS=https://licenses.example.com
SESSION_COOKIE_SECURE=true
```

Ensure the reverse proxy forwards `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto` headers.

Reverse proxies should route both the SPA and `/api/*` paths to this service. A separate browser-facing API origin is only needed for custom split-host deployments that build the frontend with `VITE_API_URL`.
