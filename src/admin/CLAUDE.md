<!-- src/admin/: the admin dashboard SPA. Repo-wide architecture/invariants live
     in the ROOT CLAUDE.md; src/ dependency rules in src/CLAUDE.md. This file is
     only the admin SPA's local stack. The backend it calls is server/admin.ts
     (see server/CLAUDE.md). -->

# src/admin/: admin dashboard SPA

A standalone **Svelte 5 (runes)** dashboard for ops/moderation. **Separate Vite entry**
(`admin.html` at repo root: `<script src="/src/admin/main.ts">`), wired as the `admin`
rollup input in `vite.config.ts` (the `svelte()` plugin is registered there). It is
**completely independent of the game client**: no `IWorld`, no `src/render`/`src/ui`/
`src/sim` imports. Svelte is the one sanctioned UI-framework exception in this repo and
is scoped to this bundle only. Components are `.svelte` with `<script lang="ts">`,
type-checked by `npm run check:admin` (svelte-check over `tsconfig.admin.json`).

## Layout
- `main.ts`: entry, loads the locale, sets `document.title`, mounts `App.svelte` into `#app`, imports `admin.css`.
- `App.svelte`: root, auth gate (login vs dashboard), URL-backed typed routing, `{#key session.locale}` re-render.
- `admin.css` + `styles/`: the style barrel (mirrors the game client's `src/styles/index.css`)
  declares the one canonical `@layer tokens, base, components` order over the modules in
  `styles/`. The header comment in `admin.css` is the cascade model, read it before touching
  CSS here: flat layer names (a dot is a sublayer separator that reorders the cascade),
  scoped Svelte `<style>` blocks are UNLAYERED so they win over the layered base, recurring
  colors are semantic `--tokens` in `styles/tokens.css`, and the mobile-zoom `!important`
  floor lives in `styles/base.css`.
- `state/`: runes singletons: `auth.svelte.ts` (token/name/roles/permissions, login, `hydrate` via `/me`, logout, `handleAuthFailure`, `can(permission)`), `session.svelte.ts` (locale signal), `poll.ts` (interval helper + refresh constants).
- `navigation.ts`: typed page/IP route parsing, URL serialization, History API interception, and optional navigation context for native links.
- `components/`: shared UI; reuse a family before writing a bespoke one: dialogs are
  `ModalDialog`/`ConfirmDialog`, charts are `BarChart`/`LineChart` (native SVG, no `{@html}`),
  moderation actions go through the existing `*Moderation*` components. Enumerate:
  `ls src/admin/components`.
- `pages/`: one `.svelte` per route id (enumerate: `ls src/admin/pages`). `pages.ts` is the
  navigation tree: each item carries its `permission`; `visibleNavSections`/`firstVisiblePage`
  drive the sidebar filter and route-guard fallback. Server-authored data renders as data, not
  keys (exemplar: `AntibotConfig` field labels are server data, its chrome is `t()`).
- Host-agnostic helpers (plain `.ts` at the dir root, unit-tested directly): exemplars are
  `moderation_actions.ts` (request shaping + validation), `histogram_stats.ts` (pure stats for
  `DetectionCalibration`), `permissions.ts` (client mirror of the server permission vocabulary;
  parity pinned by `tests/admin_permissions.test.ts`). Enumerate: `ls src/admin/*.ts`.
- Reused as-is: `api.ts` (fetch wrapper, `apiLogin/apiGet/apiPost`, `ApiError`, token in `localStorage`), `types.ts` (endpoint response shapes), `format.ts` (the locale-aware `fmt*` formatting helpers; enumerate via grep), `i18n.ts` (+ `i18n.en.ts`, `i18n.locales/`, `i18n.resolved.generated/`).

Recent surfaces follow the same shape, permission-gated per page: `SuspiciousPlayers` +
`DetectionCalibration` (`botdetector.read`; pure stats in `histogram_stats.ts`, exports in
`calibration_export.ts`/`suspicious_sessions_export.ts`), `TickPerf` (`ops.perf`; on-demand
`POST /perf/tick/capture`), `ModerationHistoryPage` (`moderation.read`), timed
daily-rewards bans (optional duration in hours, blank means permanent) and account notes
(`moderation.act`), reset-password (`accounts.password`), and the AccountModal Reward
Points event ledger (`accounts.read`; pure presentation in `daily_reward_event_log.ts`,
pinned by `tests/admin/daily_reward_event_log.test.ts`).

## i18n: operators are users, so all rendered text routes through `t()`
Admin has its OWN sparse-overlay catalog, independent of the game. Author English in
`i18n.en.ts` (flat dotted keys) and render via `{t('key')}` / `placeholder={t('key')}`;
**never edit the `i18n.locales/<lang>.ts` overlays** (the maintainer fills them at
release). Regenerate the dense `i18n.resolved.generated/` dir with `npm run i18n:admin`
after any key change; the release-tier gate (`I18N_RELEASE_TIER=1`) hard-fails on a
`pending` admin row. Server error bodies reverse-map via `localizeAdminError`;
`classLabel`/`zoneLabel` reverse-map server ids. `?lang=en_XA` on a non-release build
surfaces any un-keyed literal. The guard `tests/i18n_admin_catalog.test.ts` scans every
literal `t('...')` in this dir and fails on an untracked key.

## Talks to server/admin.ts over `/admin/api`
All responses use the `{ success, data, error }` envelope (unwrapped in `api.ts`). The
authoritative endpoint list is `ADMIN_ROUTE_PERMISSIONS` in `server/admin_routes.ts`: a
declarative, fail-closed table consulted BEFORE the handler chain (a route missing there
can never execute), kept complete by `tests/admin_routes.test.ts` (it scans
`server/admin.ts` for handled paths with no entry). In dev, Vite proxies `/admin/api`
to `:8787`.

## Auth: server-side, not client-side
Login (`POST /admin/api/login`) and **every** endpoint are gated in `server/admin.ts`:
a `Bearer <64-hex>` token whose account has at least one staff role
(`accounts.admin_roles`; `is_admin` is the derived "is staff" flag), and every route is
authorized against the declared permission map (vocabulary + role bundles in
`server/admin_permissions.ts`; the fail-closed route map in `server/admin_routes.ts`,
guarded by `tests/admin_routes.test.ts`). The `admin.*` host is just routing, **not**
security. `state/auth.svelte.ts` mirrors the token plus the operator's
roles/permissions for PRESENTATION only (sidebar filtering, the route guard in
`App.svelte`, hiding action buttons via `auth.can(...)`); the server re-checks every
call. `handleAuthFailure` logs out on **401 only**; a 403 means "missing permission"
and surfaces inline via `localizeAdminError`, never a logout. Never gate an action on
client-read state.

## Adding a panel / table / chart (module-first)
**Where new code lands:** a new self-contained widget is its own `.svelte` component under
`components/` that a page composes, never markup bolted into an existing page or `App.svelte`;
its pure logic is a plain `.ts` helper at the dir root. **Where its tests go:** `tests/admin/`
(components under jsdom via a per-file `// @vitest-environment jsdom` docblock +
`tests/admin/_setup.ts`; pure helpers in the default Node env). Fix bugs test-first: a failing
test that reproduces the bug, then the smallest change that turns it green.
1. Add the response shape to `types.ts` (match the server return exactly).
2. Build the `.svelte` component. Render data with `{...}` (Svelte auto-escapes) and text
   with `{t('key')}`.
3. Fetch via `apiGet`/`apiPost`; wrap in try/catch and route errors through
   `auth.handleAuthFailure` (then `localizeAdminError`/an `alert.*` key). Live data uses
   `poll()` inside `onMount` so the timer is torn down on tab switch.
4. Lift pure logic (request shaping, validation, id/state resolution, stats) into a plain
   `.ts` helper and unit-test it (see `moderation_actions.ts`, `histogram_stats.ts`).
5. A new backend endpoint goes in `server/admin.ts` plus a permission row in
   `ADMIN_ROUTE_PERMISSIONS` (see server/CLAUDE.md).

## Gotchas / never do
- **Escaping is automatic:** Svelte escapes `{value}`. Only `{@html}` reintroduces an
  XSS surface, so avoid it for player-controlled values (there is currently none in
  this dir; the chart components use native SVG elements, not `{@html}`).
- Don't read auth/permission state from the client to allow an action; the server
  re-checks admin on every request.
- Don't import from `src/sim`, `src/render`, `src/ui`, `src/net`, or `IWorld` here.
  Enforced, not just convention: `tests/i18n_admin_catalog.test.ts` walks every `.ts`
  under `src/admin` and fails any relative import that resolves outside the dir;
  shared-looking helpers (`format.ts`, `api.ts`) are deliberate local copies.
- **Mobile zoom:** every `input`/`textarea`/`select` must render at least 16px on touch
  or iOS Safari zooms on focus. The `@media (pointer: coarse)` floor in `styles/base.css`
  enforces it centrally; keep it and don't add a per-control mobile font below 16px.
  Don't add `user-scalable=no`/`maximum-scale` to the viewport. Check:
  `node scripts/mobile_input_zoom_check.mjs` (needs `npm run dev`).
