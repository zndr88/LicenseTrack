# Architecture Notes

This document records the current architecture conventions. It is not a full design specification; it is a short map for maintainers so future changes do not drift back into duplicated page and route logic.

## Frontend Runtime Baseline

The frontend runtime baseline is React 19 and ReactDOM 19. `frontend/src/main.jsx`
uses `createRoot`, the Vite React plugin supplies the modern JSX transform, and
development runs under `StrictMode`. Keep direct React integrations on versions
whose peer ranges include React 19, and preserve npm 10 compatibility when the
lockfile changes. Do not use `--force` or `--legacy-peer-deps` to hide an
incompatible dependency tree.

Frontend tests use React Testing Library. When component state is loaded by
independent effects or lazy imports, wait for the specific user-visible state
the test needs instead of assuming that an earlier parent render flushed all
descendant work.

## Frontend Data Flow

Server state is managed with TanStack Query.

- Query keys are centralized in `frontend/src/queryKeys.js`.
- Repeated invalidation groups live in `frontend/src/queryInvalidation.js`.
- Pages should prefer `useQuery`, `queryClient.invalidateQueries`, and `queryClient.setQueryData` over local reload-key state.
- Single-page UI state, filters, selected IDs, draft form state, and local modal state remain ordinary React state.

When a mutation affects multiple domains, prefer a named invalidation helper once the same group appears more than once. Keep optimistic cache updates local when they are simple and well-tested.

## LicensesPage Sub-Module Pattern

`LicensesPage.jsx` is a composition layer. Its responsibilities are split across sub-modules in `frontend/src/components/pages/licenses/`:

| Module | Owns |
|--------|------|
| `useLicensesPageData.js` | Server data fetching (licenses, stats, sourcing, contracts, custom fields) |
| `useLicenseActions.js` | Mutation handlers (create, update, single-field patch, delete, renewal, bulk delete) |
| `useLicenseTableState.js` | All table UI state (search, filters, sort, selection, pagination) |
| `LicenseTable.jsx` | Table rendering, virtualizer, inline edit mode handoff, column drag/sort/hide, pagination |
| `LicenseToolbar.jsx` | Search, saved views dropdown, Current View / Full Data / localized Current View CSV exports, inline edit, filter/stats/full-view toggles |
| `LicenseStatusFilter.jsx` | Status chip filters with complete↔incomplete mutual exclusivity |
| `LicenseAttentionPanel.jsx` | Expiring/expired attention banner |
| `LicenseBulkActions.jsx` | Bulk delete confirmation dialog |
| `licenseColumns.js` | Shared Registry column catalog: user-facing static fields, visibility groups and defaults, custom-field column assembly, saved ordering helpers, and Full Data export selection |
| `exportFilteredCsv.js` | Registry CSV export assembly: selected columns in supplied order, canonical ISO values by default, localized Current View formatting when requested, stable custom-field keys for Full Data round-trips, custom-field values, and spreadsheet-formula escaping |

`LicensesPage.jsx` computes derived values (`activeColumns`, `visList`, `attentionItems`, `allFilteredSelected`) and wires navigation props through to `DetailPanel`. It also owns the inline edit mode toggle because that mode coordinates toolbar state, table row behavior, and detail-panel selection. Inline edits use the single-field patch path in `useLicenseActions.js`; computed columns, document counts, custom fields, and workflow actions stay outside the table editing surface. The `onStatsChange` effect that feeds the sidebar portfolio widget remains in `LicensesPage` because it depends on both the filtered stats and navigation callbacks that live at page level.

## DetailPanel Sub-Module Pattern

`DetailPanel.jsx` is a composition shell. Its responsibilities are split across sub-modules in `frontend/src/components/licenses/detail/`:

| Module | Owns |
|--------|------|
| `useRenewalPanelModel.js` | PO-sibling detection and bundle count derivation for renewal workflow |
| `DetailSectionHeader.jsx` | Shared collapsible section header button with chevron |
| `CustomFieldRows.jsx` | Shared custom field row renderer used by all sections |
| `IdentitySection.jsx` | Publisher, description, badge row, parent/maintenance navigation, maintenance expiry alert |
| `RenewalWorkflowSection.jsx` | All renewal lifecycle state boxes (expiring, pending, renewed, draft, consolidated) |
| `ContractDatesSection.jsx` | Start/end/notice dates, notice handled action/status, editable request/purchase procurement milestones, contract #, PO #, invoice #, contract record link |
| `MaintenanceSection.jsx` | Maintenance coverage dates, linked maintenance children, add/disable maintenance actions |
| `HistorySection.jsx` | Read-only License Record ID, creator account label, license-row creation and last-update timestamps, plus procurement-trail links to source sourcing and pending-order records |
| `CommercialSection.jsx` | License type, metric, purchase/effective quantity, SKU, pricing, currency |
| `PeopleSection.jsx` | Supplier, cost centre, publisher contact link, budget owner, secondary contacts |
| `EmailPublisherAction.jsx` | Bottom Email Publisher action, same-PO/same-publisher scope prompt, mailto construction |
| `DocumentsSection.jsx` | License/procurement document display, upload/download/delete/preview controls, and integration-backed document action buttons |
| `CompletenessFlagsSection.jsx` | Completeness checklist and retired/legacy/exempt toggles |
| `NotesSection.jsx` | Notes display; also exports `CatchallCustomFieldsSection` for unassigned custom fields |

`DetailPanel.jsx` calls `useDetailPanelState` for all state and handlers, then wires props through to section components and mounts modals (`FieldEditModal`, `MaintenanceCreateModal`, `LinkCommitmentModal`, `ConfirmDialog`). `MaintenanceCreateModal` owns the License Details create-new/link-existing maintenance workflow, including the compact searchable existing-maintenance picker. No domain logic or rendering logic belongs in the shell.

