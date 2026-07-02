#!/usr/bin/env python3
"""Submit a fake document-processing result without running a webhook receiver.

Usage:
  python examples/submit-document-processing-result.py \
    --base-url http://localhost:8000 \
    --token lt_... \
    --document-type license_document \
    --document-id 123 \
    --quantity 42
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request


def request_json(
    base_url: str,
    token: str,
    path: str,
    method: str,
    payload: dict,
) -> tuple[int, object]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "LicenseTrack-Submit-Processing-Result-Example/0.1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            body = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            body = raw
        return exc.code, body


def main() -> int:
    parser = argparse.ArgumentParser(description="Submit a fake LicenseTrack document-processing result.")
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--token", required=True)
    parser.add_argument("--document-type", choices=["license_document", "procurement_document"], required=True)
    parser.add_argument("--document-id", type=int, required=True)
    parser.add_argument("--capability-key", default="licensetrack-ai")
    parser.add_argument("--quantity", default="42")
    args = parser.parse_args()

    payload = {
        "documentType": args.document_type,
        "documentId": args.document_id,
        "capabilityKey": args.capability_key,
        "summary": "Example processor detected entitlement details.",
        "suggestedFields": [
            {
                "field": "quantity",
                "value": args.quantity,
                "confidence": 0.5,
                "source": "Example script",
                "note": "Static smoke-test value; no parsing was performed.",
            }
        ],
        "rawOutput": {
            "processor": "submit-document-processing-result-example",
        },
    }

    status, body = request_json(args.base_url, args.token, "/api/document-processing-results", "POST", payload)
    print(f"POST /api/document-processing-results -> {status}")
    print(json.dumps(body, indent=2))

    if status != 201:
        return 1
    print(f"Created pending processing result {body['id']}. Review it in the license Documents section.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
