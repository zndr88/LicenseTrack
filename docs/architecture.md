# Architecture Notes

This document records the current architecture conventions. It is not a full design specification; it is a short map for maintainers so future changes do not drift back into duplicated page and route logic.

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
| `licenseColumns.js` | Column definitions and default visibility map |
| `licenseColumns.js` | Shared Registry column catalog: user-facing static fields, visibility groups and defaults, custom-field column assembly, saved ordering helpers, and Full Data export selection |
| `exportFilteredCsv.js` | Registry CSV export assembly: selected columns in supplied order, canonical ISO values by default, localized Current View formatting when requested, custom-field values, and spreadsheet-formula escaping |

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
| `ContractDatesSection.jsx` | Start/end dates, editable request/purchase procurement milestones, contract #, PO #, invoice #, contract record link |
| `MaintenanceSection.jsx` | Maintenance coverage dates, linked maintenance children, add/disable maintenance actions |
| `HistorySection.jsx` | Read-only creator account label plus license-row creation and last-update timestamps |
| `CommercialSection.jsx` | License type, metric, quantity, SKU, pricing, currency |
| `PeopleSection.jsx` | Supplier, cost centre, publisher contact link, budget owner |
| `EmailPublisherAction.jsx` | Bottom Email Publisher action, same-PO/same-publisher scope prompt, mailto construction |
| `DocumentsSection.jsx` | License/procurement document display, upload/download/delete controls, and integration-backed document action buttons |
| `CompletenessFlagsSection.jsx` | Completeness checklist and retired/legacy/exempt toggles |
| `NotesSection.jsx` | Notes display; also exports `CatchallCustomFieldsSection` for unassigned custom fields |

`DetailPanel.jsx` calls `useDetailPanelState` for all state and handlers, then wires props through to section components and mounts modals (`FieldEditModal`, `MaintenanceCreateModal`, `LinkCommitmentModal`, `ConfirmDialog`). No domain logic or rendering logic belongs in the shell.

Document actions are part of the core-rendered integration surface. `DocumentsSection.jsx` should render actions from `useLicenseDocuments`; it should not hard-code plugin names or assume AI processing specifically. Action availability is determined by the backend from registered integration capabilities and active webhook subscribers. This is not runtime frontend plugin loading.

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
| `SourcingTable.jsx` | Parent sourcing request rows, inline quote download column, expandable license-line rows, search box, merge-selected action, sortable sourcing table, request actions, child line actions, and row badges |
| `MergeSourcingModal.jsx` | Merge confirmation UI, selected item summary, final merged quantity input |
| `CotermSuggestionBanner.jsx` | Coterm renewal opportunity banner and select-group action |
| `SourcingToast.jsx` | Page-local success/error toast presentation |
| `useSourcingPageData.js` | TanStack Query setup for sourcing requests plus license context load for coterm detection |
| `useSourcingActions.js` | Create/update/delete/convert/export mutation handlers and cross-page invalidation callbacks |
| `useSourcingMerge.js` | Selected-for-merge state, merge quantity, merge submit lifecycle |
| `useSourcingQuotes.js` | Quote upload file input state, quote upload, and quote download |

`SourcingPage.jsx` owns page composition, page-level sort/search state, highlighted row state, modal open/close state, and wiring between the hooks and presentation components. Coterm grouping remains in `frontend/src/hooks/useCotermDetection.js`.

### PendingOrdersPage

`PendingOrdersPage.jsx` delegates server data and cross-page invalidation to `frontend/src/components/pages/usePendingOrdersData.js`.

| Module | Owns |
|--------|------|
| `usePendingOrdersData.js` | Pending order query, shared licenses query context, create/update/delete/convert/batch-convert/add/update/delete-item handlers, purchase-order document upload/download, CSV export, related query invalidation |
| `PendingOrdersPage.jsx` | Search/sort/expanded-row state, highlight behavior, table rendering, modal orchestration, conversion prefill builder, pending line-item edit/delete confirmation wiring |
| `pendingOrders/PendingOrdersTable.jsx` | Pending-order parent rows, inline PO download column, expanded line-item rows, parent row actions, line-item quote/download action buttons, and status badges |

Keep new pending-order API handlers in `usePendingOrdersData.js` unless they are purely local UI actions.

## Procurement Conversion Components

Batch pending-order conversion is decomposed so `ConvertAllModal.jsx` remains the shell for the form array and submit lifecycle:

| Module | Owns |
|--------|------|
| `frontend/src/utils/buildConvertItemDefaults.js` | Pure default-value construction for one form item per sourcing row |
| `frontend/src/components/procurement/ConvertItemForm.jsx` | Single conversion item card, local expand/collapse, price display state, item readiness helper, maintenance parent picker wiring |
| `frontend/src/components/procurement/ParentLicensePicker.jsx` | Explicit maintenance/support parent selection for existing perpetual/OEM/freeware licenses and eligible same-conversion parent rows |
`ConvertAllModal.jsx` owns the batch-level copy action for shared PO fields. The action copies PO number, contract number, invoice number, contact email, supplier, cost centre, currency, and budget owner email from the first conversion item into the remaining items. Do not reintroduce per-item price formatting, readiness checks, or default-value construction into `ConvertAllModal.jsx`.

Single pending-order conversion is similarly decomposed:

| Module | Owns |
|--------|------|
| `frontend/src/components/procurement/ConvertPendingOrderModal.jsx` | Modal shell, React Hook Form binding, save lifecycle, and field layout |
| `frontend/src/components/procurement/buildPendingOrderConversionPayload.js` | Pure conversion payload construction, date normalization, numeric parsing, SaaS portal URL rule, maintenance parent IDs |
| `frontend/src/components/procurement/PendingOrderInvoiceField.jsx` | Invoice file input presentation and selected-file display |

Do not put payload normalization or invoice-file display logic back into `ConvertPendingOrderModal.jsx`.

## ReportsPage Sub-Module Pattern

`ReportsPage.jsx` computes datasets and coordinates filters/export. Report presentation lives in `frontend/src/components/reports/`:

| Module | Owns |
|--------|------|
| `reportShared.jsx` | Shared report section shell, empty state, sort header, legend, palette |
| `CostCentreDropdown.jsx` | Cost-centre filter dropdown |
| `CostForecastSection.jsx` | Budget forecast controls and forecast table/chart presentation |
| `PublisherBreakdownSection.jsx` | Publisher spend chart plus sortable publisher/supplier relationship table |
| `PortfolioBreakdownSection.jsx` | License type and billing metric breakdown presentation |
| `RenewalCalendarSection.jsx` | Renewal calendar chart/table presentation |

`ReportsPage.jsx` fetches portfolio annual cost via `useQuery` (`queryKeys.reportsPortfolioStats` -> `GET /api/reports/portfolio-stats`) and displays that server rollup in the chip row above the report sections. This key is intentionally separate from the sidebar's `queryKeys.portfolioStats` cache because the two queries return different shapes. The Upcoming, Active, Expiring, and Expired chips are client-computed from the filtered license list so they update with report filters; Active excludes Upcoming and Expiring. All section-specific datasets (cost forecast, publisher and vendor overview, portfolio health, renewal calendar) remain client-computed from the raw license list fetched separately. `ReportsPage.jsx` also computes `singleCurrency` (the single ISO currency code present across the filtered dataset, or `null` when multiple currencies are mixed); chart sections receive `singleCurrency` and suppress currency-dependent chart portions with explanatory notes when needed. Grouped tables remain available. All spend totals use `formatCostByCurrency` so mixed-currency portfolios display grouped values by currency rather than a combined figure. `ReportsPage.jsx` should not own section-specific sort state or large chart/table JSX.

## Help Center Pattern

`HelpPage.jsx` is the in-app product documentation surface. It is intentionally a static, searchable help center rather than a user-editable wiki.

The Help entry point lives in `TopBar.jsx` as a top-right utility button. Do not add Help to the main top navigation beside Overview, Import, Reports, or Admin, and do not add it to the sidebar reference group. The top navigation is for primary work areas; the sidebar is for operational pipeline and reference data. Help cuts across all work areas and should remain a utility-level route.

`HelpPage.jsx` owns its local article catalog, category filtering, search ranking, selected article state, and article rendering. Keep the content user-facing and version-local: product workflows, feature behavior, caveats, troubleshooting, and glossary terms belong here. Deployment, compliance, release, security, and maintainer-only material should remain in repository or website documentation.

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
| `useCSVImportPreview.js` | Standard import preview data, warning summary exposure, row selection, skipped rows, duplicate warning counts, acknowledgement-aware confirm import |
| `useCSVImportAnalysis.js` | External/mapped import analysis, column decisions, saved mappings, mapping preview/execute, acknowledgement-aware mapped execute, and the `updateExisting` flag (auto-armed when a `license_ref` column is matched) forwarded to preview/execute |