Document actions are part of the core-rendered integration surface. `DocumentsSection.jsx` should render actions from `useLicenseDocuments`; it should not hard-code plugin names or assume AI processing specifically. Action availability is determined by the backend from registered integration capabilities and active webhook subscribers. This is not runtime frontend plugin loading.

PDF document preview is coordinated at `LicensesPage.jsx` level through
`useDocumentPreview.js` and `DocumentPreviewPane.jsx` so the preview can replace
the registry area while the selected license detail panel remains mounted and
usable. `useLicenseDocuments.js` gates preview eligibility with
`utils/documentPreview.js` and continues to use authenticated API download
helpers rather than direct browser navigation.

## RenewalWorkbenchPage Sub-Module Pattern

`RenewalWorkbenchPage.jsx` is a composition layer. Its responsibilities are split across sub-modules in `frontend/src/components/pages/renewals/`:

| Module | Owns |
|--------|------|
| `workbenchRules.js` | Pure domain: view options, status/risk/severity constants, view count computation, priority sort, risk flag ordering, `getPrimaryAction`, `rowTone`, `includesSearch` |
| `workbenchColumns.js` | Column definitions, custom field discovery and deduplication, visibility resolution (with legacy-id fallback), `renderCustomFieldDisplay`, `formatDate` (delegates to `utils/formatting.js`, accepts `userSettings` for locale-aware date display) |
| `RenewalWorkbenchTable.jsx` | Table and cell rendering; receives `visibleColumns`, `visibleRows`, `userSettings`, permissions, and handlers as props; threads `userSettings` through `renderCell` for locale-aware date and custom field display |
| `RenewalWorkbenchToolbar.jsx` | Search input, view chip strip, column picker; owns `columnsOpen` state and outside-click dismiss |

`RenewalWorkbenchPage.jsx` runs queries, manages page-level state (`view`, `search`, `startingId`), persists column visibility via `updateSettings`, and composes the four sub-modules. No domain logic or rendering logic belongs in the shell.

## Procurement Page Sub-Module Pattern

The procurement pipeline is split across the sourcing and pending-order pages. Keep page shells focused on state, API mutation handlers, and modal orchestration; move large render-only surfaces or isolated workflows into sub-modules.

### SourcingPage

`SourcingPage.jsx` is a composition layer. Its responsibilities are split across sub-modules in `frontend/src/components/pages/sourcing/`:

| Module | Owns |
|--------|------|
| `SourcingTable.jsx` | Parent sourcing request rows, quote evidence indicators, expandable license-line rows, search box, merge-selected action, sortable sourcing table, primary Convert action, row action menu items, read-only history reference actions, child line actions, and row badges |
| `MergeSourcingModal.jsx` | Merge confirmation UI, selected item summary, final merged quantity input |
| `CotermSuggestionBanner.jsx` | Coterm renewal opportunity banner and select-group action |
| `SourcingToast.jsx` | Page-local success/error toast presentation |
| `components/procurement/SourcingRequestEditModal.jsx` | Atomic request-level editing for supplier/contact/notes and all eligible open lines; converted/cancelled lines remain read-only |
| `components/procurement/SourcingItemModal.jsx` | New-request and line-entry form, including local pre-save PDF/image/text quote preview |
| `useSourcingPageData.js` | TanStack Query setup for active and historical sourcing requests plus license context load for coterm detection |
| `useSourcingActions.js` | Create/update/delete/convert/export mutation handlers and cross-page invalidation callbacks |
| `useSourcingMerge.js` | Selected-for-merge state, merge quantity, merge submit lifecycle |
| `useSourcingQuotes.js` | Quote upload file input state, quote upload, quote download, and quote delete |

`SourcingPage.jsx` owns page composition, active and history sort/search/pagination state, highlighted row state, modal open/close state, and wiring between the hooks and presentation components. The history table is a read-only second table used for converted and cancelled sourcing requests; document evidence actions remain available through row action menus when permitted. Coterm grouping remains in `frontend/src/hooks/useCotermDetection.js`.

### PendingOrdersPage

`PendingOrdersPage.jsx` delegates server data and cross-page invalidation to `frontend/src/components/pages/usePendingOrdersData.js`.

| Module | Owns |
|--------|------|
| `usePendingOrdersData.js` | Active and historical pending-order queries, shared licenses query context, create/update/delete/convert/batch-convert/add/update/delete-item handlers, purchase-order document upload/download/delete, sourcing quote download/delete from pending-order context, CSV export, related query invalidation |
| `PendingOrdersPage.jsx` | Active and history search/sort/pagination/expanded-row state, highlight behavior, table rendering, modal orchestration, conversion prefill builder, pending line-item edit/delete confirmation wiring |
| `pendingOrders/PendingOrdersTable.jsx` | Pending-order parent rows, PO and carried-forward quote evidence indicators, expanded line-item rows, primary Convert action, row action menu items, read-only history reference actions, line-item quote/download action buttons, and status badges |

Keep new pending-order API handlers in `usePendingOrdersData.js` unless they are purely local UI actions.

Shared procurement history pagination is implemented by
`frontend/src/components/procurement/ProcurementTablePagination.jsx`; keep page
state in the owning page and the footer rendering in the table composition.

The procurement history and trail linking contract is captured in
`docs/maintainer/procurement-history-trail.md`. Keep those links based on stored
ids and relationships, not PO-number text matching.

## Procurement Conversion Components

Batch pending-order conversion is decomposed so `ConvertAllModal.jsx` remains the shell for the form array and submit lifecycle:

| Module | Owns |
|--------|------|
| `frontend/src/utils/buildConvertItemDefaults.js` | Pure default-value construction for one form item per sourcing row |
| `frontend/src/components/procurement/ConvertItemForm.jsx` | Single conversion item card, local expand/collapse, price display state, item readiness helper, maintenance parent picker wiring |
| `frontend/src/components/procurement/ParentLicensePicker.jsx` | Explicit maintenance/support parent selection for existing perpetual/OEM/freeware licenses and eligible same-conversion parent rows |
`ConvertAllModal.jsx` owns the batch-level copy action for shared PO fields. The action copies PO number, procurement reference, contract number, invoice number, contact email, supplier, cost centre, currency, and budget owner email from the first conversion item into the remaining items. Do not reintroduce per-item price formatting, readiness checks, or default-value construction into `ConvertAllModal.jsx`.

