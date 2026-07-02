#!/usr/bin/env python3
"""Create a sample sourcing request through the LicenseTrack API.

Usage:
  python examples/create-sourcing-request.py --base-url http://localhost:8000 --token lt_...
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request


def post_json(base_url: str, token: str, path: str, payload: dict) -> tuple[int, object]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
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
    parser = argparse.ArgumentParser(description="Create a sample LicenseTrack sourcing request.")
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--token", required=True)
    args = parser.parse_args()

    payload = {
        "supplier": "Example Reseller",
        "contactEmail": "sales@example-reseller.com",
        "notes": "Created by API integration example.",
        "items": [
            {
                "publisherName": "Example Publisher",
                "softwareDescription": "Example Product",
                "quantity": "25",
                "estimatedUnitPrice": "12.50",
                "estimatedTotalPrice": "312.50",
                "currency": "EUR",
                "supplier": "Example Reseller",
                "contactEmail": "sales@example-reseller.com",
            }
        ],
    }

    status, body = post_json(args.base_url, args.token, "/api/sourcing/requests", payload)
    print(f"POST /api/sourcing/requests -> {status}")
    print(json.dumps(body, indent=2))

    if status != 201:
        return 1
    print(f"Created sourcing request {body['id']} with {len(body.get('items', []))} item(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
