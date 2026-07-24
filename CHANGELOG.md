# Changelog

All notable changes to LicenseTrack are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
LicenseTrack uses the three-part milestone and release-train policy described in
[VERSIONING.md](VERSIONING.md). It is not strict Semantic Versioning: compatible
features may ship in the third-number release train for the current milestone.

API stability levels and the breaking-change policy are defined in
[docs/extension-authors/api-stability.md](docs/extension-authors/api-stability.md). Changes that affect stable API
contracts will be called out under a **Breaking** heading in future releases.

## [Unreleased]

### Added

- Added an optional license type to sourcing lines. Zero-cost
  freeware/open-source lines can convert directly from sourcing to an active
  Registry license without a pending order, purchase date, PO, invoice,
  contract, or purchase price. Mixed requests now complete in one action: free
  lines enter the Registry while paid lines enter the pending-order path.
- Added maintenance/support classification to sourcing, pending-order
  conversion, and direct license entry for perpetual, OEM, and
  freeware/open-source records. Included support stores its coverage dates and
  either a flat coverage fee or a covered quantity, unit price, and calculated
  coverage-period total on the parent. Separately tracked support creates an
  editable linked maintenance line and preserves that relationship through
  conversion. Included support contributes to sourcing estimates and
  pending-order totals exactly once.
- Freeware/open-source records now treat contract, PO, invoice, quote, and
  non-expiring end-date requirements as not applicable when no paid support is
  included. EULA, proof-of-entitlement, and publisher-contact requirements
  remain inapplicable; paid included support restores the purchase-evidence
  requirements while preserving department and budget-owner checks.
- Added an admin-only portfolio reset for clean pre-production starts. It
  removes current and historical licenses, sourcing requests, pending orders,
  contracts, documents, processing results, delivery history, and prior audit
  events while preserving users and application configuration. A verified
  database-and-document recovery archive is required before deletion, and the
  next generated license reference restarts at `LT-REF-00001`.
- Added server-side archive selection to Database Restore while retaining local
  file upload. Routine database backups leave managed documents unchanged;
  portfolio-recovery and pre-restore safety archives restore both the database
  and managed documents after creating a new database-and-document safety
  archive. Server selections are restricted to validated archives in the
  configured backup directory.

### Changed

- Documented LicenseTrack's milestone and release-train versioning policy so
  release numbers match the established practice of shipping backward-compatible
  features, fixes, hardening, and documentation within an active `1.x` series.
- Freeware/open-source forms now hide license acquisition pricing and persist
  a zero acquisition cost. Perpetual and OEM acquisition pricing remains
  separate from optional included-support pricing.
- Reports now exclude zero-cost freeware/open-source records from monetary
  totals. Current paid included support contributes its coverage-period total
  to recurring cost and forecast calculations, while separately tracked
  support continues to report through its maintenance license line.
- Demo frontend builds now use `frontend/dist-demo` instead of replacing the
  normal production bundle under `frontend/dist`.
- Native installation now records and reports explicit local-only,
  reverse-proxy, or direct-network reachability. Non-interactive installs must
  confirm reverse-proxy intent when a non-local public URL uses the secure
  loopback bind.
- Documented the native runtime privilege boundary and a guarded removal
  procedure with explicit data-retention, final-backup, service-account, and
  external host-cleanup steps.
- Settings and CSV Import now share the same pattern-based number-format
  choices, removing duplicate and misleading country labels. Import defaults
  to the user's number format but remains overridable per file when source data
  uses a different convention.
- Refocused the repository README on the product and the shortest installation
  paths; configuration, persistence, hardening, native host, and maintainer
  detail now point to their dedicated documentation.

### Fixed

- Native release assembly and installation now reject frontend bundles that
  contain the demo-only marker, preventing a stale or contaminated demo build
  from being installed as the production application.
- Native release assembly now uses an explicit backend allow-list, preventing
  local environment files, databases, backups, uploaded documents, coverage
  data, and development plugin storage from entering release archives.
- The SPA shell now requires browser revalidation while fingerprinted frontend
  assets use explicit long-lived immutable caching, preventing stale HTML from
  continuing to reference an obsolete application build.
- `licensetrack doctor` now reports bind address, public URL, and effective
  reachability, warns about unconfirmed legacy reverse-proxy arrangements, and
  detects recorded network-mode mismatches.
