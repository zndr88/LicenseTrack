import asyncio
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from functools import partial

from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings

logging.basicConfig(
    level=settings.LOG_LEVEL.upper(),
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("license_lifecycle")

# Common weak/placeholder values that must never be accepted as a signing
# secret. Compared case-insensitively against a stripped JWT_SECRET.
_WEAK_JWT_SECRETS = frozenset(
    {
        "changeme",
        "change-this",
        "changethis",
        "secret",
        "jwt_secret",
        "jwtsecret",
        "password",
        "default",
        "your-secret-key",
        "your_secret_key",
        "supersecret",
        "mysecret",
        "example",
    }
)

from app.routes import (
    api_tokens,
    audit_log,
    auth,
    auth_oidc,
    backup,
    contract_documents,
    contract_folders,
    contracts,
    csv_import,
    custom_fields,
    document_actions,
    document_processing,
    documents,
    extensions,
    global_settings,
    import_mappings,
    integrations,
    license_exports,
    license_maintenance,
    license_renewals,
    plugin_actions,
    plugin_runtime_access,
    plugin_suggestions,
    licenses,
    notifications,
    operations,
    pending_orders,
    plugins,
    renewals,
    reports,
    reference_data,
    sourcing,
    user_settings,
    users,
    webhooks,
)
from app.services.notification_scheduler import start_scheduler
from app.services.restore_maintenance import restore_maintenance
from app.version import APP_VERSION

SPA_INDEX_CACHE_CONTROL = "no-cache, must-revalidate"
IMMUTABLE_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable"


class ImmutableStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope: dict):
        response = await super().get_response(path, scope)
        if response.status_code in {200, 304}:
            response.headers["Cache-Control"] = IMMUTABLE_ASSET_CACHE_CONTROL
        return response


def spa_index_response(frontend_dist: str) -> FileResponse:
    return FileResponse(
        os.path.join(frontend_dist, "index.html"),
        headers={"Cache-Control": SPA_INDEX_CACHE_CONTROL},
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run database migrations on every startup so the schema is always current.
    # In a frozen PyInstaller bundle the alembic files live in sys._MEIPASS;
    # in development they are resolved relative to the working directory.
    if getattr(sys, "frozen", False):
        alembic_cfg_path = os.path.join(os.path.dirname(sys.executable), "alembic.ini")
    else:
        alembic_cfg_path = "alembic.ini"
    alembic_cfg = AlembicConfig(alembic_cfg_path)
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, partial(alembic_command.upgrade, alembic_cfg, "head"))
    except Exception as exc:
        logger.critical("Alembic migration failed: %s", exc)
        logger.critical("The application cannot start. Check your database and migration files.")
        raise

    secret = settings.JWT_SECRET
    if not secret or secret.strip().lower() in _WEAK_JWT_SECRETS:
        logger.critical(
            "JWT_SECRET is blank or set to a common default value. "
            'Generate a long random string (e.g. `python -c "import secrets; print(secrets.token_hex(32))"`) '
            "and set it in your .env file, then restart."
        )
        sys.exit(1)

    admin_pw = settings.ADMIN_PASSWORD or ""
    if admin_pw.lower() in ("admin", "password", "", "changeme", "changeme_required"):
        logger.critical(
            "ADMIN_PASSWORD is set to a default or blank value. Set a strong password in your .env file and restart."
        )
        sys.exit(1)

    from app.seed import seed as run_seed

    await run_seed()

    # Reset any plugin runtime DB rows left in a non-stopped state from a
    # previous run. The in-memory process dict is empty on a fresh start so
    # those rows refer to processes that no longer exist. Wrapped in a broad
    # except so a missing table on a first-boot race (migrations ran but the
    # process restarted before the table existed) is non-fatal.
    try:
        from app.database import AsyncSessionLocal
        from app.services.plugin_runtime_service import reset_stale_runtime_statuses

        async with AsyncSessionLocal() as startup_db:
            await reset_stale_runtime_statuses(startup_db)
            await startup_db.commit()
    except Exception as _exc:
        logger.warning("Plugin runtime status reset skipped: %s", _exc)

    task = asyncio.create_task(start_scheduler())
    yield

    # Gracefully stop all managed plugin processes before the event loop exits.
    try:
        from app.services.plugin_lifecycle_service import stop_all_plugin_runtimes

        async with AsyncSessionLocal() as shutdown_db:
            await stop_all_plugin_runtimes(shutdown_db)
    except Exception as _exc:
        logger.warning("Plugin runtime shutdown skipped: %s", _exc)

    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


# Disable the interactive docs and OpenAPI schema unless explicitly enabled, so
# the full API surface is not handed to unauthenticated callers in production.
_docs_kwargs = {} if settings.EXPOSE_API_DOCS else {"docs_url": None, "redoc_url": None, "openapi_url": None}

