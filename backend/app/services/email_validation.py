"""
Shared validator for user-supplied email-address fields.

Fields such as ``budget_owner_email`` and ``manager_email`` are plain,
loosely-formatted strings - not strict RFC 5322 addresses. They are allowed
to be blank/None ("not set"), and some stored values are display strings
like "First Last <a@b.com>". Switching these fields to Pydantic's
``EmailStr`` would reject that existing data and break the CSV round-trip,
so this module does NOT attempt full email syntax validation.

Its only job is to close the SMTP command-injection vector behind
CVE-2026-53533 / GHSA-v3q9-hj7j-63hq: these values eventually flow into
``aiosmtplib.send(recipients=...)`` (see app.services.email_service), and a
value containing embedded CR/LF bytes can smuggle extra SMTP commands to the
server. Rejecting CR, LF, and NUL bytes at the input boundary is defense in
depth on top of the aiosmtplib >=5.1.1 upgrade, which rejects control
characters in SMTP command arguments at the transport layer.
"""

from __future__ import annotations

from email.utils import getaddresses

_FORBIDDEN_CHARS = ("\r", "\n", "\x00")


def reject_email_crlf(value: str | None) -> str | None:
    """Strip whitespace and reject CR/LF/NUL bytes in an email-like field.

    Blank strings and ``None`` pass through unchanged - both are valid
    "not set" sentinels used across the license/settings schemas.
    """
    if value is None or value == "":
        return value
    stripped = value.strip()
    if any(ch in stripped for ch in _FORBIDDEN_CHARS):
        raise ValueError("Email field must not contain line breaks or null bytes.")
    return stripped


def email_domain(value: str | None) -> str | None:
    """Return the normalized domain from one mailbox or display-name address."""
    if not value:
        return None
    parsed = getaddresses([value])
    if len(parsed) != 1:
        return None
    _, mailbox = parsed[0]
    if "@" not in mailbox:
        return None
    domain = mailbox.rsplit("@", 1)[1].strip().rstrip(".").casefold()
    return domain or None


def is_email_domain_allowed(value: str | None, allowed_domains: list[str]) -> bool:
    """Return whether an address is allowed by a case-insensitive domain list."""
    if not allowed_domains:
        return True
    domain = email_domain(value)
    allowed = {domain_name.strip().lstrip("@").rstrip(".").casefold() for domain_name in allowed_domains}
    return domain is not None and domain in allowed


def sanitize_email_header(value: object) -> str:
    """Remove header-control characters before constructing a mail header."""
    return str(value or "").replace("\r", " ").replace("\n", " ").replace("\x00", "").strip()