`CSVImportPage.jsx` should remain a UI shell that wires `useCSVImportState` into `UploadStep`, `MappingStep`, `PreviewStep`, and `DoneStep`.

The frontend forwards the same declared number/date formats through native preview/confirm and mapped preview/execute. The backend parses localized input only at that boundary: quantity, price, and mapped custom currency values become canonical decimal strings; dates accept ISO or the declared date format. Invalid values become row errors.

The backend is the source of truth for import warning summaries. Preview responses include `warningSummary`; execute/confirm requests must send `acknowledge_warnings=true` when that summary has acknowledgement-required warnings. The route rechecks the summary before writing so a stale or hand-built client cannot bypass the gate.

The mapped flow (`/preview-mapped`, `/execute`) supports update-on-LT-Ref-match via the `update_existing` flag. `import_/license_matcher.py` resolves a row's `license_ref` to the current chain head (`is_retired = false AND renewed_to_id IS NULL`): exactly one match updates, none creates, two or more active heads is a row error. `annotate_update_targets` tags each row's `import_action` ("create"/"update") for both preview counts and execute; `import_/import_update.py` patches only non-empty importable fields, leaves `license_type`/`license_ref`/chain-lifecycle/maintenance-mirror fields immutable, and re-resolves `contract_id` on a contract-number change. When a row will update, `duplicate_detection` suppresses its "license ref matches" warning. The legacy `/confirm` auto-map path is always create-only. Preview responses carry `createCount`/`updateCount` and per-row `importAction`; execute responses add `updatedCount`.

## Forms And Validation

New or migrated complex forms should use React Hook Form and Zod.

- Procurement form schemas live in `frontend/src/utils/procurementSchemas.js`.
- Settings validation schemas live in `frontend/src/utils/settingsSchemas.js`.
- General validators live in `frontend/src/utils/validation.js`.

Settings still use the existing dirty-section navigation guard. Do not replace that globally unless the whole Settings flow is deliberately redesigned.

Admin settings are grouped into three product areas:

- General: storage, notifications, SMTP, OIDC, completeness, custom fields, and import mappings.
- Integrations: API tokens, webhooks, and integration capability declarations.
- Operations: database backup and restore.

The restore flow in `backend/app/routes/backup.py` must quiesce all database connections before swapping the file: `await db.close()` closes the request-scoped session, then `await engine.dispose()` drains the connection pool, then `backup_service.restore_backup()` deletes stale `-wal`/`-shm` files and replaces the `.db` file, then `os.kill(SIGTERM)` restarts the process. Do not reorder or remove these steps — out-of-order execution leaves file handles open (Windows) or stale WAL pages that corrupt the restored database on restart.

Upload size enforcement uses a two-layer defence. An HTTP middleware in `main.py` (`reject_oversized_uploads`) inspects the `Content-Length` header before FastAPI's body parser runs, returning 413 for declared sizes above `MAX_UPLOAD_SIZE_MB` on document and backup restore upload paths. The route handlers (`documents.py`, `backup.py`) repeat the same check inline before `await file.read()` as a second layer. The post-read check in `storage.validate_upload` remains as the authoritative gate for uploads that arrive without a `Content-Length` header.

