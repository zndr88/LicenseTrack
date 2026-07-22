# Integrations And Official Extensions

LicenseTrack works without any extension or external integration. Choose an
advanced surface only when an operator has a concrete automation need.

## Supported surfaces

| Need | Use |
| --- | --- |
| Read or update records from another system | Public API with a scoped API token |
| React to audited LicenseTrack events | Signed webhooks |
| Process a selected document outside LicenseTrack | Document action and sidecar contracts |
| Install an optional package released by the LicenseTrack project | Official Extensions |
| Run custom or third-party code in the application process | Not supported |

API, webhook, and sidecar contracts are supported LicenseTrack integration
surfaces. The integration itself remains operated, tested, and maintained by
its owner. Start with the
[extension author overview](https://github.com/zndr88/LicenseTrack/blob/main/docs/extension-authors/overview.md).

## Official Extensions

The internal extension host is reserved for optional extensions published and
signed by the LicenseTrack project. It is disabled by default. When enabled,
admins can install a package only after its Ed25519 signature verifies against
a pinned LicenseTrack release key. Install packages only from official
LicenseTrack release channels.

Official Extensions run as trusted server code under the LicenseTrack operating
system account. Declared access, managed processes, callback tokens, and
lifecycle controls do not form a hostile-code sandbox. Do not install custom or
third-party packages into this host.

Developer mode allows unsigned local packages for project development. Such
packages are visibly marked as developer builds, are never presented as
official or verified, and are unsupported in production.

See [Production deployment and hardening](../operations/deployment.md) for the
host configuration and trust-store requirements.
