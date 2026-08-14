# Native Linux removal

This procedure applies only to instances installed by LicenseTrack's native
installer. Docker and Podman deployments use their container and volume
management procedures instead.

LicenseTrack 1.1.8 documents removal as an operator procedure. It does not
provide a `licensetrack uninstall` command because complete removal can destroy
the database, uploaded documents, backups, configuration, and secrets.

## Review the managed paths

The commands below use the default native layout. Before removing anything,
inspect the installation state and confirm whether custom paths, service names,
or external document storage are in use:

```bash
sudo cat /etc/licensetrack/install.json
sudo licensetrack doctor
```

Also review **Settings > Storage**. A configured document-storage path outside
`/var/lib/licensetrack` is not represented by the standard removal commands.

## Choose what to preserve

`sudo licensetrack backup` creates a consistent SQLite database backup, but it
does not include uploaded documents, configuration, or Official Extension
packages. For a recoverable final archive, stop the service and copy at least:

- `/var/lib/licensetrack`;
- `/etc/licensetrack`;
- `/var/backups/licensetrack`; and
- any external document-storage path.

Store the archive outside every path that will be removed. Preserve its file
ownership and permissions, and protect it as sensitive data because it contains
application secrets and business records.

If data may be needed later, perform only the application-removal steps below
and retain the data, configuration, and backup directories.

## Remove the application

Stop and disable the service:

```bash
sudo systemctl disable --now licensetrack.service
```

Remove the systemd unit and operator command, then reload systemd:

```bash
sudo rm -f /etc/systemd/system/licensetrack.service
sudo rm -f /usr/local/bin/licensetrack
sudo systemctl daemon-reload
sudo systemctl reset-failed
```

Remove the immutable application releases and installer lock:

```bash
sudo rm -rf -- /opt/licensetrack
sudo rm -f /run/lock/licensetrack-installer.lock
```

Remove the service account. The matching group can be removed when no other
local resource uses it:

```bash
sudo userdel licensetrack
sudo groupdel licensetrack
```

At this point the application is removed, but retained data could still be
restored during a future installation.

## Permanently delete retained data

!!! danger "This cannot be undone"
    Run these commands only after confirming the final backup and every path.
    They permanently delete the database, documents, configuration, secrets,
    extension packages, and native upgrade snapshots.

For the default layout:

```bash
sudo rm -rf -- /var/lib/licensetrack
sudo rm -rf -- /etc/licensetrack
sudo rm -rf -- /var/backups/licensetrack
```

Delete a custom external storage path only when it belongs exclusively to this
LicenseTrack instance and has been resolved to the intended absolute path.

## External cleanup

The native installer does not manage the surrounding host configuration.
Remove or update these separately when applicable:

- reverse-proxy virtual host and TLS certificate automation;
- DNS records;
- `firewalld` or other host-firewall rules;
- monitoring, log shipping, and backup jobs; and
- browser cookies, cache, and other site data.

Clearing browser site data is especially useful when removing an evaluation
instance or changing the URL to point at a different LicenseTrack deployment.