Single pending-order conversion is similarly decomposed:

| Module | Owns |
|--------|------|
| `frontend/src/components/procurement/ConvertPendingOrderModal.jsx` | Modal shell, React Hook Form binding, save lifecycle, and field layout |
| `frontend/src/components/procurement/buildPendingOrderConversionPayload.js` | Pure conversion payload construction, date normalization, numeric parsing, SaaS portal URL rule, maintenance parent IDs |
| `frontend/src/components/procurement/PendingOrderInvoiceField.jsx` | Invoice file input presentation and selected-file display |

Do not put payload normalization or invoice-file display logic back into `ConvertPendingOrderModal.jsx`.

Pending orders may be created before the formal PO number exists by using a
procurement reference or only the generated pending-order id. Final conversion
to active licenses must still require a real PO number; keep that invariant in
the pending-order conversion path rather than in sourcing conversion.

## ReportsPage Sub-Module Pattern

`ReportsPage.jsx` computes datasets and coordinates filters/export. Report presentation lives in `frontend/src/components/reports/`:

| Module | Owns |
|--------|------|
| `reportShared.jsx` | Shared collapsible report section shell, table search toolbar, empty state, sort header, legend, palette |
| `CostCentreDropdown.jsx` | Searchable, scrollable cost-centre filter dropdown |
| `CostForecastSection.jsx` | Budget forecast controls and forecast table/chart presentation |
| `PublisherBreakdownSection.jsx` | Publisher spend chart plus sortable publisher/supplier relationship table |
| `PortfolioBreakdownSection.jsx` | License type and billing metric breakdown presentation |
| `RenewalCalendarSection.jsx` | Renewal calendar chart/table presentation |
| `PerpetualMaintenanceSection.jsx` | Perpetual acquisition and included/separately tracked maintenance reconciliation |
| `PurchaseOrderSection.jsx` | Searchable per-PO override, line-value, and difference reconciliation |

`ReportsPage.jsx` fetches portfolio annual cost via `useQuery` (`queryKeys.reportsPortfolioStats` -> `GET /api/reports/portfolio-stats`) and displays that server rollup in the chip row above the report sections. This key is intentionally separate from the sidebar's `queryKeys.portfolioStats` cache because the two queries return different shapes. The Upcoming, Active, Expiring, and Expired chips are client-computed from the filtered license list so they update with report filters; Active excludes Upcoming and Expiring. All section-specific datasets (cost forecast, publisher and vendor overview, portfolio health, renewal calendar) remain client-computed from the raw license list fetched separately. `ReportsPage.jsx` also computes `singleCurrency` (the single ISO currency code present across the filtered dataset, or `null` when multiple currencies are mixed); chart sections receive `singleCurrency` and suppress currency-dependent chart portions with explanatory notes when needed. Grouped tables remain available. All spend totals use `formatCostByCurrency` so mixed-currency portfolios display grouped values by currency rather than a combined figure. `ReportsPage.jsx` should not own section-specific sort state or large chart/table JSX.

Sections start collapsed and `ReportSections.jsx` persists expansion state in
session storage; table-specific search stays inside the owning report section.

Cost Overview keeps two separate spend meanings. Spend by License sums strict
line values (`quantity * unit_price`) for the attributable headline comparison.
Spend by PO Value groups nonblank PO numbers, uses
`po_total_override` once when present, otherwise sums line values, and treats
PO-less records individually. The Difference is PO-value spend minus
license-line spend. Never replicate a PO override into publisher/vendor,
lifecycle, or forecast calculations because no line allocation exists. Preserve
currency grouping in all three totals.

`getPurchaseOrderReport` and `getPerpetualMaintenanceReport` in
`frontend/src/utils/reportHelpers.js` own the two detailed reconciliation
models. Keep PO overrides confined to the PO tracker, preserve unkeyed rows as
individual entries, resolve maintenance children through explicit link IDs,
and group every total by currency.

Date-only report values must stay calendar-date based. `frontend/src/utils/reportHelpers.js` parses `YYYY-MM-DD` start and end dates as local dates before date-range and renewal-calendar comparisons so browser UTC offsets cannot move boundary dates into the previous day or quarter.

## Help Center Pattern

`HelpPage.jsx` is the in-app product documentation surface. It is intentionally a static, searchable help center rather than a user-editable wiki.

The Help entry point lives in `TopBar.jsx` as a top-right utility button. Do not add Help to the main top navigation beside Overview, Import, Reports, or Admin, and do not add it to the sidebar reference group. The top navigation is for primary work areas; the sidebar is for operational pipeline and reference data. Help cuts across all work areas and should remain a utility-level route.

`HelpPage.jsx` is the single source for its local article catalog and owns category filtering, search ranking, selected article state, and article rendering. Do not maintain a second article mirror under `docs/`. Keep the content user-facing and version-local: product workflows, feature behavior, caveats, troubleshooting, and glossary terms belong here. Deployment, compliance, release, security, and maintainer-only material should remain in repository or website documentation.

If Help content grows large enough to require external data loading, preserve the same product boundary: authenticated users should be able to access help in a self-hosted install without depending on a public website.

## ContractModal Sub-Module Pattern

`ContractModal.jsx` owns contract identity/edit state and wires the detail modal. Folder and document management belongs in `frontend/src/components/contracts/ContractDocumentsSection.jsx`, which owns document fetch, upload/download/delete, folder CRUD, folder expansion, and related loading/error states.

Keep contract document state out of `ContractModal.jsx` unless it directly changes the contract record itself.

## UsersPage Sub-Module Pattern

`UsersPage.jsx` owns user/departments loading, mutation handlers, edit drafts, delete/reset flows, and break-glass/admin-sensitive wiring. Presentation-only user management pieces live in `frontend/src/components/users/`:

| Module | Owns |
|--------|------|
| `NewUserForm.jsx` | Add-user form presentation, role/auth-provider controls, viewer department selector, download toggle, and local/OIDC password-field visibility |
| `ResetPasswordPanel.jsx` | Inline reset-password panel presentation for local users, including error text, temporary-password input, reset button, and cancel button |

Keep backend permission invariants in the API/services and page-level mutation wiring. Do not push admin safety rules into presentation components.

## CSV Import Hook Pattern

`useCSVImportState.js` is the composition hook for the CSV import page. It owns shared shell state such as step, source, selected file, drag/drop, loading, error state, and the declared import number/date formats defaulted from the user's settings. Flow-specific work is delegated:

| Module | Owns |
|--------|------|
| `useCSVImportPreview.js` | Native import preview data, warning summary exposure, row selection, skipped rows, duplicate warning counts, acknowledgement-aware confirm import, and the native `updateExisting` flag |
| `useCSVImportAnalysis.js` | External/mapped import analysis, native and existing-custom-field column decisions, admin-only custom-field creation, saved mappings, mapping preview/execute, acknowledgement-aware mapped execute, and the `updateExisting` flag (auto-armed when a `license_ref` column is matched) forwarded to preview/execute |

`CSVImportPage.jsx` should remain a UI shell that wires `useCSVImportState` into `UploadStep`, `MappingStep`, `PreviewStep`, and `DoneStep`.

The frontend forwards the same declared number/date formats through native preview/confirm and mapped preview/execute. The backend parses localized input only at that boundary: quantity, quantity per unit, effective quantity, price, and mapped custom currency values become canonical decimal strings; dates accept ISO or the declared date format. Far-future end dates such as 2099 import as perpetual records instead of row errors. Invalid values become row errors.

The backend is the source of truth for import warning summaries. Preview responses include `warningSummary`; execute/confirm requests must send `acknowledge_warnings=true` when that summary has acknowledgement-required warnings. The route rechecks the summary before writing so a stale or hand-built client cannot bypass the gate.

Both the native (`/preview`, `/confirm`) and mapped (`/preview-mapped`, `/execute`) flows support update-on-LT-Ref-match via the `update_existing` flag. The frontend auto-arms the option when a `license_ref` column is present and lets the user return to create-only behavior. `import_/license_matcher.py` resolves a row's `license_ref` to the current chain head (`is_retired = false AND renewed_to_id IS NULL`): exactly one match updates, none creates, two or more active heads is a row error. `annotate_update_targets` tags each row's `import_action` ("create"/"update") for preview counts and execution; `import_/import_update.py` patches only non-empty importable fields, leaves `license_type`/`license_ref`/chain-lifecycle/maintenance-mirror fields immutable, and re-resolves `contract_id` on a contract-number change. When a row will update, `duplicate_detection` suppresses its "license ref matches" warning. Preview responses carry `createCount`/`updateCount` and per-row `importAction`; confirm/execute responses add `updatedCount`.

Both write paths rebuild maintenance inference, update-target annotations, duplicate warnings, and the warning summary before applying the acknowledgement gate. Row writes use nested transactions so a database failure on one row is reported without poisoning the rest of the batch. An inferred maintenance parent must appear before its maintenance child in the file.

Import mapping presets are shared configuration. Editors may list and use presets; only admins may create, replace, rename, or delete them. The execute endpoint must not use its optional `mappingName` field to bypass that boundary.

Existing custom fields participate in both import paths. Native preview/confirm loads definitions and resolves headers by immutable `field_key` first and by normalized display name only when that name is unambiguous; native and ignored headers retain precedence. External analysis reports those same matches automatically, and unresolved columns may be assigned to an existing definition. Only admins may create definitions. Native and mapped values share `custom_fields_service` validation/upsert behavior, including typed row errors and nonblank-only patches during LT-Ref updates.

External analysis may receive several source columns that resemble the same
native field. Stronger header aliases keep precedence, weak fallback aliases
such as `item` do not override exact fields such as `software_description`, and
duplicate recognized columns are returned as available mapping candidates
instead of being hidden.

Native and mapped import fields should stay aligned with the current editable
license model. In addition to core commercial fields, CSV import supports
request date, purchase date, procurement reference, parent LT Ref, and
secondary contacts. Mapped imports allow multiple source columns to feed
secondary contacts so application-owner or technical-owner email columns can be
retained as renewal notification CC recipients. Purchase quantity remains the
commercial count used for cost calculations; quantity per unit is stored as the
native entitlement multiplier; and effective quantity is derived as purchase
quantity multiplied by quantity per unit. Flexera-style purchase type aliases
map software subscription, software maintenance, software baseline, software,
and service values onto the native `license_type` enum where unambiguous.
Flexera-style metric aliases map common user, device, core, processor,
concurrent, site, enterprise, custom, unknown, and other labels onto native
`license_metric` values. Boolean "includes maintenance/support" columns map to
`maintenance_coverage=included` when true-like and stay unset when false-like
or blank.
For perpetual, OEM, or freeware included-support imports, source start/end
dates are copied into maintenance coverage dates while the persisted license
`end_date` remains null for perpetual rows. When no explicit maintenance cost
column is present, import defaults support cost from the row line total and
adds a warning so operators can verify it is not the perpetual acquisition
value.

Included support on subscription and SaaS records is bundled into the
subscription itself. The backend derives maintenance start/end from license
start/end and derives maintenance cost from the line acquisition total in
`support_coverage_defaults.py`; procurement totals must not add that value a
second time. Separately tracked maintenance remains limited to perpetual, OEM,
and freeware/open-source parents and belongs in `maintenance_rules.py`, not in
inline route or form checks. CSV import creates at most one primary parent link
for each maintenance row. Import-time row overrides can resolve a maintenance
parent to an existing eligible license during preview/confirm; additional
shared maintenance links are explicit post-import actions from License Details.

