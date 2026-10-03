# Invariants

Rules LicenseTrack guarantees on **every** supported entry point: forms, inline
edits, CSV import and update, conversion, the API, and background jobs. Each rule
names its single owner in code and the test that fails if the rule breaks.
A rule without a guard test is marked *unguarded* until it has one.

Status: **holds** (guarded), **unguarded** (believed to hold, no guard test
yet), **target** (planned for the named release), or **known violation**
(with an issue).

**One owner per rule.** Most LicenseTrack regressions came from one job being
implemented in several places that later drifted apart. Every rule below
therefore has exactly one owner in code. Other code calls the owner instead of
re-implementing the rule. Every pull request lists the rules it touches, the
other implementations it found, and what it did with them. Where a rule is a
literal value (a set of statuses, a list of fields), a guard test built on
`backend/tests/single_owner.py` fails if the literal appears outside its owner.

## Money

| ID | Rule | Owner | Guard | Status |
|---|---|---|---|---|
| MONEY-1 | Stored numbers are canonical decimal strings and are never re-interpreted. User-typed text is parsed exactly once; opening and leaving an input unchanged preserves value and precision. | `frontend/src/utils/formatting.js` (`parseTypedNumber`, `toInputText`); `backend/app/services/money.py` | `frontend/src/__tests__/utils/numberInput.test.js` (round-trip and idempotency, 7 locales); `frontend/src/__tests__/typedNumberReaders.test.js` (typed text read only by `NumberInput`, inline cells and list filters) | holds |
| MONEY-5 | Typed numbers follow one rule on both sides: plain or correctly grouped text in the user's number format; anything else is refused with a message, never changed. Under comma-decimal formats with "." grouping, `1.234` is refused as ambiguous. The API accepts only canonical decimals. | `backend/app/services/money.py` (`parse_localized_money`, separator table, generated into `frontend/src/generated/numberFormats.json`); `frontend/src/utils/formatting.js` (`parseTypedNumberResult`); `frontend/src/components/ui/NumberInput.jsx` | `backend/tests/fixtures/number_parsing_cases.json` run by both `test_number_parsing_cases.py` and `numberParsingCases.test.js`; `test_request_numbers_are_canonical.py` | holds |
| MONEY-2 | A license's Line Total is quantity × unit price, always calculated. The stored `total_po_price` field is retired: no calculation reads it and the app never writes it (the API still accepts it until 1.3.0). Procurement estimates (Est. Line Total) keep their own field. | `backend/app/services/license_service.py` (`calc_line_total`, `unit_price_from_total`); `frontend/src/utils/lineAmount.js` | `backend/tests/fixtures/line_amount_cases.json` run by `test_line_amount.py` and `lineAmount.test.js`; `test_line_amount.py::test_stored_line_total_is_only_touched_by_its_compatibility_owners` | holds |
| MONEY-3 | Totals stay separated by currency. There is no implicit exchange rate. | `backend/app/services/po_total_override_service.py`, `reporting_service.py`; frontend `registryGrouping.js`, `procurementIdentity.js`, `procurementTotals.js` | `backend/tests/fixtures/currency_totals_cases.json` run by `test_reporting_service.py::test_shared_currency_totals_guard_reports_and_overview` and `frontend/src/__tests__/currencyTotals.test.js` | holds |
| MONEY-4 | A manual PO total replaces the calculated total once per financial group. It is never spread across lines or added per license. | `po_total_override_service.py` | `backend/tests/test_integration/test_pending_order_po_total.py` | holds |

## Identity

| ID | Rule | Owner | Guard | Status |
|---|---|---|---|---|
| ID-1 | "Same PO" means the same normalized PO number: trimmed, inner whitespace collapsed, case ignored. | `backend/app/services/procurement_identity.py` (`normalize_po_number`, SQL `licensetrack_normalize_po`); `frontend/src/utils/procurementIdentity.js` | `backend/tests/test_integration/test_documents.py` (normalized PO tests); frontend DetailPanel Email Supplier test | holds |
| ID-2 | A financial group is the pending order, else the manual batch, else the normalized PO number, always per currency. | `po_total_override_service.py` (`procurement_identity_key`) | `backend/tests/test_unit/test_reporting_service.py` | holds |
| ID-3 | The database schema built by migrations equals the models. | `backend/alembic/versions/*`, `backend/app/models/*` | `backend/tests/test_unit/test_schema_drift.py` | holds |
| ID-4 | Every record with a PO number has a PO line number, unique per normalized PO number and never reused. PO line numbers are generated only; no request can set them. | `backend/app/services/po_line_service.py` (the in-browser demo mirrors it in `frontend/src/demo/poLines.js`) | `backend/tests/test_integration/test_po_line_service.py`; `frontend/src/demo/__tests__/poLines.test.js`; `backend/tests/test_unit/test_po_line_guard.py` (only the owner writes lines); commit guard in `backend/tests/conftest.py` (fails any request that commits a record whose line does not match its PO number) | holds |

