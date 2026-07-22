# Native Linux installation

LicenseTrack can run directly on a Linux host as a systemd service. This path does not use Docker or Podman.

## Supported baseline

- Ubuntu 22.04 LTS, x86_64
- systemd
- Python 3.12 with the `venv`, SSL, and SQLite modules
- `curl`, `tar`, and standard GNU/Linux user-management tools
- A TLS-terminating reverse proxy for network-reachable production use

The official native release archive contains the compiled frontend and an offline Python wheelhouse. Node.js is not required when using that archive.

!!! warning "Third-party Python packages on Ubuntu 22.04"
    Ubuntu 22.04 does not ship Python 3.12 in its standard repositories. Install and maintain Python 3.12 according to your organisation's package policy before running the installer. Do not replace `/usr/bin/python3`; Ubuntu system tools should continue using the distribution Python.

Verify the interpreter:

```bash
python3.12 --version
python3.12 -c 'import sqlite3, ssl, venv; print("Python prerequisites OK")'
```

## Install from the native release archive

Download both the native archive and `SHA256SUMS` from the GitHub release. Verify the archive before extracting it:

```bash
sha256sum --check SHA256SUMS
tar -xzf licensetrack-native-<version>-linux-x86_64.tar.gz
cd licensetrack-native-<version>-linux-x86_64
./install.sh --verify-only
sudo ./install.sh
```

The installer offers two modes:

| Mode | Intended use | Configuration |
|------|--------------|---------------|
| **Standard (recommended)** | Most production installations | Prompts only for the browser-facing URL and initial local admin password. Uses safe runtime defaults and binds to `127.0.0.1:8000`. |
| **Advanced** | Custom ports, troubleshooting, larger limits, or isolated test environments | Also prompts for bind address, port, log level, session lifetime, upload/extension limits, allowed extensions, API documentation exposure, session-cookie behavior, and test-only OIDC network allowances. |

Press Enter at the mode prompt to choose Standard, or select a mode explicitly:

```bash
sudo ./install.sh --standard
sudo ./install.sh --advanced
```

Both modes generate the JWT signing secret automatically and protect the resulting environment file. SMTP credentials and OIDC provider/client details remain application-managed settings: configure them after first login under **Settings**. Advanced mode can enable plain-HTTP or private-network OIDC discovery for an isolated test environment, but those allowances should remain disabled in production.

After installation:

```bash
sudo licensetrack status
sudo licensetrack doctor
sudo licensetrack logs
```

## Install from GitHub's source archive

The automatic tag ZIP is source-only. Its installer builds the production frontend on the server, so this path additionally requires Node.js 22 and npm:

```bash
unzip LicenseTrack-<version>.zip
cd LicenseTrack-<version>
sudo ./install.sh
```

Use the native release archive for production when possible. It is built and checksummed by the release workflow and does not install frontend build tooling on the server.

## Unattended installation

Store the initial admin password in a root-readable file and supply the public URL explicitly:

```bash
sudo install -m 600 /dev/null /root/licensetrack-admin-password
sudo editor /root/licensetrack-admin-password

sudo ./install.sh \
  --yes \
  --public-url https://licenses.example.com \
  --admin-password-file /root/licensetrack-admin-password

sudo rm /root/licensetrack-admin-password
```

The installer intentionally does not accept the password as a command-line argument, where it would be visible in process listings and shell history.

`--yes` selects Standard mode when no mode is supplied. An unattended Advanced install accepts the same settings as flags instead of prompting. For example, this isolated HTTP test configuration binds to the LAN and permits a private plain-HTTP identity provider:

```bash
sudo ./install.sh \
  --advanced \
  --yes \
  --bind-host 0.0.0.0 \
  --port 8000 \
  --public-url http://192.168.0.247:8000 \
  --allow-http-oidc-discovery \
  --allow-private-oidc-discovery \
  --no-session-cookie-secure \
  --admin-password-file /root/licensetrack-admin-password
```

Run `./install.sh --help` for every Advanced automation flag. Command-line flags contain no secret values; application integration secrets are entered later through LicenseTrack's Settings UI.

## Filesystem layout

| Purpose | Path |
|---------|------|
| Versioned releases | `/opt/licensetrack/releases/<version>/` |
| Active release link | `/opt/licensetrack/current` |
| SQLite database | `/var/lib/licensetrack/licenses.db` |
| Uploaded documents | `/var/lib/licensetrack/storage/` |
| Official Extension packages | `/var/lib/licensetrack/plugins/` |
| Database backups | `/var/lib/licensetrack/backups/` |
| Upgrade snapshots | `/var/backups/licensetrack/upgrades/` |
| Protected environment | `/etc/licensetrack/licensetrack.env` |
| Install state | `/etc/licensetrack/install.json` |
| systemd unit | `/etc/systemd/system/licensetrack.service` |

Application files are root-owned. The service runs as the unprivileged `licensetrack` account and can write only its persistent data paths. Journald captures application output.

## Reverse proxy and HTTPS

The default loopback binding is deliberate. Put nginx, Caddy, or another TLS-terminating reverse proxy in front of `127.0.0.1:8000`. The public URL entered during installation becomes `CORS_ORIGINS`; HTTPS URLs also enable secure session cookies.

Do not expose port 8000 directly to an untrusted network. Route both the SPA and `/api/*` paths through the same public origin.

## Service operations

```bash
sudo licensetrack start
sudo licensetrack stop
sudo licensetrack restart
sudo licensetrack status
sudo licensetrack logs
sudo licensetrack doctor
sudo licensetrack backup
sudo licensetrack version
```

The `backup` command creates the same WAL-safe SQLite backup format used by the application. It does not include uploaded documents. Upgrade snapshots are separate and include the managed data directory, configuration, and any configured external document-storage path.

## First login

Open the public URL, sign in as `admin`, and use the password supplied during installation. Continue with [First launch & login](first-login.md).