CSV preview also carries a `referenceSummary` for publisher, supplier, and
cost-centre candidates. `services/import_/reference_resolution.py` owns
candidate grouping, exact/alias/inactive resolution, override validation, and
execute-time revalidation. Preview is read-only: reference records are created
inside the row write transaction only for rows that succeed. `PreviewStep.jsx`
owns the collapsible review UI, bulk duplicate decisions, temporary column
visibility, and searchable maintenance-parent remediation.

## Forms And Validation

New or migrated complex forms should use React Hook Form and Zod.

- Procurement form schemas live in `frontend/src/utils/procurementSchemas.js`.
- Settings validation schemas live in `frontend/src/utils/settingsSchemas.js`.
- General validators live in `frontend/src/utils/validation.js`.

Settings still use the existing dirty-section navigation guard. Do not replace that globally unless the whole Settings flow is deliberately redesigned.

Notification and backup schedule inputs use the shared `0..23` hour contract.
Frontend parsing must preserve integer zero as midnight and leave blank or
invalid input for schema validation; do not use truthiness-based fallbacks for
these fields. Manager-digest eligibility includes `incomplete` as well as
`expired`, `expiring`, and `notice_due`, so an incomplete-only run still sends
the configured digest.

Admin settings are grouped into four product areas:

- General: storage, notifications, SMTP, and OIDC.
- Data Management: canonical Companies and Departments / Cost Centres, license configuration, and import configuration.
- Integrations: API tokens, webhooks, and integration capability declarations.
- Operations: database backup and restore.

Reference-data services own NFKC-cleaned, case-folded identity resolution,
aliases, role promotion, rename/merge/delete invariants, and compatibility
mirror fields. Foreign-key IDs are authoritative; mirrors are updated in the
same caller-owned transaction and are never used to infer identity. CSV
execution re-resolves references before writing, and viewer department access
is scoped by canonical `cost_centre_id` while retaining the name-based payload.
`backend/app/services/reference_data_service.py` is the backend identity and
mutation boundary; `frontend/src/api/referenceData.js`,
`components/ui/ReferenceCombobox.jsx`, and
`components/settings/sections/ReferenceDataSection.jsx` own the frontend data
access, selection, and admin catalog surfaces respectively.

The restore flow in `backend/app/routes/backup.py` must quiesce all database connections before swapping the file: `await db.close()` closes the request-scoped session, then `await engine.dispose()` drains the connection pool, then `backup_service.restore_backup()` deletes stale `-wal`/`-shm` files and replaces the `.db` file. When `RESTART_AFTER_RESTORE=true`, the route schedules `os.kill(SIGTERM)` after the response so a process manager can restart the API. The native systemd unit deliberately uses `Restart=always`: SIGTERM is a clean process exit, so `Restart=on-failure` leaves the service stopped after a successful restore. Native upgrades must republish and reload the current service template so lifecycle-policy fixes reach existing installs. Do not reorder or remove these steps - out-of-order execution leaves file handles open (Windows) or stale WAL pages that corrupt the restored database on restart.

Restore accepts either an uploaded archive or an exact allow-listed filename
returned by the configured server backup directory. `backup_service` classifies
routine database backups separately from portfolio-recovery and
document-restore safety archives. Routine restores validate and replace only
SQLite. Document-aware restores first create a new database-and-document safety
archive, stage only the four managed storage directories, swap those
directories, and restore SQLite; a database failure rolls the storage swap
back. Never accept arbitrary server paths or use a generic zip extraction
operation here.

The clean-start portfolio reset is separate from database restore.
`backend/app/routes/operations.py` owns its admin-only preview and execution
endpoints, while `backend/app/services/portfolio_reset_service.py` owns the
fixed deletion scope and transaction. The service takes a SQLite immediate
write reservation, requires `backup_service.create_portfolio_reset_archive()`
to capture both the database and managed document directories, and only then
deletes portfolio, procurement, contract, document, delivery, and old audit
rows. Keep accounts and configuration outside this deletion list. The public
license reference sequence is reset to zero; internal database sequences are
not.

Upload size enforcement uses a two-layer defence. The HTTP middleware in
`main.py` (`reject_oversized_uploads`) bounds the complete multipart request
before FastAPI's body parser runs. Its ceiling is the applicable configured
payload limit plus `MULTIPART_ENVELOPE_ALLOWANCE_BYTES`; do not compare the
complete `Content-Length` directly with the file-payload limit. The measured
payload checks in `storage.validate_upload`, `validate_contract_upload`, the
invoice transfer validator, backup restore, and Official Extension package
intake are authoritative: a payload equal to its configured limit is valid and
only `len(content) > max_bytes` returns 413. The transport allowance remains
bounded so excessive multipart metadata cannot bypass the early defence.

Pending-order conversion uses a conditional UPDATE write-lock to prevent duplicate license creation from concurrent requests. Both `convert_pending_order_to_licenses` and `batch_convert_pending_order_to_licenses` execute `UPDATE pending_orders SET notes=notes WHERE id=? AND status != converted` immediately after the status guard. Because SQLite serialises writers, the second concurrent request sees `rowcount == 0` and raises 409 before any license rows are created. Do not remove this UPDATE or reorder it after any license creation - the lock must be acquired before the first license write. Read-only prerequisite lookups, including shared PO-total override inheritance, must finish before acquiring the lock so no extra database yield is introduced between lock acquisition and the first license flush. Conversion also snapshots `request_date` from the sourcing item and `purchase_date` from the pending order onto each resulting license. These are editable afterwards so imported and legacy records can be enriched through the normal write path.