- Added a native permission-contract verifier for release validation, covering
  service access to mutable data and denial of writes to application code,
  configuration, systemd, operator tooling, and upgrade snapshots.
- Suppressed Official Extension action and suggestion requests when the host is
  unavailable, preventing expected disabled-host responses from appearing as
  console errors in Sourcing, Pending Orders, Add License, and License Details.
- Kept the License Overview table header and column filters available when the
  active filters return no records, so users can broaden or clear the filter.
- Preserved sourcing-line start and end dates when editing the line from
  Pending Orders instead of dropping both fields from the update request.
- Interpreted offsetless SQLite API timestamps as UTC before applying the
  user's configured time zone, fixing history times that appeared one or two
  hours behind the server's local time.
- Ensured native Linux installations restart automatically after a successful
  database restore. The systemd unit now restarts after clean application exits,
  and native upgrades refresh the installed unit so the policy reaches existing
  deployments.
- Simplified the direct freeware/open-source conversion confirmation without
  repeating the pending-order rules already expressed by the workflow.
- Updated the transitive DOMPurify dependency used by PDF export to the patched
  `3.4.12` release.

## [1.1.0] - 2026-07-22

### Added

- Added native CPython 3.13 and 3.14 support alongside Python 3.12, with
  automatic runtime and ABI selection.
- Added per-ABI offline dependency wheelhouses for `cp312`, `cp313`, and
  `cp314` to the combined native Linux release.
- Added native runtime metadata to installation state and runtime compatibility
  checks to `licensetrack doctor`.
- Added operator-initiated native rollback through
  `sudo licensetrack rollback`, including explicit backup selection,
  non-interactive confirmation, configurable health timeouts, and
  maintenance-mode operation.
- Added pre-rollback safety backups and automatic recovery of the original
  installation if a manual rollback fails after restoration begins.

### Changed

- Replaced the public generic Plugin Host positioning with a trusted
  first-party Official Extensions model. The host is disabled by default,
  stable mode requires Ed25519 signatures from pinned LicenseTrack release
  keys, and existing unsigned installations migrate to a disabled and
  unverified state. Custom and third-party automation should use the public
  API, webhook, and sidecar integration framework.
- Updated the Official Extensions admin experience to show signer, checksum,
  trust state, declared access, and trusted server-code warnings.
- Upgraded the frontend runtime from React 18.3.1 to React and ReactDOM 19.2.8,
  with aligned React 19 type definitions while preserving the existing product
  behavior and visual design.
- Native release publication is now gated by installation smoke tests across
  Python 3.12, 3.13, and 3.14.
- Native upgrades now refresh the installed `licensetrack` operator command
  atomically after the upgraded application passes its health check.
- Native upgrade and rollback backups now preserve the matching operator
  command so application and management tooling remain aligned after
  restoration.
- Updated native deployment and maintainer documentation for the expanded
  Python runtime matrix and operator-initiated rollback.
- Updated audited frontend transitive dependencies while retaining npm 10
  lockfile compatibility.

### Fixed

- Fixed native installations performed under restrictive umask settings
  creating release paths that the system service account could not access.
- Fixed the frontend package lock after dependency auditing so it remains
  compatible with the npm 10 environment used by CI.
- Stabilized the demo Playwright renewal-conversion workflow against retained
  procurement-history behavior.
- Prevented the Official Extensions settings surface from showing a transient
  empty state before host discovery and package loading complete.

### Security

- Restricted Official Extension runtime environment inheritance, enforced
  settings and document access declarations for runtime and draft contexts,
  and terminated managed extension process trees during disable and uninstall.
- Updated frontend transitive dependencies to resolve reported high-severity
  npm audit findings.

### Release

- Version bumped to 1.1.0 across backend, frontend, README, Docker Compose,
  frontend package metadata, and wiki installation/deployment examples.

## [1.0.9] - 2026-07-19

### Added

- Added native Linux release archives for systemd-based Ubuntu 22.04 LTS
  x86_64 hosts, including checksum verification, a compiled frontend, an
  offline Python wheelhouse, and Standard and Advanced installation modes.
- Added native Linux upgrades with pre-upgrade backups, database migrations,
  health verification, atomic release activation, automatic rollback, and an
  installed operator CLI.
