# Internal Official Extensions Host Contract

This is an internal implementation contract for LicenseTrack maintainers. It
does not freeze a public third-party plugin API.

## Boundary

The host is reserved for Official Extensions published and signed by the
LicenseTrack project. Stable deployments default it off. When enabled outside
developer mode, install and runtime lifecycle require a verified package.

The host provides package inspection, signature verification, registry and
version history, encrypted settings, declared access, managed Python runtimes,
core-rendered action slots, reviewable suggestions, audit events, and lifecycle
controls. Internal database names, `plugin_*` modules, and `/api/plugin-*` paths
remain intentionally unchanged to avoid churn.

The host does not provide arbitrary React or DOM injection, extension-owned
pages, extension database migrations, or a public marketplace. It also does
not provide hostile-code isolation. Managed processes use the LicenseTrack OS
identity and can access resources available to that account.

## Trust states

- `verified`: signature matched a pinned LicenseTrack release key; eligible to
  enable when compatible and configured.
- `developer`: installed while developer mode was active; never official and
  eligible to run only while developer mode remains active.
- `unverified`: signature missing, invalid, unknown, or predating the trust
  migration; never eligible to run.

Trust metadata includes the signer key ID, canonical signer identity, complete
package checksum, signed-content digest, and verification time. Self-declared
publisher metadata does not affect trust.

Existing unsigned installations migrate to `unverified`, disabled state.
Actions and runtime status are stopped while settings, version rows, audit
history, and suggestions remain intact.

## Runtime safeguards

- single Uvicorn worker while the host is enabled;
- Python-only managed process entrypoints;
- explicit inherited-environment allow-list;
- loopback runtime port and per-process callback token;
- settings and document callbacks gated by declared access;
- per-action document scope and size limit;
- bounded/redacted logs and action timeouts;
- platform-appropriate process-group/tree termination on disable/uninstall.

These are proportionate controls for trusted code and must not be documented as
a sandbox, container boundary, or guarantee that extensions cannot reach the
database.

## Core ownership

Core owns user authorization, viewer scope, target lookup, document scoping,
audit logging, user confirmation, suggestion validation, and final writes
through normal services. Official Extensions may propose work and provide
actions, but must not add extension-specific bypasses around core invariants.
