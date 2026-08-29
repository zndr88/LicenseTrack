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

## [1.1.15] - 2026-08-30

### Changed

- Consolidated frontend routing, license creation, authenticated downloads,
  query invalidation, CSV preview rules, and suggestion review around their
  canonical hooks, API helpers, and components.
- Moved duplicated backend route and workflow logic into the owning license,
  sourcing, pending-order, import, document-processing, user, and plugin
  services.
- Unified internal storage, custom-field, reference-data, lifecycle,
  reporting, and notification operations while preserving existing public
  API and operator behavior.
- Kept registry column defaults in the frontend while retaining persisted user
  overrides and existing settings contracts.

This release introduces no database migration or configuration change.

## [1.1.14] - 2026-08-26

### Added

- Added filtered detailed-report APIs and complete, formula-safe CSV and
  paginated PDF exports with native-currency totals.
- Added persistent notification-run status for successful, partial, blocked,
  failed, skipped, and no-work outcomes.
- Added stable OIDC identity binding and per-user session invalidation.
- Added optional atomic line-item creation to `POST /api/pending-orders` while
  preserving header-only requests.
- Added sourcing-quote provenance and retired-license context to procurement
  history.

### Changed

- Unified report cards, forecasts, detailed views, CSV, and PDF around the same
  filtered, currency-safe calculations.
- Improved notification classification, delivery outcomes, loading errors, and
  retry guidance across scheduled and manual runs.
- Enforced backend session timeouts, rotated tokens after password changes, and
  invalidated sessions after security-sensitive account changes.
- Expanded audit coverage for downloads, exports, folders, mappings,
  notifications, webhooks, backups, and restores.
- Prefilled standard renewals with an editable one-year successor term and
  required a budget owner before renewal initiation.
- Aligned Renewal Workbench bundle eligibility with License Details and
  restricted existing-successor links to matching entitlements with advancing
  terms.
- Preserved individual line values in coterm merges, including mixed unit
  prices, while continuing to reject mixed currencies and license types.

### Fixed

- Corrected reports for mixed currencies, shared procurement and maintenance
  costs, invalid prices, and undated recurring records.
- Strengthened notification recipient validation and prevented repeated
  automatic retries after an unsuccessful daily attempt.
- Enforced forced-password changes at the API boundary, rejected inactive local
  logins, and tightened OIDC issuer, audience, email, and subject validation.
- Made database restore maintenance-safe with archive and schema validation,
  pre-swap migrations, recovery snapshots, and reliable outcome auditing.
- Prevented department-scoped Viewers from accessing shared contracts or
  procurement evidence connected to an unassigned department.
- Improved contract authorization, validation, legacy matching, document error
  handling, and synchronized document state.
- Kept quote, purchase-order, and invoice evidence on the correct scope and
  improved upload rollback, deletion cleanup, and missing-file handling.
- Strengthened CSV import parsing, header and mapping validation, custom-field
  handling, and duplicate detection.
- Isolated purchase-order totals by PO number and currency and made exports
  deterministic.
- Enforced unique organization and cost-centre names and aliases, with an
  upgrade check for existing conflicts.
- Reduced reference-data query overhead and made custom-field reordering atomic.
- Prevented concurrent sourcing conversions from creating duplicate pending
  orders or licenses.
- Scoped renewal cancellation correctly and stopped upcoming licenses from
  generating expiry notifications.
- Corrected shared-maintenance renewal, coverage history access and refresh,
  and maintenance-cost calculations.
- Improved final-line pending-order deletion, partial document-upload handling,
  and procurement-evidence transfer recovery.
- Kept procurement history navigation and links usable for filtered, converted,
  and retired records.

## [1.1.13] - 2026-08-25

### Added

- Added **Link existing successor** to the renewal workflow so a pre-purchased
  upcoming license under the same purchase order can become the next term
  without creating a duplicate purchase. The adopted license follows the
  standard renewal chain, procurement trail, lifecycle transition, reference
  alias, and unlink behavior.

### Changed

