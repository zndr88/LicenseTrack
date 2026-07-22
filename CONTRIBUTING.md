# Contributing

## Contribution Licensing

LicenseTrack welcomes issues, pull requests, patches, integrations, extensions, and suggested improvements.

By submitting a pull request, patch, or suggested modification to this repository, you agree that your contribution may be incorporated into LicenseTrack and distributed under the LicenseTrack Source-Available License or other license terms chosen by the Licensor, including commercial terms. You retain ownership of any copyright you hold in your contribution, but you grant the Licensor the broad rights described in Section 7 of the LicenseTrack Source-Available License.

If you want to keep an extension under your own separate terms, publish it as a standalone integration or sidecar instead of submitting it for inclusion in the main repository. Independent integrations may be released under your own license terms as described in Section 2.2 of the LicenseTrack Source-Available License. That legal permission does not imply LicenseTrack product support or compatibility for the integration.

## Integrations, Extensions, And Core Contributions

LicenseTrack is intended to be extended through documented APIs, import/export contracts, webhooks, and sidecars. It does not support arbitrary third-party in-process packages, runtime React loading, or arbitrary frontend component injection. The internal Official Extensions host is reserved for optional packages published and signed by the LicenseTrack project; those packages are maintained as trusted application code by project maintainers.

Use this guide when deciding how to contribute or build on LicenseTrack:

| Need | Recommended path |
| --- | --- |
| Company-specific automation or private system connection | Build an API integration outside this repository |
| Optional first-party capability maintained by the LicenseTrack project | Propose an Official Extension and coordinate signing/release ownership with maintainers |
| Broad feature that belongs in the main procurement workflow | Open an issue or pull request for core |
| Experimental or customer-specific workflow | Keep it as a private integration until the contract is clear |

Private integrations and extensions are maintained by their owners. When LicenseTrack changes, their owners are responsible for validating compatibility before upgrading production deployments.

Do not package custom or third-party automation for the internal host. Use the public API/webhook/sidecar framework instead. See `docs/extension-authors/overview.md` and `docs/extension-authors/api-stability.md` for the current integration model and compatibility expectations. Internal Official Extension maintainers use `docs/plugin-authors/`.

## Local Development

Backend:

```bash
cd backend
pip install -r requirements.txt
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Quality Checks

Run these before preparing a release:

```bash
cd backend
py -3.12 -m ruff check .
py -3.12 -m pytest tests
```

```bash
cd frontend
npm run lint
npm run test:run
npm run test:coverage
npm run test:e2e
npm run build
```

Before release, also refresh dependency checks from the current manifests:

```bash
cd frontend
npm audit
```

```bash
python -m pip_audit -r backend/requirements.txt
```

## Current Architecture Conventions

- Follow the repository style contract in `docs/maintainer/style-contract.md`. It is the source of truth for conservative backend, frontend, CSS, testing, and AI-assisted coding conventions.
- Use TanStack Query for frontend server data. Add query keys to `frontend/src/queryKeys.js` and shared invalidation groups to `frontend/src/queryInvalidation.js` when repeated cross-page invalidation appears.
- Keep backend route handlers thin. Workflow-heavy behavior belongs in services, such as pending-order conversion in `backend/app/services/pending_order_conversion_service.py`.
- Use shared custom-field helpers rather than duplicating key, label, input, or formatting logic. Frontend presentation helpers live in `frontend/src/utils/customFieldPresentation.js`; backend value normalization lives in `backend/app/services/custom_fields_service.py`.
- Use `ModalShell` for active modal/dialog shell behavior. `ConfirmDialog` and `DiscardChangesDialog` are the standard wrappers for confirmation and dirty-discard flows.
- Use React Hook Form and Zod for new or migrated complex forms. Settings validation schemas live in `frontend/src/utils/settingsSchemas.js`; procurement schemas live in `frontend/src/utils/procurementSchemas.js`.
- Multi-year commitments are intentionally parked. Do not enable, delete, or refactor them as accidental dead code without an explicit product decision.

## Stable Release Scope

The stable release track is Docker/web only. Desktop wrappers and unsupported runtimes are outside the stable core scope. Automated document parsing belongs outside core as an optional extension built against the documented document-processor contracts.
