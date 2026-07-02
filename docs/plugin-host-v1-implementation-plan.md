# Plugin Host V1 Implementation Plan

> **Status (as of v0.9.9):** All phases are complete. Plugin Host v1 is shipped.

This plan turns `docs/plugin-host-v1-roadmap.md` into implementation work. It is intentionally sequenced as vertical slices so LicenseTrack gets a working, testable Plugin Host early, then expands toward the AI parser/modal experience.

## Implementation Status

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0: Design Freeze And Contracts | Done | V1 contracts are frozen in `docs/plugin-host-v1-roadmap.md`, with author guidance in `docs/plugin-author-guide.md` and backend schema planning in `docs/plugin-host-v1-pydantic-schema-plan.md`. |
| Phase 1: Backend Domain Model | Done | Plugin registry ORM models, Alembic migration, initial schemas, registry service, and service/migration tests are implemented. No package upload or runtime execution exists yet. |
| Phase 2: Manifest And Package Intake | Done | Admin preview/install APIs validate zip packages, inspect manifests, reject unsafe package entries, extract installable packages to plugin storage, create disabled registry rows, and audit installs. |
| Phase 3: Admin Plugin UI | Done | Admin Settings includes a Plugins section with installed-plugin list/detail, upload preview modal, permission/action review, install flow, and lifecycle controls backed by Phase 5 endpoints. |
| Phase 4: Plugin Settings And Secrets | Done | Admin settings can read/update plugin-defined settings, mask and preserve secrets, encrypt secrets at rest, audit setting changes, and mark plugins misconfigured when required settings are missing. |
| Phase 5: Enable/Disable Lifecycle And Capability Registration | Done | Admins can enable, disable, and uninstall plugins; enable grants declared permissions, validates compatibility/settings, activates actions/capabilities, starts runtime, and audit logs lifecycle events. |
| Phase 6: Managed Runtime | Done | Runtime manager can start/restart/stop managed local workers, inject loopback env/token settings, health-check workers, enforce action timeouts, capture bounded redacted logs, expose admin restart/log routes, and update runtime status. |
| Phase 7: Action Registry And First Slot | Done | Plugin action discovery/invocation APIs list enabled healthy plugin actions for `document.row.actions`, enforce roles and permissions, build `license_document` context, invoke managed runtimes, audit invocations, and render the first document-row `PluginSlot`. |
| Phase 8: Generic Suggestion Model | Done | Plugin action outputs with granted target suggestion permissions can create pending generic suggestions for `license` targets, supersede older pending suggestions, expose review APIs/UI, accept selected fields through core write services, reject without mutation, preserve line-item proposals, and audit reviewer decisions. |
| Phase 9: Procurement And Draft Licence Slots | Done | Plugin actions can now be discovered/invoked in sourcing item edit, pending-order line edit, pending-order conversion, and add-license draft review flows with scoped context payloads; generic suggestions can be stored for the new targets without mutating business data. |
| Phase 10: Package `licensetrack-ai` As First Plugin | Done | `licensetrack-ai` now builds an installable `.ltplugin.zip` package with all v1 parser actions, and LicenseTrack has a host integration fixture covering preview/install, settings, runtime restart, slot discovery, invocation, suggestion creation, and accepting a license suggestion. |

## Delivery Strategy

Build in three layers:

1. **Host foundation**: install, registry, manifest validation, settings, permissions, audit.
2. **Runtime and action path**: managed process, health, action invocation, first core-rendered slot.
3. **Workflow value**: generic suggestions, procurement slots, and conversion of `licensetrack-ai` into an installable package.

Do not start with arbitrary frontend plugin loading. V1 should use core-rendered UI and managed plugin workers.

## Guiding Constraints

