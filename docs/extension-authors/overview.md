# Extending LicenseTrack

LicenseTrack's supported customization surface is the Integration Framework:
API tokens, documented API routes, import/export contracts, webhooks, extension
capability declarations, document actions, and document-processing sidecars.
Custom and third-party automation should run outside the LicenseTrack
application process and use these contracts.

## Support boundary

| Surface | Contract |
| --- | --- |
| Core LicenseTrack | Supported product behavior maintained by the LicenseTrack project. |
| Official Extensions | Optional trusted application code published and signed by the LicenseTrack project. |
| API, webhook, and sidecar integrations | Supported public contracts; each integration remains operated, tested, and maintained by its owner. |
| Unofficial in-process packages | Unsupported. The internal host does not accept arbitrary third-party packages. |

The source license may permit independently developed integrations under their
own terms. That legal permission is separate from LicenseTrack product support
and does not make an unofficial in-process package supported.

## Choose an integration shape

- Use an API integration for sync, reporting, imports, exports, migrations, and
  other operator-owned automation.
- Use webhooks when an external receiver should react to audited business
  events instead of polling.
- Use a document processor sidecar when a user should intentionally send a
  selected document to an external service and review proposed values.
- Submit a core contribution when a feature is broadly useful and should be
  maintained as part of LicenseTrack.

Start with `build-integrations.md`, `api-reference.md`, `api-auth.md`,
`api-stability.md`, and `webhooks.md`. Document processors should also read
`build-document-processor.md`, `document-actions.md`, and
`document-processing-results.md`.

## Integration responsibilities

LicenseTrack core owns authentication and authorization, viewer department
scope, document access checks, audit logging, review UI, validation, and final
data mutation. Integrations own their external parsing, synchronization,
transformation, provider behavior, deployment, credentials, observability, and
compatibility testing.

Do not write directly to the LicenseTrack database, depend on undocumented
frontend state, or treat internal routes and response fields as stable. Use the
record `id` when identifying a specific database row; `license_ref` is a shared
renewal-chain identity and is not unique per row.

Private integrations are maintained by their owners. Test them before every
LicenseTrack upgrade, especially when they use experimental contracts.

## Official Extensions are not the public customization path

LicenseTrack contains an internal host for optional Official Extensions. It is
disabled by default and reserved for packages published and Ed25519-signed by
the LicenseTrack project. Official Extensions run as trusted server code; their
declared access and managed process lifecycle do not form a hostile-code
sandbox.

The internal package material under `../plugin-authors/` exists for LicenseTrack
release maintainers. It is not a public third-party plugin SDK, marketplace
contract, or frozen compatibility promise. If you are not producing an official
LicenseTrack release artifact, use the Integration Framework instead.

## AI and external providers

AI-assisted processing is optional. Baseline LicenseTrack does not require an
AI provider or send documents to one. Operators and integration owners must
assess what data is sent, credential storage, provider retention and training
terms, data residency, and review behavior. Proposed document values remain
pending until an editor or admin accepts supported fields.
