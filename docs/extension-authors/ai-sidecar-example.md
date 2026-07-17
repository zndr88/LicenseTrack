# AI Sidecar Example

`examples/licensetrack-ai-sidecar.py` is a minimal document-processing sidecar. It proves the current API/webhook integration loop without using a real AI provider:

1. receives `document_action.requested` webhooks;
2. verifies the LicenseTrack webhook signature;
3. downloads the requested document through the LicenseTrack API;
4. submits a fake `quantity` suggestion to `POST /api/document-processing-results`.

It is an example scaffold, not a production parser and not an installable plugin. Operators still need to configure the API token, webhook endpoint, capability declaration, and sidecar runtime manually.

## Requirements

- LicenseTrack backend running.
- A LicenseTrack API token with:
  - `documents:read`
  - `documents:write`
  - `extensions:write`
- A webhook endpoint in Admin Settings subscribed to `document_action.requested`.
- The webhook signing secret copied when the webhook endpoint is created.

For local testing, the sidecar must be reachable from the host running LicenseTrack via a non-loopback address. LicenseTrack's SSRF guard blocks `localhost`, `127.x.x.x`, and RFC-1918 ranges when delivering webhooks, so those URLs will be rejected. Use your machine's LAN IP (e.g. `http://192.168.1.50:9010/webhook`) or, if both processes run in Docker, a shared Docker network with service names.

Check that the port is free before using it. Some desktop tools bind local ports for their own services. For example, if `http://127.0.0.1:9010/health` returns `426 Upgrade Required`, another process is answering on that port. Start the sidecar on another free port and update the webhook URL to match:

```powershell
py -3.12 .\examples\licensetrack-ai-sidecar.py --port 9011 --register-capability
```

## Start The Sidecar

Open a PowerShell window from the repository root:

```powershell
cd C:\path\to\LicenseTrack

$env:LT_BASE_URL = "http://localhost:8000"
$env:LT_API_TOKEN = "lt_your_token"
$env:LT_WEBHOOK_SECRET = "whsec_your_webhook_signing_secret"
$env:LT_FAKE_QUANTITY = "25"

py -3.12 .\examples\licensetrack-ai-sidecar.py --register-capability
```

The service listens on:

```text
http://127.0.0.1:9010/webhook
```

Confirm the health endpoint before creating or testing the webhook:

```powershell
Invoke-RestMethod "http://127.0.0.1:9010/health"
```

If you started the sidecar with `--port 9011`, use `http://127.0.0.1:9011/health` and configure the webhook URL as `http://127.0.0.1:9011/webhook`.

If LicenseTrack is running in Docker or another host context, use a webhook URL that is reachable from that backend process.

## Manual End-To-End Test

1. In Admin Settings, create or edit a webhook endpoint:
   - URL: `http://localhost:9010/webhook`
   - Events: `document_action.requested`
   - Active: enabled
2. Open a license with an uploaded document.
3. Expand Documents.
4. Click the document processing action.
5. The sidecar should log the webhook request and submit a pending result.
6. The Documents section should show a pending suggestion with the fake quantity.
7. Accept or reject the suggestion in LicenseTrack.

## Notes

- The example verifies `X-LicenseTrack-Signature` using the documented `{timestamp}.{raw_json_body}` HMAC contract.
- The example rejects stale signatures using a five-minute tolerance.
- The fake extraction output is intentional. Add real AI/provider calls only after this loop works reliably in your environment.
- For production use, run behind HTTPS, protect the API token and signing secret, and add durable logging/queueing.