- Plugins never write directly to the database.
- Plugins never patch compiled frontend files.
- Plugins never receive more context than their action and permissions require.
- Core owns permissions, user role checks, audit logging, validation, and final writes.
- Installed plugins are disabled until required settings are configured and runtime health passes.
- Disabling a plugin removes its visible actions but preserves historical audit/suggestion records.
- Uninstalling a plugin removes runtime/package files but preserves historical audit/suggestion records.

## Phase 0: Design Freeze And Contracts

Status: Done.

Goal: lock the smallest viable host contract before code starts.

### Work

- Finalize `.ltplugin` JSON schema.
- Finalize v1 package rules:
  - one root `plugin.ltplugin`;
  - required `README.md`, `LICENSE`, `runtime/`;
  - no symlinks;
  - no absolute paths;
  - no path traversal;
  - maximum package size.
- Finalize v1 permission catalog and plain-language descriptions.
- Finalize v1 UI slot catalog and context payloads.
- Finalize managed-process protocol:
  - health check;
  - action invocation;
  - settings access;
  - error response shape;
  - timeout behavior.
- Finalize generic suggestion schema and first supported targets.

### Deliverables

- `docs/plugin-host-v1-roadmap.md` updated if contracts change.
- `docs/plugin-author-guide.md` draft with manifest, package, permission, runtime, and action examples.
- `docs/plugin-host-v1-pydantic-schema-plan.md` with a JSON-schema-like Pydantic schema plan for backend implementation.
- Completed in Phase 0.

### Exit Criteria

- No unresolved names for permissions, slots, manifest fields, or runtime message shapes.
- `licensetrack-ai` can be described as a future package using the finalized contract.

## Phase 1: Backend Domain Model

Status: Done.

Goal: persist installed plugin state without executing plugin code yet.

### Work

Add ORM models and Alembic migration for:

- `plugins`
  - key, name, publisher, description, installed_version, status, enabled flag, compatibility status, install path, manifest JSON, last error, timestamps.
- `plugin_versions`
  - plugin key, version, package path, checksum, manifest JSON, installed/activated timestamps.
- `plugin_permissions`
  - plugin key, permission, granted flag, granted_by, granted_at.
- `plugin_setting_definitions`
  - plugin key, setting key, type, label, required, default, options, order.
- `plugin_setting_values`
  - plugin key, setting key, encrypted value, updated metadata.
- `plugin_actions`
  - plugin key, action key, label, slot, handler, required role, enabled flag.
- `plugin_runtime_status`
  - plugin key, pid/process handle metadata where applicable, health, last heartbeat, last error.
- `plugin_audit_logs` only if ordinary audit log cannot cover plugin events cleanly. Prefer the existing audit log first.

### Backend Files

Likely new files:

- `backend/app/models/plugin.py`
- `backend/app/schemas/plugin.py`
- `backend/app/services/plugin_registry_service.py`
- `backend/alembic/versions/*_add_plugin_host_tables.py`

Likely touched files:

- `backend/app/models/__init__.py`
- `backend/app/routes/__init__.py`
- `backend/app/main.py` or route registration surface.

Implemented files:

- `backend/app/models/plugin.py`
- `backend/app/schemas/plugin.py`
- `backend/app/services/plugin_registry_service.py`
- `backend/alembic/versions/4b7c8d9e0f12_add_plugin_host_tables.py`
- `backend/tests/test_unit/test_plugin_registry_service.py`
- `backend/app/models/__init__.py`

### Tests

- ORM migration creates expected tables.
- Plugin key uniqueness.
- Setting/action uniqueness per plugin.
- Delete/uninstall rules preserve historical audit/suggestions where applicable.

### Exit Criteria

- Backend can create/read/update plugin registry records in service tests.
- No package upload or runtime execution yet.
- Completed in Phase 1.

## Phase 2: Manifest And Package Intake

Status: Done.

Goal: upload a zip and produce a safe install preview.

### Work

Create `plugin_package_service`:

- validates upload size;
- inspects zip without extracting everything first;
- rejects path traversal, absolute paths, symlinks, duplicate unsafe names;
- finds exactly one root `plugin.ltplugin`;
- parses manifest JSON;
- validates manifest schema;
- validates semantic version;
- validates LicenseTrack version compatibility;
- validates requested permissions against catalog;
- validates requested UI slots against catalog;
- validates runtime entrypoint path stays inside package;
- computes package checksum;
- builds install preview response.

Add admin routes:

```text
POST /api/plugins/preview-install
POST /api/plugins/install
GET  /api/plugins
GET  /api/plugins/{plugin_key}
```

For install, extract to a staging path first, then move into final plugin storage path after DB transaction succeeds where practical.

### Backend Files

Likely new:

- `backend/app/routes/plugins.py`
- `backend/app/services/plugin_package_service.py`
- `backend/app/services/plugin_manifest_service.py`
- `backend/app/services/plugin_permissions.py`

Likely touched:

- `backend/app/services/storage.py` or a separate plugin storage helper.
- `backend/app/config.py` for max plugin package size and plugin storage path.

Implemented files:

- `backend/app/services/plugin_manifest_service.py`
- `backend/app/services/plugin_package_service.py`
- `backend/app/routes/plugins.py`
- `backend/app/schemas/plugin.py`
- `backend/app/config.py`
- `backend/app/main.py`
- `backend/tests/test_unit/test_plugin_package_service.py`
- `backend/tests/test_integration/test_plugins.py`

### Tests

- Valid minimal package returns install preview.
- Missing manifest rejected.
- Multiple manifests rejected.
- Manifest below/above compatibility range rejected.
- Unknown permission rejected.
- Unknown slot rejected.
- Path traversal rejected.
- Absolute path rejected.
- Symlink entry rejected.
- Runtime entrypoint outside package rejected.
- Install writes registry rows and package files.
- Install audit event created.

### Exit Criteria

- Admin API can upload a valid package and install it disabled.
- No runtime execution yet.
- Completed in Phase 2.

## Phase 3: Admin Plugin UI

Status: Done.

Goal: admins can see, install, inspect, and manage plugin metadata.

### Work

Add Admin Settings plugin section:

- installed plugin list;
- install/upload modal;
- install preview screen;
- permission review;
- compatibility warnings;
- plugin detail view;
- enable/disable/uninstall buttons initially wired to backend no-op or metadata-only endpoints;
- status badges for installed, disabled, misconfigured, incompatible.

Add frontend API client:

- `frontend/src/api/plugins.js`

Add components:

- `frontend/src/components/settings/sections/PluginsSection.jsx`
- install modal/review subcomponents as needed.

Implemented files:

- `frontend/src/api/plugins.js`
- `frontend/src/components/settings/sections/PluginsSection.jsx`
- `frontend/src/components/pages/SettingsPage.jsx`
- `frontend/src/styles/global.css`
- `frontend/src/__tests__/PluginsSection.test.jsx`
- `frontend/src/__tests__/PageWorkflows.test.jsx`

### Tests

- Upload preview renders plugin identity, permissions, settings, actions, warnings.
- Invalid preview error is visible.
- Installed plugin list renders status.
- Admin-only route visibility follows existing settings patterns.

### Exit Criteria

- Admin can upload package and complete a metadata-only install through the UI.
- Plugin install starts disabled, then Phase 5 lifecycle controls enable it after settings/runtime checks pass.
- Completed in Phase 3.

## Phase 4: Plugin Settings And Secrets

Status: Done.

Goal: core-render plugin settings and store values safely.

### Work

Backend:

- Create settings read/update routes:

```text
GET /api/plugins/{plugin_key}/settings
PUT /api/plugins/{plugin_key}/settings
```

- Render setting definitions from installed manifest.
- Validate setting values by type.
- Encrypt secret settings using existing crypto service patterns.
- Mask secret settings on read.
- Preserve masked placeholder on save.
- Audit setting changes without raw secret values.
- Mark plugin `misconfigured` when required settings are missing.

Frontend:

- Generic settings renderer for text, secret, boolean, number, select, URL, textarea.
- Dirty-state integration with Settings page guard.
- Required setting indicators.
- Save success/error states.

### Tests

- Secret setting encrypted at rest.
- Secret setting masked on read.
- Mask placeholder does not overwrite stored secret.
- Missing required setting marks plugin misconfigured.
- Invalid select/number/URL rejected.
- Audit events redact secrets.

### Exit Criteria

- Installed plugin can be configured entirely inside LicenseTrack.
- No `.env` is needed for plugin-owned settings.
- Completed in Phase 4.

## Phase 5: Enable/Disable Lifecycle And Capability Registration

Status: Done.

Goal: enabling a plugin activates its declared metadata without runtime actions yet.

### Work

Backend routes:

```text
POST /api/plugins/{plugin_key}/enable
POST /api/plugins/{plugin_key}/disable
DELETE /api/plugins/{plugin_key}
```

Enable behavior:

- verify compatibility;
- verify permissions are granted;
- verify required settings are present;
- register declared capabilities in existing `ExtensionCapability` table or a replacement compatibility layer;
- mark plugin enabled;
- audit event.

Implemented behavior:

- `POST /api/plugins/{plugin_key}/enable` validates compatibility and required settings, grants declared permissions as the admin's approval action, enables declared actions, registers manifest capabilities as available, starts the managed runtime, and audits permission grant and enable events.
- `POST /api/plugins/{plugin_key}/disable` stops the runtime, disables declared actions, marks manifest capabilities unavailable, marks the plugin disabled, and audits the lifecycle event.
- `DELETE /api/plugins/{plugin_key}` stops/disable-cleans runtime state, marks capabilities unavailable, removes active plugin registry/package files, explicitly preserves historical plugin suggestions through their denormalized plugin key, and audits uninstall.
- Admin Settings lifecycle buttons now call the real endpoints and show busy/confirmation states.

Implemented files:

- `backend/app/services/plugin_lifecycle_service.py`
- `backend/app/routes/plugins.py`
- `backend/tests/test_integration/test_plugins.py`
- `frontend/src/api/plugins.js`
- `frontend/src/components/settings/sections/PluginsSection.jsx`
- `frontend/src/__tests__/PluginsSection.test.jsx`

Disable behavior:

- mark disabled;
- hide plugin actions;
- mark capabilities unavailable/disabled;
- stop runtime once runtime exists;
- audit event.

Uninstall behavior:

- require disabled first, or perform disable as part of uninstall with confirmation;
- remove package/runtime files;
- keep audit/suggestion history;
- remove active actions/settings definitions or mark archived;
- audit event.

### Tests

- Enable fails if required settings missing.
- Enable fails if incompatible.
- Enable creates/updates capability records.
- Disable hides capabilities/actions.
- Uninstall preserves historical rows required for audit.

### Exit Criteria

- Plugin lifecycle works up to metadata/capability level.
- Completed in Phase 5, including managed runtime start/stop because Phase 6 was already implemented.

## Phase 6: Managed Runtime

Status: Done.

Goal: LicenseTrack starts and talks to a plugin worker.

### Work

Define runtime protocol:

```text
GET  /health
POST /actions/{handler}
```

V1 uses HTTP on loopback with a random per-plugin port and host-issued bearer token.

Backend runtime manager:

- allocate local loopback port;
- start process;
- inject host URL/token/settings channel env vars;
- health check;
- timeout handling;
- stop/restart;
- capture stdout/stderr or log file;
- update runtime status.

Implemented files:

- `backend/app/services/plugin_runtime_service.py`
- `backend/app/routes/plugins.py`
- `backend/app/schemas/plugin.py`
- `backend/app/config.py`
- `backend/tests/test_unit/test_plugin_runtime_service.py`
- `backend/tests/test_integration/test_plugins.py`

Security:

- action invocation token per plugin runtime;
- bind to loopback only;
- do not expose runtime port publicly;
- redact settings in logs.

