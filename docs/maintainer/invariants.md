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
| ID-1 | "Same PO" means the same normalized PO number: trimmed, inner whitespace collapsed, case ignored. | `backend/app/services/procurement_identity.py` (`normalize_po_number`, SQL `licensetrack_normalize_po`); `frontend/src/utils/procurementIdentity.js` | `backend/tests/test_integration/test_documents.py` (normalized PO tests); frontend DetailPanel Email Supplier test | holds |
| ID-2 | A financial group is the pending order, else the manual batch, else the normalized PO number, always per currency. | `po_total_override_service.py` (`procurement_identity_key`) | `backend/tests/test_unit/test_reporting_service.py` | holds |
| ID-3 | The database schema built by migrations equals the models. | `backend/alembic/versions/*`, `backend/app/models/*` | `backend/tests/test_unit/test_schema_drift.py` | holds |

## State

| ID | Rule | Owner | Guard | Status |
|---|---|---|---|---|
| STATE-1 | A license's active maintenance record is computed from its linked records by date, never set by whichever path linked last. | `backend/app/services/maintenance_service.py` (`recompute_active_maintenance`) | — | target 1.2.0 (#64) |
| STATE-2 | Renewal chains never fork or cycle: each predecessor has at most one successor. | `backend/app/services/lifecycle_rules.py` (`assert_predecessor_has_no_successor`) | `backend/tests/test_integration/test_licenses.py` (`test_lifecycle_repair_rejects_successor_cycle`), `backend/tests/test_integration/test_csv_import.py` (`test_csv_import_rejects_predecessor_already_renewed`) | holds |

## Non-goals

- **Budgeting.** LicenseTrack provides the data managers use to prepare budgets. It doesn't do forecasting, budget-vs-actual, allocations or multi-year budget modelling. Annualized cost views are indicative.
- **Mobile or touch interfaces.** LicenseTrack is a desktop application.
- **Seat assignment and consumption tracking.** That is software asset management territory.
- **Storing product keys or other secrets.**
