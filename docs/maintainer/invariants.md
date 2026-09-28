# Invariants

Rules LicenseTrack guarantees on **every** supported entry point: forms, inline
edits, CSV import and update, conversion, the API, and background jobs. Each rule
names its single owner in code and the test that fails if the rule breaks.
A rule without a guard test is marked *unguarded* until it has one.

Status: **holds** (guarded), **unguarded** (believed to hold, no guard test
yet), **target** (planned for the named release), or **known violation**
(with an issue).

## Money

| ID | Rule | Owner | Guard | Status |
|---|---|---|---|---|
| MONEY-1 | Stored numbers are canonical decimal strings and are never re-interpreted. User-typed text is parsed exactly once; opening and leaving an input unchanged preserves value and precision. | `frontend/src/utils/formatting.js` (`parseTypedNumber`, `toInputText`); `backend/app/services/money.py` | `frontend/src/__tests__/utils/numberInput.test.js` (round-trip and idempotency, 7 locales) | holds |
| MONEY-2 | An entered line total is authoritative when present; quantity × unit price is the fallback and the plausibility check. | `backend/app/services/procurement_totals.py` | — | unguarded |
| MONEY-3 | Totals stay separated by currency. There is no implicit exchange rate. | `backend/app/services/po_total_override_service.py`, `reporting_service.py` | — | unguarded |
| MONEY-4 | A manual PO total replaces the calculated total once per financial group. It is never spread across lines or added per license. | `po_total_override_service.py` | `backend/tests/test_integration/test_pending_order_po_total.py` | holds |

## Identity

| ID | Rule | Owner | Guard | Status |
|---|---|---|---|---|
| ID-1 | "Same PO" means the same normalized PO number: trimmed, inner whitespace collapsed, case ignored. | `backend/app/services/procurement_identity.py` (`normalize_po_number`, SQL `licensetrack_normalize_po`); `frontend/src/utils/procurementIdentity.js` | — | target 1.2.0 (#74) |
| ID-2 | A financial group is the pending order, else the manual batch, else the normalized PO number, always per currency. | `po_total_override_service.py` (`procurement_identity_key`) | `backend/tests/test_unit/test_reporting_service.py` | holds |
| ID-3 | The database schema built by migrations equals the models. | `backend/alembic/versions/*`, `backend/app/models/*` | `backend/tests/test_unit/test_schema_drift.py` | holds |

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

## Non-goals

- **Budgeting.** LicenseTrack provides the data managers use to prepare budgets. It doesn't do forecasting, budget-vs-actual, allocations or multi-year budget modelling. Annualized cost views are indicative.
- **Mobile or touch interfaces.** LicenseTrack is a desktop application.
- **Seat assignment and consumption tracking.** That is software asset management territory.
- **Storing product keys or other secrets.**
