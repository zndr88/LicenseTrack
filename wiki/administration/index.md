# Administration

Administration covers the areas that affect the whole LicenseTrack installation:
users, access control, settings, notifications, audit history, backups, and
integration credentials.

Most day-to-day admin work happens inside the application under **Admin**. The
in-app Help Center is version-local and explains the exact controls available in
your installed release.

Use the focused administration guides for configuration and governance:

- [Users, roles, and access](users-access.md)
- [Settings, notifications, and email](settings-notifications.md)
- [Audit log](audit-log.md)

Use these public docs for operational setup and recovery:

- [Production deployment & hardening](../operations/deployment.md)
- [Backup & restore](../operations/backup-restore.md)
- [Operations runbook](../operations/runbook.md)
- [Upgrading LicenseTrack](../operations/upgrade.md)

## Admin Areas

- **Settings** - system configuration such as SMTP, OIDC, mandatory fields,
  custom fields, notification timing, backup location, API tokens, webhooks, and
  integration capabilities.
- **Users** - local and OIDC users, role assignment, viewer department scoping,
  download permission, and break-glass admin protection.
- **Audit Log** - searchable history for authentication, settings, user,
  document, backup, integration, and data-changing actions.

## Roles

LicenseTrack uses three main roles:

- **Admin** - full application and operational access.
- **Editor** - create and maintain procurement, license, contract, and document
  records.
- **Viewer** - read-only access, scoped by assigned departments.

Viewer access is intentionally narrow. A viewer with no assigned departments sees
no records.
