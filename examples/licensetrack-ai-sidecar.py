#!/usr/bin/env python3
"""
Minimal LicenseTrack document-processing sidecar.

This example receives LicenseTrack webhooks, verifies the HMAC signature,
downloads the requested document, and posts a fake extraction result back to
LicenseTrack. It intentionally does not call an AI provider yet; use it to prove
the API/webhook integration loop end to end before adding real parsing.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


DEFAULT_CAPABILITY_KEY = "licensetrack-ai"
DEFAULT_CAPABILITY_NAME = "LicenseTrack AI"
DEFAULT_TIMEOUT_SECONDS = 20
DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300


def parse_detail(detail: str | None) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in (detail or "").splitlines():
        key, separator, value = line.partition("=")
        if separator:
            values[key.strip()] = value.strip()
    return values


def build_signature(secret: str, timestamp: str, body: bytes) -> str:
    signed_payload = timestamp.encode("utf-8") + b"." + body
    digest = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def verify_signature(
    *,
    secret: str,
    timestamp: str | None,
    signature: str | None,
    body: bytes,
    tolerance_seconds: int = DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
) -> bool:
    if not timestamp or not signature:
        return False
    try:
        timestamp_int = int(timestamp)
    except ValueError:
        return False
    if abs(int(time.time()) - timestamp_int) > tolerance_seconds:
        return False
    expected = build_signature(secret, timestamp, body)
    return hmac.compare_digest(expected, signature)


def request_json(
    method: str,
    url: str,
    *,
    token: str,
    payload: dict[str, Any] | None = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> Any:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "LicenseTrack-AI-Sidecar-Example/0.1",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read()
        return json.loads(body.decode("utf-8")) if body else None


def download_document(
    *,
    base_url: str,
    token: str,
    document_type: str,
    document_id: str,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> bytes:
    if document_type == "license_document":
        path = f"/api/documents/{document_id}/download"
    elif document_type == "procurement_document":
        path = f"/api/procurement-documents/{document_id}/download"
    else:
        raise ValueError(f"Unsupported documentType: {document_type}")

    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": "LicenseTrack-AI-Sidecar-Example/0.1",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def register_capability(*, base_url: str, token: str, capability_key: str) -> Any:
    return request_json(
        "PUT",
        f"{base_url.rstrip('/')}/api/extensions/capabilities/{capability_key}",
        token=token,
        payload={
            "name": DEFAULT_CAPABILITY_NAME,
            "capabilityType": "document.processing",
            "status": "available",
            "description": "Example sidecar processor with fake extraction output.",
        },
    )


def submit_processing_result(
    *,
    base_url: str,
    token: str,
    capability_key: str,
    document_type: str,
    document_id: str,
    document_bytes: bytes,
    suggested_quantity: str,
) -> Any:
    return request_json(
        "POST",
        f"{base_url.rstrip('/')}/api/document-processing-results",
        token=token,
        payload={
            "documentType": document_type,
            "documentId": int(document_id),
            "capabilityKey": capability_key,
            "summary": "Example sidecar detected entitlement details.",
            "suggestedFields": [
                {
                    "field": "quantity",
                    "value": suggested_quantity,
                    "confidence": 0.5,
                    "source": "Example sidecar",
                    "note": "Static smoke-test value; no AI parsing was performed.",
                }
            ],
            "rawOutput": {
                "processor": "licensetrack-ai-sidecar-example",
                "bytesDownloaded": len(document_bytes),
            },
        },
    )


class SidecarHandler(BaseHTTPRequestHandler):
    server: "SidecarServer"

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send_json(200, {"status": "ok"})
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path != "/webhook":
            self._send_json(404, {"error": "Not found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        if not verify_signature(
            secret=self.server.webhook_secret,
            timestamp=self.headers.get("X-LicenseTrack-Timestamp"),
            signature=self.headers.get("X-LicenseTrack-Signature"),
            body=body,
            tolerance_seconds=self.server.signature_tolerance_seconds,
        ):
            self._send_json(401, {"error": "Invalid webhook signature"})
            return

        try:
            payload = json.loads(body.decode("utf-8"))
            result = self.server.handle_webhook(payload)
        except Exception as exc:  # Keep example service debuggable.
            self._send_json(500, {"error": str(exc)})
            return
        self._send_json(202, result)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}")

    def _send_json(self, status_code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class SidecarServer(ThreadingHTTPServer):
    def __init__(
        self,
        server_address: tuple[str, int],
        handler_class: type[BaseHTTPRequestHandler],
        *,
        base_url: str,
        api_token: str,
        webhook_secret: str,
        capability_key: str,
        suggested_quantity: str,
        signature_tolerance_seconds: int,
    ) -> None:
        super().__init__(server_address, handler_class)
        self.base_url = base_url
        self.api_token = api_token
        self.webhook_secret = webhook_secret
        self.capability_key = capability_key
        self.suggested_quantity = suggested_quantity
        self.signature_tolerance_seconds = signature_tolerance_seconds

    def handle_webhook(self, payload: dict[str, Any]) -> dict[str, Any]:
        if payload.get("event") != "document_action.requested":
            return {"status": "ignored", "reason": "Unsupported event"}

        detail = parse_detail(payload.get("detail"))
        if detail.get("action") != "request_processing":
            return {"status": "ignored", "reason": "Unsupported action"}

        document_type = detail.get("documentType") or payload.get("targetType")
        document_id = str(payload.get("targetId") or "")
        if not document_type or not document_id:
            raise ValueError("Webhook payload does not include document type/id")

        document_bytes = download_document(
            base_url=self.base_url,
            token=self.api_token,
            document_type=document_type,
            document_id=document_id,
        )
        response = submit_processing_result(
            base_url=self.base_url,
            token=self.api_token,
            capability_key=self.capability_key,
            document_type=document_type,
            document_id=document_id,
            document_bytes=document_bytes,
            suggested_quantity=self.suggested_quantity,
        )
        return {"status": "submitted", "resultId": response.get("id")}


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the example LicenseTrack AI sidecar.")
    parser.add_argument("--host", default=os.environ.get("SIDECAR_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("SIDECAR_PORT", "9010")))
    parser.add_argument("--base-url", default=os.environ.get("LT_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--capability-key", default=os.environ.get("LT_CAPABILITY_KEY", DEFAULT_CAPABILITY_KEY))
    parser.add_argument("--suggested-quantity", default=os.environ.get("LT_FAKE_QUANTITY", "25"))
    parser.add_argument("--register-capability", action="store_true")
    parser.add_argument("--signature-tolerance-seconds", type=int, default=DEFAULT_SIGNATURE_TOLERANCE_SECONDS)
    args = parser.parse_args()

    api_token = require_env("LT_API_TOKEN")
    webhook_secret = require_env("LT_WEBHOOK_SECRET")

    if args.register_capability:
        capability = register_capability(
            base_url=args.base_url,
            token=api_token,
            capability_key=args.capability_key,
        )
        print(f"Registered capability: {capability.get('key')} ({capability.get('status')})")

    server = SidecarServer(
        (args.host, args.port),
        SidecarHandler,
        base_url=args.base_url,
        api_token=api_token,
        webhook_secret=webhook_secret,
        capability_key=args.capability_key,
        suggested_quantity=args.suggested_quantity,
        signature_tolerance_seconds=args.signature_tolerance_seconds,
    )
    print(f"Listening on http://{args.host}:{args.port}/webhook")
    server.serve_forever()


if __name__ == "__main__":
    main()