Direct multi-license creation uses the additive `POST /api/licenses/batch`
contract. `create_license_batch_records` creates the ordered rows and resolves
`parent_line_index` links to an earlier row inside the caller's single database
transaction; route-level `license.created` audits commit with the same
transaction. Any validation, write, or audit failure rolls the whole batch
back. The Review License Data modal holds a synchronous submit lock until the
request settles. Optional filesystem attachment is deliberately post-commit:
failure leaves the batch intact and the UI directs the operator to retry from
the first license rather than resubmit. Batches containing more than one row
receive a `procurement_bundle_id`; Quote, Purchase Order, and Invoice uploads
use that scope so every batch member sees the same evidence without matching on
PO text. Other document categories remain license-owned.

Single and bulk license deletion collect only license-owned `Document` paths
inside the transaction, commit database and audit changes first, then remove
those paths through the storage abstraction. Missing files are idempotent and
post-commit cleanup failures are logged without rolling back the already valid
database deletion. Pending-order procurement evidence remains in its owning
scope. A manual procurement-bundle document is removed only when deletion
leaves no license in that bundle.

New admin sections should be added to the group that matches the operator's intent, not simply appended to the page. Integration-facing features should default to the Integrations group unless they are clearly general product configuration or operational recovery tooling.

## Modal And Dialog Pattern

Active modals should use `frontend/src/components/ui/ModalShell.jsx` for shell mechanics:

- overlay;
- dialog ARIA attributes;
- focus trapping;
- Escape routing;
- close button/header behavior;
- footer wrapper;
- overlay click policy.

Use `ConfirmDialog` for confirmation prompts and `DiscardChangesDialog` for dirty-form discard prompts. `useModalGuard` remains the shared dirty-close guard for forms that need discard confirmation.

## Custom Fields

Custom field behavior has two sources of truth:

- Backend definitions, keys, section, type, and value normalization live in `backend/app/services/custom_fields_service.py`.
- Frontend presentation helpers live in `frontend/src/utils/customFieldPresentation.js`.

Use `getCustomColumnId(def)` rather than manually building `cf_` keys. This prevents double-prefix values such as `cf_cf_contract_owner` and preserves compatibility with older field-key shapes.

CSV import should create custom field values through the custom-fields service helpers, not by constructing `CustomFieldValue` rows directly.
Native and mapped CSV preview/execute must validate typed custom fields through `custom_fields_service` before license rows are created. Currency custom fields use the same declared import number locale as native price fields. Invalid date, currency, boolean, or unknown custom-field mappings are row errors, not late persistence failures. Full Data exports use immutable custom-field keys as headers so canonical Native round-trips do not depend on mutable display names.

## Backend Workflow Services

Route handlers should validate input, authorize the user, call service functions, and return responses. Workflow-heavy behavior belongs in backend services.

Large procurement route surfaces are split by workflow. The aggregator files `backend/app/routes/sourcing.py` and
`backend/app/routes/pending_orders.py` should only include sub-routers. Endpoint code belongs in the matching focused
module:

| Domain | Route Modules |
|--------|---------------|
| Sourcing | `sourcing_exports.py`, `sourcing_requests.py`, `sourcing_documents.py`, `sourcing_items.py`, `sourcing_conversion.py` |
| Pending orders | `pending_order_exports.py`, `pending_order_core.py`, `pending_order_documents.py`, `pending_order_items.py`, `pending_order_conversion.py` |

Do not add new procurement endpoints to the aggregator files.

Current important service boundaries:

- license response assembly (mandatory fields, completeness/expiry enrichment, creator account labels, scoped procurement document lookup): `backend/app/services/license_response_service.py`;
- license write workflow (single and atomic batch create, update/patch/delete invariants, post-commit managed-file cleanup inputs, editable procurement milestone parsing, maintenance-parent validation, manual procurement-bundle assignment, contract_id resolution from contract_number through `contract_identity_service.py`, predecessor_id wiring on renewal successors, create-time rejection of lifecycle chain fields via `REPAIR_ONLY_UPDATE_FIELDS`): `backend/app/services/license_write_service.py`;
- shared PO-total override workflow (set/clear replication, create-time
  inheritance, and PO reassignment semantics across direct writes, imports,
  conversions, maintenance creation, and renewal successors):
  `backend/app/services/po_total_override_service.py`;
- contract-number identity checks (case-insensitive duplicate detection and unambiguous license `contract_id` resolution): `backend/app/services/contract_identity_service.py`;
- lifecycle rules (ordinary update guardrails, pending-renewal transitions, single-successor predecessor enforcement, renewed predecessor marking, admin repair target/cycle validation, and the canonical `REPAIR_ONLY_UPDATE_FIELDS` set that gates both the update and create paths): `backend/app/services/lifecycle_rules.py`;
- maintenance invariants (parent type eligibility, parent retirement checks, non-maintenance parent guard, active-maintenance type-change and retirement guards): `backend/app/services/maintenance_rules.py` — all call sites import from here; no inline maintenance checks outside this module;
- document storage abstraction (`StorageBackend` ABC with `write`/`read`/`delete`/`exists`; `LocalStorageBackend` as the active implementation wired via a module-level `_backend` variable; all public helpers delegate I/O through `_backend`): `backend/app/services/storage.py`;
- sourcing workflow (SourcingRequest parent orchestration, child line creation, coterm merge, conversion to pending order, delete side effects): `backend/app/services/sourcing_service.py`;
- sourcing CSV export assembly: `backend/app/services/sourcing_export_service.py`;
- pending-order CSV export assembly, including flat one-row-per-line-item output with repeated PO metadata and parent-only rows for orders with no items: `backend/app/services/pending_order_export_service.py`;
- CSV formula-injection neutralization for exported cells: `backend/app/services/csv_safety.py`;
- pending-order CRUD and line-item management (add, edit, delete before conversion, with converted-order mutation guards): `backend/app/services/pending_order_service.py`;
- pending-order conversion orchestration (order loading, conversion-path selection, transaction order, evidence-transfer status, audit logging, response handoff): `backend/app/services/pending_order_conversion_service.py`;
- pending-order conversion helpers (new purchase license creation, maintenance parent resolution, status transitions): `backend/app/services/conversion/license_converter.py`, `backend/app/services/conversion/maintenance_linker.py`, and `backend/app/services/conversion/pending_order_status.py`;
- pending-order conversion document transfer (invoice validation/write and quote carry-forward into pending-order-scoped procurement documents): `backend/app/services/procurement_document_transfer_service.py`;
- pending-order conversion response enrichment: `backend/app/services/conversion_response_service.py`;
- license procurement trail response assembly:
  `backend/app/services/license_procurement_trail_service.py`;
