#!/usr/bin/env python3
"""Exercise LicenseTrack API-token access without a third-party integration.

Usage:
  python examples/api-token-smoke-test.py --base-url http://localhost:8000 --token lt_...
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request


def request_json(base_url: str, token: str, path: str, method: str = "GET") -> tuple[int, object]:
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
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
    parser = argparse.ArgumentParser(description="Smoke-test a LicenseTrack API token.")
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--token", required=True)
    args = parser.parse_args()

    licenses_status, licenses = request_json(args.base_url, args.token, "/api/licenses")
    print(f"GET /api/licenses -> {licenses_status}")
    if licenses_status != 200:
        print(json.dumps(licenses, indent=2))
        return 1

    count = len(licenses) if isinstance(licenses, list) else 0
    print(f"Visible licenses: {count}")
    if count:
        first = licenses[0]
        custom_fields = first.get("customFields", [])
        print(f"First license: {first.get('softwareDescription')} ({first.get('publisherName')})")
        print(f"First license custom fields: {len(custom_fields)}")

    denied_status, denied_body = request_json(args.base_url, args.token, "/api/licenses/999999", "DELETE")
    print(f"DELETE /api/licenses/999999 -> {denied_status}")
    if denied_status != 403:
        print("Expected a read-only token to be denied.")
        print(json.dumps(denied_body, indent=2))
        return 1

    print("API token smoke test passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