Routes:

```text
POST /api/plugins/{plugin_key}/runtime/restart
GET  /api/plugins/{plugin_key}/runtime/logs
```

### Tests

- Runtime starts for a test plugin.
- Runtime health success marks available.
- Runtime health failure marks error.
- Disable stops runtime.
- Restart restarts runtime.
- Action timeout returns controlled error.
- Logs are retrievable and bounded.

### Exit Criteria

- A test plugin package can be installed, configured, enabled, started, health checked, disabled, and stopped.
- Completed in Phase 6 for managed runtime start/restart/stop, health, logs, and service-level action timeout handling. Phase 5 now wires this runtime support into admin enable/disable/uninstall.

## Phase 7: Action Registry And First Slot

Status: Done.

Goal: end-to-end plugin action invocation from a core-rendered UI slot.

### Backend

Add action discovery/invocation:

```text
GET  /api/plugin-actions?slot=document.row.actions&targetType=license_document&targetId=123
POST /api/plugin-actions/{plugin_key}/{action_key}/invoke
```

Behavior:

- list only enabled plugins;
- list only actions matching slot;
- enforce required role;
- enforce plugin permissions;
- build typed context payload;
- invoke runtime handler;
- audit invocation and result/error.

### Frontend

Add `PluginSlot` component:

```jsx
<PluginSlot slot="document.row.actions" context={...} />
```

First integration point:

- document row actions in the existing Documents section.

Implemented files:

- `backend/app/routes/plugin_actions.py`
- `backend/app/services/plugin_action_service.py`
- `backend/app/schemas/plugin.py`
- `backend/app/main.py`
- `frontend/src/api/pluginActions.js`
- `frontend/src/components/plugins/PluginSlot.jsx`
- `frontend/src/components/licenses/detail/DocumentsSection.jsx`
- `backend/tests/test_integration/test_plugin_actions.py`
- `frontend/src/__tests__/PluginSlot.test.jsx`
- `frontend/src/__tests__/api/endpointContracts.test.js`

### Tests

- Viewer does not see editor/admin plugin actions.
- Disabled plugin actions hidden.
- Missing permission hides or rejects action.
- Invoke sends expected context.
- Runtime error shown to user.
- Invocation audit event created.

### Exit Criteria

- A test plugin action appears on document rows and returns a visible result.
- Completed in Phase 7 for `license_document` targets in `document.row.actions`. Generic suggestions and additional target/slot wiring remain later phases.

## Phase 8: Generic Suggestion Model

Status: Done.

Goal: plugin actions can return reviewable suggestions outside the old document-processing-only model.

### Backend

Add models/services for generic suggestions:

- suggestion result;
- target type/id;
- source plugin/action;
- suggested fields;
- suggested line items;
- status: pending, accepted, rejected, superseded;
- raw output;
- reviewer metadata.
- target-specific plugin suggestion permission checks.

Implemented files:

- `backend/app/models/plugin_suggestion.py`
- `backend/app/schemas/plugin_suggestion.py`
- `backend/app/services/plugin_suggestion_service.py`
- `backend/app/routes/plugin_suggestions.py`
- `backend/alembic/versions/6a7b8c9d0e1f_add_plugin_suggestions.py`
- `backend/app/services/plugin_action_service.py`
- `backend/app/schemas/plugin.py`
- `backend/app/dependencies.py`
- `backend/app/main.py`
- `backend/tests/test_integration/test_plugin_actions.py`

Initial target:

- `license`

Then extend to:

- `license_draft`
- `sourcing_item`
- `pending_order_item`
- `pending_order_conversion`

Create target-specific allowlists and apply services. Reuse existing services:

- license field patch via `license_write_service.py`;
- custom field normalization via `custom_fields_service.py`;
- sourcing item updates via sourcing services;
- pending-order item updates via pending-order services.

### Frontend

Shared suggestion review components:

- current value vs suggested value;
- selected fields;
- confidence/source/note;
- accept/reject;
- multi-line item proposal display.

Implemented files:

- `frontend/src/api/pluginSuggestions.js`
- `frontend/src/components/licenses/detail/PluginSuggestionsSection.jsx`
- `frontend/src/components/licenses/DetailPanel.jsx`
- `frontend/src/hooks/useDetailPanelState.js`
- `frontend/src/components/plugins/PluginSlot.jsx`
- `frontend/src/styles/global.css`
- `frontend/src/__tests__/PluginSlot.test.jsx`
- `frontend/src/__tests__/DetailPanel.test.jsx`
- `frontend/src/__tests__/api/endpointContracts.test.js`

### Tests

- Unknown target rejected.
- Missing target suggestion permission rejected.
- Unknown field rejected.
- Lifecycle/internal fields rejected.
- Accept selected fields applies only selected fields.
- Reject does not mutate data.
- Supersede behavior works per plugin/action/target.
- Audit details include plugin, action, target, reviewer, applied fields.

### Exit Criteria

- Plugin action output can become pending suggestions and be accepted/rejected through core.
- Completed in Phase 8 for `license` targets. Future target types remain declared in the generic model and are scheduled for Phase 9 slot-specific context/apply work.

## Phase 9: Procurement And Draft Licence Slots

Status: Done.

Goal: expose the workflow slots needed for the AI parser vision.

### Slots

Implement:

```text
sourcing.item.edit.actions
pendingOrder.line.edit.actions
pendingOrder.convert.actions
license.add.review.actions
```

### Context Payloads

For sourcing item:

- sourcing request ID;
- sourcing item ID;
- existing item fields;
- attached quote document IDs;
- user role.

Implemented for `sourcing.item.edit.actions` through `PluginSlot` in `SourcingItemModal`.

For pending order line:

- pending order ID;
- line item ID;
- existing line fields;
- PO document IDs;
- linked sourcing/quote context if available.

Implemented for `pendingOrder.line.edit.actions` through `PluginSlot` in `SourcingItemModal` when editing pending-order line items.

For pending order conversion:

- pending order ID;
- selected line item IDs;
- conversion form draft fields;
- invoice/quote/PO document IDs.

Implemented for `pendingOrder.convert.actions` through `PluginSlot` in both single-item and batch conversion modals.

For add license:

- uploaded temporary document ID or staged file token;
- draft form fields;
- detected document category if available.

Implemented for `license.add.review.actions` through `PluginSlot` in the add-license review modal.

Implemented files:

- `backend/app/services/plugin_action_service.py`
- `backend/app/services/plugin_suggestion_service.py`
- `backend/app/schemas/plugin.py`
- `backend/tests/test_integration/test_plugin_actions.py`
- `frontend/src/components/plugins/PluginSlot.jsx`
- `frontend/src/components/procurement/SourcingItemModal.jsx`
- `frontend/src/components/procurement/ConvertPendingOrderModal.jsx`
- `frontend/src/components/procurement/ConvertAllModal.jsx`
- `frontend/src/components/licenses/InvoiceConfirmModal.jsx`
- `frontend/src/styles/global.css`
- `frontend/src/__tests__/PluginSlot.test.jsx`
- `frontend/src/__tests__/api/endpointContracts.test.js`

### Tests

- Actions appear only when slot context supports them.
- Plugin cannot access unrelated documents through context.
- Suggestions merge non-destructively unless user accepts overwrites.
- Multi-line quote suggestions can propose additional sourcing items.
- Draft license suggestion creates review form values, not a saved license until user confirms.

### Exit Criteria

- AI-style parser plugin can cover the requested modal flows through core-rendered slots.
- Completed in Phase 9 for slot discovery/invocation and pending suggestion creation. Applying suggestions for non-license targets remains future target-specific apply-service work.

## Phase 10: Package `licensetrack-ai` As First Plugin

