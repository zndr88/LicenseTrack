# Integration Recipes

These recipes show common operator-built integrations using API tokens. They are intended as starting points for private scripts, CMDB syncs, reporting jobs, optional document processors, and first-party integration pilots.

These recipes cover the supported API/webhook integration approach for custom and third-party automation. LicenseTrack does not support arbitrary third-party in-process packages; the internal Official Extensions host is reserved for packages published and signed by the LicenseTrack project.

Use an API token in the `Authorization` header:

```http
Authorization: Bearer lt_...
```

Create one token per integration and grant only the scopes needed for that job. API tokens are managed by admins in Admin Settings.

For the higher-level integration author guide and scope matrix, start with `docs/extension-authors/build-integrations.md`. For document processor sidecars, start with `docs/extension-authors/build-document-processor.md`.

## Register An Integration Capability

Required scope: `extensions:write`

```bash
curl -X PUT https://licensetrack.example.com/api/extensions/capabilities/licensetrack-ai \
  -H "Authorization: Bearer lt_your_token" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "AI document processor",
    "capabilityType": "document.processing",
    "status": "available",
    "version": "0.1.0",
    "description": "Parses selected uploaded documents."
  }'
```

Capabilities are visible to admins in Admin Settings. They are status declarations and do not install packages or load frontend/runtime code. Use `status: "misconfigured"` with `lastError` when an integration or sidecar exists but needs operator attention.

## List Licences With Custom Fields

Required scope: `licenses:read`

```bash
curl -H "Authorization: Bearer lt_your_token" \
  https://licensetrack.example.com/api/licenses
```

`GET /api/licenses` returns active, non-retired license records by default. Each license includes `customFields` inline:

```json
{
  "id": 42,
  "publisherName": "Example Publisher",
  "softwareDescription": "Example Product",
  "customFields": [
    {
      "customFieldDefId": 7,
      "valueText": "asset-team@example.com",
      "valueCurrency": null,
      "definition": {
        "id": 7,
        "name": "CMDB Owner",
        "fieldKey": "cf_cmdb_owner",
        "fieldType": "text"
      }
    }
  ]
}
```

Use `fieldKey` for integration mapping because it is stable after field creation.

## Create A Licence Record

Required scope: `licenses:write`

```bash
curl -X POST https://licensetrack.example.com/api/licenses \
  -H "Authorization: Bearer lt_your_token" \
  -H "Content-Type: application/json" \
  -d '{
    "publisherName": "Example Publisher",
    "softwareDescription": "Example Product",
    "licenseType": "subscription",
    "licenseMetric": "per_user",
    "quantity": "25",
    "currency": "EUR"
  }'
```

The response is the created license, including computed completeness, expiry status, document count, and any custom fields set later.

## Create A Sourcing Request

Required scope: `procurement:write`

```bash
curl -X POST https://licensetrack.example.com/api/sourcing/requests \
  -H "Authorization: Bearer lt_your_token" \
  -H "Content-Type: application/json" \
  -d '{
    "supplier": "Example Reseller",
    "contactEmail": "sales@example-reseller.com",
    "notes": "Created by CMDB integration",
    "items": [
      {
        "publisherName": "Example Publisher",
        "softwareDescription": "Example Product",
        "quantity": "25",
        "estimatedUnitPrice": "12.50",
        "estimatedTotalPrice": "312.50",
        "currency": "EUR",
        "supplier": "Example Reseller",
        "contactEmail": "sales@example-reseller.com"
      }
    ]
  }'
```

This creates quote-stage procurement work. The response includes the request, its items, current status, and total estimated value.

## Upload Quote Evidence

Required scopes: `documents:write` and `procurement:write`

```bash
curl -X POST https://licensetrack.example.com/api/sourcing/requests/123/quote-documents \
  -H "Authorization: Bearer lt_your_token" \
  -F "file=@quote.pdf"
```

Quote documents are scoped to the sourcing request. When sourcing work is converted, procurement evidence follows the workflow.

## Upload Licence Evidence

Required scope: `documents:write`

```bash
curl -X POST https://licensetrack.example.com/api/licenses/42/documents \
  -H "Authorization: Bearer lt_your_token" \
  -F "category=entitlement" \
  -F "file=@entitlement.pdf"
```

