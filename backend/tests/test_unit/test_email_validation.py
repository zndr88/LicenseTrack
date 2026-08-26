"""Unit tests for app.services.email_validation.reject_email_crlf.

CVE-2026-53533 / GHSA-v3q9-hj7j-63hq hardening: email-like fields must
reject embedded CR/LF/NUL bytes (SMTP command injection) while still
allowing blank/None "not set" values and loosely-formatted display strings.
"""

import pytest

from app.services.email_validation import (
    email_domain,
    is_email_domain_allowed,
    reject_email_crlf,
    sanitize_email_header,
)


# ── allowed "not set" sentinels ──────────────────────────────────────────────

def test_reject_email_crlf_allows_none():
    assert reject_email_crlf(None) is None


def test_reject_email_crlf_allows_empty_string():
    assert reject_email_crlf("") == ""


# ── normal values pass through (stripped) ────────────────────────────────────

def test_reject_email_crlf_allows_plain_address():
    assert reject_email_crlf("owner@example.com") == "owner@example.com"


def test_reject_email_crlf_allows_display_name_format():
    value = "First Last <a@b.com>"
    assert reject_email_crlf(value) == value


def test_reject_email_crlf_strips_whitespace():
    assert reject_email_crlf("  owner@example.com  ") == "owner@example.com"


# ── injection payloads are rejected ──────────────────────────────────────────

@pytest.mark.parametrize("payload", [
    "a@b.com\r\nRCPT TO:<evil@x>",
    "a@b.com\nRCPT TO:<evil@x>",
    "a@b.com\rRCPT TO:<evil@x>",
    "a@b.com\x00",
    "a@b.com\r\nb@c.com",
])
def test_reject_email_crlf_rejects_control_chars(payload):
    with pytest.raises(ValueError):
        reject_email_crlf(payload)


def test_reject_email_crlf_allows_pure_whitespace_that_strips_to_blank():
    """A value that is only CR/LF/whitespace strips down to '' — equivalent to
    "not set" and never reaches the SMTP layer as a non-empty recipient, so it
    is not treated as an injection attempt."""
    assert reject_email_crlf("\r\n") == ""


def test_email_domain_parses_display_name_and_normalizes_domain():
    assert email_domain("Owner Name <owner@EXAMPLE.com.>") == "example.com"


def test_email_domain_rejects_multiple_mailboxes():
    assert email_domain("one@example.com, two@example.com") is None


def test_is_email_domain_allowed_normalizes_configured_domain():
    assert is_email_domain_allowed("Owner <owner@example.com>", ["@EXAMPLE.COM."]) is True


def test_sanitize_email_header_removes_control_characters():
    assert sanitize_email_header("Safe\r\nBcc: attacker@example.com\x00") == (
        "Safe  Bcc: attacker@example.com"
    )