Status: Done.

Goal: prove the host with the real AI parser.

### Work In `licensetrack-ai`

- Add `plugin.ltplugin`.
- Package runtime into zip.
- Replace `.env` settings with host settings access.
- Replace manual webhook/API token setup with action invocation.
- Add handlers:
  - `parse_quote`;
  - `parse_purchase_order`;
  - `parse_pending_order_conversion`;
  - `parse_license_document`;
  - optional `parse_existing_document`.
- Return generic suggestions.
- Include README and operator notes in package.

Implemented in `C:\Users\zande\Documents\GitHub\licensetrack-ai`:

- `plugin.ltplugin` declares `licensetrack-ai`, managed runtime settings, permissions, and all requested slot actions.
- `runtime/run-plugin.py` provides the managed process entrypoint.
- Runtime handlers cover `parse_quote`, `parse_purchase_order`, `parse_pending_order_conversion`, `parse_license_document`, and `parse_existing_document`.
- Live mode uses the Anthropic Messages HTTP API through `httpx` rather than requiring an Anthropic SDK runtime dependency.
- `scripts/build_plugin_zip.py` builds `dist/licensetrack-ai-0.1.0.ltplugin.zip`.
- README/operator notes document install, settings, test mode, supported slots, and host follow-ups.
- Package tests pass in the AI repo, and the built zip validates in the LicenseTrack host inspector with `installable=True`, `compatibility=compatible`, and no issues.

### Work In LicenseTrack

- Add fixture/test package for integration tests.
- Add E2E path:
  - upload plugin zip;
  - configure Anthropic key placeholder/test mode;
  - enable;
  - see Parse action in a slot;
  - invoke fake/test parser;
  - accept suggestion.

Implemented in LicenseTrack:

- `backend/tests/test_integration/test_plugins.py` includes a self-contained `licensetrack-ai` fixture package with the same v1 slot/action surface as the real plugin.
- The fixture E2E path previews and installs the zip through `/api/plugins`, configures `anthropicApiKey` and `testMode`, grants the declared permissions, enables the plugin record/actions, restarts the managed runtime, discovers the document-row parse action, invokes the runtime, stores a generic license suggestion, accepts it, and verifies the license is updated through core services.
- The real package at `C:\Users\zande\Documents\GitHub\licensetrack-ai\dist\licensetrack-ai-0.1.0.ltplugin.zip` was inspected by `app.services.plugin_package_service.inspect_plugin_package` and returned `installable=True`, `compatibility=compatible`, `issues=[]`.

### Exit Criteria

- Admin installs AI parser from zip.
- Anthropic API key is configured in LicenseTrack plugin settings.
- Parse buttons appear in supported slots.
- Suggestions are reviewable and apply through core.
- No manual API token, webhook secret, or `.env` setup is needed.

Completed for the host-supported fixture and package contract. The live-parser host follow-ups are now also implemented: runtimes can read their own unmasked settings through `/api/plugin-runtime/{pluginKey}/settings`, and action payloads include request-scoped `runtimeAccess.documentRefs` whose content URLs expose only the documents core included in that action context.

## Phase 11: Hardening And Release Readiness

Goal: make Plugin Host v1 shippable.

### Security Review

- Zip extraction audit.
- Runtime token audit.
- Secret storage audit.
- Permission enforcement audit.
- Action context scoping audit.
- Uninstall/disable data retention audit.
- Log redaction audit.

### Operational Review

- Plugin storage backup expectations.
- Plugin runtime restart behavior.
- Docker deployment notes.
- Offline install notes.
- Upgrade/rollback notes.
- Disaster recovery notes.

### Documentation

- Admin guide.
- Plugin author guide.
- Security model.
- Troubleshooting guide.
- `licensetrack-ai` install guide.
- Migration guide from sidecar integration to plugin package.

### Tests