Pending-order conversion uses a conditional UPDATE write-lock to prevent duplicate license creation from concurrent requests. Both `convert_pending_order_to_licenses` and `batch_convert_pending_order_to_licenses` execute `UPDATE pending_orders SET notes=notes WHERE id=? AND status != converted` immediately after the status guard. Because SQLite serialises writers, the second concurrent request sees `rowcount == 0` and raises 409 before any license rows are created. Do not remove this UPDATE or reorder it after any license creation — the lock must be acquired before the first license write. Conversion also snapshots `request_date` from the sourcing item and `purchase_date` from the pending order onto each resulting license. These are editable afterwards so imported and legacy records can be enriched through the normal write path.

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
Mapped CSV preview and execute must validate typed custom fields through `custom_fields_service` before license rows are created. Currency custom fields use the same declared import number locale as native price fields. Invalid date, currency, boolean, or unknown custom-field mappings are row errors, not late persistence failures.

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
- license write workflow (create/update/patch/delete invariants, editable procurement milestone parsing, maintenance-parent validation, contract_id resolution from contract_number, predecessor_id wiring on renewal successors, create-time rejection of lifecycle chain fields via `REPAIR_ONLY_UPDATE_FIELDS`): `backend/app/services/license_write_service.py`;
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
- custom field normalization/upsert: `backend/app/services/custom_fields_service.py`;
- renewal read model (async DB queries): `backend/app/services/renewal_service.py`;
- renewal workbench computation (pure, no DB): `backend/app/services/renewal_workbench_model.py`;
- renewal command orchestration (start/cancel workflow, single and coterm successor creation, pre-creation predecessor guards): `backend/app/services/renewal_orchestrator.py`;
- user domain invariants (break-glass, active-admin guard, apply-update): `backend/app/services/user_service.py`;
- maintenance mirror synchronization: `backend/app/services/maintenance_service.py`;
- portfolio summary statistics (total active/expiring/expired/incomplete, `annual_cost_by_currency` dict grouped by ISO currency code rather than a single scalar total, `excluded_from_totals` count, by-license-type breakdown): `backend/app/routes/reports.py` — `GET /api/reports/portfolio-stats`;
- audit logging and data-change webhook enqueueing: `backend/app/services/audit_service.py`;
- reusable structured audit detail contracts beyond generic field diffs: `backend/app/services/audit_contracts.py`;
- API token generation, hashing, scope encoding, and last-used mutation: `backend/app/services/api_token_service.py`;
- webhook event matching, signing, delivery, and retry dispatch: `backend/app/services/webhook_service.py`.

SQLite foreign-key enforcement is enabled at the connection level via `enable_sqlite_foreign_keys` in `backend/app/database.py`. It registers a `connect` event listener that executes `PRAGMA foreign_keys=ON` for every DBAPI connection. This means every `ForeignKey` declared in the ORM models is enforced at the database layer — not just by the ORM. Do not remove this listener. The test engine in `conftest.py` applies the same function. Note: the pragma only affects new writes; existing rows with dangling references are not retroactively rechecked on deploy.

`backend/app/routes/licenses.py` is now a thin route module. It should own auth, request parsing, query composition for reads, and audit-log wiring. It should not reintroduce field-level patch validation, maintenance-parent invariants, or response enrichment logic that now live in the license services.

Settings routes are split by responsibility while preserving existing API paths. `backend/app/routes/user_settings.py` owns `GET/PUT /api/settings`; `backend/app/routes/global_settings.py` owns global settings read/update endpoints; `backend/app/routes/integrations.py` owns admin integration actions such as test email and manual notification trigger; `backend/app/routes/backup.py` owns database backup/restore. `backend/app/routes/settings.py` remains only as a compatibility aggregator for older imports.

File I/O in `procurement_document_transfer_service` follows a two-phase pattern coordinated by `pending_order_conversion_service`: file validation happens before any DB work; the actual disk write happens only after `db.commit()` succeeds. This prevents orphaned files when a DB transaction fails. After the conversion commit, evidence transfer records `pending`, `complete`, or `failed` on the pending order; a transfer failure is retryable/recoverable state and must not roll back the created licenses.

Procurement documents must be resolved by explicit scope. Use `pending_order_id` for documents shared by licenses created from one pending order, and `license_id` for procurement-category documents uploaded directly from a license. Do not use PO number as the document sharing key; PO number is metadata and may be reused intentionally or accidentally.

Document and procurement-document uploads/deletes are evidence amendments once they happen outside the original conversion transaction. Their audit detail should use `mutationType=document_amendment` and include operation, post-conversion flag, category, scope, related license/order/PO, actor email, timestamp, and optional deletion reason.

Renewal command side effects belong in `backend/app/services/renewal_orchestrator.py`, with chain invariants delegated to `backend/app/services/lifecycle_rules.py`. Do not spread renewal lifecycle mutations across pages or routes. Successor creation must validate every predecessor before creating a new license row so stale single or coterm pending-order work cannot fork a renewal chain.

## Integration, Plugin, And API Boundaries

LicenseTrack's extensibility model has two layers: the **Integration Framework** (API tokens, webhooks, declared capabilities, document actions, document processing) and the **Plugin Host v1** (installable zip packages, managed runtimes, core-rendered UI slots, generic suggestions).

The integration foundation currently includes:

