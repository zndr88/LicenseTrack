import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib

from app.models.settings import GlobalSettings
from app.services.crypto_service import decrypt_secret

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


def _reject_crlf_recipient(address: str) -> None:
    """Raise ValueError if *address* contains CR/LF/NUL bytes.

    Belt-and-braces guard against SMTP command injection (CVE-2026-53533 /
    GHSA-v3q9-hj7j-63hq) at the actual sink - aiosmtplib.send() - in addition
    to the input-boundary validation on the Pydantic schemas that feed this
    function (budget_owner_email, manager_email, etc).
    """
    if any(ch in address for ch in _FORBIDDEN_RECIPIENT_CHARS):
        raise ValueError(f"Refusing to send: recipient address contains line breaks or null bytes: {address!r}")


async def send_email(
    gs: GlobalSettings,
    to: str,
    subject: str,
    html_body: str,
    cc: str | None = None,
) -> None:
    """Send a single email using SMTP settings from GlobalSettings."""
    if not gs.smtp_host or not gs.smtp_sender:
        raise ValueError("SMTP is not configured")

    _reject_crlf_recipient(to)
    if cc:
        _reject_crlf_recipient(cc)

    msg = MIMEMultipart("alternative")
    msg["From"] = gs.smtp_sender
    msg["To"] = to
    msg["Subject"] = subject
    if cc:
        msg["Cc"] = cc
    msg.attach(MIMEText(html_body, "html"))

    recipients = [to, cc] if cc else [to]
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
    html = """
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1e293b; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0;">Software License Lifecycle Management</h2>
        <p style="margin: 4px 0 0; opacity: 0.7; font-size: 14px;">Email Configuration Test</p>
      </div>
      <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
        <p>This is a test email from your license lifecycle management system.</p>
        <p>If you are reading this, your SMTP configuration is working correctly.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #94a3b8;">
          Server: {host}:{port} | Encryption: {encryption} | Sender: {sender}
        </p>
      </div>
    </div>
    """.format(
        host=gs.smtp_host,
        port=gs.smtp_port,
        encryption=_SMTP_ENCRYPTION_LABELS[_smtp_encryption_mode(gs)],
        sender=gs.smtp_sender,
    )
    await _send_test_email_impl(gs, to, html)


async def _send_test_email_impl(gs: GlobalSettings, to: str, html: str) -> None:
    await send_email(gs, to, "License Lifecycle Management - Test Email", html)
