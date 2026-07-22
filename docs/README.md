# LicenseTrack Documentation Layout

This directory holds repository documentation that is useful on GitHub but is not
the primary public operator manual.

The published documentation site is built from `wiki/` through `mkdocs.yml`.
Start there for installation, first-use, upgrade, backup, restore, and operations
guidance.

Use the folders here by audience:

- `maintainer/` - architecture notes and contribution style conventions for
  people changing the core application.
- `extension-authors/` - API, webhook, document-processing, and integration
  contracts for externally hosted automation.
- `plugin-authors/` - internal package, signing, runtime, and release material
  for first-party Official Extension maintainers; not a public plugin SDK.
- `in-app-help/` - locator and maintenance guidance for the version-local Help
  Center catalog bundled in the frontend. It is not a second article source.
- `images/` - README screenshots and related image guidance.
