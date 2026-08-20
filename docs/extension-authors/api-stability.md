# API Stability Policy

LicenseTrack's integration story depends on predictable API behavior. This document defines how API routes should be treated by maintainers and integration authors.

The API is currently unversioned: routes use `/api/...`, not `/api/v1/...`.
Integration compatibility is therefore declared against LicenseTrack application
versions. This policy defines which unversioned surfaces are supported contracts
and how breaking changes are handled.

## Stability Levels

### Stable

Stable API routes are intended for operator-built integrations and first-party
clients. They should preserve request and response compatibility within a
release line unless a security or data-integrity issue requires a breaking
change.

Stable routes should have:

- documented purpose and payload shape;
- route or service-level tests for important behavior;
- clear authorization requirements;
- audit logging for data-changing operations where applicable.

### Experimental

Experimental routes are usable but may change while the workflow is still being
shaped. They can support early first-party integrations or internal pilots, but
integration authors should expect compatibility churn.

Experimental routes should be marked as such in documentation before they are promoted to stable.

### Internal

Internal routes or response fields are implementation details. They are not supported integration contracts. Frontend-only assumptions, private helper routes, compatibility aggregators, and undocumented fields should be treated as internal unless documented otherwise.

## Current Contract Classification

The supported route catalog lives in `docs/extension-authors/api-reference.md`.
Within that catalog, the following route families are stable unless an endpoint
is explicitly marked experimental or session-only:

| Area | Route family | Stability |
| --- | --- | --- |
| Licences and renewals | `/api/licenses/*`, `/api/renewals/*` | Stable where listed in the API reference |
| Licence and procurement documents | `/api/licenses/{id}/documents`, `/api/documents/*`, `/api/procurement-documents/*` | Stable with documented scope and permission rules |
| Sourcing | `/api/sourcing/*` | Stable where listed in the API reference |
| Pending orders | `/api/pending-orders/*` | Stable where listed in the API reference |
| Contracts | `/api/contracts/*` | Stable where listed in the API reference |
| Reports | `/api/reports/*` | Stable read-only contract |
| Custom fields | `/api/custom-fields/*`, `/api/licenses/{id}/custom-fields/*` | Stable field-key and typed-value contract |
| Import metadata and workflows | `/api/import/*` | Stable where listed in the API reference |
| Extension capabilities | `/api/extensions/capabilities/*` | Experimental declaration/status registry |
| Document actions | `/api/document-actions/*` | Experimental operator-triggered integration point |
| Document processing results | `/api/document-processing-results/*` | Experimental result intake and review surface |
| Webhook delivery | signed payload and headers | Experimental event surface; management routes remain session-only |

Procurement history reads are part of the sourcing and pending-order route families. `GET /api/sourcing/requests/history` and `GET /api/pending-orders/history` expose converted/cancelled reference records. `GET /api/licenses/{id}/procurement-trail` is part of the license route family and exposes the stored source sourcing and pending-order links for a converted license.

The following areas are session-only or internal and are not public API-token
contracts unless the API reference explicitly says otherwise:

- admin-only global settings mutation shapes;
- database backup and restore routes;
- compatibility aggregator modules;
- hidden or parked commitment workflows;
- frontend component structure and React module paths.

## Breaking Changes

A breaking change includes:

- removing a stable route;
- changing a stable route path or HTTP method;
- renaming or removing a documented request or response field;
- changing documented enum values;
- changing authorization requirements in a way that prevents an existing valid integration from working;
- changing pagination, filtering, sorting, or export semantics in a documented stable route;
- changing error status codes or error response shapes relied on by documented recipes.

The following are not usually breaking changes:

- adding a new optional response field;
- adding a new optional request field with a default;
- adding a new route;
- tightening validation for security or data-integrity reasons;
- fixing behavior that contradicted documentation.

Reference-data-backed responses may include additive canonical ID fields while
existing name-based request fields remain supported. Integrations should treat
IDs as authoritative when present and continue sending name-compatible values to
existing payload fields; legacy mirror spelling must not be used to infer a
different organization or cost centre.

## Deprecation Policy

When a stable API needs to change, maintainers should:

1. Document the old and replacement behavior.
2. Keep the old behavior available for at least one minor release where practical.
3. Add release notes calling out the deprecation.
4. Include migration guidance for integration authors.
5. Add or update tests around the replacement contract.

Security fixes, data-corruption fixes, and severe authorization bugs may require immediate breaking changes. In those cases, release notes should explain the reason.

## Versioning Expectations

Until a versioned API path exists, integrations should declare compatibility by LicenseTrack application version or release range and be tested by their owners before upgrades.

Example:

```text
Compatible with LicenseTrack 1.0.x
Requires stable license, document, and pending-order APIs
```

If a future `/api/v1` path is introduced, this policy will define how long old API versions remain supported.

## Auth For Integrations

Session-based authentication is suitable for the web application. Long-running integrations should use API tokens with:

- scoped permissions;
- hashed token storage;
- revocation;
- last-used tracking;
- audit logging;
- clear ownership by an admin user.

See `docs/extension-authors/api-auth.md` for the current token model, scopes, and limitations. Dedicated service-account identities remain a future refinement.

## Maintainer Checklist

Before marking an API route stable:

- document the request, response, permissions, and error behavior;
- add or verify endpoint contract tests;
- verify audit logging for data changes;
- verify viewer department scoping where relevant;
- avoid leaking filesystem paths or internal implementation details;
- confirm the route does not depend on hidden frontend state.