## State

| ID | Rule | Owner | Guard | Status |
|---|---|---|---|---|
| STATE-1 | A license's active maintenance record is computed from its linked records by date, never set by whichever path linked last. The current record stays active while it covers today; a gap shows the most recently ended record. | `backend/app/services/maintenance_service.py` (`choose_active_maintenance`, `recompute_active_maintenance`) | `backend/tests/test_unit/test_maintenance_activation_rule.py`, `backend/tests/test_integration/test_maintenance_activation_paths.py` | holds |
| STATE-2 | Renewal chains never fork or cycle: each predecessor has at most one successor. | `backend/app/services/lifecycle_rules.py` (`assert_predecessor_has_no_successor`) | `backend/tests/test_integration/test_licenses.py` (`test_lifecycle_repair_rejects_successor_cycle`), `backend/tests/test_integration/test_csv_import.py` (`test_csv_import_rejects_predecessor_already_renewed`) | holds |
| STATE-3 | Disabling maintenance leaves no current or planned maintenance record linked to the license; the active period is kept in coverage history. | `maintenance_service.py` (`disable_maintenance_for_parent`) | `test_maintenance_activation_paths.py` (`test_disable_maintenance_*`) | holds |
| STATE-4 | A license-type change keeps maintenance coverage whenever it stays valid (between perpetual, OEM and freeware); leaving those types records the included period in history first. | `backend/app/services/maintenance_rules.py` (`coverage_after_type_change`); `license_write_service.py` (`_snapshot_included_support_before_type_change`) | `test_maintenance_rules.py`; `test_licenses.py` (type-change tests) | holds |
| STATE-5 | "Renewal in progress" has one answer for licenses and maintenance: a pending renewal, or an open maintenance-renewal line. Alerts, the workbench and retirement all use it. | `backend/app/services/support_renewal_service.py` (`open_support_renewal_filter`, `renewal_in_progress`) | `backend/tests/test_integration/test_renewal_in_progress.py` | holds |
| STATE-6 | Legacy licenses can't start a renewal; a renewed status can't be cleared through a general edit. | `lifecycle_rules.py` | `test_license_renewals.py` (`test_legacy_license_cannot_start_single_or_bundle_renewal`, `test_general_update_cannot_clear_renewed_status`) | holds |
| STATE-7 | A co-term merge needs one license type, and its maintenance successor covers every predecessor's licenses. | `sourcing_service.py` (`_validate_coterm_merge_compatibility`); `renewal_orchestrator.py` | `backend/tests/test_integration/test_coterm_maintenance.py` | holds |

## Frontend

| ID | Rule | Owner | Guard | Status |
|---|---|---|---|---|
| UI-1 | Every maintenance-linking dialog reads the shared license list and searches the same fields. | `frontend/src/hooks/useAllLicenses.js`, `frontend/src/utils/maintenanceLinking.js` | `frontend/src/__tests__/utils/maintenanceLinking.test.js`, `frontend/src/__tests__/RenewalWorkbenchLinkExisting.test.jsx` | holds |
| UI-2 | Which license types may be a maintenance parent is defined once in the frontend and matches the backend. | `frontend/src/utils/maintenanceCoverage.js` (`MAINTENANCE_PARENT_TYPES`) | `backend/tests/test_unit/test_maintenance_rules.py` (`test_frontend_maintenance_parent_types_match_backend`) | holds |

## Import and export

