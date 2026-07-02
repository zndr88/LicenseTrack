# API Stability Policy

LicenseTrack's integration story depends on predictable API behavior. This document defines how API routes should be treated by maintainers and integration authors.

The policy is intentionally modest. It does not introduce a versioned `/api/v1` path yet, but it does define which surfaces are safe to build against and how breaking changes should be handled.

## Stability Levels

### Stable

Stable API routes are intended for operator-built integrations and first-party integration/plugin work. They should preserve request and response compatibility within a release line unless a security or data-integrity issue requires a breaking change.

Stable routes should have:

- documented purpose and payload shape;
- route or service-level tests for important behavior;
- clear authorization requirements;
- audit logging for data-changing operations where applicable.

### Experimental

Experimental routes are usable but may change while the workflow is still being shaped. They can support early first-party integrations, future plugin-host work, or internal pilots, but integration authors should expect compatibility churn.

Experimental routes should be marked as such in documentation before they are promoted to stable.

### Internal

Internal routes or response fields are implementation details. They are not supported integration contracts. Frontend-only assumptions, private helper routes, compatibility aggregators, and undocumented fields should be treated as internal unless documented otherwise.

## Initial Stable API Candidates

The following route groups are candidates for stable integration contracts, subject to detailed endpoint documentation:

| Area | Route family | Stability intent |
| --- | --- | --- |
| Authentication/session | `/api/auth/*` | Stable for browser/session behavior; not sufficient for long-running integrations |
| Licences | `/api/licenses` | Stable candidate for registry reads, writes, exports, and focused actions |
| Licence documents | `/api/licenses/{id}/documents`, `/api/documents/{id}/download` | Stable candidate with strict permission and storage rules |
| Procurement documents | `/api/procurement-documents/{id}/download`, pending-order document routes | Stable candidate for evidence workflows |
| Sourcing | `/api/sourcing/*` | Stable candidate for sourcing request, quote, item, conversion, and export workflows |
| Pending orders | `/api/pending-orders/*` | Stable candidate for purchase-order, line-item, document, conversion, and export workflows |
| Contracts | `/api/contracts/*` | Stable candidate for contract and contract document workflows |
| Reports | `/api/reports/*` | Stable candidate for read-only reporting surfaces |
| Custom fields | `/api/custom-fields/*` | Stable candidate once field-key and value-normalization behavior is fully documented |
| Webhooks | `/api/webhooks/*` | Experimental admin-managed event surface based on audit actions |
| Document actions | `/api/document-actions/*` | Experimental operator-triggered integration point for document processors |
| Document processing results | `/api/document-processing-results/*` | Experimental result intake and review surface for document processors |
| Extension capabilities | `/api/extensions/capabilities/*` | Experimental declared-capability/status registry for integrations and sidecars; not a plugin loader |

The following areas should remain internal or carefully limited until explicitly documented:

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

## Deprecation Policy

When a stable API needs to change, maintainers should:

1. Document the old and replacement behavior.
2. Keep the old behavior available for at least one minor release where practical.
3. Add release notes calling out the deprecation.
4. Include migration guidance for integration authors.
5. Add or update tests around the replacement contract.

Security fixes, data-corruption fixes, and severe authorization bugs may require immediate breaking changes. In those cases, release notes should explain the reason.

## Versioning Expectations

Until a versioned API path exists, integrations and future installable plugins should declare compatibility by LicenseTrack application version or release range.

Example:

```text
Compatible with LicenseTrack 1.0.x
Requires stable license, document, and pending-order APIs
```

If a future `/api/v1` path is introduced, this policy should be updated to define how long old API versions remain supported.

## Auth For Integrations

Session-based authentication is suitable for the web application. Long-running integrations should use API tokens with:

- scoped permissions;
- hashed token storage;
- revocation;
- last-used tracking;
- audit logging;
- clear ownership by an admin user.

See `docs/api-auth.md` for the current token model, scopes, and limitations. Dedicated service-account identities remain a future refinement.

## Maintainer Checklist

Before marking an API route stable:

- document the request, response, permissions, and error behavior;
- add or verify endpoint contract tests;
- verify audit logging for data changes;
- verify viewer department scoping where relevant;
- avoid leaking filesystem paths or internal implementation details;
- confirm the route does not depend on hidden frontend state.