- Unified new managed document storage under an `attachments/` hierarchy keyed
  by immutable license, pending-order, procurement-bundle, sourcing-request,
  and contract IDs instead of using purchase-order numbers as physical folder
  names. Legacy stored paths remain readable and supported by backup, restore,
  and portfolio reset workflows.
- Classified Quote, Purchase Order, and Invoice uploads consistently as
  procurement evidence even when the attached license does not yet have a PO
  number.

### Fixed

- Made the **Docs** column selectable from License Overview and per-user
  settings, renamed **Visible Categories** to **Column Categories**, and kept
  the selector within the viewport when the attention banner lowers the toolbar.
- Required document categories now count toward completeness only when the
  managed file is available. Missing or unavailable files retain their
  metadata and availability counts but no longer make a license appear
  complete in the Registry, reports, notifications, exports, or Renewal
  Workbench.
- Rejected newly created or edited terms whose end date precedes their start
  date across manual entry, inline editing, CSV import, procurement conversion,
  maintenance, and renewal workflows. Existing invalid historical records
  remain readable and repairable instead of breaking the Registry response.
- Stopped classifying recurring licenses without an end date as perpetual.
  They remain active but incomplete until an end date is supplied, while true
  non-expiring license types retain perpetual status.
- Rejected explicit null values for required license fields and safely
  normalized null values for clearable text fields, preventing database errors
  during full and inline updates.
- Scoped bulk selection to the displayed page, cleared hidden selections when
  filters or pagination change, and identified the selected licenses in the
  delete confirmation.
- Reset and clamped Registry pagination after searches, filters, saved-view
  changes, and page-size changes so a valid filtered result cannot appear as an
  empty out-of-range page.
- Aligned Registry status filters with portfolio counts: **Active** no longer
  includes expiring licenses, and **Incomplete** no longer includes
  completeness-exempt records.
- Removed the redundant all-custom-field-values request from License Overview
  and built the custom-field map from values already embedded in the license
  registry response.
- Kept core license loading independent from auxiliary statistics, sourcing,
  pending-order, contract, and custom-field-definition failures. The Registry
  retains last-known supporting data, shows unavailable pipeline counts as
  unknown instead of zero, offers a focused retry, and applies stable license
  ID ordering before offset pagination.

## [1.1.12] - 2026-08-23

### Added

- Added an explicit **Import as legacy unlinked maintenance** exception for
  maintenance purchases whose original perpetual, OEM, or freeware parent is
  unavailable. Preview supports row-level and bulk selection, requires warning
  acknowledgement, marks the imported record for follow-up, and lets Editors
  and Admins establish a normal parent relationship later from License Details.
- Added upgrade migrations that restore missing foreign-key delete behavior for
  license relationships and procurement documents, persist invoice-evidence
  retry requirements, and enforce the explicit legacy-unlinked maintenance
  state without silently rewriting invalid existing relationships.

### Changed

- Updated supported backend and frontend dependencies to their latest
  compatible maintenance releases.
- License Overview sorting now follows each column's displayed meaning,
  including PO-wide totals, calculated values, lifecycle-aware expiration,
  localized labels, timestamps, and typed custom fields. Unsupported columns no
  longer advertise sorting, and filters now cover additional displayed fields
  and custom-field values consistently.
- Renewal Workbench estimated annual value now annualizes multi-year term cost.
  Renewal sourcing, coterm merges, and pending-order conversion preserve an
  explicit maintenance/support classification and apply the correct default
  when older recurring records do not have one stored.
- Pending-order batch conversion now validates a complete one-to-one set of all
  eligible lines before taking the conversion lock or creating licenses.

### Fixed

- Kept PO-wide totals and manual overrides scoped by both PO number and
  currency, preventing reused mixed-currency PO numbers from combining or
  relabelling monetary values in the Registry and reports.
- Aligned sourcing and pending-order overview totals and sorting with the
  canonical procurement line total, including separately priced support and
  preserving currency groups instead of combining unlike currencies.
- Hardened local sourcing quote previews against DOM-based XSS by encoding
  preview URLs, rejecting conflicting MIME types, and sandboxing PDF previews.
