# Document Actions

Document actions are the first generic core-rendered integration action in LicenseTrack. They let core expose a small, audited action on document rows without loading third-party frontend code.

They are not browser-style plugin buttons. The action is built into LicenseTrack and is shown only when the required webhook subscriber and declared capability exist.

The current built-in action is:

| Key | Label | Purpose |
| --- | --- | --- |
| `request_processing` | Request processing | Emit an event that an external processor can handle |

This is intentionally small. LicenseTrack owns the button, permission check, document visibility check, audit event, and webhook delivery. External services decide what to do with the event.

## API

List available actions:

```http
GET /api/document-actions
```

`request_processing` is returned only when both conditions are true:

- at least one active webhook endpoint subscribes to `document_action.requested` or `*`;
- at least one integration capability with `capabilityType: "document.processing"` has `status: "available"`.

If no processor is fully configured, the list is empty and the document-row action is hidden in the UI.

Invoke an action:

```http
POST /api/document-actions/{action_key}/invoke
Content-Type: application/json

{
  "documentType": "license_document",
  "documentId": 123
}
```

`documentType` is either `license_document` or `procurement_document`.

Successful response:

```json
{
  "actionKey": "request_processing",
  "documentType": "license_document",
  "documentId": 123,
  "status": "accepted"
}
```

Browser users must be Editors or Admins. API clients need `documents:write`.

If no active document processor webhook is configured, invocation returns `409 Conflict`. If no available `document.processing` capability is registered, invocation also returns `409 Conflict`.

## Event Contract

Invoking the action writes an audit event:

```text
document_action.requested
```

Webhook receivers can subscribe to that event. The payload uses the normal webhook audit-event shape:

```json
{
  "event": "document_action.requested",
  "targetType": "license_document",
  "targetId": "123",
  "targetLabel": "entitlement.pdf",
  "detail": "action=request_processing\ndocumentType=license_document\nfilename=entitlement.pdf\nlicenseId=42"
}
```

Receivers should treat the event as a notification. If they need current record state, document metadata, or file contents, they should call the LicenseTrack API using their own scoped API token.

## Integration Pattern

A document-processing integration should:

1. Create an API token with the minimum required scopes, usually `documents:read`, `documents:write`, and any record scopes it needs.
2. Register a webhook endpoint for `document_action.requested`.
3. Verify webhook signatures.
4. Inspect the payload detail to identify the action and document.
5. Call LicenseTrack APIs for current data.
6. Submit proposed extracted values to `POST /api/document-processing-results`.

For AI parsing, the processor should remain optional and bring-your-own-provider-key. Core should not send documents to an AI provider by itself.

See `docs/ai-sidecar-example.md` and `examples/licensetrack-ai-sidecar.py` for a minimal sidecar that verifies webhooks, downloads a document, and submits fake processing results.

When testing a local sidecar, verify that the configured port is actually serving the sidecar before wiring the webhook. A response such as `426 Upgrade Required` from `/health` usually means another local application is listening on that port; choose a free port and update the webhook URL.

## Current Limitations

- Actions are built into core rather than admin-defined.
- The event payload is an audit notification, not a typed domain event.
- Core does not load third-party React bundles, plugin-owned settings panels, or plugin UI.
- Document actions do not let integrations inject arbitrary buttons into unrelated modals or pages.
