# Build Integrations

This guide is the starting point for operator-built integrations. Use it when you want to connect LicenseTrack to CMDBs, procurement tools, reporting jobs, inventory sources, export pipelines, document processor sidecars, or private automation.

LicenseTrack integrations should live outside core unless they are broadly useful product features. They authenticate with API tokens, use documented routes, and keep their own release and maintenance cycle.

This guide describes the public API/webhook Integration Framework, where you authenticate with an API token and drive LicenseTrack through documented routes from externally hosted code. This is the supported path for custom and third-party automation. The internal Official Extensions host is reserved for packages published and signed by the LicenseTrack project and is not a public plugin SDK.

## Integration Shape

Most integrations follow this pattern:

1. Create one API token for the integration.
2. Grant only the scopes that integration needs.
3. Read or write LicenseTrack records through documented API routes.
4. Use webhooks when the integration should react to LicenseTrack events.
5. Record enough external IDs in normal fields or custom fields to reconcile later.
6. Treat API errors and permission failures as real operator-facing signals.

Do not depend on private frontend internals, database tables, or undocumented response fields. If a route is not documented, treat it as internal until it is promoted in `docs/extension-authors/api-stability.md`.

## Scope Matrix

| Integration job | Recommended scopes |
| --- | --- |
| Read license portfolio and custom fields | `licenses:read` |
| Create or update license records | `licenses:read`, `licenses:write` |
| Export reports | `reports:read` |
| Create sourcing requests or pending-order work | `procurement:read`, `procurement:write` |
| Upload evidence to licenses | `licenses:read`, `documents:write` |
| Download or inspect documents | `documents:read` |
| Register integration capability/status | `extensions:read`, `extensions:write` |
| Submit document processing suggestions | `documents:read`, `documents:write`, `extensions:write` |
| Accept document processing suggestions through API | `documents:write`, `licenses:write` |

Reporting integrations should use `GET /api/reports/detailed` for the filtered
report model or `GET /api/reports/detailed/export` for its complete CSV. Both
routes accept `include_retired`, `date_range` (with `date_from` and `date_to`
for custom ranges), repeated `cost_centres`, `forecast_years`,
`annual_uplift_pct`, and `fiscal_year_start_month`. Money in the detailed model
and CSV is emitted as canonical decimal strings and remains grouped by native
currency; no conversion is performed. Rows include explicit report/row types,
and invalid, unpriced, and undated records are surfaced in the report counts.

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

Detailed examples live in `docs/extension-authors/integration-recipes.md`:

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

- `docs/extension-authors/checklist.md` for the current integration boundaries and handoff checklist;
- `docs/extension-authors/api-reference.md` for the supported route catalog, stability, scopes, and common errors;
- `docs/extension-authors/api-auth.md` for API-token behavior and scope meaning;
- `docs/extension-authors/api-stability.md` for stable, experimental, and internal route expectations;
- `docs/extension-authors/webhooks.md` for signed event delivery and retry behavior;
- `docs/extension-authors/overview.md` for current Integration Framework terminology and boundaries.

Private integrations are maintained by their owners. Test them before upgrading LicenseTrack, especially when they use experimental surfaces such as webhooks, document actions, extension capabilities, or document processing results.

## Record Identity

Use the record `id` from API responses when you need to reference a specific database row across systems or store a stable identifier for later reconciliation. Do not use `license_ref` as a unique row key.

`license_ref` is a chain identity: it is generated once for a new license chain and inherited by renewal successors. A single `license_ref` value such as `LT-2024-00042` may appear on multiple rows across a renewal chain. It is read-only and cannot be set or changed through any API path, including document processing results or license patch endpoints.

`external_ref` is the correct field for storing a CMDB, ServiceNow, or third-party system identifier alongside a LicenseTrack license record.

License read responses also expose procurement and record-history metadata:

- `requestDate`: sourcing-item creation timestamp captured during LicenseTrack procurement conversion, or set later through the license patch endpoint or a CSV import (`request_date` column);
- `purchaseDate`: pending-order creation timestamp captured during LicenseTrack procurement conversion, or set later through the license patch endpoint or a CSV import (`purchase_date` column);
- `secondaryContacts`: optional additional internal contacts copied as CC
  recipients on budget-owner renewal emails. CSV imports can populate the same
  field from `secondary_contacts` or from mapped owner/contact email columns;
- `createdAt` and `updatedAt`: license-row creation and latest-update timestamps;
- `createdBy`, `createdByName`, and `createdByEmail`: creator ID plus best-effort account labels. Account labels may be null for deleted or legacy users.

`requestDate` and `purchaseDate` are optional. Treat a missing value as unknown rather than inferring one from unrelated fields such as start date or PO number.

Procurement read integrations can also follow the stored procurement trail:

- `GET /api/licenses/{id}/procurement-trail` returns the source sourcing request/item and pending order when the license was created through LicenseTrack procurement conversion;
- `GET /api/sourcing/requests/history` returns converted and cancelled sourcing requests for reference;
- `GET /api/pending-orders/history` returns converted and cancelled pending orders for reference.

Use returned `id`, `sourcingRequestId`, `sourcingItemId`, `pendingOrderId`, and converted-license ids for reconciliation. PO number is commercial metadata and may be reused; it is not a relationship key.

## Operational Checklist

- Store API tokens in a secret manager, not in source code.
- Use one token per integration so it can be revoked independently.
- Monitor token `last_used_at` in Admin Settings.
- Keep a short runbook for each integration: owner, token name, scopes, endpoints used, and failure behavior.
- Use custom fields or external reference fields for stable cross-system identifiers.
- Prefer idempotent syncs. Re-running an integration should not create duplicate records unless the operator asked for that behavior.
