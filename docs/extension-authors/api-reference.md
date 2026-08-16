# API Reference

This is the supported route catalog for operator-built integrations. LicenseTrack
currently exposes an **unversioned** `/api/...` surface. Integrations should state
the LicenseTrack application versions they support and follow the compatibility
policy in `api-stability.md`.

Exact request and response schemas for an installed release are available from
its OpenAPI document. On a local development instance, set
`EXPOSE_API_DOCS=true`, recreate or restart the service, and open
`/docs` or `/openapi.json`. Keep interactive API documentation disabled on
network-reachable production instances.

## Authentication

Send a scoped token as a bearer credential:

```http
Authorization: Bearer lt_...
```

API tokens inherit the active owning Admin account and then apply route scopes.
They are rejected on session-only routes even when the owner is an Admin. See
`api-auth.md` for token creation, storage, rotation, and the complete scope
definitions.

## Stability labels

- **Stable** endpoints preserve documented paths, methods, fields, enum values,
  authorization, and error semantics within the compatibility policy.
- **Experimental** endpoints are supported for pilots but may change between
  releases. Test the integration before every upgrade.
- **Session-only** endpoints are browser/operator surfaces and do not accept API
  tokens.
- Routes absent from this catalog are **internal**.

## Stable route families

### Licences and lifecycle

Required scope is `licenses:read` for reads and `licenses:write` for writes.

| Method and path | Purpose |
| --- | --- |
| `GET /api/licenses` | List visible license records |
| `GET /api/licenses/{license_id}` | Read one visible record |
| `POST /api/licenses` | Create a license |
| `PUT /api/licenses/{license_id}` | Replace editable license fields |
| `PATCH /api/licenses/{license_id}/field` | Patch one supported field |
| `POST /api/licenses/{license_id}/po-total-override` | Set the shared manual Total PO Value for the record's PO |
| `DELETE /api/licenses/{license_id}/po-total-override` | Clear the shared manual Total PO Value for the record's PO |
| `DELETE /api/licenses/{license_id}` | Delete an eligible record |
| `GET /api/licenses/export` | Export the visible registry to CSV |
| `GET /api/licenses/departments` | List visible department values |
| `GET /api/licenses/stats` | Read Registry statistics |
| `GET /api/licenses/{license_id}/procurement-trail` | Follow stored sourcing and pending-order relationships |
| `POST /api/licenses/{license_id}/initiate-renewal` | Start a single renewal |
| `POST /api/licenses/{license_id}/cancel-renewal` | Cancel eligible renewal work |
| `POST /api/licenses/renewal-bundle/initiate` | Start a coterm renewal bundle |
| `POST /api/licenses/{license_id}/disable-maintenance` | Disable active linked maintenance |
| `POST /api/licenses/{license_id}/link-maintenance` | Link an existing maintenance record to an eligible parent |
| `GET /api/renewals/workbench` | Read the renewal workbench model |

Lifecycle repair endpoints are Admin maintenance tools and are not part of the
stable integration contract.

License create, update, single-field patch, and pending-order conversion JSON
payloads accept `quantityPerUnit` as the native entitlement multiplier. CSV
imports expose the same concept as `quantity_per_unit` and can derive it from
`effective_quantity` when purchase quantity is present. Responses include
derived `effectiveQuantity`, calculated as `quantity` multiplied by
`quantityPerUnit`. Monetary calculations continue to use purchase `quantity`
multiplied by `unitPrice`.

License responses include nullable `poTotalOverride`. Set it only through
`POST /api/licenses/{license_id}/po-total-override` with a canonical decimal
string such as `{ "poTotalOverride": "1250.00" }`, or clear it through the
matching `DELETE` endpoint. The operation applies to every license sharing the
target record's nonblank PO number. New records joining an existing PO inherit
its override; reassignment to another existing PO adopts the destination PO's
override. Ordinary create/update payloads and CSV import do not set a manual
override.

Maintenance records use `parentLicenseId` as the primary compatibility parent.
Create requests can also provide `maintenanceParentIds` for a maintenance
license when the same support record should be linked to several perpetual,
OEM, or freeware/open-source parents. Responses include `maintenanceParentIds`
on maintenance records and `linkedMaintenanceIds` on parent records. To attach
an existing maintenance record to another eligible parent, call
`POST /api/licenses/{parent_id}/link-maintenance` with
`maintenanceLicenseId`.

### Custom fields

Custom-field definition reads require `licenses:read`; definition writes require
`licenses:write`. License value reads and writes use the same corresponding
license scopes.

| Method and path | Purpose |
| --- | --- |
| `GET /api/custom-fields/` | List definitions and stable field keys |
| `POST /api/custom-fields/` | Create a definition |
| `GET /api/custom-fields/{definition_id}` | Read one definition |
| `PATCH /api/custom-fields/{definition_id}` | Update supported definition properties |
| `DELETE /api/custom-fields/{definition_id}` | Delete a definition and its stored values |
| `GET /api/custom-fields/values` | Read custom-field values |
| `GET /api/licenses/{license_id}/custom-fields/` | Read values for one license |
| `PUT /api/licenses/{license_id}/custom-fields/` | Upsert typed values for one license |

