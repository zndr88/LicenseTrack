# API Authentication

LicenseTrack supports API tokens for operator-managed integrations and automation. API tokens are intended for machine-to-machine access where browser sessions or human user credentials are not appropriate.

API tokens are created by admins. For ownership purposes, each token records the admin who created it. For audit purposes, token-authenticated requests are logged with first-class token identity fields (`actor_token_id` and `actor_token_name`) alongside the owning admin's email. Tokens are shown only once at creation time. LicenseTrack stores a keyed digest of the token, not the raw token value. Tokens created before v1.0.6 with the legacy digest format are migrated to the keyed format after successful use.

## Token Format

API tokens use the `lt_` prefix.

Send tokens as bearer credentials:

```http
Authorization: Bearer lt_...
```

## Managing Tokens

Admins can manage tokens through:

```text
GET    /api/api-tokens
POST   /api/api-tokens
DELETE /api/api-tokens/{token_id}
```

Creating a token requires a name and one or more scopes:

```json
{
  "name": "CMDB sync",
  "scopes": ["licenses:read", "licenses:write"]
}
```

The create response includes the raw token once:

```json
{
  "id": 1,
  "name": "CMDB sync",
  "token": "lt_example...",
  "token_prefix": "lt_example1",
  "scopes": ["licenses:read", "licenses:write"],
  "created_by": 1,
  "created_at": "2026-05-27T12:00:00Z",
  "last_used_at": null,
  "revoked_at": null
}
```

Later list responses include only token metadata and the token prefix. If the raw token is lost, revoke it and create a replacement.

## Scopes

Initial scopes are deliberately small:

| Scope | Allows |
| --- | --- |
| `licenses:read` | Read license registry, contracts, renewals, custom-field metadata, and import mapping metadata |
| `licenses:write` | Create and modify license-oriented records, contracts, custom fields, and import mappings |
| `procurement:read` | Read sourcing and pending-order workflows |
| `procurement:write` | Create and modify sourcing and pending-order workflows |
| `documents:read` | Download or list documents on supported document routes |
| `documents:write` | Upload, delete, process, submit processing results, or reject processing suggestions for documents on supported routes |
| `reports:read` | Read reporting endpoints |
| `extensions:read` | Read declared extension capabilities |
| `extensions:write` | Register or update declared extension capabilities |

Submitting document processing results requires both `documents:write` and `extensions:write`. Accepting a pending processing result applies suggested values to a license, so API-token clients need both `documents:write` and `licenses:write` for the accept endpoint.

API tokens are not accepted on every authenticated route. Admin settings, user management, database backup/restore, authentication, and token-management routes remain browser/admin-session surfaces unless explicitly documented otherwise.

## Examples

List licenses:

```bash
curl -H "Authorization: Bearer lt_your_token" \
  https://licensetrack.example.com/api/licenses
```

License read responses include `customFields` inline. Each value includes its custom-field definition so integrations can read the stable `fieldKey`, display name, type, and stored value from a single license read.

Run the included smoke test against a local or deployed instance:

```bash
python examples/api-token-smoke-test.py \
  --base-url http://localhost:8000 \
  --token lt_your_token
```

The smoke test lists visible licenses, reports whether the first license has custom fields, and confirms that a read-only token cannot delete a license.

Integration author guidance, scope selection, and common integration flows are documented in `docs/extension-authors/build-integrations.md` and `docs/extension-authors/integration-recipes.md`.

Create a minimal license:

```bash
curl -X POST https://licensetrack.example.com/api/licenses \
  -H "Authorization: Bearer lt_your_token" \
  -H "Content-Type: application/json" \
  -d '{
    "publisherName": "Example Publisher",
    "softwareDescription": "Example Product",
    "licenseType": "subscription",
    "licenseMetric": "per_user",
    "quantity": "25",
    "currency": "EUR"
  }'
```

## Operational Guidance

- Create one token per integration or automation job.
- Grant only the scopes the integration needs.
- Store raw tokens in the operator's secret manager.
- Revoke tokens when an integration is retired or suspected to be compromised.
- Rotate tokens according to local policy.
- Review audit logs for token creation and revocation events.
- Filter the audit log by API token ID (`actor_token_id`) to isolate all activity from a specific integration. Token name is also searchable via the free-text search filter.
- Monitor `last_used_at` to find stale tokens.

## Current Limitations

- Tokens are owned by the admin user that created them; dedicated service-account users are a future refinement.
- Scope checks are route-family based. They are intentionally conservative and should become more granular as integration contracts mature.
- Token use updates `last_used_at`. Business audit entries carry first-class `actor_token_id` and `actor_token_name` fields for token-authenticated changes, queryable via the audit log API filter and included in CSV exports.
