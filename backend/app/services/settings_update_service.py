import os

from fastapi import HTTPException

from app.schemas.settings import _SMTP_PASSWORD_MASK
from app.services.crypto_service import encrypt_secret

OIDC_CACHE_FIELDS = {
    "oidc_enabled",
    "oidc_discovery_url",
    "oidc_client_id",
    "oidc_client_secret",
}


def normalize_smtp_encryption(update_data: dict) -> None:
    if "smtp_encryption" in update_data:
        update_data["smtp_use_tls"] = update_data["smtp_encryption"] == "tls"
        return

    if "smtp_use_tls" in update_data:
        update_data["smtp_encryption"] = "tls" if update_data["smtp_use_tls"] else "starttls"


def validate_storage_path(update_data: dict) -> None:
    if "storage_path" not in update_data or not update_data["storage_path"]:
        return

    path = update_data["storage_path"]
    if not os.path.isdir(path):
        raise HTTPException(status_code=422, detail=f"Directory does not exist: {path}")
    if not os.access(path, os.W_OK):
        raise HTTPException(status_code=422, detail=f"Directory is not writable: {path}")


def preserve_masked_or_empty_secrets(update_data: dict) -> None:
    if update_data.get("smtp_password") == _SMTP_PASSWORD_MASK:
        del update_data["smtp_password"]

    if "oidc_client_secret" not in update_data:
        return

    value = update_data["oidc_client_secret"]
    if value == _SMTP_PASSWORD_MASK:
        del update_data["oidc_client_secret"]
    elif not value:
        update_data["oidc_client_secret"] = None


def encrypt_settings_secrets(update_data: dict) -> None:
    if update_data.get("smtp_password"):
        update_data["smtp_password"] = encrypt_secret(update_data["smtp_password"])
    if update_data.get("oidc_client_secret"):
        update_data["oidc_client_secret"] = encrypt_secret(update_data["oidc_client_secret"])


def oidc_cache_should_invalidate(update_data: dict) -> bool:
    return any(field in update_data for field in OIDC_CACHE_FIELDS)
