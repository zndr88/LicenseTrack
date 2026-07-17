# Build A Document Processor

Document processors are optional integration sidecars that inspect an uploaded document and submit suggested LicenseTrack field values for human review.

The processor may use AI, OCR, deterministic parsing, or a private rules engine. LicenseTrack does not care how the result was produced. The contract is: receive a document-processing request, inspect the document through the API, submit proposed values, and let LicenseTrack users accept or reject them.

Read `docs/extension-authors/checklist.md` first for the current framework boundaries and handoff checklist.

This is the API/webhook document-processor flow: operators configure an API token, webhook endpoint, capability declaration, and externally hosted sidecar runtime. If you would rather ship an installable package that LicenseTrack manages - with plugin-owned settings, permissions, a managed runtime, and Parse actions in the UI - use the shipped **Plugin Host v1** instead; see `docs/plugin-authors/plugin-author-guide.md`. The first-party LicenseTrack AI companion plugin uses that model, but release of the AI plugin is pending and it is not bundled with baseline LicenseTrack. See `docs/plugin-authors/plugin-host-post-v1-notes.md` for post-v1 direction.

## User Flow

1. An editor or admin uploads evidence to a license.
2. LicenseTrack shows the document action button only when:
   - an active webhook subscribes to `document_action.requested` or `*`;
   - an integration capability with `capabilityType: "document.processing"` has `status: "available"`.
3. The user clicks the document action button.
4. LicenseTrack emits an audited `document_action.requested` webhook event.
5. The processor verifies the webhook signature.
6. The processor downloads the selected document using its API token.
7. The processor submits suggested fields to `POST /api/document-processing-results`.
8. LicenseTrack shows the result as a pending review item.
9. A user accepts selected fields or rejects the result.

The processor never directly mutates the license. Review, write behavior, and audit logging stay in core.

## Required Setup

Create an API token for the processor with:

- `documents:read`
- `documents:write`
- `extensions:write`

Add `licenses:read` if the processor needs current license state beyond the document payload. Add `licenses:write` only if an API client will accept results programmatically; human review in the UI does not require the processor token to accept its own output.

Create a webhook endpoint in Admin Settings:

- URL: the processor receiver URL — must be reachable from the LicenseTrack backend via a non-loopback address. LicenseTrack's SSRF guard blocks `localhost`, `127.x.x.x`, and RFC-1918 ranges, so use your machine's LAN IP (e.g. `http://192.168.1.50:9011/webhook`) or a Docker service name if both run in the same network.
- Event: `document_action.requested`
- Active: enabled

Copy the webhook signing secret when the endpoint is created. LicenseTrack cannot show it again.

## Register Capability

Processors should declare their status:

```http
PUT /api/extensions/capabilities/licensetrack-ai
Authorization: Bearer lt_...
Content-Type: application/json

{
  "name": "LicenseTrack AI",
  "capabilityType": "document.processing",
  "status": "available",
  "version": "0.1.0",
  "description": "Parses selected uploaded documents."
}
```

Use `status: "misconfigured"` or `status: "error"` with `lastError` when operator action is needed. Admin Settings is the visibility surface for capability health; it is not a plugin installer or runtime loader.

## Webhook Contract

Subscribe to:

```text
document_action.requested
```

The webhook payload uses the audit event shape:

```json
{
  "event": "document_action.requested",
  "targetType": "license_document",
  "targetId": "123",
  "targetLabel": "entitlement.pdf",
  "detail": "action=request_processing\ndocumentType=license_document\nfilename=entitlement.pdf\nlicenseId=42"
}
```

Verify:

- `X-LicenseTrack-Timestamp`
- `X-LicenseTrack-Signature`

The signed payload is:

```text
{timestamp}.{raw_json_body}
```

See `docs/extension-authors/webhooks.md` for the full signing contract.

## Download The Document

Use the document type from the detail payload:

| Document type | Download route |
| --- | --- |
| `license_document` | `GET /api/documents/{documentId}/download` |
| `procurement_document` | `GET /api/procurement-documents/{documentId}/download` |

Receivers should treat webhook events as notifications and call the API for current data.

## Submit Suggested Fields

```http
POST /api/document-processing-results
Authorization: Bearer lt_...
Content-Type: application/json

{
  "documentType": "license_document",
  "documentId": 123,
  "capabilityKey": "licensetrack-ai",
  "summary": "Detected entitlement details.",
  "suggestedFields": [
    {
      "field": "quantity",
      "value": "25",
      "confidence": 0.91,
      "source": "Page 1",
      "note": "Seat count found near entitlement table."
    }
  ],
  "rawOutput": {
    "processor": "example"
  }
}
```

Supported targets are built-in inline-edit license fields and existing custom fields. Custom fields may be addressed by `fieldKey`, by the key without `cf_`, or by display name.

Submitting a newer pending result for the same document and capability supersedes older pending results. Older rows remain visible as history.

## Local Examples

Smoke-test the full webhook loop:

```powershell
cd C:\path\to\LicenseTrack

$env:LT_BASE_URL = "http://localhost:8000"
$env:LT_API_TOKEN = "lt_your_processor_token"
$env:LT_WEBHOOK_SECRET = "whsec_your_webhook_secret"
$env:LT_FAKE_QUANTITY = "42"

py -3.12 .\examples\licensetrack-ai-sidecar.py --port 9011 --register-capability
```

Then set the webhook URL to:

```text
http://127.0.0.1:9011/webhook
```

Submit a processing result without running a webhook receiver:

```powershell
py -3.12 .\examples\submit-document-processing-result.py `
  --base-url http://localhost:8000 `
  --token lt_your_processor_token `
  --document-type license_document `
  --document-id 123 `
  --quantity 42
```

## Troubleshooting

- If the document action button is hidden, check both the active webhook subscription and the registered `document.processing` capability.
- If the webhook delivery fails, inspect Admin Settings -> Integrations -> Webhooks -> Deliveries.
- If `/health` on a local sidecar returns `426 Upgrade Required` or another unexpected response, another process is listening on that port. Pick a free port and update the webhook URL.
- If result submission returns `409`, the capability is missing or not `available`.
- If accepting a result returns `422`, at least one accepted suggested field is unsupported or invalid.
