# Official Extension Maintainer Docs

This directory documents LicenseTrack's internal first-party extension host.
It is for project maintainers producing optional Official Extensions that are
published and signed through LicenseTrack release channels.

It is not a public third-party plugin SDK, marketplace contract, or promise of
compatibility for unofficial packages. LicenseTrack does not support arbitrary
third-party code in this host. Custom and third-party automation should use the
API, webhook, and sidecar contracts in `../extension-authors/`.

- `plugin-author-guide.md`: internal package and signing workflow.
- `plugin-host-v1-contract.md`: current implementation boundary.
- `plugin-host-post-v1-notes.md`: maintainer decisions and deferred work.
