# Build Integrations

This guide is the starting point for operator-built integrations. Use it when you want to connect LicenseTrack to CMDBs, procurement tools, reporting jobs, inventory sources, export pipelines, document processor sidecars, or private automation.

LicenseTrack integrations should live outside core unless they are broadly useful product features. They authenticate with API tokens, use documented routes, and keep their own release and maintenance cycle.

This guide describes the API/webhook Integration Framework, where you authenticate with an API token and drive LicenseTrack through documented routes from your own externally hosted code. It is distinct from the **Plugin Host**, which is now shipped (v1): installable `.ltplugin` packages with manifests, plugin-owned settings panels, permissions, UI slots, and a managed runtime. If you want a packaged, installable add-on, see `docs/plugin-author-guide.md`. Use this API/webhook guide when you are building externally hosted automation rather than an installable package.

## Integration Shape

Most integrations follow this pattern:

1. Create one API token for the integration.
2. Grant only the scopes that integration needs.
3. Read or write LicenseTrack records through documented API routes.
4. Use webhooks when the integration should react to LicenseTrack events.
5. Record enough external IDs in normal fields or custom fields to reconcile later.
6. Treat API errors and permission failures as real operator-facing signals.

Do not depend on private frontend internals, database tables, or undocumented response fields. If a route is not documented, treat it as internal until it is promoted in `docs/api-stability.md`.

## Scope Matrix

| Integration job | Recommended scopes |
| --- | --- |
| Read license portfolio and custom fields | `licenses:read` |
| Create or update license records | `licenses:read`, `licenses:write` |
| Export reports | `reports:read` |
| Create sourcing requests or pending-order work | `procurement:read`, `procurement:write` |
| Upload evidence to licenses | `licenses:read`, `licenses:write`, `documents:write` |
| Download or inspect documents | `documents:read` |
| Register integration capability/status | `extensions:read`, `extensions:write` |
| Submit document processing suggestions | `documents:read`, `documents:write`, `extensions:write` |
| Accept document processing suggestions through API | `documents:write`, `licenses:write` |

Webhook endpoint management is intentionally admin/browser-session only. API tokens are not accepted for `/api/webhooks`.

## Quickstart

Run the PowerShell quickstart from the repository root:

```powershell
cd C:\path\to\LicenseTrack

$env:LT_BASE_URL = "http://localhost:8000"
$env:LT_API_TOKEN = "lt_your_token"

powershell -ExecutionPolicy Bypass -File .\examples\integration-quickstart.ps1
```

The script lists visible licenses, prints custom-field counts, registers a sample integration capability if the token has `extensions:write`, and confirms that unsupported admin routes reject API-token auth.

## Core Recipes

Detailed examples live in `docs/integration-recipes.md`:

- register an integration capability;
- list licenses with custom fields;
- create a license;
- create a sourcing request;
- upload quote or license evidence;
- request document processing;
- submit, accept, and reject document processing results;
- export license CSV.

## Compatibility

Before building an integration, read:

- `docs/extension-author-checklist.md` for the current integration boundaries and handoff checklist;
- `docs/api-auth.md` for API-token behavior and scope meaning;
- `docs/api-stability.md` for stable, experimental, and internal route expectations;
- `docs/webhooks.md` for signed event delivery and retry behavior;
- `docs/extensions.md` for current Integration Framework terminology and boundaries.
- `docs/plugin-author-guide.md` for the installable Plugin Host model (shipped) and `docs/plugin-host-roadmap.md` for post-v1 direction.

Private integrations are maintained by their owners. Test them before upgrading LicenseTrack, especially when they use experimental surfaces such as webhooks, document actions, extension capabilities, or document processing results.

## Record Identity

Use the record `id` from API responses when you need to reference a specific database row across systems or store a stable identifier for later reconciliation. Do not use `license_ref` as a unique row key.

`license_ref` is a chain identity: it is generated once for a new license chain and inherited by renewal successors. A single `license_ref` value such as `LT-2024-00042` may appear on multiple rows across a renewal chain. It is read-only and cannot be set or changed through any API path, including document processing results or license patch endpoints.

`external_ref` is the correct field for storing a CMDB, ServiceNow, or third-party system identifier alongside a LicenseTrack license record.

License read responses also expose procurement and record-history metadata:

- `requestDate`: sourcing-item creation timestamp captured during LicenseTrack procurement conversion, or set later through the license patch endpoint or a CSV import (`request_date` column);
- `purchaseDate`: pending-order creation timestamp captured during LicenseTrack procurement conversion, or set later through the license patch endpoint or a CSV import (`purchase_date` column);
- `createdAt` and `updatedAt`: license-row creation and latest-update timestamps;
- `createdBy`, `createdByName`, and `createdByEmail`: creator ID plus best-effort account labels. Account labels may be null for deleted or legacy users.

`requestDate` and `purchaseDate` are optional. Treat a missing value as unknown rather than inferring one from unrelated fields such as start date or PO number.

## Operational Checklist

- Store API tokens in a secret manager, not in source code.
- Use one token per integration so it can be revoked independently.
- Monitor token `last_used_at` in Admin Settings.
- Keep a short runbook for each integration: owner, token name, scopes, endpoints used, and failure behavior.
- Use custom fields or external reference fields for stable cross-system identifiers.
- Prefer idempotent syncs. Re-running an integration should not create duplicate records unless the operator asked for that behavior.