- Made post-conversion quote and invoice evidence transfer durable and
  idempotent across phase commits, status-update failures, scheduled retries,
  and missing required invoice files. A failed transfer remains recoverable
  without deleting already committed evidence or reconverting licenses.
- Preserved maintenance parent links, active-parent mirrors, coverage state,
  and legacy-unlinked state through ordinary edits, linking, disabling,
  retirement, renewal successors, conversion responses, and parent deletion.
- Prevented CSV import from creating an inferred maintenance child when its
  same-file parent is skipped, kept warning and audit counts aligned with the
  effective rows, honored the selected date format for mapped custom fields,
  and refreshed all affected Registry, renewal, report, notification, and
  reference-data caches after import.
- Allowed a license referenced only by cancelled renewal sourcing history to be
  deleted while retaining that history with the deleted predecessor reference
  removed. Active renewal/procurement relationships continue to block deletion.
- Fixed sourcing-request supplier changes so refreshed parent and line values
  are persisted and audited correctly.
- Fixed Registry zero-value totals, missing-value ordering, creator filters,
  quantity and notice-date filters, and stable ascending/descending ordering.

## [1.1.11] - 2026-08-20

### Added

- Added canonical Companies and Departments / Cost Centres with stable IDs,
  aliases, publisher/supplier roles, active status, usage counts, safe rename,
  merge, and delete workflows under Admin > Settings > Data Management. The
  upgrade migration backfills existing publisher, supplier, and cost-centre
  text without discarding the compatibility display fields used by existing
  integrations.
- Added reference-aware publisher, supplier, and cost-centre selectors across
  license, contract, user-access, sourcing, pending-order, conversion, and
  maintenance workflows. Existing names and aliases resolve to the canonical
  record while new values can be created through supported editor workflows.
- Added CSV reference-data review. Preview groups candidate organizations and
  cost centres, reuses exact names and aliases, and requires explicit decisions
  for possible duplicates or inactive references. Decisions are revalidated at
  execution time, and new references are created only for successful rows.
- Added immutable maintenance coverage history. When included support or an
  active maintenance record is replaced, LicenseTrack snapshots the prior
  period and exposes it from License Details alongside the current period.
- Added **Perpetual Licenses & Maintenance** and **Purchase Order Value
  Tracker** report sections for reviewing acquisition value, included or
  separately tracked support, manual PO overrides, line totals, and per-PO
  differences without combining currencies.
- Added request-level sourcing editing for supplier, contact, notes, and all
  open line items in one validated save. Converted and cancelled lines remain
  read-only. Newly attached quote files can be previewed in a split or expanded
  view before the sourcing request is saved.

### Changed

- Reorganized Admin Settings into General, Data Management, Integrations, and
  Operations. Reference data, license configuration, and import configuration
  now live together under Data Management.
- CSV preview now supports searchable maintenance-parent repair, configurable
  column visibility, condensed responsive layouts, collapsible reference
  review, and bulk decisions for unresolved possible duplicates.
- Perpetual, OEM, and freeware imports no longer become legacy merely because
  an included-support end date has passed. Expired included support is instead
  surfaced as an acknowledgement-required warning.
- Registry price filters accept the user's localized number format, maintenance
  coverage can be filtered explicitly, and the selected license row remains
  highlighted while its detail panel is open.
- Procurement forms now resolve canonical organizations and cost centres,
  preserve renewal-parent and purchase-date defaults during conversion, and
  keep quote actions at the owning request or order level rather than repeating
  them on each child line.
- Stable API responses may include additive `publisherId`, `supplierId`, and
  `costCentreId` fields. Existing name-based request fields remain supported;
  when an ID is present it is authoritative and the returned name is canonical.

### Fixed

- Refreshed license and reference-data query state after imports and
  procurement mutations so newly created parents, aliases, assignments, and
  canonical names appear without a manual reload.
- Preserved maintenance, renewal, supplier, purchase-date, and canonical
  reference relationships through direct writes, imports, sourcing updates,
  pending-order conversion, maintenance creation, and renewal successors.
- Made sourcing-request line updates atomic and prevented edits to converted or
  cancelled lines while retaining their historical values.