- custom field normalization/upsert: `backend/app/services/custom_fields_service.py`;
- renewal read model (async DB queries): `backend/app/services/renewal_service.py`;
- renewal workbench computation (pure, no DB): `backend/app/services/renewal_workbench_model.py`;
- renewal command orchestration (start/cancel workflow, single and coterm successor creation, pre-creation predecessor guards): `backend/app/services/renewal_orchestrator.py`;
- user domain invariants (break-glass, active-admin guard, apply-update): `backend/app/services/user_service.py`;
- maintenance link management, coverage snapshots, and mirror synchronization: `backend/app/services/maintenance_service.py` owns creation/linking/unlinking of `LicenseMaintenanceLink` rows, immutable `LicenseCoverageHistory` snapshots when active coverage changes, active-maintenance mirror updates on parents, and the compatibility behavior where `parent_license_id` remains the primary parent for older create/import flows while `maintenanceParentIds`/`linkedMaintenanceIds` expose multi-parent links in responses;
- canonical organization and cost-centre identity, aliases, roles, active state, usage, merge/delete invariants, mirror synchronization, and CSV reference resolution: `backend/app/services/reference_data_service.py` and `backend/app/services/import_/reference_resolution.py`;
- portfolio summary statistics (total active/expiring/expired/incomplete, `annual_cost_by_currency` dict grouped by ISO currency code rather than a single scalar total, `excluded_from_totals` count, by-license-type breakdown): `backend/app/routes/reports.py` — `GET /api/reports/portfolio-stats`;
- audit logging and data-change webhook enqueueing: `backend/app/services/audit_service.py`;
- reusable structured audit detail contracts beyond generic field diffs: `backend/app/services/audit_contracts.py`;
- API token generation, hashing, scope encoding, and last-used mutation: `backend/app/services/api_token_service.py`;
- webhook event matching, signing, delivery, and retry dispatch: `backend/app/services/webhook_service.py`.

SQLite foreign-key enforcement is enabled at the connection level via `enable_sqlite_foreign_keys` in `backend/app/database.py`. It registers a `connect` event listener that executes `PRAGMA foreign_keys=ON` for every DBAPI connection. This means every `ForeignKey` declared in the ORM models is enforced at the database layer — not just by the ORM. Do not remove this listener. The test engine in `conftest.py` applies the same function. Note: the pragma only affects new writes; existing rows with dangling references are not retroactively rechecked on deploy.

`backend/app/routes/licenses.py` is now a thin route module. It should own auth, request parsing, query composition for reads, and audit-log wiring. It should not reintroduce field-level patch validation, maintenance-parent invariants, or response enrichment logic that now live in the license services.

Settings routes are split by responsibility while preserving existing API paths. `backend/app/routes/user_settings.py` owns `GET/PUT /api/settings`; `backend/app/routes/global_settings.py` owns global settings read/update endpoints; `backend/app/routes/integrations.py` owns admin integration actions such as test email and manual notification trigger; `backend/app/routes/backup.py` owns database backup/restore; and `backend/app/routes/operations.py` owns destructive operational maintenance such as the fixed-scope portfolio reset. `backend/app/routes/settings.py` remains only as a compatibility aggregator for older imports.

File I/O in `procurement_document_transfer_service` follows a two-phase pattern coordinated by `pending_order_conversion_service`: file validation happens before any DB work; the actual disk write happens only after `db.commit()` succeeds. This prevents orphaned files when a DB transaction fails. After the conversion commit, evidence transfer records `pending`, `complete`, or `failed` on the pending order; a transfer failure is retryable/recoverable state and must not roll back the created licenses.

Procurement documents must be resolved by explicit scope. Use
`pending_order_id` for documents shared by licenses created from one pending
order, `procurement_bundle_id` for Quote, Purchase Order, and Invoice evidence
shared by one direct multi-license creation batch, and `license_id` for
procurement-category documents uploaded directly to a single license. Do not
use PO number as the document sharing key; PO number is metadata and may be
reused intentionally or accidentally.

Document, procurement-document, and contract-document uploads/deletes are
evidence amendments once they happen outside the original conversion
transaction. Their audit detail should use `mutationType=document_amendment`
and include operation, post-conversion flag, category, scope, related
license/order/PO or contract/folder identifiers, actor email, timestamp, and
optional deletion reason. Direct license custom-field upserts emit
`license.custom_fields_updated` with normalized before/after field diffs only
when at least one value changes; definition auditing remains separate.

Renewal command side effects belong in `backend/app/services/renewal_orchestrator.py`, with chain invariants delegated to `backend/app/services/lifecycle_rules.py`. Do not spread renewal lifecycle mutations across pages or routes. Successor creation must validate every predecessor before creating a new license row so stale single or coterm pending-order work cannot fork a renewal chain. Renewal conversion rereads the primary predecessor at the conversion boundary: an active parentless maintenance row is allowed to carry `is_legacy_unlinked_maintenance=true` only when that flag already exists on the persisted predecessor. Linked maintenance successors clear the flag and inherit the current primary parent; no parent link, mirror, or coverage snapshot is fabricated for an unlinked successor. Coterm successors use the same primary-predecessor rule.

The renewal graph permits an intermediate license to have both incoming and
outgoing renewal links, but each predecessor may have at most one immediate
successor. Coterm successors may have multiple immediate predecessors:
`renewed_from_id` and `predecessor_id` identify the deterministic primary
predecessor, while `coterm_from_ids` contains the complete ordered predecessor
set, including that primary predecessor.

## Integration, Official Extension, And API Boundaries

