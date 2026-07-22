# Users, roles, and access

LicenseTrack supports local accounts and optional OpenID Connect sign-in. Admins
manage account status, role, department scope, document download permission,
and password recovery from **Admin > Users**.

## Roles

| Role | Access |
| --- | --- |
| Admin | Full product access, users, settings, audit, backup, and restore |
| Editor | Create and manage licenses, procurement, contracts, and documents |
| Viewer | Read-only access to assigned departments |

A Viewer with no assigned departments sees no license data. Department scope is
also applied to related reporting and document access.

## Download permission

Document downloads can be disabled for an individual user independently of the
user's role. This is useful when a Viewer may inspect metadata but should not
retrieve stored commercial or entitlement evidence.

## Local and OIDC accounts

Local accounts authenticate with passwords stored as bcrypt hashes. OIDC
accounts authenticate through the configured identity provider. Local and OIDC
login can coexist.

The seeded local admin is the protected break-glass account. Keep its credentials
secure and tested even when OIDC is the normal login method.

!!! warning
    LicenseTrack prevents deactivating or removing the last active local Admin.
    Do not weaken this safeguard when introducing SSO.

OIDC users do not automatically have a usable local password. Admins should use
the account controls appropriate to the user's authentication provider.

## Operational review

Periodically review:

- inactive users and stale department assignments;
- Admin and Editor role membership;
- accounts allowed to download documents;
- OIDC availability and the break-glass login; and
- user and role changes in the [audit log](audit-log.md).
