# LicenseTrack Style Contract

This contract exists to keep LicenseTrack consistent as it continues to be built with human and AI-assisted coding. It is not a rewrite plan. It describes the direction new and touched code should move toward, using the strongest existing patterns in the repository.

The primary rule is simple: make each change look like it belongs in the codebase that is already here.

## Release Philosophy

Maintenance releases should reduce drift without hiding large rewrites.

- Prefer small, reviewable changes that leave the app working after each milestone.
- Do not reformat or restructure unrelated files just because they are nearby.
- Do not introduce a new style era inside one feature. Match the chosen contract and the local code around the change.
- Refactor only when it removes real duplication, reduces risk, or makes a large workflow easier to test.
- Keep product behavior stable unless the issue being fixed explicitly requires behavior change.

## Tooling Is The Referee

Use tools where they exist, and do not fight them.

Backend:

```bash
cd backend
py -3.12 -m ruff check .
py -3.12 -m pytest tests
```

Frontend:

```bash
cd frontend
npm run lint
npm run test:run
npm run build
```

Current frontend formatting is ESLint-led. Do not assume Prettier rules unless Prettier is added and adopted deliberately.

## Encoding And Text

All source files should be valid UTF-8, but new code should use plain ASCII unless a real user-facing reason exists.

- No mojibake artifacts, such as UTF-8 punctuation rendered as garbled accented characters.
- Use `...` for loading text unless the surrounding file has intentionally standardized on a real ellipsis.
- Avoid decorative divider comments made from box-drawing characters.
- Keep comments professional and useful. Remove joke comments, frustration notes, and old scratchpad text before release.
- User-visible copy may use proper punctuation when it is intentional and verified in the browser.

## Backend Contract

The backend is a FastAPI, SQLAlchemy, and Pydantic application. Keep that shape.

### Routes

- Route handlers should stay thin.
- Workflow-heavy behavior belongs in services.
- Use one consistent dependency style in a file. Prefer existing local aliases if the file already uses them.
- Keep response status behavior explicit and readable.
- Avoid defining local Pydantic request/response models inside route modules unless they are truly route-private and tiny.
- Do not split a large route file only for aesthetics in a maintenance release. Split when there is a clear domain boundary and tests can cover the move.

### Services

- Services own business workflows and cross-model rules.
- Prefer small pure helpers for parsing, normalization, and derived values.
- Use module-level loggers consistently: `logger = logging.getLogger(__name__)`.
- Avoid silent `except Exception` blocks. If broad exception handling is necessary, log enough context or return an explicit failure path.
- Keep `type: ignore` rare and explained when used.

### Schemas And Models

- Prefer one optional typing style within a file. For new code, prefer modern Python union syntax where it fits the surrounding file.
- Avoid mutable defaults for schema fields unless Pydantic semantics make the intent explicit. Prefer default factories for lists and dicts.
- Keep alias/camelCase configuration consistent with nearby schemas.
- Shared schema behavior should live in shared schema helpers, not repeated per route.

### Imports And Formatting

- Let Ruff format Python files.
- Keep imports at the top unless a local import is required to avoid a cycle or optional dependency cost.
- Do not manually align large blocks if the formatter will undo it.
- Keep line length within the configured Ruff limit.

## Frontend Contract

The frontend is a React/Vite JavaScript app. Keep the current architecture and improve it gradually.

### Components

- Prefer `export default function ComponentName(...)` for new component files.
- Existing `const Component = (...) => ...; export default Component;` files do not need churn-only edits.
- Components should primarily render UI. Move workflow state, API coordination, and derived data into hooks or focused helpers when the component becomes hard to scan.
- Use existing shared primitives before creating new local variants:
  - `ModalShell`
  - `ConfirmDialog`
  - `DiscardChangesDialog`
  - `Badge`
  - `Toggle`
  - `Checkbox`
  - `SearchBox`
  - `DocumentButton`
  - `RowActionsMenu`
- Use React Hook Form and Zod for new or migrated complex forms.
- Keep modal close/dirty behavior consistent through `useModalGuard`.

### Hooks

- Hook files should be named `useSomething.js` and export named hook functions.
- Small reusable hooks are preferred over large page-controller hooks.
- A hook may coordinate a workflow, but if it owns several unrelated concerns, split it by concern.
- Keep `react-hooks/exhaustive-deps` suppressions rare. If one is necessary, explain why the effect is intentionally scoped.
- Prefer request-id or mounted/current refs for async race protection when fetching data tied to a selected entity.

