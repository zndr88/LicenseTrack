# Document Processing Results

Document processing results are proposed extracted values submitted by an external processor after a document action is requested. LicenseTrack stores these results for review; it does not automatically mutate license or procurement records.

This is the result-intake foundation for optional document processor sidecars such as an AI parser. It is part of the supported public Integration Framework and does not load code into LicenseTrack.

## Submit A Result

Required API token scopes: `documents:write` and `extensions:write`

```http
POST /api/document-processing-results
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
    "model": "example-parser"
  }
}
```

`documentType` is either `license_document` or `procurement_document`.

`capabilityKey` must reference an available integration capability with `capabilityType: "document.processing"`. If the capability is missing or misconfigured, LicenseTrack returns `409 Conflict`.

Successful submissions are stored with `status: "pending"` and audit action `document_processing_result.created`.

When a new pending result is submitted for the same `documentType`, `documentId`, and `capabilityKey`, older pending results for that same processor/document are marked `superseded`. This keeps the review UI focused on the newest proposal while preserving the older extraction output for audit and troubleshooting.

## List Results

```http
GET /api/document-processing-results
GET /api/document-processing-results?license_id=42&status=pending
```

Omit `status` to return the full result history for the current filters. The license detail panel uses pending results for review and shows recent accepted, rejected, and superseded results as processing history. Viewer users only see results linked to licenses they can view.

## Accept Or Reject Results

Editors and admins can review pending results from the license detail panel. The review UI shows the current value beside the suggested value and lets the reviewer choose which suggested fields to accept. Rejecting a result records the review decision without changing license data.

```http
POST /api/document-processing-results/{id}/accept
POST /api/document-processing-results/{id}/reject
```

API token scopes:

- Accept: `documents:write` and `licenses:write`
- Reject: `documents:write`

Accepted results move to `status: "accepted"` and set `reviewedBy` / `reviewedAt`. Rejected results move to `status: "rejected"` and also set the reviewer fields. Superseded results are non-reviewable history rows created when a newer pending result replaces an older proposal from the same processor for the same document.

By default, accepting through the API applies every suggested field. API clients can apply only selected suggestions by sending zero-based indexes:

```json
{
  "suggestedFieldIndexes": [0, 2]
}
```

Every accepted suggested field must map to a supported target:

- a built-in inline-edit license field such as `quantity`, `publisherName`, `contractNumber`, or `budgetOwnerEmail`;
- an existing custom field matched by field key, field key without the `cf_` prefix, or custom field name.

If any accepted suggested field is unknown, LicenseTrack returns `422 Unprocessable Entity` and leaves the result pending. This prevents partial, silent application of integration output.

### Fields That Cannot Be Suggested

The following categories of fields are not in the accepted field allowlist and will always fail with `422 Unprocessable Entity`:

- **Lifecycle repair fields**: `lifecycle_status`, `renewed_from_id`, `renewed_to_id`, `predecessor_id`, `coterm_from_ids`, `commitment_id`, `commitment_year`. These are admin-only repair targets and cannot be proposed by an integration result.
- **Procurement conversion state**: `pending_order_id`, `status`, `evidence_transfer_status`, and other internal order-conversion fields. Conversion state is set by core workflows, not by external proposals.
- **Internal relationship and identity fields**: `id`, `license_ref`, `created_at`, `updated_at`, `created_by`, and similar system-managed columns.

`license_ref` is a chain identity, not a unique row key. Renewal successors inherit the predecessor's reference; a single `license_ref` value can identify multiple database rows across a renewal chain. Use the record `id` from API responses when you need to identify a specific database row. `license_ref` cannot be set or changed through document processing results or any license patch path.

If any accepted suggestion targets a field in the above categories, the entire accept call fails and no suggestion is applied. The result stays `pending`.

## Review Principle

External processors may suggest values, but core LicenseTrack owns review, approval, mutation, and audit logging. Accepted built-in fields are applied through the same single-field update path used by normal inline edits. Accepted custom fields use the shared custom-field normalization path.

## Current Limitations

- Accept marks the whole result accepted, even when only selected suggested fields are applied. Unselected suggestions are intentionally discarded as part of that review decision.
- Current processing results target license records and existing custom fields. They do not yet support generic suggestion/review targets for sourcing items, pending-order line items, draft licenses, or automatic multi-line quote creation.
