# Plugin Host V1 Roadmap

This document is the frozen Plugin Host v1 platform contract: package rules, the `.ltplugin` manifest, the permission catalog, the slot catalog, the runtime protocol, and the suggestion shape.

Current implementation status:

- Phase 0 is complete: v1 contracts, package rules, permission catalog, slot catalog, runtime protocol, and suggestion shape are frozen.
- Phase 1 is complete: backend plugin registry persistence, migration, schemas, service layer, and focused tests exist.
- Phase 2 is complete: admin APIs can preview and install validated plugin zip packages into disabled registry records.
- Phase 3 is complete: Admin Settings can list, preview, install, configure, enable, disable, and uninstall plugin packages through core-rendered controls.
- Phase 4 is complete: plugin-defined settings can be read, edited, validated, audited, masked, and stored with encrypted secrets.
- Phase 5 is complete: lifecycle endpoints grant declared permissions, validate compatibility/settings, enable actions, activate capabilities, start/stop runtimes, remove package files on uninstall, and preserve historical suggestions/audit records.
- The managed runtime slice is complete: LicenseTrack can start, restart, health-check, stop, and read redacted logs for local plugin workers.
- Phase 7 is complete for the first slot: document-row plugin actions can be discovered, invoked, audited, and rendered in the existing Documents section.
- Phase 8 is complete for license-target suggestions: plugin action output with granted target suggestion permissions can create pending suggestions, reviewers can accept selected fields or reject them, older pending suggestions are superseded per plugin/action/target, and audit details include plugin, action, target, reviewer, and applied fields.
- Phase 9 is complete: sourcing item edit, add-sourcing-quote, pending-order add, pending-order line edit, pending-order conversion, and add-license draft review slots are exposed with scoped backend context builders and core-rendered `PluginSlot` mounts. The `sourcing.quote.add.actions` and `pendingOrder.add.actions` slots support multi-item `sourcing_quote_draft` and `pending_order_draft` targets, enabling a plugin to parse an uploaded document and populate multiple line items before the record is saved.
- Phase 10 is complete for the first-plugin package proof: `licensetrack-ai` builds an installable `.ltplugin.zip`, the real zip validates with the host inspector, and LicenseTrack has an integration fixture covering install, settings, runtime restart, action discovery/invocation, suggestion creation, and accepting a license suggestion.

The target v1 experience is:

1. An admin downloads a plugin package as a `.zip`.
2. The admin uploads that `.zip` in LicenseTrack Admin Settings.
3. LicenseTrack opens the package, finds a `.ltplugin` manifest, validates the package, and shows an install review screen.
4. The admin approves the plugin permissions and installs it.
5. LicenseTrack stores the plugin, registers its declared capabilities, renders its settings, and exposes its actions in approved UI slots.
6. Users see native LicenseTrack buttons/actions where the plugin is allowed to appear.

The v1 host should make plugins feel installable without allowing arbitrary code to rewrite the app.

## Product Principle

LicenseTrack should be the platform host. Plugins should extend purchase and license lifecycle workflows, but core must keep control of:

- plugin installation and upgrade;
- permissions;
- settings and secrets;
- UI placement;
- user authorization;
- audit logging;
- validation;
- final data mutation;
- disable/uninstall behavior.

For v1, plugins should return proposed results or action responses. Core applies accepted changes through normal services.

## V1 Scope

### In Scope

- Upload a plugin `.zip` from Admin Settings.
- Discover exactly one `.ltplugin` manifest in the package.
- Validate manifest schema, plugin identity, version, compatibility, permissions, settings, UI slots, and runtime declaration.
- Store installed plugin package metadata.
- Enable, disable, update, and uninstall plugins.
- Render plugin settings from manifest declarations.
- Store plugin settings, including masked/encrypted secrets.
- Register plugin capabilities automatically from the manifest.
- Render plugin actions in approved core-defined UI slots.
- Invoke plugin actions through a backend action contract.
- Support managed plugin workers/sidecars as the v1 runtime.
- Support generic suggestion/review/apply flows for the first plugin targets.
- Audit install, enable, disable, uninstall, settings changes, permission grants, action invocations, and plugin errors.