### API And Data Shape

- API wrappers live in `frontend/src/api`.
- Query keys live in `frontend/src/queryKeys.js`.
- Repeated invalidation groups belong in `frontend/src/queryInvalidation.js`.
- Normalize snake_case API responses at the boundary, not throughout render code.
- Settings response normalization belongs in one normalization layer. Avoid adding new one-off mappers.

### Utilities

- Keep utilities focused by domain.
- Formatting belongs in `frontend/src/utils/formatting.js` unless there is a specific domain reason.
- Generic catch-all helpers should not grow further. Prefer focused modules over adding to `helpers.js`.
- Report calculations are domain logic; treat them as report calculation modules, not casual helpers.
- Shared validation should use centralized Zod schemas or validator utilities rather than per-component regex copies.

### Inline Styles

Inline styles are allowed only when they are genuinely dynamic or very small one-off layout adjustments.

Prefer CSS classes for:

- repeated table styling
- alert/status boxes
- dropdown/menu surfaces
- modal body layouts
- chips and badges
- upload/document blocks
- row action menus
- secret/copy panels

When a pattern appears three times, extract a component or CSS class unless doing so would make the code harder to follow.

### CSS

`frontend/src/styles/global.css` is the stylesheet entrypoint. Keep it as an ordered import manifest, not a place for new selectors.

- Use existing design tokens such as `--bg-*`, `--text-*`, `--border`, and semantic color variables.
- Prefer feature prefixes that already exist, such as `dp-`, `lp-`, `csv-`, `mapping-`, `plugin-`, `set-`, and `rw-`.
- Avoid duplicate selectors. If a selector already exists, extend it in place.
- Avoid `!important` unless overriding an unavoidable third-party or legacy rule.
- Add new selectors to the narrowest existing stylesheet partial:
  - `foundation.css`: tokens, themes, resets, focus, and error-boundary basics.
  - `app-shell.css`: login, sidebar, top bar, main app shell, and page frame.
  - `shared-ui.css`: shared tables, buttons, modals, forms, badges, document blocks, stats, notifications, and common settings shells.
  - `renewals.css`: renewal workbench styles.
  - `settings.css`: settings sections, settings grids, extensions, webhooks, audit log, and email template modal.
  - `settings-plugin-host.css`: settings plugin host management styles.
  - `sidebar-widgets.css`: sidebar version and portfolio widgets.
  - `admin-users.css`: admin page navigation, users page, toast, and small shared admin buttons.
  - `help.css`: Help Center styles.
  - `licenses.css`: page title, detail panel extensions, and license registry toolbar/table extensions.
  - `csv-import.css`: CSV import and mapping resolver styles.
  - `workflows.css`: consumption, pipeline strip, attention banner, and workflow toolbar styles.
  - `platform.css`: browser/platform integration details such as drag regions and scrollbars.
  - `responsive.css`: late cascade responsive overrides that intentionally affect multiple features.
  - `motion.css`: reduced-motion overrides and other late motion safety rules.
- Preserve `global.css` import order unless you are intentionally changing cascade behavior and have verified the visual impact.
- Keep feature-local responsive rules near the feature when possible; use `responsive.css` only for late cross-feature overrides.

## Testing Expectations

Match test effort to risk.

- Formatting-only changes need lint/build checks.
- Shared utility changes need focused unit tests where behavior is non-trivial.
- Route/service changes need backend tests when they affect workflow behavior.
- Frontend workflow changes should cover the user path with component or integration tests when practical.
- Demo-mode behavior should stay tested, especially the guarantee that demo-only behavior is isolated from normal production builds.

## AI-Assisted Work Rules

Any AI-assisted change should follow the same contract.

- Read the local code before editing.
- State the intended scope before making broad changes.
- Prefer established local helpers over inventing new patterns.
- Keep diffs scoped to the milestone.
- Do not mix formatting, refactoring, behavior changes, and version bumps in one commit unless explicitly planned.
- Preserve user or existing work in the tree. Never revert unrelated changes to make a patch easier.
- If the best style is unclear, choose the least invasive option and document the follow-up rather than improvising a new convention.

## What This Contract Does Not Require

This contract does not require:

- rewriting backend routes
- splitting every large component immediately
- converting every component export style
- moving all inline styles in one pass
- replacing the custom icon registry immediately
- converting the codebase to TypeScript

It requires that each new change lowers drift instead of adding to it.
