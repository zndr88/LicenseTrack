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
- `plugin-authors/` - Plugin Host v1 package, manifest, runtime, and suggestion
  contracts for installable plugins.
- `in-app-help/` - source copy for version-local Help Center material. These
  files are not the public docs site.
- `images/` - README screenshots and related image guidance.
