# Extension Author Docs

These docs cover externally hosted integrations: API clients, webhook receivers,
document-processing sidecars, and private automation.

Start with:

- `overview.md` for terminology and where an extension belongs.
- `build-integrations.md` for the API/webhook integration path.
- `api-auth.md` for API-token behavior and scopes.
- `api-stability.md` for stable, experimental, and internal route expectations.
- `webhooks.md` for signed event delivery and retry behavior.
- `build-document-processor.md` for document-processing sidecars.
- `checklist.md` before handing off a private integration.

The internal Official Extensions host is not the public customization path.
Material in `../plugin-authors/` is for LicenseTrack release maintainers only.
Custom and third-party automation should use the contracts in this directory.
