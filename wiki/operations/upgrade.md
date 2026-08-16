# Upgrading LicenseTrack

This guide covers a Docker Compose upgrade while keeping the existing database, uploaded documents, database backups, and Official Extension storage intact.

!!! danger "Do not delete the data volume"
    Do not run `docker compose down -v` during an upgrade unless you intentionally want to delete LicenseTrack data. The `-v` flag removes named volumes, including the `/data` volume that stores the SQLite database and uploaded documents.

## What persists

The application container is replaceable. Persistent data lives under `/data` in the Docker volume mounted by Compose:

- `/data/licenses.db`
- `/data/storage/`
- `/data/backups/`
- `/data/plugins/`

Startup runs Alembic migrations automatically, so an upgrade normally means replacing the application source/image and starting the container against the same `/data` volume.

## Before upgrading

From the current install directory, identify the volume mounted at `/data`:

```bash
cd /path/to/LicenseTrack

CID=$(docker compose ps -q license-lifecycle)
DATA_VOL=$(docker inspect "$CID" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
echo "$DATA_VOL"
```

Back up the full volume:

```bash
mkdir -p ~/licensetrack-upgrade-backups

docker run --rm \
  -v "$DATA_VOL":/data:ro \
  -v "$HOME/licensetrack-upgrade-backups":/backup \
  alpine \
  sh -c 'tar -czf /backup/licensetrack-data-pre-upgrade-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .'
```

Also keep a copy of `.env`:

```bash
cp .env ~/licensetrack.env.backup
```

## Normal same-directory upgrade

The cleanest upgrade path is to keep the same install directory and Compose project name.

```bash
cd /path/to/LicenseTrack
docker compose down
```

Replace the source files with the new release while keeping the same folder name and `.env`. Then rebuild and start:

```bash
cp ~/licensetrack.env.backup .env
docker compose up -d --build
```

Check health and logs:

```bash
docker compose ps
docker compose logs --tail=100 license-lifecycle
curl http://localhost:8080/api/health
```

The health response should include the expected version:

```json
{"status":"ok","version":"1.1.10"}
```

Log in and smoke-test license listing, document downloads, settings, backup listing, and any configured SMTP/OIDC integrations.

## If the install folder changes

Docker Compose names volumes from the Compose project name. By default, the project name comes from the folder name. For example:

```text
~/LicenseTrack-1.0.4  -> licensetrack-104_license_lifecycle_data
~/LicenseTrack        -> licensetrack_license_lifecycle_data
```

If you move to a different folder name, Compose may create a new empty volume. The symptom is a startup log that runs every migration from `initial_schema`, and the app opens with an empty database.

To reuse an existing volume after changing folder/project name, mark the volume as external in `docker-compose.yml`:

```yaml
volumes:
  license_lifecycle_data:
    external: true
    name: existing_volume_name_here
```

Use the volume name you found before upgrading, for example:

```yaml
volumes:
  license_lifecycle_data:
    external: true
    name: licensetrack-104_license_lifecycle_data
```

Then start again:

```bash
docker compose up -d --build
curl http://localhost:8080/api/health
```

## Podman upgrades

If you run LicenseTrack with plain `podman run`, upgrade by replacing the container while reusing the same `/data` volume.

Identify the current `/data` volume:

```bash
podman inspect licensetrack --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}'
```

Back up the volume:

```bash
mkdir -p ~/licensetrack-upgrade-backups

podman run --rm \
  -v license_lifecycle_data:/data:ro \
  -v "$HOME/licensetrack-upgrade-backups":/backup \
  alpine \
  sh -c 'tar -czf /backup/licensetrack-data-pre-upgrade-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .'
```

Stop and remove only the old container, not the volume:

```bash
podman stop licensetrack
podman rm licensetrack
```

Build the new image from the release source:

```bash
podman build -t license-lifecycle-system:1.1.10 .
```

Start the new container with the same volume mounted at `/data`:

```bash
podman run -d --name licensetrack -p 8080:8000 \
  --env-file .env \
  -v license_lifecycle_data:/data \
  license-lifecycle-system:1.1.10
```

Check health:

```bash
curl http://localhost:8080/api/health
```

If your Podman volume has a different name, substitute it in both `-v` arguments. Do not use `podman volume rm` during an upgrade unless you intentionally want to delete persistent data.

If you use `podman compose`, follow the Docker Compose guidance above. Compose project-name behavior can still change generated volume names when the install folder changes.

## Stable project names

For new installs, you can avoid folder-name surprises by setting a stable Compose project name before first startup:

```env
COMPOSE_PROJECT_NAME=licensetrack
```

Do not add or change `COMPOSE_PROJECT_NAME` on an existing install unless you also confirm which data volume will be used. Changing it later changes the Compose-generated volume name.

## Recovery if an empty database appears

If the upgraded container starts with an empty database:

1. Stop the new container with `docker compose down`.
2. Do not delete any Docker volumes.
3. List available volumes with `docker volume ls`.
4. Inspect old containers to find their `/data` volume:

```bash
docker ps -a
docker inspect <old-container-name-or-id> --format '{{json .Mounts}}'
```

5. Update `docker-compose.yml` to use the correct existing volume as an external volume.
6. Start again and confirm that the startup logs no longer run the full migration chain from the initial schema.

## After upgrading

- Confirm `/api/health` reports the expected version.
- Confirm the container is healthy and not restarting.
- Review logs for migration errors.
- Log in with an admin account.
- Smoke-test license listing, document access, settings, backup listing, and configured integrations.
- Confirm scheduled database backup and notification settings remain as expected.

When upgrading from 1.1.0 or earlier, a browser may still hold the old SPA shell
under its previous cache policy. If `/api/health` reports the new version but
the interface still looks or behaves like the old release, perform one hard
refresh or clear that site's cached files. Releases from 1.1.1 onward require
the SPA shell to revalidate, so this should be a one-time transition.
