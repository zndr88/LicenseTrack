# Prerequisites

Before you install LicenseTrack, make sure your environment meets the requirements below. LicenseTrack ships as a set of containers, so the host itself stays light — almost everything runs inside Docker (or Podman).

## Host machine

| Requirement | Recommended | Notes |
|-------------|-------------|-------|
| Operating system | Linux (Ubuntu 22.04 LTS or newer) | Any modern Linux distribution works. macOS and Windows work for evaluation via Docker Desktop. |
| CPU | 2 cores | 1 core is enough for small installs. |
| Memory | 2 GB RAM | 4 GB recommended if you import large spreadsheets. |
| Disk | 2 GB free | Grows with uploaded documents and database size. |

## Software

- **Docker Engine 24+** with the Docker Compose plugin (`docker compose`), **or**
- **Podman 4+** with `podman-compose`.
- **OpenSSL** — used once to generate your JWT secret (pre-installed on most Linux systems).
- A tool to download and unzip the release, e.g. `wget` (or `curl`) and `unzip`.

## Network

- Outbound internet access **during the build** so the containers can pull their base images and dependencies.
- One free TCP port to expose the app. This guide uses **`8080`** (the default) — change it in your `.env` if it is already in use.
- Access to that port from any machine you want to reach LicenseTrack from (open your firewall accordingly).

!!! tip "Docker or Podman?"
    LicenseTrack supports both. The examples in this guide use Docker. If you use Podman, substitute `podman compose` for `docker compose` in every command.
