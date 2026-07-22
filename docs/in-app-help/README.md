# In-App Help

The canonical version-local Help Center catalog lives in
`frontend/src/components/pages/HelpPage.jsx`. It is bundled into the self-hosted
application so authenticated users can read it without reaching an external
documentation site.

This directory intentionally contains no second copy of the articles. Keeping a
text mirror beside the frontend catalog caused the two versions to drift and
mixed maintainer implementation notes into user-facing material.

Public operator guidance belongs in `wiki/`. Maintainer implementation notes
belong in `docs/maintainer/`. When a Help article needs to change, edit the
frontend catalog and update the matching public page when one exists.
