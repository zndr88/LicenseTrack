# Third-party notices

This project includes third-party open source software dependencies.
This file is a human-readable starting point for attributions; for an authoritative inventory, generate and review SBOMs for the exact release artifacts.

## Core runtime (Docker) - direct dependencies

Python backend (see `backend/requirements.txt`):
- FastAPI (MIT)
- Starlette (BSD-3-Clause)
- Uvicorn (BSD-3-Clause)
- SQLAlchemy (MIT)
- Alembic (MIT)
- Pydantic / pydantic-settings (MIT)
- Authlib (BSD-3-Clause)
- bcrypt (Apache-2.0)
- cryptography (Apache-2.0 OR BSD-3-Clause)
- aiosqlite (MIT)
- python-multipart (Apache-2.0)
- APScheduler (MIT)
- aiosmtplib (MIT)
- email-validator (Unlicense)
- httpx (BSD-3-Clause)
- pytest (MIT), pytest-asyncio (Apache-2.0), respx (BSD-3-Clause), ruff (MIT) (testing and development only; not required at runtime)

Frontend (see `frontend/package.json` and `frontend/package-lock.json`):
- React / react-dom (MIT)
- @hookform/resolvers (MIT)
- @tanstack/react-query (MIT)
- @tanstack/react-virtual (MIT)
- Recharts (MIT)
- jsPDF (MIT)
- html2canvas (MIT)
- react-hook-form (MIT)
- zod (MIT)
- Vite / @vitejs/plugin-react (MIT)
- Vitest (MIT)
- @vitest/coverage-v8 (MIT; testing and coverage only)
- @playwright/test (Apache-2.0; browser testing only)
- @testing-library/jest-dom, @testing-library/react, @testing-library/user-event (MIT; testing only)
- @types/react / @types/react-dom (MIT; development only)
- ESLint / eslint-plugin-react / eslint-plugin-react-hooks (MIT; development only)
- jsdom (MIT; testing only; current lockfile resolves its transitive `ws` dependency to `8.20.1`)

## Fonts and other assets

The frontend bundles the Space Grotesk, Outfit, and DM Mono webfonts under `frontend/public/fonts/` (no external font CDN).
These fonts are distributed under the SIL Open Font License 1.1; see `frontend/public/fonts/OFL-1.1.txt`.

## Container base images

The Docker build currently uses:
- `node:20-alpine` (build stage)
- `python:3.12-slim` (runtime stage)

These images contain additional third-party components and OS packages; include a container SBOM in release artifacts when distributing images.
