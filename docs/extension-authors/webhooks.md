# Webhooks

LicenseTrack webhooks let operators notify internal systems when audited business events occur. They are an integration primitive for CMDB syncs, ticket creation, workflow monitors, and document processor sidecars.

Webhooks do not install code or add UI and settings panels to LicenseTrack; they deliver signed event notifications to external receivers.

This is the v1 webhook foundation. It is intentionally conservative: webhooks are admin-managed, event delivery is best-effort with retries, and events are based on audit actions.

## Managing Webhooks

Admins manage webhook endpoints through:

```text
GET    /api/webhooks
POST   /api/webhooks
PUT    /api/webhooks/{endpoint_id}
DELETE /api/webhooks/{endpoint_id}
GET    /api/webhooks/{endpoint_id}/deliveries
POST   /api/webhooks/deliveries/{delivery_id}/retry
```

Webhook management is an admin browser-session surface. API tokens are not accepted for these routes.

Admins can also manage webhook endpoints in Admin Settings, including endpoint creation, one-time signing secret capture, enable/disable, test delivery, recent delivery inspection, response/error visibility, manual retry, and deletion.

Create a webhook endpoint:

```json
{
  "name": "CMDB events",
  "url": "https://cmdb.example.com/webhooks/licensetrack",
  "events": ["license.created", "license.updated"],
  "isActive": true
}
```

Use `["*"]` to subscribe to all audited events. The create response includes `signing_secret` once. Store it in the receiving system because LicenseTrack does not return it again.

Common event names include `license.created`, `license.updated`,
`license.existing_successor_linked`, `license.existing_successor_unlinked`,
`document.uploaded`, `procurement_document.uploaded`,
`document_action.requested`, and `webhook.test`.

## Event Payload

Webhook payloads use the audit event shape:

```json
{
  "event": "license.created",
  "timestamp": "2026-05-27T13:00:00+00:00",
  "actorEmail": "admin@example.com",
  "targetType": "license",
  "targetId": "42",
  "targetLabel": "Example Product",
  "detail": "via API token: CMDB sync (3)"
}
```

The payload is intentionally small. Receivers that need current record state should call the LicenseTrack API after receiving the event.

For document processors, subscribe to `document_action.requested`. The event target identifies the document, and the `detail` field includes the action key and related record identifiers when available.

## Signature Verification

LicenseTrack signs each delivery with HMAC-SHA256 using the endpoint signing secret.

Headers:

```http
X-LicenseTrack-Event: license.created
X-LicenseTrack-Delivery: 123
X-LicenseTrack-Timestamp: 1779886800
X-LicenseTrack-Signature: sha256=...
```

The signed payload is:

```text
{timestamp}.{raw_json_body}
```

Receivers should reject signatures that do not match and should reject stale timestamps according to local policy.

## Delivery And Retry Behavior

- Delivery rows are created in the same database transaction as the audit event.
- The background scheduler attempts pending webhook deliveries.
- Successful `2xx` responses mark a delivery as `succeeded`.
- Non-`2xx` responses or network failures are retried up to five attempts.
- Backoff is simple and increases by five minutes per attempt.
- Admins can inspect deliveries, see the HTTP response or network error, check the next retry time, and manually retry a delivery.

## URL Restrictions

Webhook delivery is blocked if the configured URL resolves to a loopback address, a link-local address (169.254.0.0/16, fe80::/10), or an RFC1918 private range. This applies regardless of whether the URL was entered as an IP literal or a hostname that resolves to a private address. HTTP redirects are also checked: if the target server returns a 3xx response, the redirect destination is validated against the same rules before the hop is followed. Deliveries that fail this check are treated as errors and follow the normal retry path; the error detail recorded on the delivery row will include the blocked address.

## Current Limitations

- Webhook payloads are audit-event notifications, not full domain snapshots.
- There is no per-event schema registry yet.
- Retry scheduling uses the existing background scheduler, not a dedicated distributed queue.