- Hardened reference merges, deactivation, role changes, viewer department
  assignments, CSV execution preflight, demo behavior, and large reference-list
  rendering against stale or conflicting decisions.

## [1.1.10] - 2026-08-16

### Added

- Added a shared manual Total PO Value override for purchase orders whose
  invoice provides only one total without usable line-level pricing. Editors
  and admins can set or clear the override from any License Details record in
  the PO; the value is synchronized across every license sharing that PO
  number and is included in registry CSV exports.
- Added separate Reports totals for Spend by License and Spend by PO Value,
  plus their Difference. Manual PO overrides are counted once in PO-value
  spend without being distributed into license-level breakdowns or forecasts.

### Changed

- Report sections now start collapsed, retain their expanded state for the
  browser session, and use the same compact section behavior as Admin and User
  Settings.
- Added compact search and result counts to detailed recurring-cost and
  publisher/supplier report tables, along with clearer filter status and reset
  behavior.
- Clarified that the importable legacy stored PO price is compatibility data,
  not the manual PO override or an active Total PO Value calculation.

### Fixed

- Kept shared PO overrides consistent when licenses are created, imported,
  converted, renewed, or moved between PO numbers, including inheritance from
  an existing PO and correct clearing when a license leaves a grouped PO.
- Fixed localized PO override entry so grouped values remain stable after the
  field loses focus.
- Preserved the pending-order conversion conflict guard while inheriting an
  existing PO override, so concurrent conversion attempts still reject the
  losing request with a conflict instead of an internal error.
- Prevented report PDF export while a custom date range is invalid and removed
  the duplicate date-range error message.

## [1.1.9] - 2026-08-14

### Added

- Added the backend maintenance-link foundation that lets one maintenance
  license be associated with multiple perpetual, OEM, or freeware parent
  licenses while preserving the existing primary-parent compatibility field.
- Added backend workflows to create maintenance records with multiple parent
  licenses and link an existing maintenance record to another eligible parent
  without retiring shared maintenance when one parent disables tracking.
- Added the License Details maintenance workflow for linking an existing
  maintenance/support record to another parent from a compact searchable list,
  alongside the existing create-new path.
- Added CSV import row remediation for maintenance records so an unresolved
  maintenance parent can be selected from existing eligible license records
  during preview and applied during import.

### Fixed

- Fixed demo bundled included support propagation so subscription and SaaS
  records derive support dates and support cost from their subscription term and
  acquisition value without double-counting procurement totals.
- Fixed CSV import handling for perpetual, OEM, and freeware rows with included
  support so imported coverage dates and explicit support cost are preserved; if
  no support cost is supplied, LicenseTrack defaults from the line total and
  warns the operator to verify the value.

## [1.1.8] - 2026-08-14

### Changed

- Expanded Flexera import normalization for license metrics and maintenance
  flags. Common Flexera metric labels now map to LicenseTrack metrics, while
  Custom Metric, Unknown, and Other land on Other / Unknown instead of blocking
  import. Flexera-style "includes maintenance" boolean columns can now map to
  included support coverage.
- Hardened CSV imports for files that were exported from LicenseTrack, adjusted
  in Excel, and saved again, so common spreadsheet rewrites do not prevent
  re-import.
- Updated Reports recurring-cost calculations so multi-year subscriptions,
  SaaS, maintenance, and paid included-support records are annualized for
  forecast baselines and allocated by overlapping days when a report date range
  is selected.
- Changed Sourcing Overview active rows to start expanded and allow each
  request to be collapsed independently.
- Showed Created as a date-only value in the License Overview table while
  keeping the full timestamp in License Details history.
- Reordered License Details quantities to show Purchase Quantity, Quantity per
  Unit, then Effective Quantity.
- Allowed included support coverage on subscription and SaaS licenses. For
  those bundled-support records, LicenseTrack derives support dates from the
  subscription dates and support cost from the acquisition total, hides the
  derived inputs in license, sourcing, and pending-order forms, and avoids
  double-counting the bundled cost in procurement totals.

## [1.1.7] - 2026-08-13

### Added

