# Integration Framework And Plugin Roadmap

LicenseTrack is intended to be a software license procurement and lifecycle platform. The core product owns the opinionated process for sourcing, purchase orders, evidence, license records, renewals, contracts, audit history, and reporting. Other systems can connect to that platform through documented integration contracts.

This document covers both the **Integration Framework** (always available, API/webhook-based) and the **Plugin Host v1** (installable packages, managed runtimes, core-rendered slots).

## Current State

LicenseTrack supports two extensibility layers.

### Integration Framework

API- and webhook-based integrations for technical users, automation, private connectors, and sidecar services:

- API tokens for machine-to-machine access;
- documented API routes for license, procurement, document, report, and related workflows;
- import/export contracts;
- webhook endpoints for audited event delivery;
- extension capability declarations such as `document.processing`;
- core-rendered document actions, currently `request_processing`;
- document processing result intake, review, accept, reject, and supersede behavior.

### Plugin Host V1

Installable plugin packages for adding settings, actions, and workflow UI through core-defined slots:

- upload a `.zip` package from Admin Settings;
- validate and install the package with admin permission review;
- enable/disable/uninstall lifecycle with full audit trail;
- core-rendered plugin settings panels with encrypted secret storage;
- managed local process runtimes with health checks and bounded logs;
- plugin action discovery and invocation in approved core UI slots;
- generic suggestion/review/apply flows for license, sourcing, and procurement targets.

The Plugin Host v1 does **not** support:

- marketplace-style plugin discovery or internet auto-download;
- runtime React plugin loading or arbitrary frontend JavaScript;
- remote frontend bundles or arbitrary DOM injection;
- plugin-created database migrations or direct database writes;
- plugin-defined arbitrary pages.

The `/api/extensions/capabilities/{key}` registry is a status and discovery surface for both integrations and installed plugins. It does not load third-party code into LicenseTrack.

## Naming Guidance

Use these terms consistently:

| Term | Meaning |
| --- | --- |
| API integration | External script, service, or system using supported API routes. |
| Webhook integration | External receiver reacting to LicenseTrack audit/business events. |
| Document processor | External service that inspects selected documents and submits proposed extracted values. |
| Extension capability | A declared capability/status record, not loaded code. |
| Installable plugin | Packaged unit installed via Admin Settings; LicenseTrack manages installation, settings, permissions, UI slots, and lifecycle. Supported in v1. |
| Plugin host | The LicenseTrack subsystem that manages plugin manifests, settings, permissions, runtime processes, UI slots, and lifecycle. V1 is shipped. |

Avoid using “plugin” for API/webhook sidecars unless you explicitly clarify they are integration-style sidecars, not installable plugin packages.

## API Integrations

API integrations are external systems, scripts, or services that read from or write to LicenseTrack through supported API routes.

Examples:

- synchronizing selected CMDB fields into license records;
- exporting portfolio data for Flexera, Snow, or reporting tools;
- creating sourcing requests from an internal procurement workflow;
- uploading procurement evidence from a document management system;
- reconciling LicenseTrack data with Lansweeper or ServiceNow records.

API integrations are the preferred starting point for company-specific needs. They can be private, operator-owned, and maintained outside the LicenseTrack repository.

Start with `docs/build-integrations.md` for integration-author guidance, scope selection, and operational expectations. Common API integration flows are documented in `docs/integration-recipes.md`.

## Webhook Integrations

Webhook event notifications are documented in `docs/webhooks.md`. Use them when an integration needs to react to LicenseTrack changes instead of polling.

Webhook endpoints are admin-managed integration endpoints. They are useful for ticket creation, notification relays, sync jobs, and document processor sidecars. They are not a plugin installation mechanism.

## Document Processors

Document actions are documented in `docs/document-actions.md`. Use them when an operator should intentionally request work from an external processor against a specific uploaded document. Document processor authoring is covered in `docs/build-document-processor.md`.

Document processors should submit extracted values as pending document processing results. Core treats those values as proposals until an editor or admin reviews them. Reviewers can compare current and suggested values, apply selected supported built-in license fields and existing custom fields through core update paths, or reject the result without changing license data. If the same processor submits a newer pending result for the same document, older pending results are marked superseded.

Current document processing is license-record oriented. It does not yet provide generic review/apply targets for sourcing items, pending-order line items, draft licenses, or multi-line quote creation.

## Core Contributions

Features that are broadly useful, fit the core procurement workflow, and can be maintained as part of the main product may be submitted as pull requests. Once accepted, they become part of LicenseTrack and are distributed under the repository's contribution terms.

If a feature is company-specific, depends on a private system, or needs separate licensing, keep it as an API/webhook integration unless a generic plugin host capability exists.

Do not add plugin-specific code paths to core workflows without first defining a generic extension point. For example, prefer “modal action slot for document processors” over “hard-code an Anthropic Parse Quote button.”

## First-Party Integrations And Plugins

The project may provide optional first-party integrations or installable plugins over time. Likely candidates include:

- AI-assisted document parsing with bring-your-own provider credentials (the `licensetrack-ai` reference plugin is already packaged as an installable v1 plugin);
- native Lansweeper integration;
- Flexera export or integration helpers;
- ServiceNow or CMDB-oriented synchronization helpers.

