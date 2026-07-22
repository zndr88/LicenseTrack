from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    DATABASE_URL: str = "sqlite+aiosqlite:///./licenses.db"
    STORAGE_PATH: str = "./storage"
    JWT_SECRET: str = ""
    TOKEN_EXPIRY: int = 1440  # minutes; default 24h
    CORS_ORIGINS: str = "http://localhost:5173"
    MAX_UPLOAD_SIZE_MB: int = 20
    MAX_PLUGIN_PACKAGE_SIZE_MB: int = 50
    PLUGIN_STORAGE_PATH: str = "./plugins"
    PLUGIN_HOST_BASE_URL: str = "http://127.0.0.1:8000"
    # The managed extension host is an internal first-party feature boundary.
    # Stable deployments leave it disabled unless explicitly opted in.
    PLUGIN_HOST_ENABLED: bool = False
    # Developer mode permits unsigned local packages, marks them as developer
    # builds, and is unsupported for production use.
    PLUGIN_HOST_DEVELOPER_MODE: bool = False
    # JSON array of pinned Ed25519 release keys. Each entry contains keyId,
    # signer, and publicKey (base64-encoded raw 32-byte public key).
    OFFICIAL_EXTENSION_PUBLIC_KEYS: str = "[]"
    PLUGIN_RUNTIME_LOG_MAX_BYTES: int = 65536
    MAX_PLUGIN_DOCUMENT_SIZE_MB: int = 10
    ALLOWED_UPLOAD_EXTENSIONS: str = ".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.txt,.docx"
    BACKUP_LOCATION: str = "./backups"
    RESTART_AFTER_RESTORE: bool = False
    ADMIN_PASSWORD: str = "admin"
    HOST: str = "0.0.0.0"
    LOG_LEVEL: str = "INFO"
    OIDC_STATE_SECRET: str = ""
    ALLOW_HTTP_OIDC_DISCOVERY: bool = False
    ALLOW_PRIVATE_OIDC_DISCOVERY: bool = False
    SESSION_COOKIE_NAME: str = "license_lifecycle_session"
    SESSION_COOKIE_SECURE: bool = False
    # When False (the default), the interactive API docs (/docs, /redoc) and the
    # OpenAPI schema (/openapi.json) are disabled so the full API surface is not
    # exposed to unauthenticated callers. Enable in development if you want them.
    EXPOSE_API_DOCS: bool = False

    @property
    def EFFECTIVE_OIDC_STATE_SECRET(self) -> str:
        return self.OIDC_STATE_SECRET or self.JWT_SECRET


settings = Settings()