- Added native **Service** and **Other** license types for implementation
  services, purchase-adjacent costs, and uncommon external purchase types that
  should remain in the registry without being treated as renewable entitlement
  lines.
- Added authenticated PDF preview from License Details documents. Existing PDF
  files can now be previewed in a side pane while the details panel remains
  usable, and the original download action is unchanged.
- Added native Quantity per Unit and derived Effective Quantity support across
  licenses, CSV imports, registry exports, details, manual creation, and
  pending-order conversion. Purchase Quantity remains the commercial count used
  for cost calculations, while Effective Quantity represents entitlement scale.

### Changed

- Expanded Flexera purchase-type handling so common values such as Software
  Subscription, Software Maintenance, Software Baseline, Software, and Service
  map to the closest LicenseTrack license type during import.
- Made the Reports department and cost-centre filter searchable and scrollable
  for large portfolios.
- Capped the License Overview attention banner at six visible warnings and
  remeasured the virtual registry after dismissing it.
- Displayed request date and purchase date as date-only values in License
  Details to reduce timestamp clutter.

### Fixed

- Prevented weak fallback import aliases such as `Item` from overriding a real
  Software Description column, and kept duplicate recognized columns available
  for manual mapping instead of silently hiding them.
- Excluded legacy records from report forecast calculations when retired and
  legacy records are not included.
- Renamed the Full Data CSV `total_po_price` header to `total_po_value` so the
  export label matches the stored portfolio meaning.

## [1.1.6] - 2026-08-12

### Added

- Added license **Secondary Contacts** beside the budget owner. These contacts
  are stored on the license, editable from License Details, and copied as CC
  recipients on budget-owner renewal emails when SMTP notifications are enabled.
- Added CSV import support for secondary contacts, including repeatable mapped
  email columns such as application owner or technical owner fields from
  external exports.
- Added native and mapped CSV import support for request date, purchase date,
  procurement reference, and parent LT Ref fields so imported legacy records can
  match the current application data model more closely.

### Changed

- Expanded the native CSV template and import preview to show the newer
  procurement and contact fields operators are likely to reconcile during a
  first portfolio load.
- Capped the License Overview warning list with an internal scrollbar so large
  first-import warning batches no longer take over the whole page.

### Fixed

- Hardened CSV quantity parsing for Flexera-style exports that contain both
  purchase quantity and quantity-per-unit values. Quantity-per-unit headers are
  no longer treated as the purchased license quantity.
- Treated far-future dates such as `1-1-2099` as perpetual license indicators
  without blocking import.
- Shared the declared import date format with custom date-field validation so
  native and mapped imports parse operator-selected date formats consistently.
- Preserved localized numeric parsing and update-on-LT-Ref behavior while
  applying the new import fields.

## [1.1.5] - 2026-08-09

### Added

- Added a procurement reference field to sourcing-to-pending-order workflows so
  teams can track internal request or approval numbers before a formal PO
  number exists.
- Added paginated sourcing and pending-order history tables with compact row
  action menus for evidence download and deletion.
- Exposed sourcing quote evidence from pending-order rows and pending-order
  history so quotes remain reachable after a request leaves active sourcing.

### Changed

- Pending orders can now be created before the real PO number is known, while
  final conversion to active licenses still requires an actual PO number.
- Sourcing and pending-order row actions now favor the primary Convert action
  and move edit, evidence, and cancel/delete actions into a consistent menu.
- Evidence action labels now use filenames directly, making multiple uploaded
  quote or PO documents easier to distinguish.

### Fixed

- Included sourcing quote documents in pending-order API responses so pending
  order views can offer quote download and delete actions.
- Refreshed frontend audited transitive dependencies and aligned demo/unit tests
  with the current procurement conversion forms.

## [1.1.4] - 2026-08-04

### Added

- Standardized exported record identifiers as **Sourcing Request ID**,
  **Sourcing Line ID**, **Pending Order ID**, **Pending Order Line ID**, and
  **License Record ID**. License Details now shows the exact License Record ID
  alongside creator and timestamp history.
