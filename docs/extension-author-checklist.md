# Integration Author Checklist

Use this checklist before building a private LicenseTrack API integration, webhook integration, or document processor sidecar. It captures the current Integration Framework and keeps external work aligned with core boundaries.

This checklist is for API/webhook-based integrations. LicenseTrack also ships Plugin Host v1 for installable packages; use `docs/plugin-author-guide.md` if you want a packaged plugin with manifest-declared settings, permissions, UI slots, and a managed runtime.

## Choose The Right Shape

- Use an API integration for private sync, reporting, import, export, or automation needs.
- Use a webhook integration when an external service should react to audited LicenseTrack events.
- Use a document processor sidecar when a user should intentionally ask an external service to inspect an uploaded document and return suggested values.
- Use Plugin Host v1 when you need an installable package that LicenseTrack manages from Admin Settings.
- Submit a core contribution only when the feature is broadly useful and should be maintained inside LicenseTrack.
- Do not rely on runtime React plugin loading, remote frontend bundles, direct database writes, plugin-created migrations, or arbitrary UI injection. Plugin Host v1 supports core-rendered slots only.

## Authentication And Scopes

- Create one API token per integration or processor.
- Grant only the required scopes.
- Store the raw token outside source control.
- Expect API tokens to be rejected by admin settings, user management, database backup, restore, authentication, webhook-management, and token-management routes unless explicitly documented otherwise.
- Use `docs/build-integrations.md` for scope selection.

## Capability Declaration

- Register optional integration capabilities with `PUT /api/extensions/capabilities/{key}`.
- Use stable, lowercase keys such as `licensetrack-ai` or `company-cmdb-sync`.
- Use `status: "available"` only when the integration or sidecar is ready to handle work.
- Use `status: "misconfigured"` or `status: "error"` with `lastError` when operator attention is needed.
- Treat capability records as status/discovery declarations, not loaded plugin code.

## Webhooks

- Create webhook endpoints in Admin Settings.
- Copy and store the signing secret when the endpoint is created.
- Verify `X-LicenseTrack-Signature` and `X-LicenseTrack-Timestamp`.
- Treat webhook payloads as notifications. Call the API for current state.
- Inspect delivery history and response details in Admin Settings while testing.

## Document Processor Contract

- Subscribe to `document_action.requested`.
- Register a `document.processing` capability.
- Download the selected document through the LicenseTrack API.
- Submit suggestions to `POST /api/document-processing-results`.
- Return proposed values only. Do not write license fields directly.
- Include `confidence`, `source`, and `note` where useful so reviewers can understand the suggestion.
- Assume users may accept only selected fields or reject the result.
- Expect newer pending results from the same processor/document to supersede older pending results.

## Core Boundaries

- Core owns permissions, viewer department scoping, document access checks, audit logging, review UI, and final data mutation.
- Integrations own external parsing, sync, transformation, and provider-specific behavior.
- Do not bypass LicenseTrack services by writing directly to the database.
- Do not depend on undocumented frontend state, internal helper APIs, or database schema details.
- Do not add plugin-specific core code unless a generic extension point or Plugin Host slot exists first.

## Documentation To Read First

- `docs/extensions.md`
- `docs/plugin-author-guide.md`
- `docs/plugin-host-v1-roadmap.md`
- `docs/build-integrations.md`
- `docs/build-document-processor.md`
- `docs/api-auth.md`
- `docs/api-stability.md`
- `docs/webhooks.md`
- `docs/document-actions.md`
- `docs/document-processing-results.md`

## Example Code

- `examples/integration-quickstart.ps1`
- `examples/api-token-smoke-test.py`
- `examples/create-sourcing-request.py`
- `examples/submit-document-processing-result.py`
- `examples/licensetrack-ai-sidecar.py`