### Out Of Scope For V1

- Public marketplace.
- Automatic internet download from marketplace URLs.
- Arbitrary frontend JavaScript injection.
- Plugin modification of compiled React code.
- Direct plugin database writes.
- Plugin-provided database migrations.
- Plugin-defined arbitrary pages.
- Multiple runtimes inside one plugin package.
- Cross-plugin dependencies.
- Paid licensing enforcement inside LicenseTrack.
- Sandboxed custom React components.

These can be considered after the first host model is stable.

## Phase 0 Contract Decisions

These decisions freeze the v1 host contract for implementation. Later releases can add new manifest versions, package signatures, additional slots, or other runtimes without changing the v1 rules below.

| Topic | V1 decision |
| --- | --- |
| Package extension | Admin-uploaded `.zip`. |
| Manifest filename | Exactly one root file named `plugin.ltplugin`. Other `*.ltplugin` files are rejected. |
| Runtime protocol | Managed process speaking local HTTP on loopback with a host-issued bearer token. |
| Install state | Installed plugins are disabled by default. They can be enabled only after compatibility, permissions, required settings, and runtime health pass. |
| Package size | Default maximum is 50 MiB, configurable by admins. |
| Package signing | Optional `SIGNATURE` may be displayed, but signatures are not required in v1. Package checksum is always calculated and shown. |
| Capability source | The existing `ExtensionCapability` table remains the public compatibility/status surface for v1. Plugin capability rows are registered from manifests during enable. |
| Plugin logs | V1 stores bounded runtime log files under plugin storage and exposes tail reads; it does not write unbounded logs into the database. |

## Package Format

V1 package extension:

```text
.zip
```

Reason: easy for admins to download, inspect, archive, and upload.

Required package contents:

```text
plugin.ltplugin
README.md
LICENSE
runtime/
```

Optional package contents:

```text
assets/
docs/
checksums.txt
SIGNATURE
```

Rules:

- The zip must contain exactly one root `plugin.ltplugin` file.
- The manifest must be at the package root for v1; nested manifests are rejected.
- Package extraction must reject path traversal entries such as `../`.
- Package extraction must reject absolute paths.
- Package extraction must reject symlinks for v1.
- Package size must be limited by an admin-configurable maximum. The v1 default is 50 MiB.
- Package files must be stored outside normal document storage.
- Package entry names must use relative, normalized POSIX-style paths. Backslash separators, drive letters, empty path segments, and `.`/`..` segments are rejected.
- Duplicate package entry names after normalization are rejected.
- Runtime entrypoints, documentation paths, and asset paths must stay inside the extracted package root.

Suggested install path:

```text
/data/plugins/{plugin_key}/{version}/
```

## `.ltplugin` Manifest

The `.ltplugin` file is the installer contract. It is JSON for v1 so LicenseTrack can validate it with existing backend tooling.

Example:

```json
{
  "manifestVersion": 1,
  "key": "licensetrack-ai",
  "name": "LicenseTrack AI",
  "version": "0.1.0",
  "publisher": {
    "name": "LicenseTrack",
    "url": "https://licensetrack.example"
  },
  "licenseTrack": {
    "minVersion": "1.1.0",
    "maxVersionExclusive": "2.0.0"
  },
  "description": "AI-assisted document parsing for LicenseTrack.",
  "runtime": {
    "type": "managedProcess",
    "entrypoint": "runtime/licensetrack_ai.py",
    "healthPath": "/health"
  },
  "permissions": [
    "documents:read",
    "plugin:settings:read",
    "plugin:settings:write",
    "suggestions:license:write",
    "suggestions:sourcing_item:write",
    "suggestions:pending_order_item:write"
  ],
  "capabilities": [
    {
      "key": "licensetrack-ai.document-processing",
      "type": "document.processing",
      "description": "Parses selected uploaded documents."
    }
  ],
  "settings": [
    {
      "key": "anthropicApiKey",
      "label": "Anthropic API Key",
      "type": "secret",
      "required": true
    },
    {
      "key": "model",
      "label": "Model",
      "type": "select",
      "required": true,
      "default": "claude-sonnet-4-20250514",
      "options": [
        "claude-sonnet-4-20250514"
      ]
    }
  ],
  "actions": [
    {
      "key": "parseQuote",
      "label": "Parse Quote",
      "slot": "sourcing.item.edit.actions",
      "handler": "parse_quote",
      "requiredRole": "editor"
    },
    {
      "key": "parsePurchaseOrder",
      "label": "Parse PO",
      "slot": "pendingOrder.line.edit.actions",
      "handler": "parse_purchase_order",
      "requiredRole": "editor"
    },
    {
      "key": "parseLicenseDocument",
      "label": "Parse Document",
      "slot": "license.add.review.actions",
      "handler": "parse_license_document",
      "requiredRole": "editor"
    }
  ]
}
```

### Manifest Field Contract

| Field | Required | Type | V1 rules |
| --- | --- | --- | --- |
| `manifestVersion` | Yes | integer | Must be `1`. |
| `key` | Yes | string | Lowercase slug, 3-80 chars, `a-z`, `0-9`, and single hyphens only. Stable across versions. |
| `name` | Yes | string | 1-120 chars. |
| `version` | Yes | string | Semantic version `MAJOR.MINOR.PATCH` with optional prerelease/build metadata. |
| `publisher` | Yes | object | Requires `name`; optional `url`. |
| `licenseTrack` | Yes | object | Requires `minVersion`; optional `maxVersionExclusive`. |
| `description` | No | string | Max 1000 chars. |
| `runtime` | Yes | object | V1 supports only `type: "managedProcess"`. |
| `permissions` | Yes | array | Known permission strings only. Empty array is allowed. |
| `permissionRationale` | No | object | Optional map from permission name to short reason shown during install review. |
| `capabilities` | No | array | Optional compatibility/status declarations registered while enabled. |
| `settings` | No | array | Core-rendered plugin setting definitions. |
| `actions` | No | array | Core-rendered action declarations for approved UI slots. |

Runtime object:

| Field | Required | Type | V1 rules |
| --- | --- | --- | --- |
| `type` | Yes | string | Must be `managedProcess`. |
| `entrypoint` | Yes | string | Relative path inside `runtime/`; no traversal or absolute path. |
| `args` | No | array[string] | Literal process arguments. No shell expansion. |
| `healthPath` | Yes | string | Must start with `/`; default author recommendation is `/health`. |
| `actionsBasePath` | No | string | Must start with `/`; default is `/actions`. |
| `timeoutSeconds` | No | integer | 1-120; default is 30. |
| `startupTimeoutSeconds` | No | integer | 1-120; default is 15. |

Setting object:

| Field | Required | Type | V1 rules |
| --- | --- | --- | --- |
| `key` | Yes | string | Camel-case identifier, 1-80 chars, unique per plugin. |
| `label` | Yes | string | 1-120 chars. |
| `type` | Yes | string | One of `text`, `secret`, `boolean`, `number`, `select`, `url`, `textarea`. |
| `required` | No | boolean | Defaults to `false`. |
| `default` | No | value | Must match setting type. Secrets cannot declare defaults. |
| `options` | For `select` | array[string] | 1-100 options, each 1-200 chars. |
| `helpText` | No | string | Max 500 chars. |
| `order` | No | integer | Lower values render first. |

Action object:

| Field | Required | Type | V1 rules |
| --- | --- | --- | --- |
| `key` | Yes | string | Camel-case identifier, 1-80 chars, unique per plugin. |
| `label` | Yes | string | 1-80 chars. |
| `slot` | Yes | string | Must be in the v1 UI slot catalog. |
| `handler` | Yes | string | Runtime handler identifier, snake-case recommended, 1-120 chars. |
| `requiredRole` | Yes | string | One of `viewer`, `editor`, `admin`. |
| `icon` | No | string | Optional approved icon name rendered by core. |
| `description` | No | string | Max 500 chars for install review and tooltips. |
| `timeoutSeconds` | No | integer | 1-120; defaults to runtime timeout. |

## Manifest Validation

LicenseTrack should reject installation if:

- manifest JSON is invalid;
- `manifestVersion` is unsupported;
- `key` is missing, too long, or not lowercase slug format;
- `version` is not semantic version format;
- current LicenseTrack version is outside the declared compatibility range;
- requested permissions are unknown;
- requested UI slots are unknown;
- action keys are duplicated;
- setting keys are duplicated;
- runtime type is unsupported;
- runtime entrypoint points outside the extracted package;
- package contains forbidden file types for the selected runtime.

The install review screen should show all validation results before install.

## V1 Runtime Model

Recommended v1 runtime:

```text
managedProcess
```

LicenseTrack starts an isolated plugin process and communicates with it over a local HTTP protocol bound to loopback.

Why this model:

- avoids loading third-party code into the backend process;
- avoids arbitrary frontend JavaScript;
- isolates crashes;
- allows per-plugin health checks;
- keeps the same mental model as today’s sidecars, but removes manual token/webhook/env setup.

Runtime responsibilities:

- expose a health endpoint;
- accept action invocation requests from LicenseTrack;
- read plugin settings through the host-provided secure channel;
- return structured action results;
- never call internal database paths directly.

LicenseTrack responsibilities:

- start/stop/restart plugin workers;
- inject runtime configuration securely;
- generate internal plugin identity credentials;
- invoke actions;
- record logs and health;
- enforce permissions before invoking plugin actions;
- apply accepted results through core services.

## Internal Plugin Identity

Admins should not manually create API tokens for installed plugins.

For v1, LicenseTrack should create an internal plugin identity when a plugin is installed:

- plugin key;
- installed version;
- granted permissions;
- internal credential or invocation token;
- last-used timestamp;
- revoked/disabled state.

This identity is not shown as a normal API token. It is managed by the Plugin Host and revoked automatically when the plugin is disabled or uninstalled.

## Permission Model

Permissions should be explicit and reviewed during installation.

Initial permission catalog:

| Permission | Plain-language description | Risk |
| --- | --- | --- |
| `documents:read` | Read documents included in an action context, such as selected license, quote, invoice, or purchase order files. | High |
| `documents:write` | Attach or create documents through approved core document APIs. | High |
| `licenses:read` | Read license fields included in an action context. | Medium |
| `procurement:read` | Read sourcing and pending-order fields included in an action context. | Medium |
| `plugin:settings:read` | Read this plugin's own configured settings through the secure runtime channel. | Medium |
| `plugin:settings:write` | Update this plugin's own settings through approved host APIs. | High |
| `suggestions:license:write` | Create reviewable suggestions for existing license records. | Medium |
| `suggestions:license_draft:write` | Create reviewable suggestions for a draft license before it is saved. | Medium |
| `suggestions:sourcing_item:write` | Create reviewable suggestions for sourcing items. | Medium |
| `suggestions:sourcing_quote_draft:write` | Create multi-line sourcing item suggestions from a parsed quote before saving. | Medium |
| `suggestions:pending_order_draft:write` | Create multi-line pending-order item suggestions from a parsed PO before saving. | Medium |
| `suggestions:pending_order_item:write` | Create reviewable suggestions for pending-order line items. | Medium |
| `suggestions:pending_order_conversion:write` | Create reviewable suggestions for pending-order conversion forms. | Medium |
| `actions:invoke` | Receive action invocation requests from LicenseTrack. Required for plugins with actions. | Low |

Permission review UI should show:

- permission name;
- plain-language explanation;
- why the plugin requested it, if provided in the manifest;
- whether the permission is high risk.

Core must check permissions both at install time and action invocation time.

## Plugin Settings

V1 should support core-rendered settings:

- text;
- password/secret;
- boolean;
- number;
- select;
- URL;
- textarea.

Secret settings:

- encrypted at rest;
- masked on read;
- never written to audit logs;
- preserved when the admin saves masked placeholders;
- optionally testable through plugin action hooks.

Settings UI should live under:

```text
Admin Settings -> Plugins -> {Plugin Name}
```

Not under the old Integration capability status list.

## UI Slots For V1

Start with a small number of high-value slots.

V1 slot catalog:

| Slot | Context target | Intended use |
| --- | --- | --- |
| `settings.plugins.panel` | `plugin` | Host-rendered plugin settings and diagnostics. This slot is reserved for core; plugins do not declare actions here in v1. |
| `document.row.actions` | `license_document` | Actions on an existing document row, such as requesting parsing. |
| `license.detail.actions` | `license` | Actions on an existing license record. |
| `license.add.review.actions` | `license_draft` | Actions during add-license review before a license is saved. |
| `sourcing.item.edit.actions` | `sourcing_item` | Actions inside a sourcing item edit workflow. |
| `sourcing.quote.add.actions` | `sourcing_quote_draft` | Actions during add-sourcing-request to parse an uploaded quote into multiple items. |
| `pendingOrder.add.actions` | `pending_order_draft` | Actions during add-pending-order to parse an uploaded PO into multiple items. |
| `pendingOrder.line.edit.actions` | `pending_order_item` | Actions inside a pending-order line edit workflow. |
| `pendingOrder.convert.actions` | `pending_order_conversion` | Actions during pending-order-to-license conversion. |

V1 context payloads are deliberately narrow:

| Target | Context fields |
| --- | --- |
| `license_document` | `targetType`, `targetId`, `documentId`, `licenseId`, `documentCategory`, `fileName`, `contentType`, `userRole`. |
| `license` | `targetType`, `targetId`, `licenseId`, `licenseFields`, `documentIds`, `userRole`. |
| `license_draft` | `targetType`, `draftId` or `stagedFileToken`, `draftFields`, `documentIds`, `detectedDocumentCategory`, `userRole`, `fileContentBase64`, `fileName`, `contentType`. |
| `sourcing_item` | `targetType`, `targetId`, `sourcingRequestId`, `sourcingItemId`, `itemFields`, `quoteDocumentIds`, `userRole`. |
| `sourcing_quote_draft` | `targetType`, `targetId`, `userRole`, `fileContentBase64`, `fileName`, `contentType`. |
| `pending_order_draft` | `targetType`, `targetId`, `userRole`, `fileContentBase64`, `fileName`, `contentType`. |
| `pending_order_item` | `targetType`, `targetId`, `pendingOrderId`, `lineItemId`, `lineFields`, `purchaseOrderDocumentIds`, `linkedSourcingContext`, `userRole`. |
| `pending_order_conversion` | `targetType`, `pendingOrderId`, `selectedLineItemIds`, `conversionDraftFields`, `documentIds`, `userRole`. |

Slot rules:

- Core owns layout and styling.
- Plugin declares label, action key, role, and optional icon name from an approved icon list.
- Core provides a typed context payload.
- Plugin returns a typed result.
- Core displays loading, success, warning, and error states.
- Core decides whether results are immediately applied, reviewed, or rejected.

## Action Invocation Contract

For v1 local HTTP runtimes, LicenseTrack starts the process with:

```text
LT_PLUGIN_KEY
LT_PLUGIN_VERSION
LT_PLUGIN_PORT
LT_PLUGIN_TOKEN
LT_PLUGIN_BASE_URL
LT_PLUGIN_SETTINGS_URL
LT_PLUGIN_DOCUMENTS_BASE_URL
LT_PLUGIN_LOG_DIR
```