- Expanded direct multi-license entry so every eligible line can configure
  included or separately tracked maintenance. Quote, purchase-order, and
  invoice evidence uploaded with a multi-license batch is shared across that
  batch without using PO-number text as the sharing key.

### Fixed

- Made direct multi-license creation atomic and protected it from repeated
  submission. A failed row or audit write creates no licenses, while a
  post-create attachment failure is reported separately so operators can retry
  the document without recreating the batch.
- Removed managed license-document files only after a successful single or bulk
  license deletion commit, while preserving procurement evidence that is still
  shared by surviving licenses.
- Included incomplete-license items in manager-digest eligibility and preserved
  notification and backup hour `0` as midnight.
- Added structured audit events for contract-document uploads/deletions and
  changed license custom-field values, without adding no-op custom-field events.
- Accepted a file payload exactly equal to the configured upload maximum while
  continuing to reject larger payloads and excessively large multipart
  requests.
- Corrected gray-theme contrast, programmatic form-label associations, and
  desktop keyboard isolation so activating a contract tile's delete control no
  longer opens the contract.
- Preserved localized number formatting for added manual license lines and gave
  those lines the same maintenance/support choices as the first line.
- Refreshed supported backend, frontend, and GitHub Actions dependencies,
  including current security fixes for audited transitive packages.

## [1.1.3] - 2026-07-26

### Added

- Added an optional license `notice_date` for manually tracked contractual
  notice deadlines. Notice dates can be shown, edited, imported, exported,
  included in completeness goals, and warned on when they fall after the
  license end date.
- Added a separate global notice-deadline alert window. Notice deadline
  reminders appear in notifications and manager digests, while expiry emails
  continue to use the budget-owner recipient flow.
- Added a `Mark Handled` action for notice deadlines. Handled notice dates are
  excluded from in-app notice alerts and manager digests, and the handled state
  clears automatically when the notice date changes.

### Fixed

- Enforced real browser-session logout for the inactivity timeout so an expired
  frontend session cannot be immediately restored from the still-valid session
  cookie.
- Hardened login throttling so a successful username login no longer clears
  the source-IP password-spray limiter, and active limiter entries are capped
  after expired entries are pruned.
- Prevented stale document refreshes from replacing the currently selected
  license's document list after uploads, deletes, or processing-review actions
  resolve out of order.
- Honored the configured expiry alert window consistently across Registry
  statistics, license responses, exports, reports, renewal and maintenance
  responses, pending-order conversion responses, contracts, and notifications.
- Treated contract numbers as case-insensitive contract identities for contract
  create/update validation, license linking, linked-license counts, and viewer
  contract access, while returning clear conflicts for pre-existing duplicate
  contract records instead of server errors.
- Scoped `GET /api/licenses/departments` to the caller's visible license
  departments so viewers cannot enumerate departments outside their assignment.
- Parsed report `YYYY-MM-DD` values as local calendar dates in date-range
  filters and the renewal calendar, avoiding off-by-one quarter results in
  negative UTC offsets.
- Deduplicated exact duplicate viewer department assignments before saving so
  repeated values no longer trigger a database integrity error, while preserving
  manually distinct casing such as `ART` and `art`.

## [1.1.2] - 2026-07-25

### Fixed

- Aligned License Details renewal cancellation with sourcing-request
  cancellation: unfinished renewal sourcing requests now move to cancelled
  history instead of being deleted, and audit history uses the same
  `sourcing_request.cancelled` event as the Sourcing page.
- Cancelled a pending order automatically when its final license line is
  deleted, with a stronger frontend warning and history-preserving audit trail
  so empty active purchase orders no longer linger.
- Refreshed procurement-related query state more broadly after sourcing and
  pending-order lifecycle changes so portfolio numbers, pipeline counts,
  renewal workbench rows, and License Overview renewal statuses update without
  waiting for stale cached data.
- Corrected renewal-chain validation so intermediate licenses may retain both
  incoming and outgoing links, while administrative repair accepts secondary
  coterm predecessors and continues to reject cycles and conflicting
  one-to-many successor relationships.
- Preserved established renewal ancestry when cancelling an unfinished
  successor renewal from either License Details or Sourcing. Cancellation now
  targets only the pending procurement workflow while retaining reciprocal
  navigation across the completed predecessor and successor.
