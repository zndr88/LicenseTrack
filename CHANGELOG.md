# Changelog

All notable changes to LicenseTrack are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

API stability levels and the breaking-change policy are defined in
[docs/api-stability.md](docs/api-stability.md). Changes that affect stable API
contracts will be called out under a **Breaking** heading in future releases.

## [1.0.1] - 2026-07-04

### Security

- Exclude nested `.env` files (e.g. `backend/.env`) from the Docker build context
  so local secrets can no longer be baked into a built image.
- Docker Compose no longer supplies a default `ADMIN_PASSWORD`; an unset value now
  fails startup instead of silently using a placeholder. Added `changeme_required`
  to the weak-password blocklist as defense-in-depth.
- Bump `pydantic-settings` to 2.14.2 (resolves a symlink-escape advisory in
  `NestedSecretsSettingsSource`) and `dompurify` to 3.4.11.
- Docker Compose now runs the container with `no-new-privileges`.

### Changed

- Frontend build stage now uses `node:22-alpine` (Node 20 reached end-of-life).

### Docs

- Removed the internal Plugin Host v1 implementation-plan and Pydantic schema-plan
  documents (build scaffolding for already-shipped functionality) and corrected
  stale version references in the remaining plugin-host docs.
- Added Podman deployment instructions and a production-hardening section (HTTPS,
  `SESSION_COOKIE_SECURE`, reverse-proxy, and trusted-network guidance) to
  `docs/DEPLOY.md`.

## [1.0.0] - 2026-06-16

First public source-available release. LicenseTrack is a self-hosted software
license procurement and lifecycle management system, deployed via Docker.

### Security (post-release hardening)

Follow-up hardening from an internal security review. No API contract changes;
the release remains 1.0.0.

- Login throttling now counts failed attempts by source IP in addition to
  username, so a password spray across many usernames is throttled and can no
  longer bypass the per-username limit. The failed-attempt counters are also
  capped so a flood of unique usernames or IPs cannot exhaust memory.
- Login now performs a constant-time dummy password verification when the
  username does not exist, removing a timing side channel that could be used to
  enumerate valid usernames.
- The interactive API docs (`/docs`, `/redoc`) and OpenAPI schema
  (`/openapi.json`) are disabled by default and gated behind the new
  `EXPOSE_API_DOCS` setting, so the full API surface is no longer published to
  unauthenticated callers unless explicitly enabled.

### Procurement

- Sourcing requests for evaluating license purchases, capturing publisher,
  supplier, contact, quantity, estimated cost, status, renewal context, and
  quote documents.
- Promotion of sourcing items into pending purchase orders, with grouping of
  multiple items under a single purchase order.
- Conversion of pending orders into live license records.
- Renewal opportunity detection with cotermed renewal workflows.

### License registry

- Searchable, filterable license records covering publisher, contract, purchase
  order, dates, quantities, costs, status, custom fields, and notes.
- Status filters for active, expiring, expired, pending renewal, renewed,
  retired, legacy, complete, and incomplete records.
- Configurable visible columns, column reordering, saved display preferences,
  and CSV export.
- Create, edit, retire, renew, and link license records, with record history
  (creator account, creation timestamp, latest update timestamp) in the detail
  panel.
- Preservation of sourcing-request and purchase-order milestone dates on the
  resulting license records, with manual enrichment for imported and legacy
  data.

### Renewals

- Dedicated renewal workbench for upcoming, overdue, and in-progress renewals.
- Renewals started from existing license records, carrying data through the
  sourcing, pending order, and conversion workflows.
- Renewal-chain traceability with preservation of historical license records.
- Renewal consolidation for coterm opportunities.

### Contracts and documents

- Contract records grouped by publisher and contract number, linkable to
  license records.
- Contract-level document storage in user-defined folders.
- File attachments (invoices, EULAs, proofs of entitlement, quotes, and others)
  for licenses, contracts, sourcing requests, and procurement records.
- Completeness tracking based on mandatory fields and required document
  presence.

### Reporting and analytics

- Read-only analytics workspace covering the full license portfolio, with a
  global filter bar: include/exclude retired records, start-date range (all
  time, this year, last 12 months, or a custom range), and multi-select
  cost-centre (department) filtering.
- Portfolio summary stats: active, expiring, and expired counts, plus total
  annual portfolio cost reported per currency, with an indicator for records
  excluded from totals.
- Cost overview and budget forecast: total historical spend (deduplicated by
  purchase order), recurring annual cost, non-recurring spend, and lifecycle
  budget split across active, expiring, and expired records; multi-year budget
  projection with configurable forecast horizon and annual growth percentage.
- Spend by publisher, and a publisher/supplier relationship table with license
  counts, per-currency spend, and unpriced-record flags.
- Portfolio breakdown by license type and license metric.
- Fiscal-year-aware renewal calendar projecting renewal counts and estimated
  value across the next four quarters, honoring the configured fiscal-year
  start month.
- Per-currency reporting throughout, with no implicit currency conversion and a
  clear disclaimer when a filtered set mixes currencies.
- Export of the full report to PDF.
- CSV import and CSV export for operational reporting.

### Administration

- Configurable mandatory fields, legacy handling, and completeness exemptions.
- In-app notifications and optional SMTP email alerts.
- Manual and scheduled database backups, with a pre-restore safety snapshot on
  restore.
- User management with Admin, Editor, and Viewer roles.
- Optional OIDC/SSO with a protected local break-glass admin account.
- Audit history for authentication, settings, user, database backup, document,
  and data-changing actions, with configurable retention.

### Integration and extensibility

- Documented, versioned API with token authentication and defined stability
  levels (see [docs/api-auth.md](docs/api-auth.md) and
  [docs/api-stability.md](docs/api-stability.md)).
- Optional extension points: document actions, declared capabilities,
  document-processing results, and webhooks.
- Author guides and copyable recipes for integrations and document processors
  (see [docs/build-integrations.md](docs/build-integrations.md),
  [docs/build-document-processor.md](docs/build-document-processor.md), and
  [docs/integration-recipes.md](docs/integration-recipes.md)).

### Deployment and security

- Docker and Docker Compose deployment serving the compiled frontend from the
  backend container via same-origin `/api` URLs.
- JWT sessions, bcrypt password hashing, and encryption of stored integration
  secrets derived from `JWT_SECRET`.
- Startup refuses blank or common default values for `JWT_SECRET` and
  `ADMIN_PASSWORD`.
- Configurable upload size and extension allow-list, CORS origin allow-list,
  and session cookie controls.

[1.0.1]: https://github.com/zndr88/LicenseTrack/releases/tag/v1.0.1
[1.0.0]: https://github.com/zndr88/LicenseTrack/releases/tag/v1.0.0
