from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import secrets
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.webhook import WebhookDelivery, WebhookEndpoint
from app.services.crypto_service import decrypt_secret, encrypt_secret
from app.services.ssrf_guard import check_ssrf

MAX_WEBHOOK_ATTEMPTS = 5
WEBHOOK_TIMEOUT_SECONDS = 10


class _SsrfRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Re-run check_ssrf on every redirect hop so a public→internal redirect is rejected."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_ssrf(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def encode_events(events: list[str]) -> str:
    return ",".join(sorted(set(events)))


def decode_events(endpoint: WebhookEndpoint) -> list[str]:
    return [event for event in endpoint.events.split(",") if event]


def generate_signing_secret() -> str:
    return f"whsec_{secrets.token_urlsafe(32)}"


def _matches_event(endpoint: WebhookEndpoint, event_type: str) -> bool:
    events = set(decode_events(endpoint))
    return "*" in events or event_type in events


async def has_active_subscriber(db: AsyncSession, event_type: str) -> bool:
    """Return whether an active webhook endpoint subscribes to an event."""
    result = await db.execute(select(WebhookEndpoint).where(WebhookEndpoint.is_active.is_(True)))
    return any(_matches_event(endpoint, event_type) for endpoint in result.scalars().all())


async def enqueue_webhook_deliveries(
    db: AsyncSession,
    *,
    event_type: str,
    payload: dict,
) -> None:
    """Create pending delivery rows for active endpoints subscribed to an event."""
    result = await db.execute(select(WebhookEndpoint).where(WebhookEndpoint.is_active.is_(True)))
    endpoints = [endpoint for endpoint in result.scalars().all() if _matches_event(endpoint, event_type)]
    for endpoint in endpoints:
        db.add(
            WebhookDelivery(
                endpoint_id=endpoint.id,
                event_type=event_type,
                payload=payload,
                status="pending",
            )
        )


def _build_signature(secret: str, timestamp: str, body: bytes) -> str:
    signed_payload = timestamp.encode("utf-8") + b"." + body
    digest = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def _post_webhook(endpoint: WebhookEndpoint, delivery: WebhookDelivery) -> tuple[int, str]:
    check_ssrf(endpoint.url)
    body = json.dumps(delivery.payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    timestamp = str(int(datetime.now(timezone.utc).timestamp()))
    secret = decrypt_secret(endpoint.secret)
    request = urllib.request.Request(
        endpoint.url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": "LicenseTrack-Webhooks/1.0",
            "X-LicenseTrack-Event": delivery.event_type,
            "X-LicenseTrack-Delivery": str(delivery.id),
            "X-LicenseTrack-Timestamp": timestamp,
            "X-LicenseTrack-Signature": _build_signature(secret, timestamp, body),
        },
    )
    opener = urllib.request.build_opener(_SsrfRedirectHandler())
    try:
        with opener.open(request, timeout=WEBHOOK_TIMEOUT_SECONDS) as response:
            return response.status, response.read(2000).decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(2000).decode("utf-8", errors="replace")


async def deliver_webhook_delivery(db: AsyncSession, delivery: WebhookDelivery) -> None:
    endpoint = await db.get(WebhookEndpoint, delivery.endpoint_id)
    if endpoint is None or not endpoint.is_active:
        delivery.status = "failed"
        delivery.error = "Webhook endpoint is inactive or missing"
        return

    delivery.attempts += 1
    try:
        status_code, response_body = await asyncio.to_thread(_post_webhook, endpoint, delivery)
        delivery.response_status = status_code
        delivery.response_body = response_body[:2000]
        delivery.error = None
        if 200 <= status_code < 300:
            delivery.status = "succeeded"
            delivery.delivered_at = datetime.now(timezone.utc)
            delivery.next_attempt_at = None
            endpoint.last_success_at = delivery.delivered_at
            return
        delivery.error = f"HTTP {status_code}"
    except Exception as exc:
        delivery.error = str(exc)[:2000]

    endpoint.last_failure_at = datetime.now(timezone.utc)
    if delivery.attempts >= MAX_WEBHOOK_ATTEMPTS:
        delivery.status = "failed"
        delivery.next_attempt_at = None
    else:
        delivery.status = "pending"
        delivery.next_attempt_at = datetime.now(timezone.utc) + timedelta(minutes=delivery.attempts * 5)


async def dispatch_pending_webhooks(limit: int = 20) -> int:
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(WebhookDelivery)
            .where(WebhookDelivery.status == "pending")
            .where((WebhookDelivery.next_attempt_at.is_(None)) | (WebhookDelivery.next_attempt_at <= now))
            .order_by(WebhookDelivery.created_at.asc(), WebhookDelivery.id.asc())
            .limit(limit)
        )
        deliveries = list(result.scalars().all())
        for delivery in deliveries:
            await deliver_webhook_delivery(db, delivery)
        await db.commit()
        return len(deliveries)


def encrypt_signing_secret(secret: str) -> str:
    return encrypt_secret(secret)
