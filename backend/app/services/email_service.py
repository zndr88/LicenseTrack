import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import aiosmtplib

from app.models.settings import GlobalSettings
from app.services.crypto_service import decrypt_secret
from app.services.email_templates import test_email

log = logging.getLogger(__name__)

_FORBIDDEN_RECIPIENT_CHARS = ("\r", "\n", "\x00")
_SMTP_ENCRYPTION_LABELS = {
    "none": "None",
    "starttls": "STARTTLS",
    "tls": "TLS/SSL",
}


def _smtp_encryption_mode(gs: GlobalSettings) -> str:
    mode = getattr(gs, "smtp_encryption", None)
    if mode in _SMTP_ENCRYPTION_LABELS:
        return mode
    return "tls" if getattr(gs, "smtp_use_tls", False) else "starttls"


def _contains_forbidden_email_chars(value: str) -> bool:
    return any(char in value for char in _FORBIDDEN_RECIPIENT_CHARS)


def _reject_crlf_recipient(address: str) -> None:
    """Raise ValueError if *address* contains CR/LF/NUL bytes.

    Belt-and-braces guard against SMTP command injection (CVE-2026-53533 /
    GHSA-v3q9-hj7j-63hq) at the actual sink - aiosmtplib.send() - in addition
    to the input-boundary validation on the Pydantic schemas that feed this
    function (budget_owner_email, manager_email, etc).
    """
    if _contains_forbidden_email_chars(address):
        raise ValueError(f"Refusing to send: recipient address contains line breaks or null bytes: {address!r}")


def _reject_crlf_header(value: str, name: str) -> None:
    if _contains_forbidden_email_chars(value):
        raise ValueError(f"Refusing to send: {name} contains line breaks or null bytes")


async def send_email(
    gs: GlobalSettings,
    to: str,
    subject: str,
    html_body: str,
    cc: str | list[str] | None = None,
) -> None:
    """Send a single email using SMTP settings from GlobalSettings."""
    if not gs.smtp_host or not gs.smtp_sender:
        raise ValueError("SMTP is not configured")

    _reject_crlf_recipient(to)
    cc_recipients = [cc] if isinstance(cc, str) else list(cc or [])
    for recipient in cc_recipients:
        _reject_crlf_recipient(recipient)
    _reject_crlf_header(subject, "subject")
    _reject_crlf_header(gs.smtp_sender, "sender")

    msg = MIMEMultipart("alternative")
    msg["From"] = gs.smtp_sender
    msg["To"] = to
    msg["Subject"] = subject
    if cc_recipients:
        msg["Cc"] = ", ".join(cc_recipients)
    msg.attach(MIMEText(html_body, "html"))

    recipients = [to, *cc_recipients]
    encryption = _smtp_encryption_mode(gs)
    await aiosmtplib.send(
        msg,
        hostname=gs.smtp_host,
        port=gs.smtp_port,
        username=gs.smtp_username or None,
        password=decrypt_secret(gs.smtp_password) or None,
        use_tls=encryption == "tls",
        start_tls=encryption == "starttls",
        recipients=recipients,
    )


async def send_test_email(gs: GlobalSettings, to: str) -> None:
    """Send a test email to verify SMTP configuration."""
    html = test_email(
        host=gs.smtp_host,
        port=gs.smtp_port,
        encryption=_SMTP_ENCRYPTION_LABELS[_smtp_encryption_mode(gs)],
        sender=gs.smtp_sender,
    )
    await send_email(gs, to, "License Lifecycle Management - Test Email", html)