- Added a tag-driven native packaging workflow that publishes `.tar.gz`,
  `.zip`, and `SHA256SUMS` release assets.
- Added optional LT-Ref replacement behavior to Native CSV Import, matching the
  existing External Tool Import workflow. Exported licenses can now be edited
  and re-imported without creating duplicates.
- Added automatic Native Import matching for existing custom fields using their
  stable `cf_*` key or an unambiguous display name.
- Added existing custom fields to the External Import mapping selector.
- Added searchable history sections for converted and cancelled sourcing
  requests and pending orders.
- Added click-through procurement trail links from license details to
  historical sourcing records, pending orders, and created licenses.
- Added license detail history context for sourcing request/item data,
  pending-order data, procurement evidence counts, and related navigation.
- Added support for bundled renewal initiation: licenses sharing the same PO
  number and end date can create one sourcing request with multiple renewal
  lines.

### Changed

- Full Data CSV exports now use stable custom-field keys as headers for reliable
  export/edit/re-import round-tripping, including after a field is renamed.
- Native and External imports now share typed custom-field validation and
  nonblank update behavior. Blank cells preserve existing values.
- Invalid enum, date, numeric, and typed custom-field values are consistently
  treated as row errors instead of acknowledgement warnings.
- Import mapping presets are shared configuration: editors can load and use
  presets, while only admins can create, replace, rename, or delete them.
- Custom-field definition creation during import is shown only to admins.
- Converted and cancelled sourcing and pending-order records are now retained
  as read-only reference history instead of cluttering active workflow tables.
- Sourcing history can link forward to related pending orders, including
  converted orders in pending-order history.
- Pending-order history can link forward to created licenses, with line-level
  license links for multi-line orders.
- Tightened coterm renewal merge eligibility to require matching publisher,
  software description, license metric, predecessor end date, and compatible
  SKU when SKU values are present.
- Updated procurement, registry, integration, API stability, wiki, maintainer,
  Help Center, and glossary documentation for sourcing history, pending-order
  history, and procurement trail behavior.
- Made license table sortable headers keyboard-activatable and exposed
  `aria-sort`.
- Split native runtime dependencies from development and test dependencies so
  release archives and container images install only production requirements.

### Fixed

- Fixed Native Import creating duplicate licenses when re-importing records
  with matching LT references instead of offering the same replacement
  behavior as External Import.
- Fixed Native Import silently dropping recognized custom-field values during
  preview, creation, and LT-Ref updates.
- Fixed import confirmation trusting stale preview warnings by rebuilding
  duplicate detection, maintenance inference, update targets, and warning
  summaries immediately before writing.
- Isolated each imported row in a database savepoint so one persistence failure
  no longer invalidates successful rows in the same batch.
- Fixed update-only CSV imports not producing an audit event or reporting their
  updated count.
- Rejected non-empty CSV uploads that do not contain a usable header row.
- Rejected maintenance rows whose inferred parent appears later in the import
  file, since the parent must be persisted first.
- Normalized imported perpetual licenses so they cannot retain an end date.
- Fixed import mapping renames replacing or losing the mapping payload.
- Prevented non-admin mapped-import requests from saving or overwriting shared
  mapping presets through the execute endpoint.
- Clarified completion summaries so manually skipped rows are not incorrectly
  described as validation errors.
- Fixed renewal initiation for same-PO/same-end-date license groups creating
  separate sourcing requests instead of one multi-line sourcing request.
- Fixed misleading historical sourcing links that pointed only to active
  pending orders when the related PO had already converted.
- Fixed stale audit test coverage for coterm merge validation.
- Stabilized the frontend Playwright smoke test for license table publisher
  sorting.

### Release

- Version bumped to 1.0.9 across backend, frontend, README, Docker Compose,
  frontend package metadata, and wiki installation/deployment examples.

## [1.0.8] - 2026-07-17

### Added

- Added a License Overview toolbar column-category selector so users can quickly
  show or hide Standard, Advanced, Computed, and Custom Field list columns while
  building saved views, without visiting My Settings.

### Fixed

- Fixed an app-breaking shared frontend query-cache shape mismatch between the
  License Overview and Sourcing pages that could crash Sourcing with
  `licenses.find is not a function` after navigating from renewal workflows.
