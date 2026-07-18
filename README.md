# LicenseTrack

Version 1.0.8.

LicenseTrack is a self-hosted software license procurement and lifecycle management system. It gives organisations a single Docker-deployed application for sourcing, purchase orders, active license records, renewals, contracts, documents, notifications, reporting, database backups, audit history, and user access control.

LicenseTrack is source-available software. See [Licensing](#licensing) before using, modifying, or redistributing it.

![LicenseTrack license overview dashboard](docs/images/dashboard.png)

[Try the hosted demo](https://zndr88.github.io/LicenseTrack/demo/) before installing.

## Background

LicenseTrack came out of two jobs on opposite sides of the same problem.

The first was at a Value Added Reseller, where I worked as a software consultant. Part of the job was entering quotes in the ERP, printing them for customers, then converting them into purchase orders toward suppliers or publishers. When deliveries came in, required documents were routinely missing or scattered across emails and shared drives. There was no renewal dashboard for customers. Management's answer was Excel. The frustration was not mine alone. The quoting and order-processing team felt it, and so did the consultants working as dedicated customer SPOCs who needed a single source of truth.

The second job was License Manager at an end customer. Same problem, other side of the transaction: requesting quotes from resellers, pushing orders through internal purchasing, receiving entitlements. An ITAM tool was in place for importing purchases, but a general tracking tool and procurement dashboard were missing.

LicenseTrack is what I needed in both roles: a single source of truth for software license procurement, with document storage, automatic email notifications, and clear license logic. It's built to that shape. If that gap sounds familiar inside your own organisation, it should fit yours too.

## What LicenseTrack Does

### Procurement

![Sourcing requests and pending purchase orders](docs/images/procurement.png)

- Track sourcing requests while license purchases are still being evaluated.
- Record publisher, supplier, contact, quantity, estimated cost, status, renewal context, and quote documents.
- Promote sourcing items into pending purchase orders.
- Group multiple items under the same purchase order.
- Convert pending orders into live license records.
- Keep converted and cancelled sourcing requests and pending orders in searchable history views for later price, quote, PO, invoice, and notes reference.
- Detect renewal opportunities and support cotermed renewal workflows.

### License Registry

- Maintain searchable, filterable license records with publisher, contract, purchase order, dates, quantities, costs, status, custom fields, and notes.
- Preserve sourcing-request and purchase-order milestone dates on resulting license records, with manual enrichment for imported and legacy data.
- Review record history in the license detail panel, including creator account, creation timestamp, latest update timestamp, and linked procurement trail records.
- Use status filters for upcoming, active, expiring, expired, pending renewal, renewed, retired, legacy, complete, and incomplete records.
- Configure visible columns from the Registry toolbar or user settings, reorder columns, save user display preferences, and export CSV data.
- Create, edit, retire, renew, and link license records.

### Renewals

![Renewal workbench showing upcoming, overdue, and in-progress renewals](docs/images/renewals.png)

- Work upcoming, overdue, and in-progress renewals from a dedicated renewal workbench.
- Start renewals from existing license records and carry data through sourcing, pending order, and conversion workflows.
- Preserve historical license records with renewal-chain traceability.
- Support renewal consolidation where coterm opportunities exist.

### Contracts and Documents

- Manage contract records grouped by publisher and contract number.
- Link contracts to license records.
- Store contract-level documents in user-defined folders.
- Attach invoices, EULAs, proofs of entitlement, quotes, and other files to licenses, contracts, sourcing requests, and procurement records.
- Track completeness based on mandatory fields and required document presence.

### Reporting, Alerts, and Admin

![Reports view with spend and portfolio breakdowns](docs/images/reports.png)

- Configure mandatory fields, legacy handling, and completeness exemptions.
- Use dashboards, reports, CSV import, and CSV exports for operational reporting.
- Send in-app notifications and optional SMTP email alerts.
- Create manual and scheduled database backups.
- Restore the database with a pre-restore database safety snapshot.
- Manage users with Admin, Editor, and Viewer roles.
- Use optional OIDC/SSO with a protected local break-glass admin account.
- Review audit history for authentication, settings, user, database backup, document, and data-changing actions.

## LicenseTrack and Discovery Tools

LicenseTrack is the procurement and governance layer. It works alongside discovery and compliance tools.

Discovery tools like Flexera, Snow, or Lansweeper are excellent at telling you what is installed and whether it matches what you are entitled to run. LicenseTrack handles what they do not: building and maintaining the complete, structured record of what you actually own, from initial sourcing request through purchase order, invoice, contract, and renewal history, so that record is accurate, evidenced, and ready to act on.

A practical workflow: manage procurement and license governance in LicenseTrack, keep records complete (entitlement certificates, invoices, renewal chain), then feed that data into your discovery tool for compliance reconciliation. LicenseTrack's completeness scoring and mandatory-field configuration exist to help you reach that "ready to export" state.

If you do not yet use a dedicated discovery tool, LicenseTrack works as your central license registry on its own. When you reach the scale where discovery tooling makes sense, your data is already structured and exportable.

LicenseTrack does not scan networks, discover installed software, or reconcile installed deployments against entitlements. It tracks license lifecycle data entered manually, imported through CSV, or added through documented API integrations.

## Advanced Integrations

LicenseTrack is complete without extensions. Baseline deployments do not need plugins, AI provider credentials, webhooks, or external integrations.

When an organisation does want to connect LicenseTrack to other systems, it can use API tokens, webhooks, document-processing sidecars, or installable Plugin Host v1 packages. These are advanced paths for technical operators and extension authors, not requirements for normal use.

Start with [docs/extension-authors/overview.md](docs/extension-authors/overview.md) for API/webhook integrations and document processors. Use [docs/plugin-authors/plugin-author-guide.md](docs/plugin-authors/plugin-author-guide.md) for installable plugin packages. Plugin runtime deployment constraints are covered in [wiki/operations/deployment.md](wiki/operations/deployment.md).

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Vite, TanStack Query, React Hook Form, Zod, Recharts, Vitest, Playwright |
| Backend | FastAPI, SQLAlchemy async, Alembic, Pydantic |
| Database | SQLite with `aiosqlite` |
| Auth | JWT sessions, bcrypt password hashing, optional OIDC |
| Documents | Filesystem-backed storage under the configured storage path |
| Jobs | APScheduler background scheduler |
| Deployment | Docker and Docker Compose (Podman-compatible) |

## Quick Start

Production-style local startup uses Docker Compose.

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Set required secrets in `.env`:

```env
JWT_SECRET=<long random secret>
ADMIN_PASSWORD=<strong initial admin password>
```

Generate a `JWT_SECRET` with one of these commands:

```bash
openssl rand -hex 32
```

```powershell
-join ((0..31) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

3. Start the application:

```bash
docker compose up -d --build
```

4. Open `http://localhost:8080`.

Log in with username `admin` and the password configured in `ADMIN_PASSWORD`. Change and store the break-glass admin password according to your operational policy.

The backend refuses to start with blank or common default values for `JWT_SECRET` and `ADMIN_PASSWORD`.

In Docker deployments the compiled frontend is served by the backend container and calls the API through same-origin `/api` URLs. `VITE_API_URL` is only needed for development or custom split-host deployments where the browser must call a separate API origin.

For full deployment guidance, see the [deployment guide](wiki/operations/deployment.md).

## Configuration

Core Docker configuration is loaded from `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | none | Required secret for signing sessions and deriving encryption keys for stored integration secrets. |
| `ADMIN_PASSWORD` | none | Required initial password for the local `admin` account. |
| `APP_PORT` | `8080` | Host port mapped to the application container. |
| `HOST` | `0.0.0.0` | Backend bind host inside the container. |
| `LOG_LEVEL` | `INFO` | Backend log level. |
| `CORS_ORIGINS` | `http://localhost:8080` | Exact browser origin allow-list. |
| `DATABASE_URL` | `sqlite+aiosqlite:////data/licenses.db` | SQLite database connection string. |
| `STORAGE_PATH` | `/data/storage` | Uploaded document storage path. |
| `BACKUP_LOCATION` | `/data/backups` | Database backup output path. |
| `RESTART_AFTER_RESTORE` | `true` in Docker Compose, `false` in direct backend runs | Exit the backend after database restore so a process manager can restart it. Set `false` for local development without a restart supervisor. |
| `TOKEN_EXPIRY` | `1440` | JWT session lifetime in minutes. |
| `OIDC_STATE_SECRET` | falls back to `JWT_SECRET` | Secret used for transient OIDC flow state cookies. |
| `ALLOW_HTTP_OIDC_DISCOVERY` | `false` | Unsafe testing-only allowance for plain-HTTP OIDC discovery. Leave disabled in production. |
| `ALLOW_PRIVATE_OIDC_DISCOVERY` | `false` | Unsafe testing-only allowance for private, loopback, link-local, or reserved OIDC hosts. Leave disabled in production. |
| `SESSION_COOKIE_NAME` | `license_lifecycle_session` | Browser session cookie name. |
| `SESSION_COOKIE_SECURE` | `false` | Set to `true` behind HTTPS. |
| `MAX_UPLOAD_SIZE_MB` | `20` | Maximum upload size. |
| `ALLOWED_UPLOAD_EXTENSIONS` | common document formats | Comma-separated upload extension allow-list. |

SMTP and OIDC are configured through application settings after startup. Deployment placeholders also exist in `.env.example`. OIDC callback logs use safe stage names for troubleshooting without logging auth codes, tokens, client secrets, or raw ID tokens.

## Persistent Data

Docker Compose creates the `license_lifecycle_data` volume and mounts it at `/data`.

The volume contains:

- `/data/licenses.db`
- `/data/storage/`
- `/data/backups/`

Application database backups contain the SQLite database only. Uploaded documents are data files that live separately under `/data/storage`; operators must back them up separately, usually by backing up the full `/data` volume.

## Documentation

- Public operator docs: [LicenseTrack documentation](https://zndr88.github.io/LicenseTrack/docs/) and the source pages under [wiki/](wiki/).
- Deployment and operations: [deployment](wiki/operations/deployment.md), [upgrade](wiki/operations/upgrade.md), [runbook](wiki/operations/runbook.md), and [backup/restore](wiki/operations/backup-restore.md).
- Maintainer docs: [docs/maintainer/architecture.md](docs/maintainer/architecture.md) and [docs/maintainer/style-contract.md](docs/maintainer/style-contract.md).
- Extension author docs: [docs/extension-authors/](docs/extension-authors/).
- Plugin author docs: [docs/plugin-authors/](docs/plugin-authors/).
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): human-readable direct dependency license summary.

Version-local Help Center source copy lives under [docs/in-app-help/](docs/in-app-help/). It is not the public documentation site.

## Maintainer Notes

- Frontend server-state query keys live in `frontend/src/queryKeys.js`; shared invalidation helpers live in `frontend/src/queryInvalidation.js`.
- Active modals use `frontend/src/components/ui/ModalShell.jsx`, with `ConfirmDialog` and `DiscardChangesDialog` as focused wrappers.
- Custom-field presentation rules are centralized in `frontend/src/utils/customFieldPresentation.js`.
- Backend custom-field value normalization is centralized in `backend/app/services/custom_fields_service.py`.
- Pending-order conversion behavior is coordinated by `backend/app/services/pending_order_conversion_service.py`; route handlers should remain thin.
- Procurement forms use React Hook Form and Zod schemas.

See [docs/maintainer/architecture.md](docs/maintainer/architecture.md) for the fuller maintainer map.

## Development

Backend dependencies are listed in `backend/requirements.txt`. Frontend dependencies and scripts are listed in `frontend/package.json`.

Common verification commands:

```bash
cd backend
pytest -q
```

```bash
cd frontend
npm run lint
npm run test:run
npm run test:coverage
npm run test:e2e
npm run build
```

Release verification should also include dependency audits (`npm audit`, `python -m pip_audit`), a Docker build, and container/image vulnerability scans.

## Licensing

LicenseTrack is distributed under the LicenseTrack Source-Available License. See [LICENSE](LICENSE).

In short, the license allows internal self-hosted use, private internal modifications, implementation services, and independent integrations/extensions. A separate commercial license is required for hosted services, managed services, tracking third-party licenses, commercial distribution of derivative works, or incorporation into a commercial product.

LicenseTrack uses a source-available license, not an OSI-approved open source license.

Third-party dependencies remain governed by their own license terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
