"""
Unit tests for app.services.webhook_service.

Covers the lines missing from the 61% baseline:
  - _build_signature (lines 61-63)
  - _post_webhook success and HTTPError paths (lines 67-87)
  - deliver_webhook_delivery: missing/inactive endpoint (lines 93-95)
  - deliver_webhook_delivery: HTTP error, generic exception, retry/fail
    logic (lines 109-119)
  - dispatch_pending_webhooks (lines 123-136)
"""

from __future__ import annotations

import urllib.error
from datetime import datetime, timezone
from unittest.mock import MagicMock

from sqlalchemy import select

from app.models.user import User, UserRole
from app.models.webhook import WebhookDelivery, WebhookEndpoint
from app.services import webhook_service
from app.services.webhook_service import (
    MAX_WEBHOOK_ATTEMPTS,
    _build_signature,
    _matches_event,
    _post_webhook,
    deliver_webhook_delivery,
    decode_events,
    dispatch_pending_webhooks,
    encode_events,
    enqueue_webhook_deliveries,
    generate_signing_secret,
)
from app.services.crypto_service import encrypt_secret


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_endpoint(db_session, *, events="license.created", is_active=True):
    """Persist a minimal WebhookEndpoint (and a required owner User) and return it."""
    owner = User(
        username="webhookowner",
        email="webhookowner@test.local",
        hashed_password="x",
        role=UserRole.admin,
    )
    db_session.add(owner)
    await db_session.flush()

    secret = encrypt_secret("whsec_testsecret")
    endpoint = WebhookEndpoint(
        name="Test Endpoint",
        url="https://example.com/hook",
        secret=secret,
        events=events,
        is_active=is_active,
        created_by=owner.id,
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(endpoint)
    return endpoint


def _make_delivery(endpoint, *, status="pending", attempts=0, next_attempt_at=None):
    """Return an unsaved WebhookDelivery linked to *endpoint*."""
    return WebhookDelivery(
        endpoint_id=endpoint.id,
        event_type="license.created",
        payload={"event": "license.created"},
        status=status,
        attempts=attempts,
        next_attempt_at=next_attempt_at,
    )


# ---------------------------------------------------------------------------
# Pure-function tests (no DB needed)
# ---------------------------------------------------------------------------


def test_encode_events_deduplicates_and_sorts():
    result = encode_events(["b", "a", "b"])
    assert result == "a,b"


def test_decode_events_splits_on_comma():
    endpoint = MagicMock()
    endpoint.events = "license.created,license.updated"
    assert decode_events(endpoint) == ["license.created", "license.updated"]


def test_decode_events_ignores_empty_segments():
    endpoint = MagicMock()
    endpoint.events = ",license.created,"
    assert decode_events(endpoint) == ["license.created"]


def test_generate_signing_secret_format():
    secret = generate_signing_secret()
    assert secret.startswith("whsec_")
    assert len(secret) > 10


def test_matches_event_wildcard():
    endpoint = MagicMock()
    endpoint.events = "*"
    assert _matches_event(endpoint, "anything.goes")


def test_matches_event_specific_match():
    endpoint = MagicMock()
    endpoint.events = "license.created"
    assert _matches_event(endpoint, "license.created")
    assert not _matches_event(endpoint, "license.deleted")


# ---------------------------------------------------------------------------
# _build_signature (lines 61-63)
# ---------------------------------------------------------------------------


def test_build_signature_format():
    sig = _build_signature("mysecret", "1700000000", b'{"key":"value"}')
    assert sig.startswith("sha256=")
    assert len(sig) > 10


def test_build_signature_deterministic():
    sig1 = _build_signature("secret", "12345", b"body")
    sig2 = _build_signature("secret", "12345", b"body")
    assert sig1 == sig2


def test_build_signature_changes_with_different_inputs():
    sig1 = _build_signature("secret", "12345", b"body")
    sig2 = _build_signature("other_secret", "12345", b"body")
    assert sig1 != sig2


# ---------------------------------------------------------------------------
# _post_webhook — success path (lines 67-87)
# ---------------------------------------------------------------------------


def test_post_webhook_success(monkeypatch):
    endpoint = MagicMock()
    endpoint.url = "https://example.com/hook"
    endpoint.secret = encrypt_secret("whsec_testsecret")

    delivery = MagicMock()
    delivery.payload = {"event": "license.created"}
    delivery.event_type = "license.created"
    delivery.id = 42

    fake_response = MagicMock()
    fake_response.__enter__ = lambda s: fake_response
    fake_response.__exit__ = MagicMock(return_value=False)
    fake_response.status = 200
    fake_response.read.return_value = b"OK"

    fake_opener = MagicMock()
    fake_opener.open.return_value = fake_response
    monkeypatch.setattr(webhook_service.urllib.request, "build_opener", lambda *_handlers: fake_opener)

    status_code, body = _post_webhook(endpoint, delivery)

    assert status_code == 200
    assert body == "OK"


def test_post_webhook_http_error(monkeypatch):
    """_post_webhook must catch urllib.error.HTTPError and return (code, body)."""
    endpoint = MagicMock()
    endpoint.url = "https://example.com/hook"
    endpoint.secret = encrypt_secret("whsec_testsecret")

    delivery = MagicMock()
    delivery.payload = {"event": "license.created"}
    delivery.event_type = "license.created"
    delivery.id = 42

    http_err = urllib.error.HTTPError(
        url="https://example.com/hook",
        code=503,
        msg="Service Unavailable",
        hdrs=None,
        fp=None,
    )
    http_err.read = lambda n: b"Service Unavailable"

    fake_opener = MagicMock()
    fake_opener.open.side_effect = http_err
    monkeypatch.setattr(webhook_service.urllib.request, "build_opener", lambda *_handlers: fake_opener)

    status_code, body = _post_webhook(endpoint, delivery)

    assert status_code == 503
    assert "Service Unavailable" in body


# ---------------------------------------------------------------------------
# deliver_webhook_delivery — missing / inactive endpoint (lines 93-95)
# ---------------------------------------------------------------------------


async def test_deliver_webhook_delivery_missing_endpoint(db_session):
    """When the endpoint row does not exist the delivery should be failed."""
    # Use a transient (not persisted) delivery to avoid FK violation on endpoint_id=9999.
    delivery = WebhookDelivery(
        endpoint_id=9999,  # non-existent
        event_type="license.created",
        payload={"event": "license.created"},
        status="pending",
        attempts=0,
    )

    await deliver_webhook_delivery(db_session, delivery)

    assert delivery.status == "failed"
    assert "inactive or missing" in (delivery.error or "")


async def test_deliver_webhook_delivery_inactive_endpoint(db_session):
    """An inactive endpoint should also mark the delivery as failed."""
    endpoint = await _make_endpoint(db_session, is_active=False)
    await db_session.flush()

    delivery = _make_delivery(endpoint)
    db_session.add(delivery)
    await db_session.commit()

    await deliver_webhook_delivery(db_session, delivery)

    assert delivery.status == "failed"
    assert "inactive or missing" in (delivery.error or "")


# ---------------------------------------------------------------------------
# deliver_webhook_delivery — HTTP error response (non-2xx), lines 109-119
# ---------------------------------------------------------------------------


async def test_deliver_webhook_delivery_non2xx_response(db_session, monkeypatch):
    """A non-2xx response should set error, increment attempts and re-schedule."""
    endpoint = await _make_endpoint(db_session)
    await db_session.flush()

    delivery = _make_delivery(endpoint)
    db_session.add(delivery)
    await db_session.commit()

    monkeypatch.setattr(webhook_service, "_post_webhook", lambda ep, dl: (500, "Internal Server Error"))

    await deliver_webhook_delivery(db_session, delivery)

    assert delivery.status == "pending"  # not yet at MAX_WEBHOOK_ATTEMPTS
    assert delivery.attempts == 1
    assert delivery.error == "HTTP 500"
    assert delivery.next_attempt_at is not None
    assert endpoint.last_failure_at is not None


async def test_deliver_webhook_delivery_success(db_session, monkeypatch):
    """A 2xx response must flip the delivery to succeeded and record timestamps."""
    endpoint = await _make_endpoint(db_session)
    await db_session.flush()

    delivery = _make_delivery(endpoint)
    db_session.add(delivery)
    await db_session.commit()

    monkeypatch.setattr(webhook_service, "_post_webhook", lambda ep, dl: (200, "OK"))

    await deliver_webhook_delivery(db_session, delivery)

    assert delivery.status == "succeeded"
    assert delivery.attempts == 1
    assert delivery.response_status == 200
    assert delivery.delivered_at is not None
    assert delivery.error is None
    assert endpoint.last_success_at is not None


async def test_deliver_webhook_delivery_generic_exception(db_session, monkeypatch):
    """A generic exception from _post_webhook should capture the error string."""
    endpoint = await _make_endpoint(db_session)
    await db_session.flush()

    delivery = _make_delivery(endpoint)
    db_session.add(delivery)
    await db_session.commit()

    def boom(ep, dl):
        raise ConnectionError("Connection refused")

    monkeypatch.setattr(webhook_service, "_post_webhook", boom)

    await deliver_webhook_delivery(db_session, delivery)

    assert delivery.status == "pending"
    assert "Connection refused" in delivery.error
    assert endpoint.last_failure_at is not None


async def test_deliver_webhook_delivery_fails_after_max_attempts(db_session, monkeypatch):
    """After MAX_WEBHOOK_ATTEMPTS failures the status must become 'failed'."""
    endpoint = await _make_endpoint(db_session)
    await db_session.flush()

    # pre-set attempts to one below the maximum so this attempt tips it over
    delivery = _make_delivery(endpoint, attempts=MAX_WEBHOOK_ATTEMPTS - 1)
    db_session.add(delivery)
    await db_session.commit()

    monkeypatch.setattr(webhook_service, "_post_webhook", lambda ep, dl: (500, "fail"))

    await deliver_webhook_delivery(db_session, delivery)

    assert delivery.status == "failed"
    assert delivery.attempts == MAX_WEBHOOK_ATTEMPTS
    assert delivery.next_attempt_at is None


# ---------------------------------------------------------------------------
# enqueue_webhook_deliveries — active endpoint not subscribed to event
# ---------------------------------------------------------------------------


async def test_enqueue_webhook_deliveries_no_match(db_session):
    """Active endpoint subscribed to a different event should not be enqueued."""
    await _make_endpoint(db_session, events="license.deleted")
    await db_session.flush()
    await db_session.commit()

    await enqueue_webhook_deliveries(db_session, event_type="license.created", payload={"event": "license.created"})

    deliveries = (await db_session.execute(select(WebhookDelivery))).scalars().all()
    assert len(deliveries) == 0


async def test_enqueue_webhook_deliveries_wildcard_matches(db_session):
    """Endpoint subscribed to '*' should receive any event."""
    await _make_endpoint(db_session, events="*")
    await db_session.flush()
    await db_session.commit()

    await enqueue_webhook_deliveries(db_session, event_type="anything.happened", payload={"event": "anything.happened"})
    await db_session.commit()

    delivery = (await db_session.execute(select(WebhookDelivery))).scalars().first()
    assert delivery is not None
    assert delivery.event_type == "anything.happened"


# ---------------------------------------------------------------------------
# dispatch_pending_webhooks (lines 123-136)
# ---------------------------------------------------------------------------


async def test_dispatch_pending_webhooks_processes_pending(monkeypatch):
    """dispatch_pending_webhooks must call deliver_webhook_delivery for each pending row."""
    calls = []

    async def fake_deliver(db, delivery):
        calls.append(delivery.id)
        delivery.status = "succeeded"

    monkeypatch.setattr(webhook_service, "deliver_webhook_delivery", fake_deliver)

    # We need rows in the real AsyncSessionLocal database; patch AsyncSessionLocal
    # to return a session that yields our controlled deliveries.
    fake_delivery = MagicMock()
    fake_delivery.id = 1
    fake_delivery.status = "pending"
    fake_delivery.next_attempt_at = None

    fake_result = MagicMock()
    fake_result.scalars.return_value.all.return_value = [fake_delivery]

    fake_db = MagicMock()
    fake_db.execute = MagicMock(return_value=_async_return(fake_result))
    fake_db.commit = MagicMock(return_value=_async_return(None))
    fake_db.__aenter__ = MagicMock(return_value=_async_return(fake_db))
    fake_db.__aexit__ = MagicMock(return_value=_async_return(False))

    fake_session_local = MagicMock(return_value=fake_db)

    monkeypatch.setattr(webhook_service, "AsyncSessionLocal", fake_session_local)

    count = await dispatch_pending_webhooks(limit=10)

    assert count == 1
    assert calls == [1]


async def test_dispatch_pending_webhooks_returns_zero_when_empty(monkeypatch):
    """dispatch_pending_webhooks returns 0 when no pending deliveries exist."""

    async def fake_deliver(db, delivery):  # pragma: no cover
        pass

    monkeypatch.setattr(webhook_service, "deliver_webhook_delivery", fake_deliver)

    fake_result = MagicMock()
    fake_result.scalars.return_value.all.return_value = []

    fake_db = MagicMock()
    fake_db.execute = MagicMock(return_value=_async_return(fake_result))
    fake_db.commit = MagicMock(return_value=_async_return(None))
    fake_db.__aenter__ = MagicMock(return_value=_async_return(fake_db))
    fake_db.__aexit__ = MagicMock(return_value=_async_return(False))

    monkeypatch.setattr(webhook_service, "AsyncSessionLocal", MagicMock(return_value=fake_db))

    count = await dispatch_pending_webhooks()

    assert count == 0


# ---------------------------------------------------------------------------
# Async helper
# ---------------------------------------------------------------------------


class _async_return:
    """Awaitable that returns a fixed value — avoids coroutine creation boilerplate."""

    def __init__(self, value):
        self._value = value

    def __await__(self):
        yield
        return self._value