First-party plugin work should use the same public Plugin Host contracts available to third-party plugin authors. This keeps core stable and avoids hidden privileges.

The repository includes `examples/licensetrack-ai-sidecar.py` as a non-AI smoke-test sidecar for the document-processing loop. It verifies webhook signatures, downloads the selected document through the API, and posts fake suggestions back for review. Treat it as an integration scaffold reference, not an installable plugin package.

## AI And External Providers

AI-assisted parsing is intentionally optional, not a core dependency. A baseline LicenseTrack deployment should not require AI provider credentials, expose AI-specific UI, or send documents to an external AI service.

When an AI document processor or future AI plugin is installed, operators remain responsible for deciding whether documents may be sent to the selected provider. Documentation should clearly state:

- what data is sent;
- which provider receives it;
- where credentials are stored;
- whether prompts, files, or results are retained;
- how proposed changes are reviewed before being written to LicenseTrack.

Bring-your-own API keys reduce LicenseTrack project infrastructure cost and avoid routing customer data through project-operated infrastructure. They do not remove the operator's responsibility to assess provider terms, data protection requirements, and internal policy.

## Compatibility Expectations

Private integrations are maintained by their owners. Operators should test them before upgrading LicenseTrack.

Integration authors should:

- target documented stable APIs where possible;
- declare the LicenseTrack versions they support;
- avoid depending on private frontend internals or undocumented response fields;
- handle API errors and permission failures explicitly;
- preserve LicenseTrack's audit and review expectations for data-changing workflows;
- restrict document processing suggestions to patchable license fields and existing custom fields; lifecycle repair fields (`lifecycle_status`, `renewed_from_id`, `renewed_to_id`, `predecessor_id`, `coterm_from_ids`, `commitment_id`, `commitment_year`), procurement conversion state, and internal identity fields such as `id` and `license_ref` are never accepted and will fail the accept call.

`license_ref` is a chain identity shared across a renewal successor chain, not a unique row key. Integrations that need to reference a specific database row should record the `id` from API responses. `license_ref` is read-only and cannot be set through any integration or document-processing patch path.

Core LicenseTrack should provide deprecation notice for stable API changes according to `docs/api-stability.md`.

## Contribution Decision Guide

Use this guide when deciding where a feature belongs:

| Need | Best fit today |
| --- | --- |
| Company-specific automation or private system connection | API integration |
| External system reacting to LicenseTrack events | Webhook integration |
| Operator-triggered parsing of a supported uploaded document | Document processor sidecar |
| Broad product feature that most operators benefit from | Core contribution |
| Experimental idea that may change quickly | Private integration |
| Installable package that adds settings, actions, and workflow UI | Plugin Host v1 (shipped) — see `docs/plugin-author-guide.md` |
| Runtime UI component injection into the React app | Not currently supported |

## Plugin Host V1

The Plugin Host v1 is a separate platform layer above the Integration Framework, shipped in LicenseTrack v1.0.0. It makes plugins feel closer to browser or editor extensions: install a package, approve permissions, configure settings, and see approved UI/actions appear in LicenseTrack.

The v1 design and scope are documented in `docs/plugin-host-v1-roadmap.md`. Plugin author guidance is in `docs/plugin-author-guide.md`.

Delivered building blocks:

- admin-uploaded plugin zip packages containing a root `.ltplugin` manifest;
- plugin manifest with key, version, compatibility, capabilities, permissions, settings, and UI slots;
- plugin registry with installed/enabled/disabled state and version history;
- admin-managed plugin settings with encrypted secret storage and masking;
- plugin permission grants approved by an admin;
- core-rendered UI slots (`document.row.actions`, `license.detail.actions`, `license.add.review.actions`, `sourcing.item.edit.actions`, `pendingOrder.line.edit.actions`, `pendingOrder.convert.actions`);
- action invocation contracts between core and plugin runtime;
- generic suggestion/review/apply flows for licenses, sourcing items, pending-order line items, draft licenses, and pending-order conversions;
- managed local process runtimes with health checks, bounded redacted logs, and startup/shutdown lifecycle;
- upgrade, uninstall, health, and log surfaces.

Core-rendered UI and isolated plugin workers are the v1 model. Plugins can add visible buttons and settings while LicenseTrack keeps control of permissions, audit logging, validation, and final data mutation.

## Current Foundation

The framework foundation supports:

1. API tokens for machine-to-machine access.
2. Webhooks for audited event delivery.
3. Extension capability declarations for availability and health.
4. A core-rendered document action for selected uploaded documents.
5. Document processing result intake, review history, selected-field accept, reject, and supersede behavior.
6. Example scripts and sidecar scaffolds under `examples/`.
7. Author guidance in `docs/build-integrations.md`, `docs/build-document-processor.md`, and `docs/extension-author-checklist.md`.
8. Plugin Host v1: installable packages, managed runtimes, core-rendered slots, encrypted settings, and generic suggestions. See `docs/plugin-host-v1-roadmap.md` and `docs/plugin-author-guide.md`.

## Roadmap

The following work is intentionally separate from the current foundation:

- dedicated service-account identities;
- more granular integration scopes;
- typed event schema registry;
- versioned `/api/v1` namespace;
- marketplace/community plugin metadata and online discovery;
- additional import/export extension points;
- sandboxed custom React component slots (post-v1 plugin host).
