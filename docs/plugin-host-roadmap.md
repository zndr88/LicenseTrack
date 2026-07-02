# Plugin Host Roadmap

> **Status (as of v0.9.9):** Plugin Host v1 is shipped. The First Milestone listed at the bottom of this document is complete. See `docs/plugin-host-v1-roadmap.md` for the delivered scope and `docs/plugin-author-guide.md` for the author contract.

LicenseTrack's extensibility has two layers: an Integration Framework (API tokens, webhooks, declared capabilities, document actions, and document-processing results) and the Plugin Host v1 (installable packages, managed runtimes, core-rendered slots, generic suggestions).

This roadmap describes the Plugin Host concept and outlines post-v1 directions. For the concrete v1 release plan, including the uploadable `.zip` package and `.ltplugin` manifest flow, see `docs/plugin-host-v1-roadmap.md`.

## Goal

An admin should be able to install a plugin without manually creating API tokens, webhook secrets, `.env` files, or capability records.

Target operator flow:

1. Download or obtain a plugin package.
2. Install it from Admin Settings or a command-line installer.
3. Review plugin identity, version, compatibility, and requested permissions.
4. Enable the plugin.
5. Configure plugin settings in LicenseTrack.
6. Use plugin-provided actions in approved LicenseTrack UI slots.

Example outcomes:

- An AI parser plugin adds “Parse Quote” to a sourcing item action slot and “Parse Document” to add-license intake.
- A Flexera connector adds reconciliation/export actions and settings for Flexera API credentials.
- A ServiceNow connector adds sync actions and stores external reference mappings.

## Non-Goals For The First Plugin Host

The first Plugin Host should avoid arbitrary frontend injection.

Do not start with:

- plugins editing the compiled React app;
- plugins injecting arbitrary DOM changes;
- remote JavaScript bundles with unrestricted access;
- plugin-specific hard-coded core UI;
- direct plugin writes to critical database tables.

The safer model is: plugins declare capabilities, settings, and actions; LicenseTrack renders native UI and invokes plugin actions through documented contracts.

## Core Concepts

### Plugin Package

A package such as `.ltpkg` could be a signed zip containing:

```text
plugin.json
backend/
frontend/        # optional later, only for approved/sandboxed surfaces
migrations/      # optional later, heavily restricted
README.md
LICENSE
```

### Plugin Manifest

The manifest should describe what the plugin is and what it wants to do.

```json
{
  "key": "licensetrack-ai",
  "name": "LicenseTrack AI",
  "version": "0.1.0",
  "publisher": "LicenseTrack",
  "licenseTrackVersion": ">=1.1 <2.0",
  "permissions": [
    "documents:read",
    "license-suggestions:write",
    "sourcing-suggestions:write",
    "pending-order-suggestions:write"
  ],
  "settings": [
    {
      "key": "anthropicApiKey",
      "label": "Anthropic API Key",
      "type": "secret",
      "required": true
    }
  ],
  "uiSlots": [
    {
      "slot": "sourcing.item.edit.actions",
      "action": "parseQuote",
      "label": "Parse Quote"
    },
    {
      "slot": "pendingOrder.line.edit.actions",
      "action": "parsePurchaseOrder",
      "label": "Parse PO"
    },
    {
      "slot": "license.add.review.actions",
      "action": "parseDocument",
      "label": "Parse Document"
    }
  ]
}
```

### Plugin Registry

Core should track:

- plugin key;
- name;
- publisher;
- installed version;
- compatibility status;
- enabled/disabled state;
- granted permissions;
- health;
- install/update timestamps;
- last error.

### Plugin Settings

Settings should be stored by plugin key and setting key. Secret settings should be encrypted or delegated to an operator-managed secret store. Admin APIs should mask secrets on read and audit changes without logging raw values.

### UI Slots

Core should define slots before plugins can appear in workflows. Examples:

- `settings.integrations.panels`
- `document.row.actions`
- `license.detail.panels`
- `license.add.review.actions`
- `sourcing.item.edit.actions`
- `pendingOrder.line.edit.actions`
- `pendingOrder.convert.actions`
- `reports.export.actions`

Slots should define:

- allowed action types;
- required user roles;
- available context payload;
- loading/error behavior;
- how results are reviewed or applied.

### Action Invocation

Core should invoke plugin actions through a documented contract:

```text
Core UI action -> backend action invocation -> plugin worker -> structured result -> core review/apply flow
```

Plugin actions should return proposed changes, not mutate core data directly.

### Suggestion Targets

The current document-processing result model targets license records. The Plugin Host needs generic suggestion targets:

- `license`
- `license_draft`
- `sourcing_item`
- `sourcing_request`
- `pending_order_item`
- `pending_order`
- possibly `contract`

Each target needs its own allowlist, validation, review UI, and apply service.

## Runtime Options

### Recommended First Runtime: Managed Worker/Sidecar

LicenseTrack installs or configures the plugin, then starts or calls an isolated plugin worker. Core renders UI and handles final writes.

Benefits:

- safer failure isolation;
- fewer dependency conflicts;
- no arbitrary frontend code;
- suitable for stricter environments;
- still gives users visible plugin buttons and settings.

Tradeoff:

- UI customization is limited to core-provided slots and native components.

### Later Runtime: Sandboxed Frontend Contributions

If needed, plugins could later ship frontend components for narrowly scoped slots. This requires signing, sandboxing, compatibility checks, dependency rules, and stronger review.

## Security Principles

- Admins must approve requested permissions before enabling a plugin.
- Plugins should receive only the context and access they need.
- Core owns authentication, authorization, department scoping, validation, audit logging, and final writes.
- Plugins should submit proposed changes or action results.
- Core should apply accepted changes through normal services.
- Plugin install, enable, disable, settings changes, action invocations, and failures should be auditable.
- Uninstalling a plugin should not destroy core business data without explicit admin action.

## Relationship To The Current Integration Framework

The current framework remains useful even after a Plugin Host exists:

- API tokens still support technical automation and external integrations.
- Webhooks still support event-driven systems.
- Document processors can remain sidecars.
- Capability records can become health/status declarations for installed plugins.

The difference is operator experience. Today, admins manually assemble tokens, webhooks, settings, and sidecars. In the Plugin Host future, LicenseTrack manages that wiring for installable plugins.

## First Milestone (Complete)

The first milestone is complete as of v0.9.9:

1. ✅ Plugin registry table and Admin Settings section.
2. ✅ Manifest parser and compatibility validation.
3. ✅ Plugin settings storage with secret support.
4. ✅ Core-rendered settings panels from manifest declarations.
5. ✅ Core-rendered action slots for document rows and procurement modals.
6. ✅ Action invocation API.
7. ✅ Generic suggestion targets for `license`, `license_draft`, `sourcing_item`, `pending_order_item`, and `pending_order_conversion`.
8. ✅ Managed worker/sidecar runtime with health checks and logs.

Plugins are installable and visible without arbitrary frontend code injection. Post-v1 directions are described above.
