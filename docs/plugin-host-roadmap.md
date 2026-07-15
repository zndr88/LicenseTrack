# Plugin Host Post-V1 Notes

> Status: Plugin Host v1 is shipped. This file is retained for existing links and for future-direction notes. For the current author contract, use `docs/plugin-author-guide.md`. For the shipped v1 platform contract, use `docs/plugin-host-v1-roadmap.md`.

LicenseTrack's extensibility has two layers:

- **Integration Framework:** API tokens, webhooks, declared capabilities, document actions, and document-processing results.
- **Plugin Host v1:** installable packages, managed runtimes, encrypted settings, core-rendered UI slots, and generic suggestions.

Baseline LicenseTrack deployments do not require plugins. API/webhook integrations remain the simplest path for private automation and externally hosted connectors. The Plugin Host exists for packages that should feel installable to operators while still keeping LicenseTrack in control of permissions, validation, audit logging, UI placement, and final data writes.

## Current V1 Model

Plugin Host v1 supports:

- admin-uploaded `.zip` packages containing one root `.ltplugin` manifest;
- manifest validation for identity, compatibility, permissions, settings, capabilities, UI slots, and runtime declaration;
- disabled-by-default installation with admin permission review;
- plugin-owned settings panels rendered by LicenseTrack, including masked and encrypted secrets;
- managed local Python runtimes with health checks, bounded logs, restart, and shutdown;
- core-rendered action slots in approved document, license, sourcing, and pending-order workflows;
- plugin action invocation through backend contracts;
- generic suggestions that reviewers accept or reject through core services;
- audit records for install, enable, disable, uninstall, settings, action, runtime, and suggestion events.

Plugin Host v1 intentionally does not support:

- marketplace discovery or automatic internet download;
- arbitrary frontend JavaScript injection;
- remote frontend bundles;
- plugin modification of compiled React code;
- direct plugin database writes;
- plugin-created database migrations;
- plugin-defined arbitrary pages;
- multiple runtime types inside one plugin package;
- cross-plugin dependencies.

The first-party LicenseTrack AI companion plugin is a work in progress. Release of the AI plugin is pending, and it is not bundled with baseline LicenseTrack.

## Why API Integrations Still Matter

The Integration Framework remains useful even with Plugin Host v1:

- API tokens support private scripts, reports, migrations, and external services.
- Webhooks support event-driven ticketing, notification, sync, and audit pipelines.
- Document processor sidecars can run outside LicenseTrack when an operator wants full control over hosting.
- Capability records can expose integration or plugin status without loading code into LicenseTrack.

The difference is operator experience. API/webhook integrations are assembled by technical operators. Installable plugins package settings, permissions, UI slots, and runtime wiring behind an Admin Settings flow.

## Post-V1 Directions

These ideas are intentionally separate from the shipped v1 contract:

- marketplace or community plugin metadata;
- package signing and trusted publisher workflows;
- richer compatibility tooling before upgrades;
- more granular service-account identities and scopes;
- typed event schemas and versioned event catalogs;
- additional core-rendered slots for export, reporting, contracts, and renewal workflows;
- richer suggestion targets where core has safe review/apply services;
- optional package SBOM display;
- sandboxed frontend component slots, if the host later needs custom plugin UI;
- additional runtime types after the Python runtime has proven stable.

Future work should preserve the v1 safety model: core owns authorization, validation, audit logging, review UI, final writes, and uninstall behavior. Plugins may propose work, expose actions, and run external/provider-specific logic, but they should not bypass core services.