- Fixed the related License Overview failure mode where a stale shared cache
  could clear the license list and show a negative tracked-license count until
  another navigation refreshed the page.
- Hardened shared license-cache readers and mutation helpers so legacy
  array-shaped cache data is handled consistently across License Overview,
  Sourcing, Pending Orders, and renewal workflow actions.
- Added an explicit SMTP encryption mode fix so mail configuration no longer
  relies on ambiguous implicit encryption behavior.
- Hardened OIDC discovery and callback handling with explicit unsafe dev/test
  flags for HTTP or private IdP URLs, validation for server-fetched OIDC
  endpoints, and safe stage-aware callback diagnostics, including a generic
  `callback_failed` stage for unexpected server-side callback errors.

### Release

- Version bumped to 1.0.8 across backend, frontend, README, Docker Compose,
  frontend package metadata, and wiki installation/deployment examples.

## [1.0.7] - 2026-07-15

### Security

- Resolved remaining GitHub CodeQL findings by tightening document storage path
  validation around an explicit validated-path boundary and moving API token
  keyed digests to the cryptography HMAC API.

### Release

- Version bumped to 1.0.7 across backend, frontend, README, Docker Compose,
  frontend package metadata, and wiki installation/deployment examples.

## [1.0.6] - 2026-07-15

### Added

- Added `RESTART_AFTER_RESTORE` so Docker/process-manager deployments can keep
  the restore-and-exit restart flow while direct local development keeps the
  API process running after a database restore.
- Added a local stylesheet ownership map under `frontend/src/styles/README.md`
  and updated the style contract so future CSS has a clear destination.
- Added per-user default saved views on the License Overview while keeping the
  built-in Default view as a safe reset.

### Changed

- Split the former monolithic frontend stylesheet into ordered CSS partials
  while preserving the original cascade through `global.css` as the import
  manifest.
- Split PDF export dependencies into separate on-demand chunks so production
  builds no longer emit the Vite large-chunk warning.
- Consolidated settings presentation styles across API tokens, import mappings,
  custom fields, password and restore controls, global settings, visible
  categories, SMTP/email templates, extensions, webhooks, audit log, and
  remaining settings stragglers.
- Normalized root Vite/Vitest config formatting and Alembic environment comments
  to match the repository style contract.

### Fixed

- Returned restore restart status to the frontend and clarified restore
  messaging so local and process-manager restart modes report accurately.
- Covered both restore restart modes with backup integration tests.

### Security

- Hardened CodeQL-reported redirect, storage path, API token digest, email
  validation, and test assertion patterns before the 1.0.6 release tag.

### Release

- Version bumped to 1.0.6 across backend, frontend, README, Docker Compose,
  frontend package metadata, and wiki installation/deployment examples.

## [1.0.5] - 2026-07-14

### Added

- Added an upcoming license status for records whose entitlement start date is
  still in the future, with overview filtering, report counts, notification
  handling, and regression coverage.

### Changed

- Added a public style contract and contribution guidance for consistent
  AI-assisted backend, frontend, CSS, testing, and release work.
- Normalized backend formatting and comments to the repository style contract.
- Updated form placeholders to use more neutral wording.
- Consolidated frontend modal, settings, license-toolbar, and shared UI
  presentation patterns to reduce inline style drift.
- Consolidated global settings response normalization through the canonical
  frontend normalizer.

### Fixed

- Reduced frontend hook dependency suppressions to the remaining documented,
  license-scoped effects.
- Replaced silent cleanup failures with warning logs where broad cleanup paths
  intentionally continue after failure.
- Removed production-source comment artifacts, mojibake, and demo-build marker
  leakage from normal production builds.

### Release

- Version bumped to 1.0.5 across backend, frontend, README, Docker Compose,
  frontend package metadata, and wiki installation/deployment examples.
- Verified backend tests, frontend lint, frontend tests, frontend production
  build, demo marker absence, and tracked-file release-surface scans.

## [1.0.4] - 2026-07-12

### Added

- Added support for multiple invoice numbers per license while preserving
  compatibility with the existing single invoice number field.
- Added per-license renewal notification controls so individual records can be
  excluded from renewal reminders without changing global notification rules.

### Fixed

