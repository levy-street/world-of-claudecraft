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
- `admin.css`: the style **barrel** (mirrors the game client's `src/styles/index.css`). It declares the one canonical `@layer tokens, base, components` order and `@imports` the modules under `src/admin/styles/` in that order, holding no rules of its own; Lightning CSS inlines the local `@imports` into one stylesheet at build (no runtime waterfall). Imported once from `main.ts`.
- `styles/`: the layered CSS modules, each opening its own `@layer`: `tokens.css` (`:root` design tokens), `base.css` (reset, form controls via zero-specificity `:where()`, base buttons, native-control normalization, the `@media (pointer: coarse)` mobile-zoom `!important` floor), then three `@layer components` modules imported in source order: `components.css` (panel, login, layout, chat filter, stat cards, tables, badges, detail grid, controls), `charts.css` (charts grid + SVG primitives + range tabs), `moderation.css` (moderation detail + `mod-confirm`). Layer names are FLAT, never dotted (a dot is a sublayer separator that reorders the cascade). Svelte component `<style>` blocks are scoped and UNLAYERED, so they always win over these layered primitives regardless of specificity (the intended direction: the barrel is the low-priority base, components override locally); the mobile-zoom floor survives via `!important`. Colors that recur across the modules and the scoped styles are semantic `--tokens` in `tokens.css` (`--bg-app`, `--surface-sunken`/`--surface-inset`, `--btn-flat-bg`, `--border-soft`/`--border-subtle`, `--text-bright`/`--text-soft`, `--color-danger`/`--color-danger-border`), not hand-typed hex at each call site; genuinely one-off colors stay inline. Component-specific layout is scoped `<style>`.
- `state/`: runes singletons: `auth.svelte.ts` (token/name, login, logout, `handleAuthFailure`), `session.svelte.ts` (locale signal), `poll.ts` (interval helper + refresh constants).
- `navigation.ts`: typed page/IP route parsing, URL serialization, History API interception, and optional navigation context for native links.
- `components/`: shared UI: `Login`, `AdminShell`, `AdminNav`, `AccountModal`, `AccountLink`, `Panel`, `Badge`, `AccountIndicators`, `IpLink`, `StatCard`, `Pager`, `BarChart` (native SVG, no `{@html}`), `ConfirmDialog`, `ModerationActionPrompt`, `AccountModerationActions`, `ChatModerationControls`, `ModerationHistory`, `ScreenshotOverlay`, `OnlineTable`, `CharactersTable`, `ProviderUsage`, `WordList`, `ChatModeration`, `IpBlockSection`.
- `pages/`: one per route: `Overview`, `Usage`, `Accounts`, `Characters`, `Moderation` (+ `ModerationDetail`), `SharedIps`, `ChatFilter`, `BlockedIps`, `BugReports`, plus the shared `AccountDetail`. `pages.ts` is the navigation tree.
- Host-agnostic helpers (plain `.ts`, unit-tested directly): `moderation_actions.ts` (builds the suspend/ban/chat-mute/force-rename/ban-ip request + validation), `ip_block.ts` (`knownAccountIps`), `block_expiry.ts`, `labels.ts` (`reasonLabel`).
- Reused as-is: `api.ts` (fetch wrapper, `apiLogin/apiGet/apiPost`, `ApiError`, token in `localStorage`), `types.ts` (endpoint response shapes), `format.ts` (`fmtDuration/Date/Relative/Copper/Bytes/Number/Percent`), `i18n.ts` (+ `i18n.en.ts`, `i18n.locales/`, `i18n.resolved.generated/`).

## i18n: operators are users, so all rendered text routes through `t()`
Admin has its OWN sparse-overlay catalog, independent of the game. Author English in
`i18n.en.ts` (flat dotted keys) and render via `{t('key')}` / `placeholder={t('key')}`;
**never edit the 20 `i18n.locales/<lang>.ts` overlays** (the maintainer fills them at
release). Regenerate the dense `i18n.resolved.generated/` dir with `npm run i18n:admin`
after any key change; the release-tier gate (`I18N_RELEASE_TIER=1`) hard-fails on a
`pending` admin row. Server error bodies reverse-map via `localizeAdminError`;
`classLabel`/`zoneLabel` reverse-map server ids. `?lang=en_XA` on a non-release build
surfaces any un-keyed literal. The guard `tests/i18n_admin_catalog.test.ts` scans every
literal `t('...')` in this dir and fails on an untracked key.

## Talks to server/admin.ts over `/admin/api`
All responses use the `{ success, data, error }` envelope (unwrapped in `api.ts`).
GET: `/overview`, `/online`, `/suspicious-players`, `/activity`, `/accounts?search&page`,
`/accounts/:id`, `/shared-ips?sort&dir&online&page`, `/ip-associations?ip&page`,
`/characters?sort&dir&page`, `/moderation/queue`, `/moderation/accounts/:id`, `/chat-filter`,
`/blocked-ips`, `/bug-reports?page`, `/bug-reports/:id/screenshot`.
POST: `/login`, `/moderation/accounts/:id/{suspend,unsuspend,ban,unban,chat-mute,lift-mute,reset-strikes}`,
`/moderation/characters/:id/force-rename`, `/moderation/reports/:id/ignore`,
`/chat-filter/words`, `/chat-filter/words/:id/delete`, `/chat-filter/config`,
`/blocked-ips`, `/blocked-ips/delete`. In dev, Vite proxies `/admin/api` to `:8787`.

## Auth: server-side, not client-side
Login (`POST /admin/api/login`) and **every** endpoint are gated in `server/admin.ts`:
a `Bearer <64-hex>` token whose account has `is_admin = TRUE`. The `admin.*` host is
just routing, **not** security. `state/auth.svelte.ts` only stores the token and shows
the login screen on 401/403 (`handleAuthFailure`). Never gate an action on client-read
state.

## Adding a panel / table / chart
1. Add the response shape to `types.ts` (match the server return exactly).
2. Build a `.svelte` component (a page composes shared components; a new self-contained
   widget is its own component, not markup bolted into a page). Render data with `{...}`
   (Svelte auto-escapes) and text with `{t('key')}`.
3. Fetch via `apiGet`/`apiPost`; wrap in try/catch and route errors through
   `auth.handleAuthFailure` (then `localizeAdminError`/an `alert.*` key). Live data uses
   `poll()` inside `onMount` so the timer is torn down on tab switch.
4. Lift pure logic (request shaping, validation, id/state resolution) into a plain `.ts`
   helper and unit-test it (see `moderation_actions.ts`, `ip_block.ts`).
5. A new backend endpoint goes in `server/admin.ts` first (see server/CLAUDE.md).

## Gotchas / never do
- **Escaping is automatic:** Svelte escapes `{value}`. Only `{@html}` reintroduces an
  XSS surface, so avoid it for player-controlled values (there is currently none in
  this dir; `BarChart` uses native SVG elements, not `{@html}`).
- Don't read auth/permission state from the client to allow an action; the server
  re-checks admin on every request.
- Don't import from `src/sim`, `src/render`, `src/ui`, `src/net`, or `IWorld` here.
- **Mobile zoom:** every `input`/`textarea`/`select` must render **≥16px** on touch or
  iOS Safari zooms on focus. The `@media (pointer: coarse)` floor in `admin.css`
  enforces it centrally; keep it and don't add a per-control mobile font below 16px.
  Don't add `user-scalable=no`/`maximum-scale` to the viewport. Check:
  `node scripts/mobile_input_zoom_check.mjs` (needs `npm run dev`).
- Tests: component tests live in `tests/admin/*.test.ts` (jsdom via a per-file
  `// @vitest-environment jsdom` docblock + `tests/admin/_setup.ts`); pure helpers test
  in the default Node env. Run `npm run check:admin` for types.
