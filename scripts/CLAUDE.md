<!-- scripts/: plain Node `.mjs` tooling (build, browser E2E, screenshot tours,
     multiplayer integration, admin utils). NOT TypeScript, NOT part of the
     vite/esbuild build. Root CLAUDE.md covers the repo + sim/server model;
     don't repeat it here. Asset pipeline lives in scripts/assets/ (own file). -->

# scripts/

Standalone Node ESM (`.mjs`) tooling, **not** compiled by vite/esbuild and **not**
TypeScript. Run a script directly: `node scripts/<name>.mjs`. Several are wired into
npm (see `package.json`); many more run directly.

## What runs where
- **Browser scripts** use `puppeteer-core` + `browser_path.mjs` and need `npm run dev`
  (:5173). They launch headless Chrome/Edge with `--use-angle=swiftshader` and drive
  the real game via the `window.__game` global (`__game.sim`, `.hud`, `.input`, `.renderer`).
- **Multiplayer scripts** use `ws` + `fetch` against a running `npm run server` (:8787).
  Override host with `SERVER_URL=` / `GAME_URL=`.
- **Server bots that teleport/level/grant** (`dev_teleport`, `dev_level`, `dev_give`)
  need the server started with `ALLOW_DEV_COMMANDS=1`, **dev only** (see root invariants).
- **Admin utils** talk straight to Postgres via `DATABASE_URL` (call `process.loadEnvFile()`,
  so a local `.env` works); they do not need the server.
- Screenshot tours write PNGs into `tmp/` (gitignored). They typically god-mode the
  player so camp mobs don't kill the camera.

## Scripts by purpose
| Group | Files | Needs |
|---|---|---|
| Build | `build_media_manifest.mjs` (`generate` to `manifest.generated.ts`, `emit` to `dist/media`) | none |
| Browser E2E (offline) | `smoke_browser.mjs`, `smoke_mage.mjs`, `smoke_rogue.mjs`, `check_directions.mjs` | dev |
| MP E2E (browser) | `mp_browser.mjs`, `mp_combat_visibility.mjs`, `market_mp_e2e.mjs` | dev + server |
| MP integration (ws) | `mp_integration.mjs`, `chat_e2e.mjs`, `chat_log_persistence.mjs`, `social_e2e.mjs`, `crypt_raid.mjs` | server (+`ALLOW_DEV_COMMANDS=1` for raid) |
| Security | `ws_security_e2e.mjs` (server), `malware_scan.mjs` (release-gate malicious-code flagger over the whole tree; `security:scan` / `security:gate`, exits 1 on findings) | server / none |
| Screenshot tours | `visual_tour.mjs`, `arena_visual.mjs`, `market_visual.mjs`, `social_visual.mjs`, `tour_expansion.mjs` | dev (some + server) |
| SEO / homepage / i18n | `homepage_verify.mjs`, `seo_audit.mjs`, `localization_e2e.mjs` (locale-matrix homepage E2E) | dev (+ server) |
| i18n pipeline | `i18n_build.mjs`+`i18n_admin_build.mjs` (resolved tables), `i18n_scan.mjs` (status registry), `i18n_resolved_hash.mjs` (game-table SHA gate); seed `i18n_blocked_seed.mjs` owns `V07_SLASH`/`COPIED_ALLOW_IDS`; `i18n_pseudo.mjs` (en_XA dev pseudo-locale), `i18n_modulepreload.mjs` (lazy-locale boot modulepreload) | `i18n:gen`; SHA via `i18n:hash` |
| Data export | `export_loot_spreadsheet.mjs` (esbuild-bundles `src/sim` to a loot sheet in `docs/`) | none |
| Admin / dev utils | `grant_admin.mjs`, `create_gm.mjs` | `DATABASE_URL` |
| Local realms | `dev-realms.mjs` (launches built server processes) | built server (`npm run realms`) |
| Helper | `browser_path.mjs` (resolves Chrome/Edge/Chromium; override `BROWSER_PATH=`) | none |

## Conventions (verifiable patterns to copy)
- ws scripts inline `mergeSelf`/`mergeEnts` to reconstruct delta snapshots
  (`DELTA_SELF_KEYS`, `ENTITY_IDENTITY_KEYS`, `snap.keep`). Match the wire field
  names exactly (`tid`, `lv`, `res`, `gcd`, ...), they mirror the server snapshot.
- E2E scripts track pass/fail via a local `check(name, cond, extra)` and
  `process.exit(fail > 0 ? 1 : 0)`; browser scripts also collect `pageerror`/console-error.
- Character names are letters-only (classic rule), scripts derive an `alpha` suffix
  from a base-36 timestamp so reruns don't collide.

## How to add one
- **Browser E2E / tour:** copy `smoke_browser.mjs` / `visual_tour.mjs`; import
  `BROWSER_PATH` from `./browser_path.mjs`, read state through `window.__game`,
  `mkdirSync('tmp')` before screenshots.
- **MP integration:** copy `mp_integration.mjs`; reuse its `Client` class + merge helpers.

## Never
- These are raw `.mjs` run directly by Node, not part of the vite/esbuild build; keep
  deps Node-only (`ws`, `pg`, `puppeteer-core`). Most never touch `src/`. Several scripts
  that need sim or i18n data bundle the TS with `esbuild` themselves (e.g.
  `export_loot_spreadsheet.mjs` and the `i18n_*` builders); follow that pattern and never
  `import` the TS sources raw.
- Don't hand-edit the generated i18n artifacts: `src/ui/i18n.resolved.generated/` +
  `src/admin/i18n.resolved.generated/` (resolved tables), `src/ui/i18n.status.json` /
  `i18n.status.summary.json` (registry), and `src/ui/i18n.resolved.sha256` (byte gate).
  Regenerate with `npm run i18n:gen`; after a real translation-content change re-baseline
  the SHA with `npm run i18n:hash -- --write`.