- Fixed renewal cancellation warnings by aligning the frontend with the
  backend `poWarning` response shape, including demo and regression coverage.
- Fixed stale completeness and notification state after admin mandatory-field
  changes by refreshing affected notification, license, report, and stats
  queries.
- Included procurement documents in completeness calculations, notifications,
  reports, and conversion responses so post-conversion evidence is counted
  consistently.
- Locked viewer access out of sourcing and pending-order procurement views
  while preserving department-scoped renewal workbench visibility.
- Hardened lifecycle deletion rules for licenses linked to sourcing,
  pending-order, procurement-document, renewal, and maintenance relationships.
- Fixed plugin draft suggestion and document-processing response schemas so
  draft sourcing and pending-order suggestions can be listed without validation
  errors.
- Normalized localized number fields in additional sourcing request lines
  before submit.
- Hardened frontend release workflows around API request casing, cache
  invalidation, role visibility, mutation side effects, procurement modal
  failures, renewal initiation, custom-field admin rollback, unsaved SMTP
  settings, and initial settings normalization.

### Security

- Tightened plugin action API-token scope checks for procurement and
  document-processing targets.
- Rejected oversized quote and document uploads earlier in request handling.

### Changed

- Updated frontend tooling and GitHub Actions dependencies while deferring the
  React 19 upgrade.
- Replaced deprecated Authlib JOSE imports.

### Release

- Version bumped to 1.0.4 across backend, frontend, README, Docker Compose, and
  frontend package metadata.

## [1.0.3] - 2026-07-08

### Security

- Upgraded `aiosmtplib` from 3.0.2 to 5.1.2 to address SMTP command
  injection via CR/LF in caller-supplied sender or recipient addresses
  (GHSA-v3q9-hj7j-63hq).
- Added defense-in-depth email address hardening for notification and settings
  flows: budget owner and manager email fields now reject CR/LF/NUL while
  preserving existing loose email formatting and CSV round-trip behavior.
- CSV import now flags CR/LF in `budget_owner_email` as a per-row validation
  error, and `email_service.send_email()` rejects CR/LF/NUL in `to` and `cc`
  before calling the SMTP sink.
- Added release-hygiene dependency audits to CI: `pip-audit` for backend
  Python dependencies and `npm audit --audit-level=high` for frontend npm
  packages.
- Added Dependabot configuration for grouped weekly backend pip, frontend npm,
  and GitHub Actions update PRs.

### Changed

- License exports now label `Quantity` as `Purchase Quantity` and the former
  `Total PO Price` as computed `Total PO Value`. The exported PO value is
  derived as the sum of `quantity x unit_price` across exported licenses that
  share a PO number, instead of reading the legacy stored `total_po_price`
  field.
- CSV import recognizes the new `Purchase Quantity` export header and ignores
  the derived `Total PO Value` header so fresh exports do not overwrite
  per-license stored totals on re-import. Legacy `Total PO Price` imports still
  map to the stored field for older CSVs.
- License details, edit forms, invoice confirmation, sourcing, pending-order
  conversion, CSV mapping, and help copy now consistently use `Purchase
  Quantity` for the bought quantity.
- `Total PO Value` is shown as a computed read-only value in license details
  rather than an editable stored field.
- Sourcing and pending-order CSV exports now use the `Purchase Quantity` label.

### Fixed

- Maintenance/support mirror cost now uses the active maintenance child's own
  line total (`quantity x unit_price`) instead of the legacy stored
  `total_po_price` aggregate, preventing a whole PO value from being attributed
  to one maintenance line.
- Renewal sourcing items now seed their estimated total from the renewing
  license's line total (`quantity x unit_price`) instead of the stored
  `total_po_price` aggregate.

### Maintenance

- Bumped backend dependencies including FastAPI, Uvicorn, Authlib, SQLAlchemy,
  Alembic, Pydantic, APScheduler, aiosmtplib, pytest, pytest-asyncio, respx,
  ruff, and cryptography.
- Bumped frontend dependencies including React Query, React Virtual, React Hook
  Form, Recharts, Playwright, Vitest, and related test/lint packages.

### Release

- Version bumped to 1.0.3 across backend, frontend, README, Docker Compose, and
  wiki installation/deployment examples.

## [1.0.2] - 2026-07-05