Use immutable `fieldKey` values for external mappings. Display names can change.

### Documents

Document reads require `documents:read`; writes require `documents:write`.
Sourcing and pending-order document routes additionally require the matching
`procurement:read` or `procurement:write` scope.

| Method and path | Purpose |
| --- | --- |
| `GET /api/licenses/{license_id}/documents` | List license and visible procurement documents |
| `POST /api/licenses/{license_id}/documents` | Upload license-scoped evidence |
| `GET /api/documents/{document_id}/download` | Download license-owned evidence |
| `DELETE /api/documents/{document_id}` | Delete eligible license-owned evidence |
| `GET /api/procurement-documents/{document_id}/download` | Download procurement evidence |
| `DELETE /api/procurement-documents/{document_id}` | Delete eligible procurement evidence |

Document visibility and download permission are always rechecked server-side.

### Sourcing

Reads require `procurement:read`; writes require `procurement:write`. Quote
document operations also require the matching document scope.

| Route group | Supported operations |
| --- | --- |
| `/api/sourcing/requests` | List, create, and read sourcing requests |
| `/api/sourcing/requests/history` | List converted and cancelled requests |
| `/api/sourcing/requests/{request_id}` | Read, update, cancel, or delete an eligible request |
| `/api/sourcing/requests/{request_id}/items` | Add request lines |
| `/api/sourcing/{item_id}` | Read, update, or delete one sourcing line |
| `/api/sourcing/merge` | Merge eligible coterm renewal lines |
| `/api/sourcing/requests/{request_id}/quote-documents` | List or upload quote evidence |
| `/api/sourcing/quote-documents/{document_id}/download` | Download quote evidence |
| `/api/sourcing/quote-documents/{document_id}` | Delete quote evidence |
| `/api/sourcing/requests/{request_id}/convert` | Convert a request to pending-order work |
| `/api/sourcing/{item_id}/convert` | Convert a supported individual line |
| `/api/sourcing/export` | Export sourcing rows to CSV |

Sourcing and license payloads expose the optional camel-case fields
`licenseType`, `maintenanceCoverage`, `maintenanceStartDate`,
`maintenanceEndDate`, `maintenancePricingBasis`, `maintenanceQuantity`,
`maintenanceUnitPrice`, and `maintenanceCost`. Supported pricing-basis values
are `flat` and `per_unit`. For `per_unit`, the server calculates
`maintenanceCost` from quantity and unit price.

A zero-cost `freeware` sourcing line converts directly to a license. A
freeware line with positive included support follows the pending-order route,
and a separately tracked maintenance line remains a distinct paid line.
Freeware acquisition-price fields are normalized to zero/empty values.
Subscription and SaaS lines may use `maintenanceCoverage: "included"` when
support is bundled with the subscription. In that case the server derives the
support start/end dates from the license start/end dates and derives
`maintenanceCost` from the acquisition total. Separately tracked support
coverage remains limited to perpetual, OEM, and freeware parents.

### Pending orders

Reads require `procurement:read`; writes require `procurement:write`. Document
operations also require the matching document scope.

| Route group | Supported operations |
| --- | --- |
| `/api/pending-orders` | List or create pending orders |
| `/api/pending-orders/history` | List converted and cancelled orders |
| `/api/pending-orders/{order_id}` | Read, update, cancel, or delete an eligible order |
| `/api/pending-orders/{order_id}/items` | Add one or several lines |
| `/api/pending-orders/{order_id}/items/{item_id}` | Update or delete an eligible line |
| `/api/pending-orders/{order_id}/documents` | List or upload PO documents |
| `/api/pending-orders/documents/{document_id}/download` | Download PO documents |
| `/api/pending-orders/documents/{document_id}` | Delete PO documents |
| `/api/pending-orders/{order_id}/convert` | Convert a supported single-line order |
| `/api/pending-orders/{order_id}/convert-all` | Convert a reviewed multi-line order |
| `/api/pending-orders/{order_id}/retry-evidence-transfer` | Retry recoverable evidence transfer |
| `/api/pending-orders/export` | Export flat one-row-per-line data |

Pending-order payloads expose `poNumber` and `procurementReference`. `poNumber`
may be blank while an order is still being tracked, but conversion to active
licenses requires a real PO number. Treat `procurementReference` as optional
workflow metadata, not a relationship key.

Conversion is concurrency protected and non-idempotent after success: retry a
failed request only after checking the current order status.

Pending-order totals include paid support with
`maintenanceCoverage: "included"` once on the parent line. For subscription
and SaaS bundled support, the included support amount is the same acquisition
value already represented by the subscription line and is not added a second
time. A separately tracked maintenance line contributes through its own
acquisition fields and is not added again to the parent.

