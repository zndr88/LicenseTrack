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