LicenseTrack has two distinct extension paths:

- The public **Integration Framework** uses API tokens, webhooks, declared
  capabilities, document actions, document-processing results, and external
  sidecars. This is the supported path for custom and third-party automation.
- The internal **Official Extensions host** is reserved for optional packages
  published and signed by the LicenseTrack project. It is disabled by default
  and runs verified packages as trusted application code when an operator
  explicitly enables it.

The integration foundation currently includes:

- API tokens in `backend/app/routes/api_tokens.py`, authenticated through `backend/app/dependencies.py`, with hashes stored in `ApiToken` records and raw tokens shown once.
- Webhook endpoints and deliveries in `backend/app/routes/webhooks.py`, backed by `WebhookEndpoint` and `WebhookDelivery`, with signing secrets encrypted and delivery retries dispatched by the scheduler.
- Extension capability declarations in `backend/app/routes/extensions.py`, stored as `ExtensionCapability` records. Capabilities tell core that an external sidecar or connector is available; they do not load third-party code into core.
- Document actions in `backend/app/routes/document_actions.py`, exposed to the frontend only when the required capability and webhook subscriber exist.
- Document processing results in `backend/app/routes/document_processing.py`, where integrations can submit proposed extraction output for review. Core stores those results, supersedes older pending results for the same processor/document, lets editors/admins accept selected suggestions or reject the result, and applies accepted fields through normal license/custom-field update paths.

The Official Extensions host uses the existing internal `plugin_*` names to
avoid a broad implementation rename. Its foundation includes:

- Package intake, registry, manifest validation, lifecycle management, and
  managed runtimes in the existing plugin route/service modules.
- Ed25519 verification against pinned LicenseTrack release public keys. The
  verified signer identity comes from the configured trust store, never from
  self-declared manifest metadata.
- Persisted trust status, signer/key identity, signed digest, and verification
  time. Legacy unsigned installations migrate to disabled and unverified while
  their settings, versions, suggestions, and audit history remain intact.
- Encrypted settings, core-rendered `PluginSlot` buttons, action invocation, and
  generic suggestions for the existing supported target types.
- Explicit environment inheritance and permission checks for settings,
  documents, and draft contexts, plus process-tree cleanup on stop. These are
  correctness and operational safeguards, not a hostile-code sandbox.

Integration and Official Extension work should follow these boundaries:

- Treat documented API routes, import/export formats, and declared-capability integration points such as document actions as the supported integration surface.
- Keep company-specific connectors, sidecars, and automation outside core unless they become broadly useful product features.
- Do not add extension-specific code paths to core workflows without first defining a generic extension point.
- Core owns authorization, viewer department scoping, document access checks, audit logging, and user confirmation for data-changing extension workflows.
- Optional integrations and Official Extensions return explicit results or proposed changes; core applies mutations only after user review and through normal services and route-level invariants.
- Frontend-facing Official Extension work uses `PluginSlot` with core-defined context. Do not load extension-owned React or arbitrary DOM code.
- Backend integration and Official Extension work must not bypass service boundaries for procurement conversion, document storage, custom fields, user invariants, or audit logging.
- Document processing result acceptance is restricted to `ALLOWED_PATCH_FIELDS` from `license_write_service.py` plus existing custom fields. Lifecycle repair fields (`lifecycle_status`, `renewed_from_id`, `renewed_to_id`, `predecessor_id`, `coterm_from_ids`), procurement conversion state, and internal identity fields (`id`, `license_ref`) are explicitly excluded and will cause the accept call to fail without partial mutation.

Official Extensions are trusted server code running under the LicenseTrack OS
account. Access declarations and managed subprocesses do not prevent a malicious
package from reading application-accessible files or opening the SQLite database.
Install packages only from official LicenseTrack release channels. Arbitrary
third-party in-process packages are unsupported; use the public Integration
Framework instead. The internal contract and release checklist live under
`docs/plugin-authors/` for LicenseTrack maintainers.

API-token access is an alternative client authentication mechanism, not a replacement for human/browser authentication. Add new token access by explicitly mapping routes to scopes in `dependencies.py`; do not make API tokens implicitly valid for every authenticated route. Use narrow scopes first and add audit context for data-changing API-token requests.

Webhook events should represent durable product events, not UI gestures. Emit them through audit-backed data changes or explicit extension action requests so event payloads stay stable and observable. Webhook signing and retry behavior belongs in `webhook_service.py`; route handlers should only create/update endpoints, enqueue test deliveries, or request retries.

Stable public API expectations live in `docs/extension-authors/api-stability.md`,
and public integration positioning lives in `docs/extension-authors/overview.md`.
Internal Official Extension implementation and signing guidance lives in
`docs/plugin-authors/` and is not a frozen public package compatibility promise.

## Quality Gates

Use these checks during normal development:

```powershell
python scripts/check_docs.py
python -m mkdocs build --strict
```

```powershell
cd frontend
npm run lint
npm run test:run
npm run test:coverage
npm run test:e2e
```

```powershell
cd backend
py -3.12 -m ruff check .
py -3.12 -m pytest tests
```

The frontend suite uses Vitest/jsdom for API clients, workflows, UI components, hooks, router permissions, query invalidation, endpoint contract checks, and report interactions. Coverage thresholds are configured in `frontend/vitest.config.js`; browser smoke coverage lives under `frontend/tests/e2e` and runs through Playwright.

The backend suite currently covers the route map, health endpoint, startup/lifespan behavior, scheduler helpers, conversion helpers, response builders, CSV analysis/export safety, procurement document download/delete/amendment-audit paths, sourcing request conversion and converted-state locks, pending-order export edge cases, user role invariants, API-token auth, webhooks, extension capabilities, document actions, and document processing result intake/review/custom-field acceptance. Keep new service-level behavior covered close to its owning service and add integration coverage when route dependencies, status codes, scoped document visibility, token scopes, or extension availability are part of the contract.

Run `npm run build` before release packaging.
