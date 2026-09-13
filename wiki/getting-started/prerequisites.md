# Choose your installation

LicenseTrack runs on your own infrastructure. Choose a deployment method before
preparing the host; both provide the same browser application and core workflows.

| Method | Choose this when... | Start here |
|---|---|---|
| **Docker Compose** | Your team already operates containers, or you want to evaluate locally with Docker Desktop. | [Container installation](installation.md) |
| **Native Linux** | Your team prefers a systemd service on a supported Linux host. | [Native Linux installation](native-installation.md) |

Only exploring the product? Start with the [demo walkthrough](../evaluate/demo-walkthrough.md).
It needs no installation.

## Host sizing

These are starting recommendations; database size, attachments, and import volume
determine the space and memory your installation needs.

| Resource | Recommended | Notes |
|---|---|---|
| CPU | 2 cores | 1 core is enough for small installs. |
| Memory | 2 GB RAM | 4 GB recommended for large spreadsheet imports. |
| Disk | 2 GB free | Allow additional space for documents, database growth, and backups. |

## Docker Compose requirements

- A modern Linux host; the installation walkthrough uses Ubuntu 22.04 LTS.
  macOS and Windows can be used for evaluation through Docker Desktop.
- **Docker Engine 24+** with the Docker Compose plugin (`docker compose`), or
  **Podman 4+** with a Compose provider such as `podman-compose`.
- **OpenSSL** to generate a JWT secret.
- A download tool such as `wget` or `curl`, and `unzip`.
- Outbound internet access during the build to download images and dependencies.
- A free application port; the container guide uses **8080** by default.

The examples use `docker compose`. With Podman and a configured Compose provider,
use `podman compose` instead.

[Continue with container installation](installation.md)

## Native Linux requirements

The supported baseline is Debian 13 or Ubuntu 22.04 LTS on x86_64 with systemd
and CPython 3.12, 3.13, or 3.14. Docker and Podman are not required. The official
native release archive includes the compiled frontend, so Node.js is not needed
for that installation path.

Follow the [native installation guide](native-installation.md#supported-baseline)
for the complete dependency checklist and distribution-specific Python guidance.

## Before opening access to colleagues

Plan the browser-facing URL, HTTPS, reverse proxy, and backups. Follow the
[deployment and hardening guide](../operations/deployment.md) for containers and
the [native installation guide](native-installation.md) for a native service.
Back up uploaded documents as well as the database; see
[backup and restore](../operations/backup-restore.md).
