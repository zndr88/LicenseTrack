"""Unit tests for app.services.email_service.

All SMTP I/O is mocked via unittest.mock.patch so no real network calls are made.
Tests cover:
  - send_email: missing SMTP config raises ValueError
  - send_email: message construction (From/To/Subject/Cc headers, html part)
  - send_email: recipients list with and without Cc
  - send_email: aiosmtplib.send called with correct SMTP parameters
  - send_email: smtp_username/smtp_password None-passthrough when blank
  - send_email: start_tls is inverse of smtp_use_tls
  - send_test_email: delegates to _send_test_email_impl which calls send_email
  - send_test_email: HTML body contains host/port/tls/sender tokens
  - _send_test_email_impl: calls send_email with fixed subject
"""

from __future__ import annotations

from email.mime.multipart import MIMEMultipart
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
        smtp_use_tls=True,
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
    assert kwargs["start_tls"] is False  # inverse of use_tls


async def test_send_email_start_tls_true_when_use_tls_false():
    gs = _make_gs(smtp_use_tls=False)
    send_mock = AsyncMock()

    with patch("app.services.email_service.aiosmtplib.send", new=send_mock), \
         patch("app.services.email_service.decrypt_secret", return_value="pw"):
        await send_email(gs, "to@example.com", "Subj", "<p/>")

    kwargs = send_mock.await_args.kwargs
    assert kwargs["use_tls"] is False
    assert kwargs["start_tls"] is True


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
        smtp_use_tls=True,
        smtp_sender="sender@corp.com",
    )
    captured_html: list[str] = []

    async def fake_send_email(gs_arg, to_arg, subject_arg, html_body_arg, cc=None):
        captured_html.append(html_body_arg)

    with patch("app.services.email_service.send_email", new=fake_send_email):
        await send_test_email(gs, "admin@corp.com")

    assert len(captured_html) == 1
    html = captured_html[0]
    assert "mail.corp.com" in html
    assert "465" in html
    assert "Yes" in html          # tls=True → "Yes"
    assert "sender@corp.com" in html


async def test_send_test_email_html_shows_no_for_tls_disabled():
    gs = _make_gs(smtp_use_tls=False)
    captured_html: list[str] = []

    async def fake_send_email(gs_arg, to_arg, subject_arg, html_body_arg, cc=None):
        captured_html.append(html_body_arg)

    with patch("app.services.email_service.send_email", new=fake_send_email):
        await send_test_email(gs, "admin@corp.com")

    assert "No" in captured_html[0]


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