Allowed upload types include PDF, common image formats, CSV/text, Word documents, and Excel files. Uploaded files are stored under the configured server storage path and are not included in database backup files.

## Request Document Processing

Required scope: `documents:write`

Requires an active webhook endpoint subscribed to `document_action.requested` or `*`, plus an available `document.processing` integration capability. If either side is missing, the route returns `409 Conflict` and the document action is hidden in the UI.

```bash
curl -X POST https://licensetrack.example.com/api/document-actions/request_processing/invoke \
  -H "Authorization: Bearer lt_your_token" \
  -H "Content-Type: application/json" \
  -d '{
    "documentType": "license_document",
    "documentId": 123
  }'
```

This writes a `document_action.requested` audit event. A sidecar or internal service can subscribe to that event through webhooks and then call LicenseTrack APIs for current document and license state.

## Submit Document Processing Results

Required scopes: `documents:write` and `extensions:write`

```bash
curl -X POST https://licensetrack.example.com/api/document-processing-results \
  -H "Authorization: Bearer lt_your_token" \
  -H "Content-Type: application/json" \
  -d '{
    "documentType": "license_document",
    "documentId": 123,
    "capabilityKey": "licensetrack-ai",
    "summary": "Detected entitlement details.",
    "suggestedFields": [
      {
        "field": "quantity",
        "value": "25",
        "confidence": 0.91,
        "source": "Page 1"
      }
    ]
  }'
```

Submitted results are stored as pending proposals. LicenseTrack does not automatically apply extracted values until an editor/admin accepts them. Submitting a newer pending result for the same `documentType`, `documentId`, and `capabilityKey` supersedes older pending results for that document/processor.

For a runnable local receiver, see `examples/licensetrack-ai-sidecar.py`. It verifies `document_action.requested` webhook signatures, downloads the selected document, and posts a fake processing result back to LicenseTrack.

To review pending results through the API:

```bash
curl -H "Authorization: Bearer lt_your_token" \
  "https://licensetrack.example.com/api/document-processing-results?license_id=42&status=pending"
```

To accept a result from an API client, use a token with `documents:write` and `licenses:write`:

```bash
curl -X POST https://licensetrack.example.com/api/document-processing-results/7/accept \
  -H "Authorization: Bearer lt_your_token"
```

To accept only selected suggested fields, send their zero-based indexes:

```bash
curl -X POST https://licensetrack.example.com/api/document-processing-results/7/accept \
  -H "Authorization: Bearer lt_your_token" \
  -H "Content-Type: application/json" \
  -d '{"suggestedFieldIndexes":[0,2]}'
```

To reject a result, use `documents:write`:

```bash
curl -X POST https://licensetrack.example.com/api/document-processing-results/7/reject \
  -H "Authorization: Bearer lt_your_token"
```

## Export Licence CSV

Required scope: `licenses:read`

```bash
curl -H "Authorization: Bearer lt_your_token" \
  -o licenses_export.csv \
  https://licensetrack.example.com/api/licenses/export
```

The CSV export includes active license records and computed status columns. For full custom-field data, use `GET /api/licenses`.

## Check Expected Permission Failures

Read-only integrations should fail loudly when they attempt writes:

```bash
curl -i -X DELETE https://licensetrack.example.com/api/licenses/999999 \
  -H "Authorization: Bearer lt_read_only_token"
```

Expected response:

```json
{"detail":"API token missing required scope(s): licenses:write"}
```

Admin settings, user management, database backup, restore, authentication, and token-management routes are not API-token surfaces unless explicitly documented otherwise.

## Included Example Scripts

Smoke-test a token:

```bash
python examples/api-token-smoke-test.py --base-url http://localhost:8000 --token lt_your_token
```

Create a sourcing request:

```bash
python examples/create-sourcing-request.py --base-url http://localhost:8000 --token lt_your_token
```

Run the PowerShell integration quickstart:

```powershell
$env:LT_BASE_URL = "http://localhost:8000"
$env:LT_API_TOKEN = "lt_your_token"
powershell -ExecutionPolicy Bypass -File .\examples\integration-quickstart.ps1
```

Submit a fake document-processing result without running a webhook receiver:

```bash
python examples/submit-document-processing-result.py \
  --base-url http://localhost:8000 \
  --token lt_your_token \
  --document-type license_document \
  --document-id 123 \
  --quantity 42
```
