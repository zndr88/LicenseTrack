"""
Field-level encryption for sensitive GlobalSettings values (smtp_password,
oidc_client_secret).

Uses Fernet symmetric encryption (AES-128-CBC + HMAC-SHA256) with a key
derived from JWT_SECRET via SHA-256.  The decrypt function is intentionally
tolerant of plaintext values written before this feature was introduced —
if decryption fails it returns the value unchanged, so existing deployments
migrate transparently the next time an admin saves the settings.
"""

import base64
import hashlib
import logging

log = logging.getLogger(__name__)


def _fernet():
    from cryptography.fernet import Fernet
    from app.config import settings

    raw_key = hashlib.sha256(f"licensetrack-field-encryption:{settings.JWT_SECRET}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(raw_key))


def encrypt_secret(value: str) -> str:
    """Return Fernet-encrypted ciphertext for *value*. Returns *value* unchanged if empty."""
    if not value:
        return value
    return _fernet().encrypt(value.encode()).decode()


def decrypt_secret(value: str) -> str:
    """Return plaintext for a Fernet-encrypted *value*.

    If *value* is not valid ciphertext (e.g. a plaintext secret written before
    encryption was introduced), returns *value* unchanged so existing deployments
    continue to work until the admin re-saves the setting.
    """
    if not value:
        return value
    try:
        return _fernet().decrypt(value.encode()).decode()
    except Exception:
        log.debug("decrypt_secret: value is not Fernet ciphertext — returning as-is")
        return value
