# Demo mode (GitHub Pages demo build only)

This directory implements the in-browser fake backend used by the public demo
at the project's GitHub Pages site. It exists ONLY in builds produced with
`vite build --mode demo` (which loads `.env.demo` and sets `VITE_DEMO_MODE=true`).

**There is no demo account in the real application.** The `demo` / `demo`
credentials are strings inside this mock; the backend has no such user, no
seed script creates one, and no API accepts them.

Demo builds are written to `frontend/dist-demo`; normal production builds are
written to `frontend/dist`. This keeps a demo test or Pages build from replacing
a production bundle left in the working tree.

**Production builds contain none of this code.** The check in
`src/api/client.js` reads `import.meta.env.VITE_DEMO_MODE` as a build-time
constant, so Vite dead-code-eliminates this entire directory from normal
builds. Verify yourself after `npm run build`:

    grep -ri "LICENSETRACK_DEMO_MARKER" dist/   # no matches in a normal build

After `npm run build -- --mode demo`, the marker must be present only in
`dist-demo/`.

All demo state lives in browser memory: logging out or refreshing resets it.
Nothing is written to localStorage; nothing leaves the browser.

## Keeping the fake backend in sync

`store.js`, `handlers.js` and `fixtures.js` re-implement backend rules. Each
mirror is tagged with a `Mirrors backend/app/...` comment naming the function it
follows. `reportHelpers.js` mirrors `reporting_service.py` for the demo's
Reports page. After a release that changes backend behavior, diff `backend/app`
since the last re-sync and update the matching mirrors. Fixture terms follow
the app's date convention: a one-year term ends the day before its anniversary.

Two guards fail when the demo and the server drift apart:

- `__tests__/mirrorMarkers.test.js` checks that every `backend/app/...py` file
  named in a comment still exists, and the function named after it as well.
  Write the function as `backend/app/services/x.py::function_name` so the
  test picks it up.
- `__tests__/sharedCases.test.js` runs the case files in
  `backend/tests/fixtures/` (`portfolio_stats_cases.json`,
  `completeness_cases.json`) that the server tests run too. Add a case there
  when a statistics or completeness rule changes.

The backend's daily license jobs (ended one-off Service/Other retirement,
scheduled retirements, and maintenance hand-over) run once when the demo
session starts.

Deliberate simplifications:

- The server-owned-field rejection on license create is not ported.
- URL sync (deep links) is off, because GitHub Pages has no SPA fallback.
- Coverage history, audit events, emails, and document storage are not kept.
- Quote documents are stubbed, and established renewal terms are not validated.
- A maintenance line whose parent is bought on the same PO is not linked.
