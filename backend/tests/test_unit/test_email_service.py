"""Unit tests for app.services.email_service.

All SMTP I/O is mocked via unittest.mock.patch so no real network calls are made.
Tests cover:
  - send_email: missing SMTP config raises ValueError
  - send_email: message construction (From/To/Subject/Cc headers, html part)
  - send_email: recipients list with and without Cc
  - send_email: aiosmtplib.send called with correct SMTP parameters
  - send_email: smtp_username/smtp_password None-passthrough when blank
  - send_email: encryption mode maps to correct TLS/STARTTLS parameters
  - send_test_email: delegates to _send_test_email_impl which calls send_email
  - send_test_email: HTML body contains host/port/encryption/sender tokens
  - _send_test_email_impl: calls send_email with fixed subject
"""

from __future__ import annotations

from email.mime.multipart import MIMEMultipart
from html.parser import HTMLParser
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from app.services.email_service import (
    send_email,
    send_test_email,
    _send_test_email_impl,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if text:
            self.parts.append(text)


def _html_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    return " ".join(parser.parts)


def _make_gs(**overrides) -> MagicMock:
    """Return a MagicMock that quacks like a GlobalSettings instance.

    Using MagicMock avoids SQLAlchemy's ORM instrumentation which requires a
    proper session/mapper state that is not available in unit tests.
    """
    defaults = dict(
        smtp_host="smtp.example.com",
        smtp_port=587,
        smtp_sender="noreply@example.com",
        smtp_username="smtpuser",
        smtp_password="encrypted-blob",
        smtp_use_tls=False,
        smtp_encryption="starttls",
    )
    defaults.update(overrides)
    gs = MagicMock()
    for k, v in defaults.items():
        setattr(gs, k, v)
    return gs


# ---------------------------------------------------------------------------
# send_email — guard clause
# ---------------------------------------------------------------------------

async def test_send_email_raises_when_smtp_host_missing():
    gs = _make_gs(smtp_host="", smtp_sender="noreply@example.com")
    with pytest.raises(ValueError, match="SMTP is not configured"):
        await send_email(gs, "to@example.com", "Subject", "<p>body</p>")


async def test_send_email_raises_when_smtp_sender_missing():
    gs = _make_gs(smtp_host="smtp.example.com", smtp_sender="")
    with pytest.raises(ValueError, match="SMTP is not configured"):
        await send_email(gs, "to@example.com", "Subject", "<p>body</p>")


# ---------------------------------------------------------------------------
# send_email — CRLF/NUL injection guard (CVE-2026-53533 / GHSA-v3q9-hj7j-63hq)
# ---------------------------------------------------------------------------

async def test_send_email_rejects_crlf_in_to():
    gs = _make_gs()
    send_mock = AsyncMock()

    with patch("app.services.email_service.aiosmtplib.send", new=send_mock), \
         patch("app.services.email_service.decrypt_secret", return_value="pw"):
        with pytest.raises(ValueError, match="line breaks or null bytes"):
            await send_email(
                gs, "a@example.com\r\nRCPT TO:<evil@x>", "Subject", "<p/>"
            )

    send_mock.assert_not_awaited()


async def test_send_email_rejects_crlf_in_cc():
    gs = _make_gs()
    send_mock = AsyncMock()

    with patch("app.services.email_service.aiosmtplib.send", new=send_mock), \
         patch("app.services.email_service.decrypt_secret", return_value="pw"):
        with pytest.raises(ValueError, match="line breaks or null bytes"):
            await send_email(
                gs, "to@example.com", "Subject", "<p/>",
                cc="a@example.com\nRCPT TO:<evil@x>",
            )

    send_mock.assert_not_awaited()


async def test_send_email_rejects_nul_byte_in_to():
    gs = _make_gs()
    send_mock = AsyncMock()

    with patch("app.services.email_service.aiosmtplib.send", new=send_mock), \
         patch("app.services.email_service.decrypt_secret", return_value="pw"):
        with pytest.raises(ValueError, match="line breaks or null bytes"):
            await send_email(gs, "a@example.com\x00", "Subject", "<p/>")

    send_mock.assert_not_awaited()


# ---------------------------------------------------------------------------
# send_email — message construction
# ---------------------------------------------------------------------------

async def test_send_email_sets_mime_headers_correctly():
    gs = _make_gs()
    captured: list[MIMEMultipart] = []

    async def fake_send(msg, **kwargs):
        captured.append(msg)

    with patch("app.services.email_service.aiosmtplib.send", new=fake_send), \
         patch("app.services.email_service.decrypt_secret", return_value="plain-pw"):
        await send_email(gs, "to@example.com", "Hello World", "<b>hi</b>")

    assert len(captured) == 1
    msg = captured[0]
    assert msg["From"] == "noreply@example.com"
    assert msg["To"] == "to@example.com"
    assert msg["Subject"] == "Hello World"
    assert msg["Cc"] is None


async def test_send_email_sets_cc_header_when_provided():
    gs = _make_gs()
    captured: list[MIMEMultipart] = []

    async def fake_send(msg, **kwargs):
        captured.append(msg)

    with patch("app.services.email_service.aiosmtplib.send", new=fake_send), \
         patch("app.services.email_service.decrypt_secret", return_value="plain-pw"):
        await send_email(gs, "to@example.com", "Subject", "<p>body</p>", cc="cc@example.com")

    msg = captured[0]
    assert msg["Cc"] == "cc@example.com"


async def test_send_email_attaches_html_part():
    gs = _make_gs()
    captured: list[MIMEMultipart] = []

    async def fake_send(msg, **kwargs):
        captured.append(msg)

    with patch("app.services.email_service.aiosmtplib.send", new=fake_send), \
         patch("app.services.email_service.decrypt_secret", return_value="plain-pw"):
        await send_email(gs, "to@example.com", "Subject", "<p>hello</p>")

    msg = captured[0]
    payloads = msg.get_payload()
    assert len(payloads) == 1
    assert payloads[0].get_content_type() == "text/html"
    assert "<p>hello</p>" in payloads[0].get_payload()


# ---------------------------------------------------------------------------
# send_email — recipients list
# ---------------------------------------------------------------------------

async def test_send_email_recipients_without_cc():
    gs = _make_gs()
    send_mock = AsyncMock()

    with patch("app.services.email_service.aiosmtplib.send", new=send_mock), \
         patch("app.services.email_service.decrypt_secret", return_value="pw"):
        await send_email(gs, "only@example.com", "Subj", "<p/>")

    kwargs = send_mock.await_args.kwargs
    assert kwargs["recipients"] == ["only@example.com"]


async def test_send_email_recipients_with_cc():
    gs = _make_gs()
    send_mock = AsyncMock()

    with patch("app.services.email_service.aiosmtplib.send", new=send_mock), \
         patch("app.services.email_service.decrypt_secret", return_value="pw"):
        await send_email(gs, "to@example.com", "Subj", "<p/>", cc="cc@example.com")

    kwargs = send_mock.await_args.kwargs
    assert kwargs["recipients"] == ["to@example.com", "cc@example.com"]


# ---------------------------------------------------------------------------
# send_email — SMTP connection parameters
# ---------------------------------------------------------------------------

async def test_send_email_passes_smtp_parameters_correctly():
    gs = _make_gs(
        smtp_host="mail.corp.com",
        smtp_port=465,
        smtp_username="user@corp.com",
        smtp_password="enc-blob",
        smtp_use_tls=True,
        smtp_encryption="tls",
    )
    send_mock = AsyncMock()

    with patch("app.services.email_service.aiosmtplib.send", new=send_mock), \
         patch("app.services.email_service.decrypt_secret", return_value="decrypted-pw"):
        await send_email(gs, "to@example.com", "Subj", "<p/>")

    kwargs = send_mock.await_args.kwargs
    assert kwargs["hostname"] == "mail.corp.com"
    assert kwargs["port"] == 465
    assert kwargs["username"] == "user@corp.com"
    assert kwargs["password"] == "decrypted-pw"
    assert kwargs["use_tls"] is True
    assert kwargs["start_tls"] is False


async def test_send_email_start_tls_mode_uses_starttls():
    gs = _make_gs(smtp_encryption="starttls")
    send_mock = AsyncMock()

    with patch("app.services.email_service.aiosmtplib.send", new=send_mock), \
         patch("app.services.email_service.decrypt_secret", return_value="pw"):
        await send_email(gs, "to@example.com", "Subj", "<p/>")

    kwargs = send_mock.await_args.kwargs
    assert kwargs["use_tls"] is False
    assert kwargs["start_tls"] is True


async def test_send_email_none_mode_uses_plain_smtp():
    gs = _make_gs(smtp_encryption="none")
    send_mock = AsyncMock()

    with patch("app.services.email_service.aiosmtplib.send", new=send_mock), \
         patch("app.services.email_service.decrypt_secret", return_value="pw"):
        await send_email(gs, "to@example.com", "Subj", "<p/>")

    kwargs = send_mock.await_args.kwargs
    assert kwargs["use_tls"] is False
    assert kwargs["start_tls"] is False


async def test_send_email_legacy_use_tls_fallback_still_maps_to_tls():
    gs = _make_gs(smtp_use_tls=True)
    del gs.smtp_encryption
    send_mock = AsyncMock()

    with patch("app.services.email_service.aiosmtplib.send", new=send_mock), \
         patch("app.services.email_service.decrypt_secret", return_value="pw"):
        await send_email(gs, "to@example.com", "Subj", "<p/>")

    kwargs = send_mock.await_args.kwargs
    assert kwargs["use_tls"] is True
    assert kwargs["start_tls"] is False


async def test_send_email_passes_none_for_blank_username():
    """When smtp_username is blank the service should pass None to aiosmtplib."""
    gs = _make_gs(smtp_username="")
    send_mock = AsyncMock()

    with patch("app.services.email_service.aiosmtplib.send", new=send_mock), \
         patch("app.services.email_service.decrypt_secret", return_value=""):
        await send_email(gs, "to@example.com", "Subj", "<p/>")

    kwargs = send_mock.await_args.kwargs
    # "" or None both evaluate as falsy; the service uses `or None` so blank → None
    assert kwargs["username"] is None


async def test_send_email_passes_none_for_blank_password():
    """When decrypt_secret returns blank the service should pass None to aiosmtplib."""
    gs = _make_gs(smtp_password="")
    send_mock = AsyncMock()

    with patch("app.services.email_service.aiosmtplib.send", new=send_mock), \
         patch("app.services.email_service.decrypt_secret", return_value=""):
        await send_email(gs, "to@example.com", "Subj", "<p/>")

    kwargs = send_mock.await_args.kwargs
    assert kwargs["password"] is None


# ---------------------------------------------------------------------------
# send_test_email — HTML content and delegation
# ---------------------------------------------------------------------------

async def test_send_test_email_html_contains_smtp_settings():
    gs = _make_gs(
        smtp_host="mail.corp.com",
        smtp_port=465,
        smtp_encryption="tls",
        smtp_sender="sender@corp.com",
    )
    captured_html: list[str] = []

    async def fake_send_email(gs_arg, to_arg, subject_arg, html_body_arg, cc=None):
        captured_html.append(html_body_arg)

    with patch("app.services.email_service.send_email", new=fake_send_email):
        await send_test_email(gs, "admin@corp.com")

    assert len(captured_html) == 1
    html = captured_html[0]
    text = _html_text(html)
    assert f"Server: {gs.smtp_host}:{gs.smtp_port} | Encryption: TLS/SSL | Sender: {gs.smtp_sender}" in text


async def test_send_test_email_html_shows_plain_smtp():
    gs = _make_gs(smtp_encryption="none")
    captured_html: list[str] = []

    async def fake_send_email(gs_arg, to_arg, subject_arg, html_body_arg, cc=None):
        captured_html.append(html_body_arg)

    with patch("app.services.email_service.send_email", new=fake_send_email):
        await send_test_email(gs, "admin@corp.com")

    assert "Encryption: None" in _html_text(captured_html[0])


async def test_send_test_email_delegates_to_send_email_with_correct_to():
    gs = _make_gs()
    captured_to: list[str] = []

    async def fake_send_email(gs_arg, to_arg, subject_arg, html_body_arg, cc=None):
        captured_to.append(to_arg)

    with patch("app.services.email_service.send_email", new=fake_send_email):
        await send_test_email(gs, "recipient@example.com")

    assert captured_to == ["recipient@example.com"]


# ---------------------------------------------------------------------------
# _send_test_email_impl — subject line
# ---------------------------------------------------------------------------

async def test_send_test_email_impl_uses_fixed_subject():
    gs = _make_gs()
    captured_subjects: list[str] = []

    async def fake_send_email(gs_arg, to_arg, subject_arg, html_body_arg, cc=None):
        captured_subjects.append(subject_arg)

    with patch("app.services.email_service.send_email", new=fake_send_email):
        await _send_test_email_impl(gs, "to@example.com", "<p>test</p>")

    assert captured_subjects == ["License Lifecycle Management - Test Email"]


async def test_send_test_email_impl_forwards_html_body():
    gs = _make_gs()
    captured_html: list[str] = []

    async def fake_send_email(gs_arg, to_arg, subject_arg, html_body_arg, cc=None):
        captured_html.append(html_body_arg)

    with patch("app.services.email_service.send_email", new=fake_send_email):
        await _send_test_email_impl(gs, "to@example.com", "<p>custom-content</p>")

    assert captured_html == ["<p>custom-content</p>"]