- Backend unit tests for services.
- Backend integration tests for install/lifecycle/action/suggestion.
- Frontend tests for admin plugin UI.
- Frontend tests for slot rendering.
- E2E test for install and invoke.
- Regression test that plugins cannot appear when disabled.

### Exit Criteria

- All documented v1 acceptance criteria pass.
- Plugin Host can be disabled entirely by config if needed.
- Release notes clearly mark v1 limitations.

## Suggested Work Breakdown

### Milestone A: Install Preview

Outcome: upload zip, validate `.ltplugin`, show install review.

Includes:

- manifest schemas;
- package inspection;
- safe zip validation;
- preview route;
- frontend install modal.

### Milestone B: Installed But Disabled

Outcome: plugin can be installed and listed, but not run.

Includes:

- registry tables;
- install route;
- plugin list/detail UI;
- audit events.

### Milestone C: Settings And Enable

Outcome: plugin can be configured and enabled.

Includes:

- settings definitions/values;
- secret encryption/masking;
- enable/disable/uninstall;
- capability registration.

### Milestone D: Runtime And First Action

Outcome: enabled plugin worker starts and a document-row action can invoke it.

Includes:

- runtime manager;
- action discovery/invoke API;
- `PluginSlot`;
- document row slot.

### Milestone E: Suggestions

Outcome: plugin action returns suggestions that core reviews/applies.

Includes:

- generic suggestion model;
- license target apply path;
- review UI.

### Milestone F: Procurement Slots

Outcome: sourcing, pending-order, conversion, and add-license slots exist.

Includes:

- slot context builders;
- target allowlists;
- target apply services;
- shared review UI upgrades.

### Milestone G: AI Plugin Package

Outcome: `licensetrack-ai` installs from zip and works without manual token/webhook/env setup.

Includes:

- plugin manifest;
- runtime packaging;
- host settings access;
- action handlers;
- end-to-end tests.

## Risk Register

| Risk | Mitigation |
| --- | --- |
| Plugin runtime becomes a security hole | Managed worker only, loopback binding, host-issued token, no arbitrary frontend JS, no DB access. |
| Package install path traversal | Strict zip inspection before extraction, reject symlinks/absolute paths/`..`. |
| Plugin settings leak secrets | Use existing crypto service, mask reads, redact audit/log output. |
| Plugin actions bypass permissions | Enforce user role and plugin permission at action discovery and invocation. |
| Plugins break core workflows | Plugins return suggestions; core applies through existing services. |
| Scope grows into marketplace too early | Keep V1 offline zip upload only. |
| Runtime process management is brittle on Docker/Windows | Define supported runtime constraints early; add health/restart/logging before broad slots. |
| Procurement suggestions are too complex | Start with license suggestions, then add target-specific procurement apply services. |

## Implementation Notes

- Keep plugin routes in a dedicated `backend/app/routes/plugins.py`.
- Keep package/manifest/runtime logic in services, not routes.
- Reuse existing audit service for plugin events.
- Reuse existing crypto service for plugin secrets.
- Keep frontend slot rendering generic and small.
- Avoid adding plugin-specific branches to procurement modals; add slot components with typed context instead.
- Prefer feature flags/config kill switch for the Plugin Host until v1 is stable.

## Phase 0 Decisions

- Runtime protocol: local HTTP on loopback with a random per-plugin port and host-issued bearer token.
- Plugin storage path: `/data/plugins/{plugin_key}/{version}/`, configurable by deployment; backup guidance belongs in the release-readiness docs.
- Package signing: v1 displays package checksums and may display an optional `SIGNATURE`, but signatures are not required.
- Install state: installed plugins start disabled and must pass settings, permission, compatibility, and runtime checks before enable.
- Manifest filename: exactly one root `plugin.ltplugin`; other `*.ltplugin` files are rejected.
- Capability source: the existing `ExtensionCapability` table remains the public compatibility/status surface for v1.
- Plugin logs: bounded runtime log files live under plugin storage and are exposed through tail-style reads, not unbounded database rows.