### Contracts

Contract reads require `licenses:read`; writes require `licenses:write`.
Contract document reads and writes use `documents:read` and `documents:write`.

| Route group | Supported operations |
| --- | --- |
| `/api/contracts` | List and create contracts |
| `/api/contracts/{contract_id}` | Read, update, or delete an eligible contract |
| `/api/contracts/{contract_id}/licenses` | List linked licenses |
| `/api/contracts/{contract_id}/folders` | Create folders |
| `/api/contracts/{contract_id}/folders/{folder_id}` | Rename or delete folders |
| `/api/contracts/{contract_id}/documents` | List or upload contract documents |
| `/api/contracts/{contract_id}/folders/{folder_id}/documents` | Upload into a folder |
| `/api/contracts/{contract_id}/documents/{document_id}` | Download or delete a document |

### Reports and import

| Method or family | Scope | Purpose |
| --- | --- | --- |
| `GET /api/reports/portfolio-stats` | `reports:read` | Portfolio annual-cost rollup grouped by currency |
| `GET /api/import/template` | `licenses:read` | Download the native import template |
| `GET /api/import/mappings` | `licenses:read` | List shared mapping profiles |
| `/api/import/analyze`, `/preview`, `/preview-mapped` | `licenses:write` | Analyze and preview an import without persisting license rows |
| `/api/import/execute`, `/confirm` | `licenses:write` | Execute a reviewed import |
| `/api/import/mappings/{mapping_id}` | `licenses:write` | Update or delete an eligible mapping profile |

CSV import is a workflow contract rather than a generic bulk API. Preserve the
preview/acknowledgement/execute sequence documented by the installed OpenAPI
schema and integration recipes. `POST /api/import/confirm` and
`POST /api/import/execute` accept optional `row_overrides_json` form data for
review-time corrections. The first supported override is
`[{ "rowNumber": 1, "parentLicenseId": 123 }]`, which resolves a maintenance
row to an existing eligible perpetual, OEM, or freeware parent license during
execution.

The importable `total_po_price` field is a legacy stored compatibility value.
It does not set `poTotalOverride` or replace the calculated whole-PO value.

Report recurring-cost calculations annualize subscription, SaaS, maintenance,
and paid included-support records when their stored term is longer than one
year. Client report views that apply a date range allocate recurring value by
overlapping days; integrations that reproduce report totals should use the same
calendar-day basis.

## Experimental integration routes

| Method or family | Scope | Purpose |
| --- | --- | --- |
| `GET /api/extensions/capabilities` | `extensions:read` | List declared integration capabilities |
| `PUT /api/extensions/capabilities/{capability_key}` | `extensions:write` | Register or refresh a capability |
| `DELETE /api/extensions/capabilities/{capability_key}` | `extensions:write` | Remove a capability declaration |
| `GET /api/document-actions` | `documents:read` | Discover currently available document actions |
| `POST /api/document-actions/{action_key}/invoke` | `documents:write` | Request an available action |
| `/api/document-processing-results` | Combined document/extension/license scopes by operation | Submit, list, accept, or reject proposed values |

Webhook management routes are session-only. The signed delivery payload,
headers, retry semantics, and event limitations are documented in `webhooks.md`
and remain experimental.

Official Extension routes using `/api/plugins`, `/api/plugin-actions`,
`/api/plugin-runtime`, or `/api/plugin-suggestions` are internal first-party
host contracts, not public third-party integration APIs.

## Session-only routes

API tokens are rejected for these route families:

- `/api/auth/*`
- `/api/api-tokens/*`
- `/api/users/*`
- `/api/settings/*`
- `/api/backup/*`
- `/api/audit-log/*`
- `/api/webhooks/*`
- `/api/notifications`

Use a human Admin session for those workflows.

## Common response and error behavior

JSON responses use the field casing declared in the installed OpenAPI schema.
File downloads and CSV exports return binary or text content with an appropriate
`Content-Type` and `Content-Disposition` header.

Common failures:

| Status | Meaning |
| --- | --- |
| `400` | Malformed request or unsupported field/value combination |
| `401` | Missing, invalid, expired, or revoked credential |
| `403` | API tokens unsupported for the route, missing scope, role restriction, department scope, or download restriction |
| `404` | Record absent or intentionally hidden by access scope |
| `409` | Workflow state conflict, relationship invariant, unavailable integration capability, or concurrent conversion |
| `413` | Request or uploaded file exceeds the configured size limit |
| `422` | Request schema validation failed |

Do not retry `400`, `403`, `404`, `409`, or `422` responses blindly. Read the
`detail` value, fetch current state when appropriate, and surface the failure to
the integration operator.

List endpoints currently return complete visible collections unless their
installed OpenAPI schema documents filters. Do not assume undocumented
pagination, sorting, or fields are stable.