### Added

- CSV import now supports procurement dates: `request_date` and `purchase_date`
  are importable and export with importable headers, so a full export
  round-trips cleanly back into the tool.
- CSV import can update existing licenses by LT Ref (mapped flow). Re-importing
  an exported list reconciles onto existing records by LT Ref chain-head match
  instead of creating duplicates, with an auto-armed toggle and preview counts.
  `license_type`, `license_ref`, lifecycle, and maintenance-mirror fields are
  immutable on update; ambiguous refs surface a per-row error. The legacy
  `/confirm` path stays create-only.
- Admin-created users inherit the creating admin's regional and display
  preferences (currency, number/date/time format, timezone, theme, UI size).
  Personal layout state (saved views, column order, visible columns) still
  starts at defaults.
- User documentation wiki (`wiki/`, MkDocs Material) covering getting started,
  importing and understanding licenses, the renewal lifecycle, navigating the
  dashboard, and operations. Published to GitHub Pages via a new `Docs`
  workflow (`.github/workflows/docs.yml`, `mkdocs build --strict`).

### Changed

- Renamed the Renewal Workbench action from "Start Renewal" to "Initiate
  Renewal" so it matches the License Details panel.
- Consolidated operations/deployment reference into the wiki as the single
  source of truth: moved `docs/DEPLOY.md`, `docs/operations-runbook.md`, and
  `docs/user-guide/Backup and Restore.txt` into `wiki/operations/`. The former
  deployment guide is reframed as advanced "Production deployment & hardening";
  the beginner quick-start it duplicated now lives in the Installation guide.
- Repointed `README.md` and `docs/plugin-host-v1-roadmap.md` doc links to the
  new wiki paths.

### Fixed

- Sourcing item start/end dates are now preserved through conversion to a
  pending order and pre-filled into the convert-to-license form.
  `SourcingItemSummary` (nested in the pending-order response) previously
  omitted the dates, and the convert form hardcoded them blank.
- The first-launch login page now renders in light mode instead of gray,
  matching the post-login default for a consistent first impression.
- CSV import round-trip: `_IGNORED_HEADERS` lets a full export re-import skip
  computed/metadata columns instead of prompting custom-field creation, and the
  Flexera `purchase_date` alias now maps to the real field instead of
  `start_date`.

### Removed

- `docs/DEPLOY.md`, `docs/operations-runbook.md`, and
  `docs/user-guide/Backup and Restore.txt` (relocated to `wiki/operations/`).

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

- Documented, unversioned API with token authentication, application-version
  compatibility, and defined stability levels (see
  [docs/extension-authors/api-auth.md](docs/extension-authors/api-auth.md) and
  [docs/extension-authors/api-stability.md](docs/extension-authors/api-stability.md)).
- Optional extension points: document actions, declared capabilities,
  document-processing results, and webhooks.
- Author guides and copyable recipes for integrations and document processors
  (see [docs/extension-authors/build-integrations.md](docs/extension-authors/build-integrations.md),
  [docs/extension-authors/build-document-processor.md](docs/extension-authors/build-document-processor.md), and
  [docs/extension-authors/integration-recipes.md](docs/extension-authors/integration-recipes.md)).

### Deployment and security

- Docker and Docker Compose deployment serving the compiled frontend from the
  backend container via same-origin `/api` URLs.
- JWT sessions, bcrypt password hashing, and encryption of stored integration
  secrets derived from `JWT_SECRET`.
- Startup refuses blank or common default values for `JWT_SECRET` and
  `ADMIN_PASSWORD`.
- Configurable upload size and extension allow-list, CORS origin allow-list,
  and session cookie controls.

[1.1.0]: https://github.com/zndr88/LicenseTrack/compare/v1.0.9...v1.1.0
[1.0.9]: https://github.com/zndr88/LicenseTrack/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/zndr88/LicenseTrack/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/zndr88/LicenseTrack/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/zndr88/LicenseTrack/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/zndr88/LicenseTrack/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/zndr88/LicenseTrack/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/zndr88/LicenseTrack/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/zndr88/LicenseTrack/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/zndr88/LicenseTrack/releases/tag/v1.0.1
[1.0.0]: https://github.com/zndr88/LicenseTrack/releases/tag/v1.0.0
