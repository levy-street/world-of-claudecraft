<!-- src/admin/ — the admin dashboard SPA. Repo-wide architecture/invariants live
     in the ROOT CLAUDE.md; src/ dependency rules in src/CLAUDE.md. This file is
     only the admin SPA's local stack. The backend it calls is server/admin.ts
     (see server/CLAUDE.md). -->

# src/admin/ — admin dashboard SPA

A standalone vanilla-TS dashboard for ops/moderation. **Separate Vite entry**
(`admin.html` at repo root → `<script src="/src/admin/main.ts">`), wired as the
`admin` rollup input in `vite.config.ts`. It is **completely independent of the
game client**: no `IWorld`, no `src/render`/`src/ui`/`src/sim` imports. No
framework — it builds HTML strings and assigns `innerHTML`.

## Files
- `main.ts` — entry: auth flow, `refresh*()` fetchers, `wireEvents()` (delegated `data-*` handlers), live (5s) + activity (60s) timers.
- `api.ts` — fetch wrapper over `/admin/api/*`. `apiLogin/apiGet/apiPost`, `ApiError`, token in `localStorage` (`claudecraft_admin_token`/`_name`).
- `types.ts` — TS shapes of every endpoint response (mirrors `server/admin_db.ts` + `server/moderation_db.ts`).
- `tables.ts` — pure `render*Table`/detail HTML-string functions.
- `charts.ts` — hand-rolled SVG `barChart` + `chartPanel` (no chart lib).
- `format.ts` — `escapeHtml`, `fmtDuration/Date/Relative/Copper/Bytes`.

## Talks to server/admin.ts over `/admin/api`
All responses use the `{ success, data, error }` envelope (unwrapped in `api.ts`).
GET: `/overview`, `/online`, `/activity`, `/accounts?search&page`, `/accounts/:id`,
`/characters?sort&dir&page`, `/moderation/queue`, `/moderation/accounts/:id`.
POST: `/login`, `/moderation/accounts/:id/{suspend,ban}`,
`/moderation/reports/:id/ignore`, `/moderation/characters/:id/force-rename`.
In dev, Vite proxies `/admin/api` → `:8787` (see `vite.config.ts`).

## Auth — server-side, not client-side
Login (`POST /admin/api/login`) and **every** endpoint are gated in
`server/admin.ts`: it requires a `Bearer <64-hex>` token whose account has
`is_admin = TRUE` (`adminAccountId()`). The `admin.*` host is just routing — **not
security**. The SPA only stores the token and shows the login panel on 401/403
(`handleAuthFailure`). Never assume client-side gating protects anything.

## Adding a panel / table / chart
1. Add the response shape to `types.ts` (match the server return exactly).
2. Add a `<section>`/container with a stable `id` in `admin.html`; style there.
3. Write a pure `render*` HTML-string fn in `tables.ts` (or `barChart`+`chartPanel`).
4. In `main.ts`: add an `async refreshX()` that `apiGet`s and sets `$('id').innerHTML`,
   call it from `showApp()` (and a timer if live), wrap in try/catch + `handleAuthFailure`.
5. For clicks/sorts/pagers, attach **one delegated listener** in `wireEvents()` and
   key off `data-*` attributes you emit in the renderer (see the moderation handler).

A new backend endpoint must be added in `server/admin.ts` first (see server/CLAUDE.md).

## Gotchas / never do
- **YOU MUST `escapeHtml()` every player-controlled value** (usernames, character
  names, chat, report details) — everything is rendered via `innerHTML`. Forgetting
  it is an XSS hole.
- Don't read auth/permission state from the client to allow an action — the server
  re-checks admin on every request; the UI gate is cosmetic.
- `$('id')` throws if the element is missing — keep `admin.html` ids in sync with `main.ts`.
- Don't import anything from `src/sim`, `src/render`, `src/ui`, `src/net`, or `IWorld` here.
