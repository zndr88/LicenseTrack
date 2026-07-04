# Operations

Running LicenseTrack in production — hardening, backups, upgrades, and day-to-day operations — is covered by the pages in this section. New to LicenseTrack? Start with [Getting Started](../getting-started/prerequisites.md) to stand up an instance first; this section is about keeping it healthy in production.

<div class="grid cards" markdown>

- :material-server: **[Production deployment & hardening](deployment.md)**

    Podman, production hardening (HTTPS, reverse proxy, CORS), the full configuration reference, plugin runtime constraints, and persistent data.

- :material-clipboard-check: **[Operations runbook](runbook.md)**

    Health monitoring, log review, audit review, vulnerability management, upgrade checks, and incident response.

- :material-database-arrow-down: **[Backup & restore](backup-restore.md)**

    How database backups and restores work, retention, the pre-restore safety snapshot, and what is (and isn't) covered.

</div>

!!! warning "Back up before you experiment"
    Deleting a license is permanent unless you have a database backup. Set up backups early — and remember that uploaded **documents** are stored separately from the database and need their own backup. See [Backup & restore](backup-restore.md).