- API tokens in `backend/app/routes/api_tokens.py`, authenticated through `backend/app/dependencies.py`, with hashes stored in `ApiToken` records and raw tokens shown once.
- Webhook endpoints and deliveries in `backend/app/routes/webhooks.py`, backed by `WebhookEndpoint` and `WebhookDelivery`, with signing secrets encrypted and delivery retries dispatched by the scheduler.
- Extension capability declarations in `backend/app/routes/extensions.py`, stored as `ExtensionCapability` records. Capabilities tell core that an external sidecar, connector, or installed plugin is available; they do not load third-party code into core.
- Document actions in `backend/app/routes/document_actions.py`, exposed to the frontend only when the required capability and webhook subscriber exist.
- Document processing results in `backend/app/routes/document_processing.py`, where integrations can submit proposed extraction output for review. Core stores those results, supersedes older pending results for the same processor/document, lets editors/admins accept selected suggestions or reject the result, and applies accepted fields through normal license/custom-field update paths.

The Plugin Host v1 foundation adds:

- Plugin registry, package intake, manifest validation, and lifecycle management in `backend/app/routes/plugins.py`, backed by `backend/app/services/plugin_lifecycle_service.py`, `plugin_package_service.py`, `plugin_registry_service.py`, and `plugin_runtime_service.py`.
- Plugin settings and encrypted secret storage in `backend/app/services/plugin_settings_service.py`.
- Managed runtime start/stop/health/logs with a single-worker constraint (see `plugin_runtime_service.py` module docstring).
- Plugin action discovery/invocation through `backend/app/routes/plugin_actions.py` and `backend/app/services/plugin_action_service.py`.
- Generic plugin suggestions for `license`, `license_draft`, `sourcing_item`, `pending_order_item`, and `pending_order_conversion` targets in `backend/app/routes/plugin_suggestions.py`.
- Frontend `PluginSlot` component at `frontend/src/components/plugins/PluginSlot.jsx` — the only surface for plugin-provided buttons; plugins cannot inject arbitrary React or DOM.

Integration and plugin work should follow these boundaries:

- Treat documented API routes, import/export formats, and declared-capability integration points such as document actions as the supported integration surface.
- Keep company-specific connectors, sidecars, and automation outside core unless they become broadly useful product features.
- Do not add plugin-specific code paths to core workflows without first defining a generic extension point.
- Core owns authorization, viewer department scoping, document access checks, audit logging, and user confirmation for data-changing extension workflows.
- Optional integrations and plugins return explicit results or proposed changes; core applies mutations only after user review and through normal services and route-level invariants.
- Frontend-facing plugin work uses `PluginSlot` with core-defined context. Do not load arbitrary third-party React code.
- Backend integration and plugin work must not bypass service boundaries for procurement conversion, document storage, custom fields, user invariants, or audit logging.
- Document processing result acceptance is restricted to `ALLOWED_PATCH_FIELDS` from `license_write_service.py` plus existing custom fields. Lifecycle repair fields (`lifecycle_status`, `renewed_from_id`, `renewed_to_id`, `predecessor_id`, `coterm_from_ids`), procurement conversion state, and internal identity fields (`id`, `license_ref`) are explicitly excluded and will cause the accept call to fail without partial mutation.

The Plugin Host v1 does not support arbitrary frontend JavaScript injection, plugin-created database migrations, direct plugin writes to the database, or plugin-defined arbitrary pages. See `docs/plugin-host-v1-roadmap.md` for the v1 scope boundary and `docs/plugin-author-guide.md` for the author contract.

API-token access is an alternative client authentication mechanism, not a replacement for human/browser authentication. Add new token access by explicitly mapping routes to scopes in `dependencies.py`; do not make API tokens implicitly valid for every authenticated route. Use narrow scopes first and add audit context for data-changing API-token requests.

Webhook events should represent durable product events, not UI gestures. Emit them through audit-backed data changes or explicit extension action requests so event payloads stay stable and observable. Webhook signing and retry behavior belongs in `webhook_service.py`; route handlers should only create/update endpoints, enqueue test deliveries, or request retries.

Stable API expectations live in `docs/api-stability.md`; integration positioning and Plugin Host guidance live in `docs/extensions.md`, `docs/plugin-host-roadmap.md`, and `docs/plugin-host-v1-roadmap.md`.

## Quality Gates

Use these checks during normal development:

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
