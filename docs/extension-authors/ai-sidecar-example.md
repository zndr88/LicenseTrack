# AI Sidecar Example

`examples/licensetrack-ai-sidecar.py` is a minimal document-processing sidecar. It proves the current API/webhook integration loop without using a real AI provider:

1. receives `document_action.requested` webhooks;
2. verifies the LicenseTrack webhook signature;
3. downloads the requested document through the LicenseTrack API;
4. submits a fake `quantity` suggestion to `POST /api/document-processing-results`.

It is an example scaffold, not a production parser or an Official Extension package. Operators still need to configure the API token, webhook endpoint, capability declaration, and sidecar runtime manually.

## Requirements

- LicenseTrack backend running.
- A LicenseTrack API token with:
  - `documents:read`
  - `documents:write`
  - `extensions:write`
- A webhook endpoint in Admin Settings subscribed to `document_action.requested`.
- The webhook signing secret copied when the webhook endpoint is created.

For local testing, the sidecar still listens on loopback, but LicenseTrack cannot
deliver a webhook directly to it. The SSRF guard blocks loopback, link-local,
RFC-1918/private, and reserved addresses, including Docker service names that
resolve into private networks. Expose the receiver through an operator-approved
HTTPS tunnel or public test reverse proxy and use that public URL as the webhook
target.

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

If you started the sidecar with `--port 9011`, use
`http://127.0.0.1:9011/health` locally and configure your tunnel or test reverse
proxy to forward to `http://127.0.0.1:9011/webhook`.

Configure LicenseTrack with the public HTTPS receiver URL, not the local forward
target.

## Manual End-To-End Test

1. In Admin Settings, create or edit a webhook endpoint:
   - URL: the public HTTPS endpoint that forwards to the local sidecar, such as
     `https://processor-test.example.com/webhook`
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