The runtime must bind to `127.0.0.1:{LT_PLUGIN_PORT}` only. LicenseTrack sends `Authorization: Bearer {LT_PLUGIN_TOKEN}` on every request.

Health check:

```http
GET /health
Authorization: Bearer <token>
```

Health response:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "details": {}
}
```

Core action request:

```json
{
  "actionKey": "parseQuote",
  "handler": "parse_quote",
  "pluginKey": "licensetrack-ai",
  "requestId": "uuid",
  "actor": {
    "id": 1,
    "role": "admin"
  },
  "context": {
    "targetType": "sourcing_item",
    "targetId": 123,
    "documentIds": [456]
  }
}
```

Plugin success response:

```json
{
  "status": "ok",
  "summary": "Detected 3 license lines.",
  "suggestions": [
    {
      "targetType": "sourcing_item",
      "targetId": 123,
      "fields": [
        {
          "field": "publisherName",
          "value": "Example Publisher",
          "confidence": 0.91,
          "source": "Page 1"
        }
      ],
      "lineItems": []
    }
  ],
  "rawOutput": {}
}
```

Plugin error response:

```json
{
  "status": "error",
  "error": {
    "code": "provider_unavailable",
    "message": "The provider could not be reached.",
    "retryable": true,
    "details": {}
  }
}
```

Timeout behavior:

- Startup health must pass within `startupTimeoutSeconds`.
- Each action must return before its effective `timeoutSeconds`.
- Timeout results are recorded as controlled plugin errors and surfaced to the user without retrying automatically.
- Runtime logs are redacted for known setting keys and bounded before display.

Core then creates reviewable suggestion records. The plugin does not directly mutate sourcing, pending order, or license data.

## Suggestion And Review System

V1 needs a generic suggestion model beyond license document processing.

Recommended targets:

```text
license
license_draft
sourcing_item
sourcing_quote_draft
pending_order_draft
pending_order_item
pending_order_conversion
```

Generic suggestion object:

```json
{
  "targetType": "license",
  "targetId": 123,
  "summary": "Suggested publisher and renewal date.",
  "confidence": 0.88,
  "fields": [
    {
      "field": "publisherName",
      "value": "Example Publisher",
      "confidence": 0.91,
      "source": "Page 1",
      "note": "Matched quote header."
    }
  ],
  "lineItems": [],
  "rawOutput": {}
}
```

Each target needs:

- field allowlist;
- value validation;
- current-vs-suggested review UI;
- selected-field accept/reject;
- audit detail;
- apply service that uses normal core write paths.

For AI document parsing, this unlocks:

- parse quote from sourcing item;
- fill missing sourcing fields;
- propose additional sourcing line items;
- parse PO from pending-order line;
- enrich pending order conversion fields;
- upload document in Add License and generate a draft license review.

## Admin UI Roadmap

### Plugins List

Admin Settings should include a Plugins page or section:

- installed plugins;
- version;
- publisher;
- enabled/disabled;
- compatibility;
- health;
- last error;
- actions: install, enable, disable, update, uninstall, view logs.

### Install Flow

1. Admin uploads `.zip`.
2. Backend validates package and manifest.
3. UI shows install review:
   - plugin identity;
   - publisher;
   - version;
   - compatibility;
   - requested permissions;
   - settings that will be created;
   - UI slots/actions that will be added;
   - runtime type;
   - warnings.
4. Admin confirms.
5. Backend stores package, registry row, settings definitions, permissions, and runtime metadata.
6. Plugin starts disabled or enabled depending on policy. Recommended: installed but disabled until required settings are configured.

### Settings Flow

1. Admin opens plugin settings.
2. Core renders settings from manifest.
3. Admin enters required values.
4. Core stores settings.
5. Optional plugin health/test action runs.
6. Plugin becomes enable-ready.

### Enable Flow

1. Admin enables plugin.
2. Core starts runtime.
3. Core checks health.
4. Core registers declared capabilities.
5. Core exposes actions in declared slots.

## Backend Roadmap

### Phase 1: Data Model

Status: Done. The metadata-only plugin registry tables and service tests are implemented; package upload and runtime execution remain later phases.

Add tables for:

- installed plugins;
- plugin package versions;
- plugin permissions;
- plugin settings definitions;
- plugin settings values;
- plugin actions;
- plugin runtime status;
- plugin audit/log entries;
- generic suggestions.

### Phase 2: Package Intake

Add backend service for:

- upload validation;
- zip inspection;
- safe extraction;
- manifest discovery;
- manifest schema validation;
- compatibility validation;
- install preview response.

### Phase 3: Install/Enable Lifecycle

Add routes/services for:

- install plugin;
- list plugins;
- get plugin detail;
- update plugin;
- enable plugin;
- disable plugin;
- uninstall plugin;
- read plugin logs/health.

### Phase 4: Settings

Status: Done. Settings read/update APIs, secret masking/preservation, encrypted secret storage, misconfiguration checks, audit logging, and the Admin Settings renderer are implemented.

Add routes/services for:

- render settings metadata;
- read settings with masking;
- update settings;
- encrypt secrets;
- audit setting changes.

### Phase 5: Runtime Manager

Status: Done for the implementation-plan Phase 6 managed runtime slice. Start/stop/restart, health checks, timeout handling, log capture, token injection, and redacted log reads are implemented and are wired into Phase 5 lifecycle controls.

Add runtime management for:

- start worker;
- stop worker;
- restart worker;
- health check;
- timeout handling;
- log capture;
- action invocation.

### Phase 6: UI Slots And Actions

Status: Done for the full v1 slot catalog. `document.row.actions`, `sourcing.item.edit.actions`, `sourcing.quote.add.actions`, `pendingOrder.add.actions`, `pendingOrder.line.edit.actions`, `pendingOrder.convert.actions`, and `license.add.review.actions` are implemented through plugin action discovery/invocation APIs and the frontend `PluginSlot`. The two new draft slots support multi-item suggestions that populate line items before the PO or sourcing request is saved.

Add backend action registry and frontend slot renderers for:

- document row actions;
- Add License review actions;
- Sourcing item edit actions;
- Pending order line edit actions;
- Pending order conversion actions.

### Phase 7: Suggestions

Status: Done for license application and pending suggestion storage across v1 targets. Procurement, pending-order, conversion, and draft-license apply services remain target-specific follow-up work.

Generalize document-processing results into plugin suggestions:

- suggestion create;
- list by target;
- accept selected fields;
- reject;
- supersede;
- apply through existing domain services;
- audit.

Implemented Phase 8 slice:

- `plugin_suggestions` persistence with source plugin/action, target type/id, status, fields, line-item proposals, raw output, and reviewer metadata.
- Runtime action outputs with a `suggestions` array create pending suggestions and return `suggestionsCreated`.
- Target-specific suggestion permissions are enforced before suggestion records are created.
- `license` target allowlist validation rejects unknown, lifecycle, and internal fields.
- Phase 9 target allowlists store pending suggestions for `license_draft`, `sourcing_item`, `pending_order_item`, and `pending_order_conversion` without mutating business data.
- Selected accepted fields apply through `license_write_service.py` and `custom_fields_service.py`.
- Review UI shows current versus suggested values, confidence/source/note, selected fields, line-item proposals, and accept/reject controls.

## Frontend Roadmap

### Phase 1: Admin Plugin UI

- Plugins list.
- Upload/install modal.
- Install review screen.
- Permission review display.
- Plugin detail page.
- Enable/disable/uninstall actions.
- Plugin settings renderer.
- Runtime health/log display.

### Phase 2: Slot Renderer

Create a generic slot renderer:

```text
PluginSlot slot="sourcing.item.edit.actions" context={...}
```

The slot renderer:

- fetches available actions for the slot and context;
- renders native LicenseTrack buttons;
- handles loading/error states;
- invokes action API;
- forwards results to the review UI.

### Phase 3: Review UI

Create shared suggestion review components:

- current vs suggested fields;
- confidence/source/note display;
- selected-field accept;
- reject;
- multi-line-item proposal review.

## Security Roadmap

V1 security requirements:

- package size limits;
- safe zip extraction;
- manifest schema validation;
- compatibility checks;
- explicit admin permission approval;
- disabled-by-default on install if required settings are missing;
- encrypted secret settings;
- internal plugin identities instead of visible API tokens;
- runtime action timeouts;
- runtime health checks;
- plugin process isolation;
- no arbitrary frontend code execution;
- no direct database writes;
- audit everything.

Optional but recommended:

- package checksum display;
- signature field in manifest;
- trusted publisher list;
- “untrusted plugin” warning;
- package SBOM support;
- offline install notes.

## Deployment Constraints

These are host-level constraints operators must observe when running Plugin Host v1.

**Single-worker requirement.** Managed plugin state (subprocess handles, bearer tokens, per-action document scopes) is in-process. LicenseTrack must run with exactly one Uvicorn worker (`--workers 1`, the default). Multiple workers partition plugin state invisibly: one worker starts a subprocess and records its bearer token; a second worker cannot find it and rejects all runtime requests from that plugin with 401. Do not set `--workers > 1` in Docker, systemd, or any other process manager. See `docs/DEPLOY.md` for Docker Compose notes.

**Python-only entrypoints.** Only `.py` entrypoints are supported in v1. The host rejects a plugin at enable time if `runtime.entrypoint` does not end in `.py`. Plugin authors must not declare `.sh`, `.exe`, or any other executable type.

**Document size limit.** The host enforces `MAX_PLUGIN_DOCUMENT_SIZE_MB` (default 10 MB) on documents served to plugin runtimes via the content endpoint. Plugins must handle the case where a document ref is present but its content URL returns an error. Operators can raise the limit in their deployment configuration.

**Plugin storage persistence.** Installed plugin packages are extracted to `PLUGIN_STORAGE_PATH` (default `/data/plugins`). This path must be on a persistent volume alongside `/data/storage` and `/data/backups`. Without a persistent volume, installed plugins are lost on container restart and must be reinstalled.

## V1 Acceptance Criteria

Plugin Host v1 is ready when:

- an admin can upload a plugin zip;
- LicenseTrack finds and validates exactly one `.ltplugin` manifest;
- the install screen clearly shows identity, compatibility, permissions, settings, actions, and warnings;
- the plugin can be installed, configured, enabled, disabled, updated, and uninstalled;
- required settings are rendered by LicenseTrack and secrets are stored encrypted;
- plugin actions appear only in declared, core-approved slots;
- action invocation works through the managed runtime;
- plugin output becomes reviewable suggestions;
- accepted suggestions apply through normal core services;
- all install/settings/action/review events are audited;
- disabling the plugin removes its visible actions without deleting business records;
- uninstalling the plugin leaves historical audit and suggestion records readable;
- no plugin can inject arbitrary frontend code or write directly to the database.

## Suggested V1 Delivery Order

1. Manifest schema and package inspection service.
2. Plugin registry and install preview UI.
3. Install/enable/disable/uninstall lifecycle.
4. Plugin settings renderer with encrypted secrets.
5. Managed process runtime and health checks.
6. Action invocation API.
7. First UI slot: `document.row.actions`.
8. Generic suggestion model for license targets.
9. Procurement modal slots:
   - `sourcing.item.edit.actions`
   - `pendingOrder.line.edit.actions`
   - `pendingOrder.convert.actions`
10. Draft license/add-license slot:
   - `license.add.review.actions`
11. Convert `licensetrack-ai` from sidecar setup to installable zip package.

This sequence gives the host a working end-to-end path early, then expands into the modal-based AI parser experience.