app = FastAPI(
    title="Software License Lifecycle Management System API",
    version=APP_VERSION,
    lifespan=lifespan,
    **_docs_kwargs,
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Catch-all handler so unhandled exceptions return a JSON response through the
    full middleware chain (including CORSMiddleware) rather than being intercepted
    by ServerErrorMiddleware, which would strip CORS headers from the response.
    """
    logger.error(
        "Unhandled exception on %s %s: %s",
        request.method,
        request.url.path,
        exc,
        exc_info=True,
    )
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


_UPLOAD_PATHS = ("/api/backup/restore", "/api/plugins/preview-install", "/api/plugins/install")
_UPLOAD_PATH_SUFFIXES = ("/documents", "/quote-documents")
MULTIPART_ENVELOPE_ALLOWANCE_BYTES = 1024 * 1024


@app.middleware("http")
async def reject_oversized_uploads(request: Request, call_next):
    """F10: reject oversized uploads before buffering the full body."""
    if request.method == "POST":
        path = request.url.path
        is_upload = path in _UPLOAD_PATHS or any(path.endswith(s) for s in _UPLOAD_PATH_SUFFIXES)
        if is_upload:
            cl_header = request.headers.get("content-length")
            if cl_header is not None:
                max_upload_mb = (
                    settings.MAX_PLUGIN_PACKAGE_SIZE_MB
                    if path.startswith("/api/plugins/")
                    else settings.MAX_UPLOAD_SIZE_MB
                )
                max_request_bytes = max_upload_mb * 1024 * 1024 + MULTIPART_ENVELOPE_ALLOWANCE_BYTES
                try:
                    cl_value = int(cl_header)
                except ValueError:
                    cl_value = 0
                if cl_value > max_request_bytes:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": f"File exceeds the maximum allowed size of {max_upload_mb} MB."},
                    )
    return await call_next(request)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    try:
        response = await call_next(request)
    except Exception:
        logger.error(
            "Unhandled exception on %s %s",
            request.method,
            request.url.path,
            exc_info=True,
        )
        response = JSONResponse(status_code=500, content={"detail": "Internal server error"})
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "font-src 'self' data:; "
        "connect-src 'self'; "
        "frame-src 'self' blob:; "
        "frame-ancestors 'none';"
    )
    return response


@app.middleware("http")
async def log_requests(request: Request, call_next):
    if request.url.path == "/api/health":
        return await call_next(request)
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    logger.info(
        "%s %s %s %.1fms",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


@app.middleware("http")
async def reject_requests_during_restore(request: Request, call_next):
    path = request.url.path
    is_health = path == "/api/health"
    is_restore = path in {"/api/backup/restore", "/api/backup/restore-server"}
    # Restore requests coordinate themselves through begin_restore(). Counting
    # the initiating restore here would make it wait for its own request to
    # leave before the database swap could begin.
    if not is_health and not is_restore:
        entered = await restore_maintenance.enter_request()
        if not entered:
            return JSONResponse(
                status_code=503,
                content={"detail": "The application is temporarily unavailable while a database restore is in progress."},
                headers={"Retry-After": "30"},
            )
    else:
        entered = False
    try:
        return await call_next(request)
    finally:
        if entered:
            await restore_maintenance.leave_request()
        restore_owner = getattr(request.state, "restore_owner", None)
        keep_maintenance = getattr(request.state, "keep_restore_maintenance", False)
        if restore_owner is not None and not keep_maintenance:
            await restore_maintenance.end_restore(restore_owner)


_cors_origins = [origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(auth.router)
app.include_router(auth_oidc.router)
app.include_router(api_tokens.router)
app.include_router(webhooks.router)
app.include_router(extensions.router)
app.include_router(license_exports.router)
app.include_router(licenses.router)
app.include_router(license_renewals.router)
app.include_router(license_maintenance.router)
app.include_router(notifications.router)
app.include_router(document_actions.router)
app.include_router(plugin_actions.router)
app.include_router(plugin_runtime_access.router)
app.include_router(plugin_suggestions.router)
app.include_router(document_processing.router)
app.include_router(documents.router)
app.include_router(user_settings.router)
app.include_router(global_settings.router)
app.include_router(integrations.router)
app.include_router(users.router)
app.include_router(sourcing.router)
app.include_router(pending_orders.router)
app.include_router(plugins.status_router)
app.include_router(plugins.router)
app.include_router(renewals.router)
app.include_router(csv_import.router)
app.include_router(import_mappings.router)
app.include_router(backup.router)
app.include_router(operations.router)
app.include_router(contracts.router)
app.include_router(contract_folders.router)
app.include_router(contract_documents.router)
app.include_router(reports.router)
app.include_router(reference_data.router)
app.include_router(audit_log.router)
app.include_router(custom_fields.bulk_router)
app.include_router(custom_fields.definitions_router)
app.include_router(custom_fields.values_router)


@app.get("/api/health")
async def health_check() -> dict:
    return {
        "status": "maintenance" if restore_maintenance.maintenance else "ok",
        "version": APP_VERSION,
    }


# -- Serve compiled React frontend (Docker / production only) ------------------
# The frontend/dist directory only exists in the Docker image (built by the
# Dockerfile Stage 1 copy). In local dev the directory is absent and this
# block is skipped entirely, so API routes are unaffected.
_frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

if os.path.exists(_frontend_dist):
    app.mount(
        "/assets",
        ImmutableStaticFiles(directory=os.path.join(_frontend_dist, "assets")),
        name="assets",
    )
    _frontend_fonts = os.path.join(_frontend_dist, "fonts")
    if os.path.exists(_frontend_fonts):
        app.mount(
            "/fonts",
            StaticFiles(directory=_frontend_fonts),
            name="fonts",
        )

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        return spa_index_response(_frontend_dist)
