# Integration Author Checklist

Use this checklist before handing off a custom API integration, webhook
receiver, or document processor sidecar. These are the supported public
customization contracts. The integration remains operated, tested, and
maintained by its owner.

## Choose the right shape

- Use an API integration for sync, reporting, import, export, or automation.
- Use a webhook receiver when an external service should react to audited
  events.
- Use a document processor sidecar when a user should request inspection of an
  uploaded document and review proposed values.
- Submit a core contribution only when the feature is broadly useful and
  maintainable inside LicenseTrack.
- Do not build custom or third-party in-process packages. The internal Official
  Extensions host is reserved for LicenseTrack project releases.

## Authentication and scopes

- Create one API token per integration or processor.
- Grant only the required scopes and store the raw token outside source
  control.
- Expect API tokens to be rejected by admin settings, user management, backup,
  restore, authentication, webhook-management, and token-management routes
  unless explicitly documented otherwise.
- Handle authorization and validation errors as operator-facing failures.

## Capabilities and webhooks

- Register optional capability status with
  `PUT /api/extensions/capabilities/{key}`.
- Treat capability rows as status/discovery declarations, not loaded code.
- Verify `X-LicenseTrack-Signature` and `X-LicenseTrack-Timestamp` on webhook
  delivery.
- Treat webhook payloads as notifications and call the API for current state.

## Document processors

- Subscribe to `document_action.requested` and register an available
  `document.processing` capability.
- Download the selected document through the scoped LicenseTrack API.
- Submit proposals to `POST /api/document-processing-results`.
- Include confidence and source context where useful.
- Assume reviewers may accept selected fields, reject the result, or see a
  newer result supersede it.

## Core boundaries

- Core owns user authorization, viewer scope, document access, audit logging,
  review UI, validation, and final writes.
- Do not write directly to the database or depend on private frontend state,
  internal routes, or undocumented response fields.
- Use a row's `id` as its external identifier; `license_ref` is shared across a
  renewal chain.
- Test owner-maintained integrations before every LicenseTrack upgrade.

## Read first

- `overview.md`
- `build-integrations.md`
- `api-reference.md`
- `api-auth.md`
- `api-stability.md`
- `webhooks.md`
- `document-actions.md`
- `build-document-processor.md`
- `document-processing-results.md`