- Removed empty original sourcing requests after coterm merge while preserving
  requests that still contain unrelated sourcing items.
- Aligned renewal sourcing and pending-order conversion so license type, metric,
  pricing, quantity, currency, dates, supplier/contact details, and notes carry
  forward consistently. Single and batch conversion now share the same defaults
  and backend persistence contract, explicit conversion-time overrides remain
  authoritative, and maintenance type, metric, and parent requirements continue
  to be enforced.
- Enforced one human-editable target supplier across each sourcing request and
  pending order. Renewal history remains unchanged when procurement selects a
  different supplier, unresolved renewal bundles and coterm merges remain
  unassigned, and resulting licenses use the actual pending-order supplier
  instead of stale sourcing or predecessor values.
- Cleared pending renewal state from every coterm predecessor when merged
  sourcing or pending-order renewal work is cancelled or deleted.
- Standardized renewal workbench, coterm, and procurement calculations on
  Decimal arithmetic. Fractional quantities and configured precision are
  retained, invalid numeric values are reported or rejected instead of silently
  becoming zero, sourcing merge quantities remain exact and locale-aware
  throughout the frontend workflow, and existing API response formatting
  remains compatible.
- Kept normal and consolidated renewal ancestry visible while a successor has a
  subsequent renewal in progress, alongside the current sourcing or
  pending-order progress actions.
- Prioritized outgoing renewal sourcing and pending-order progress in the
  Renewal Workbench when a successor license also has incoming ancestry.
- Removed the misleading Procurement Trail evidence counter and aligned its
  sourcing request, sourcing line, and pending-order links with the existing
  neutral renewal-lineage card presentation. Procurement documents and evidence
  transfer behavior are unchanged.
- Prevented modal focus management from overriding an already-focused form
  control, avoiding dropped input during rapid custom-field editing.
- Moved scheduled and manually triggered routine backup creation, integrity
  checks, and retention pruning off the async API event loop while preserving
  serialized execution and existing backup behavior.
- Hardened server-side restore selection so request filenames are used only to
  select an inspected archive returned by trusted directory enumeration, rather
  than to construct a filesystem path.
- Preserved document metadata after database-only restores while marking
  missing or unavailable managed files in document lists, counters, restore
  warnings, and native doctor output.

## [1.1.1] - 2026-07-24

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
- Validated native installation, upgrade, portfolio-recovery restore, and
  automatic post-restore restart behavior on Debian 13 (Trixie).
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

[Unreleased]: https://github.com/zndr88/LicenseTrack/compare/v1.1.15...HEAD
[1.1.15]: https://github.com/zndr88/LicenseTrack/compare/v1.1.14...v1.1.15
[1.1.14]: https://github.com/zndr88/LicenseTrack/compare/v1.1.13...v1.1.14
[1.1.13]: https://github.com/zndr88/LicenseTrack/compare/v1.1.12...v1.1.13
[1.1.12]: https://github.com/zndr88/LicenseTrack/compare/v1.1.11...v1.1.12
[1.1.11]: https://github.com/zndr88/LicenseTrack/compare/v1.1.10...v1.1.11
[1.1.10]: https://github.com/zndr88/LicenseTrack/compare/v1.1.9...v1.1.10
[1.1.9]: https://github.com/zndr88/LicenseTrack/compare/v1.1.8...v1.1.9
[1.1.8]: https://github.com/zndr88/LicenseTrack/compare/v1.1.7...v1.1.8
[1.1.7]: https://github.com/zndr88/LicenseTrack/compare/v1.1.6...v1.1.7
[1.1.6]: https://github.com/zndr88/LicenseTrack/compare/v1.1.5...v1.1.6
[1.1.5]: https://github.com/zndr88/LicenseTrack/compare/v1.1.4...v1.1.5
[1.1.4]: https://github.com/zndr88/LicenseTrack/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/zndr88/LicenseTrack/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/zndr88/LicenseTrack/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/zndr88/LicenseTrack/compare/v1.1.0...v1.1.1
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