| ID | Rule | Owner | Guard | Status |
|---|---|---|---|---|
| IMPORT-1 | Every field marked round-trip in `csv_fields.py` survives export → import. | `backend/app/services/csv_fields.py`; `backend/app/services/csv_importer.py`; `backend/app/services/import_/license_builder.py` | `backend/tests/test_integration/test_csv_round_trip.py` | holds |
| IMPORT-2 | Frontend export headers equal the backend CSV field registry. | `backend/app/services/csv_fields.py`; `frontend/src/generated/csvFields.json` | `backend/tests/test_unit/test_csv_fields.py` (`test_frontend_csv_field_file_is_up_to_date`) | holds |

## Procurement

| ID | Rule | Owner | Guard | Status |
|---|---|---|---|---|
| PROC-1 | Only open pending orders (pending, invoice received) can gain lines, be edited, cancelled or converted; closing wins any race. | `backend/app/services/pending_order_state.py`; `frontend/src/utils/pendingOrderState.js` | `backend/tests/test_unit/test_pending_order_state.py`; `test_pending_orders.py` (`test_sourcing_cannot_attach_to_a_closed_pending_order`) | holds |
| PROC-2 | A manual PO total fixes the order's currency, in editing and in conversion. | `backend/app/services/po_total_override_service.py` (`assert_line_currency_fits_pending_order`) | `backend/tests/test_integration/test_pending_order_po_total.py` (`*_rejects_a_currency_change_*`) | holds |
| PROC-3 | A conversion's invoice is stored in the same transaction as its licenses; if it can't be stored, nothing converts. | `backend/app/services/pending_order_conversion_service.py` (`_complete_conversion`) | `test_pending_orders.py` (`test_invoice_*`) | holds |
| PROC-4 | One evidence transfer runs per order at a time. | `pending_order_conversion_service.py` (`claim_evidence_transfer`) | `test_pending_orders.py` (`test_*evidence*claim*`) | holds |

## Operations

| ID | Rule | Owner | Guard | Status |
|---|---|---|---|---|
| OPS-1 | Every copy of the live SQLite database is WAL-consistent and made by one routine; automatic safety copies (pre-upgrade, pre-restore) live in their own folder next to the database and keep the newest three. | `backup_service._copy_sqlite_database`, `_take_safety_snapshot` | `test_backup_service.py::test_sqlite_safety_copies_have_one_owner`, `test_pre_migration_snapshot.py` | holds |
| OPS-2 | A restore never blocks the event loop; `/api/health` answers throughout. | `routes/backup.py::_perform_restore` | `test_backup.py::test_health_answers_while_a_restore_is_running` | holds |

## API

| ID | Rule | Owner | Guard | Status |
|---|---|---|---|---|
| API-1 | No request field is silently dropped: unknown fields are logged, and rejected when `STRICT_REQUEST_FIELDS` is on (always in tests). | `backend/app/schemas/request_base.py::RequestModel` | `backend/tests/test_unit/test_request_models_use_base.py` | holds |
| API-2 | The core write paths (add, edit, procurement conversion, maintenance renewal, CSV round trip) are tested end to end against a real backend with strict request fields. | `frontend/tests/real-backend/` | CI job `real-backend-e2e` | holds |

## Notifications

| ID | Rule | Owner | Guard | Status |
|---|---|---|---|---|
| NOTIFY-1 | Which alert types reach budget owners and the manager digest is decided in one place. Budget owners get license and included-maintenance expiry alerts. | `notification_classification.BUDGET_OWNER_ALERT_TYPES`, `MANAGER_DIGEST_ALERT_TYPES` | `test_notifications.py::test_budget_owner_and_digest_alert_types_have_one_owner` | holds |

## Sessions

| ID | Rule | Owner | Guard | Status |
|---|---|---|---|---|
| SESSION-1 | Session deadlines are measured on the client's own clock from the server's seconds remaining; nothing compares server time with browser time. | `backend/app/routes/auth.py::_expires_in`; `frontend/src/api/client.js::rememberSessionExpiry` | `frontend/src/__tests__/sessionClock.test.js`; `frontend/tests/e2e/session-multitab.spec.js` | holds |

## Non-goals

- **Budgeting.** LicenseTrack provides the data managers use to prepare budgets. It doesn't do forecasting, budget-vs-actual, allocations or multi-year budget modelling. Annualized cost views are indicative.
- **Mobile or touch interfaces.** LicenseTrack is a desktop application.
- **Seat assignment and consumption tracking.** That is software asset management territory.
- **Storing product keys or other secrets.**
