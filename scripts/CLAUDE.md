<!-- scripts/: standalone Node tooling (gate, build, browser E2E, screenshot tours,
     multiplayer integration, SFX/asset pipelines, PR automation, admin utils).
     Not part of the vite/esbuild build. Root CLAUDE.md covers the repo + sim/server
     model; don't repeat it here. Child docs: scripts/assets/ (GLB pipeline),
     scripts/profiler/ (client profiling), scripts/sfx_studio/ (SFX Studio). -->

# scripts/

Standalone Node ESM tooling, **not** compiled into the vite/esbuild bundles. Mostly plain
`.mjs` run via `node scripts/<name>.mjs`; a few DB-migration/sim tools are `.ts` run via
`tsx` (e.g. `sim:nythraxis-matrix` runs `nythraxis_matrix.ts`; see `package.json`). A module
imported by a type-checked Vitest suite carries a hand-written `.d.mts` next to the `.mjs`
(e.g. `malware_scan.d.mts`). Every npm-wired script gets a row below; many more run directly.

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
| Gate / CI | `gate.mjs` (`npm run gate`): local mirror of the ci.yml PR-tier steps, sequential, stops at the first failure; release-tier (`I18N_RELEASE_TIER=1`) automatic on `release/**` branches; hard-exits if the resolved `ffmpeg`/`ffprobe` binaries fail an execution probe (resolution: `sfx/ffmpeg_paths.mjs`, static packages with PATH fallback; preflight pinned by `tests/sfx_gate_preflight.test.ts`). Keep its step list in sync with `.github/workflows/ci.yml`. | none (bundled FFmpeg) |
| Build | `build_media_manifest.mjs` (`generate` to `manifest.generated.ts`, `emit` to `dist/media`), `build_sitemap.mjs` (`sitemap:build`), `build_sfx_manifest.mjs` (`sfx:manifest`), `check_backdrop_survival.mjs` (post-`vite build` check): all run inside `npm run build`. `build_server.mjs` / `build_bot.mjs` esbuild-bundle the server and bot (`npm run server` / `npm run bot`). | none |
| Asset (FBX to GLB) | `combine_fbx_to_glb.mjs` (+ `combine_fbx_to_glb_entry.js`): merge a rigged character's FBX files (mesh + per-action animation FBXs, or one multi-take FBX) into one `.glb` with every clip. Parses FBX via headless three.js `FBXLoader`/`GLTFExporter` (skinning and embedded textures work where Node CLI converters fail), grafts clips by bone name, then gltf-transform. `--help` lists the flags (folder mode, `--base`/`--anim`, strip options, `--meshopt`/`--webp`). | local Chrome (`browser_path.mjs`) |
| SFX / audio | `sfx_conform.mjs` (`sfx:check` gate / `sfx:conform` = `--fix`; bundles `ffmpeg-static`/`ffprobe-static`) enforces the asset standard in `docs/design/sound_effects.md` (MP3 44.1kHz/192kbps, loudness, mono unless a catalog entry is `stereo: true`, key naming); loudness/format/bitrate fail the gate, channel/naming are advisory unless `--strict`. Pure rules/manifest logic in `scripts/sfx/` (`sfx_conform_rules.mjs`, `sfx_manifest_builder.mjs`); generators `gen_sfx.mjs` (`sfx:gen`, conforms + downmixes each clip), `gen_ui_sfx.mjs` (`sfx:ui`), `gen_npc_voices.mjs`/`gen_npc_lines.mjs` (+ `voices/`), `render_music.mjs` (+ `music_render_entry.ts`); the SFX Studio `sfx_studio/` (`sfx:studio`, playback/encode spawns the bundled static `ffmpeg` via `sfx/ffmpeg_paths.mjs` with PATH fallback; its export conformance validation binds to `ffmpeg-static`/`ffprobe-static` directly, no fallback and no `WOC_FFMPEG_PATH`/`WOC_FFPROBE_PATH` override, so the verdict always matches the `sfx:check` toolchain; own CLAUDE.md; tutorial: `docs/sfx-studio-tutorial.md`) | varies (API keys; `gen_ui_sfx.mjs` still defaults to PATH `ffmpeg`) |
| Guide / wiki (`wiki/`) | `wiki/build_content.mjs` (bundles `src/sim` content into `src/guide/content.generated.ts`; `wiki:content`, in `pretest`/`build`; imports `wiki/family_guard.mjs`, the bestiary FAMILY_ORDER guard shared with `tests/guide.test.ts`), `wiki/render_model_stills.mjs` (+ `wiki/still_key.mjs`, `wiki/stills_render_entry.js`: headless-Chrome pre-render of the bestiary/class still WebPs into `public/guide-stills/`; `wiki:stills`, deliberately NOT in `build`. `tests/guide.test.ts` gates BOTH directions (every figure with a model has a committed WebP, AND no orphan WebP without a figure). Stills are deterministic per machine but NOT byte-identical across GPUs/drivers, so they are existence-gated, never diff-gated: re-render on the `--use-angle=swiftshader` path), `wiki/apply_guide_locales.mjs` (maintainer fill of `guide.*` prose into the locale overlays) | browser binary (stills only) |
| Browser E2E (offline) | `smoke_browser.mjs`, `smoke_mage.mjs`, `smoke_rogue.mjs`, `check_directions.mjs` | dev |
| MP E2E (browser) | `mp_browser.mjs`, `mp_combat_visibility.mjs`, `market_mp_e2e.mjs` | dev + server |
| MP integration (ws) | `mp_integration.mjs`, `chat_e2e.mjs`, `chat_log_persistence.mjs`, `social_e2e.mjs`, `crypt_raid.mjs` | server (+`ALLOW_DEV_COMMANDS=1` for raid) |
| Season 1 Armory | `armory_skins_e2e.mjs` (ws: buy/apply/wire/reconnect, 19 checks), `armory_visual_e2e.mjs` (browser: browse/inspect/buy/apply + screenshots), `armory_thumbs.mjs` (+ `armory_thumbs_entry.js`: pre-render the store thumbnails to `public/ui/store/armory/`), `browser_path_resolve.mjs` (lazy browser resolver for the asset pipeline) | server + economy service (+ dev for visual) / none (thumbs) |
| Security | `ws_security_e2e.mjs` (server), `malware_scan.mjs` (release-gate malicious-code flagger over the whole tree): `security:scan` exits 1 on ANY finding (most are expected false positives an agent triages); `security:gate` (CI) fails only on a HIGH finding surviving the path-aware priors (catalog: `docs/security/malware-scan-catalog.md`) | server / none |
| PR automation | `pr_screenshots.mjs` + `pr_shot_targets.mjs` + `pr_comment_shots.mjs` (+ `gh_image_host.mjs`, `gh_sticky_comment.mjs`) produce and post the PR screenshots the root workflow requires; `prepare_ai_review.mjs` + `post_ai_review.mjs` + `redact_secrets.mjs` power the CI review bot. See `docs/ai-pr-bot.md`. | dev / CI |
| Perf / profiling | `profile.mjs` (scenario CLI, see its `SCENARIOS` map) over `scripts/profiler/` (own CLAUDE.md); `perf_tour.mjs` (`perf:tour`), `prewarm_travel_bench.mjs` (`perf:prewarm`), `server_load_jitter.mjs` (`perf:load`), `feel_smoke.mjs` (`feel:smoke`), `asset_budget.mjs` (`asset:budget`) | dev (some + server) |
| Screenshot tours | `visual_tour.mjs`, `arena_visual.mjs`, `market_visual.mjs`, `social_visual.mjs`, `tour_expansion.mjs` | dev (some + server) |
| SEO / homepage / i18n | `homepage_verify.mjs`, `seo_audit.mjs`, `localization_e2e.mjs` (locale-matrix homepage E2E) | dev (+ server) |
| i18n pipeline | `i18n_build.mjs`+`i18n_admin_build.mjs` (resolved tables), `i18n_scan.mjs` (status registry), `i18n_resolved_hash.mjs` (`i18n:hash`, print-only diagnostic: prints locales/bytes/sha256 for ad-hoc byte-equivalence comparison; no committed baseline, the committed line-item locale slices plus the CI freshness diff and the determinism tests enforce equivalence), `i18n_coverage_summary.mjs` (CI step, posts the coverage counts to the GitHub job summary); seed `i18n_blocked_seed.mjs` owns `V07_SLASH`/`COPIED_ALLOW_IDS`; `i18n_pseudo.mjs` (en_XA dev pseudo-locale), `i18n_modulepreload.mjs` (lazy-locale boot modulepreload); `i18n_fill_worklist.mjs` (`i18n:worklist`, emits the gitignored `docs/i18n-scaling/worklist/` for the maintainer release fill) | `i18n:gen` |
| Scaffold / release | `new_endpoint.mjs` (`new:endpoint`, scaffolds a `RouteDef` module on the `server/http/` pipeline, see `server/http/CLAUDE.md`), `release_version.mjs` (`release:check`/`release:prepare`), `version_sync.mjs` (`version:sync`), `electron-dev.mjs`/`electron-build.mjs` (`electron:*`; both bundle vendor deps via `electron-vendor.mjs`) | none |
| Data export | `export_loot_spreadsheet.mjs` (esbuild-bundles `src/sim` to a loot sheet in `docs/`) | none |
| Admin / dev utils | `grant_admin.mjs`, `create_gm.mjs`; one-off DB migrations are `.ts` via `tsx` (`db:*` scripts) | `DATABASE_URL` |
| Production ops | `prod_cpu_monitor*.mjs` (supervised CPU incident capture + immutable in-image PID/profile helpers) | exact-command restricted SSH access to the production container; optional mode-0600 staff token for `ops.perf` tick detail |
| Local realms | `dev-realms.mjs` (launches built server processes) | built server (`npm run realms`) |
| Helper | `browser_path.mjs` (resolves Chrome/Edge/Chromium; override `BROWSER_PATH=`), shared pure helpers in `lib/` | none |

## Conventions (verifiable patterns to copy)
- ws scripts inline `mergeSelf`/`mergeEnts` to reconstruct delta snapshots
  (`DELTA_SELF_KEYS`, `ENTITY_IDENTITY_KEYS`, `snap.keep`). Match the wire field
  names exactly (`tid`, `lv`, `res`, `gcd`, ...), they mirror the server snapshot.
- E2E scripts track pass/fail via a local `check(name, cond, extra)` and
  `process.exit(fail > 0 ? 1 : 0)`; browser scripts also collect `pageerror`/console-error.
- Character names are letters-only (classic rule), scripts derive an `alpha` suffix
  from a base-36 timestamp so reruns don't collide.

## How to add one (module-first)
- **Where new script logic lands:** any logic worth a unit test, or needed by a second
  script, goes in a pure Node module (`scripts/lib/` or the subsystem dir, e.g.
  `scripts/sfx/`) with a hand-written `.d.mts` so a type-checked Vitest imports it
  directly; the entry script stays a thin orchestrator (CLI parsing, puppeteer/ws).
  Pattern: `profiler/metrics.mjs` (pure, tested in `tests/profiler_metrics.test.mjs`) +
  `profiler/harness.mjs` (orchestration); `sfx/sfx_conform_rules.mjs` (+ `.d.mts`,
  tested in `tests/sfx_conform.test.ts`). Don't clone another 300-line monolith.
- **Bug in script logic:** reproduce with a failing test first (extract the unit under
  test into its own module if it is buried), then the smallest change that turns it green.
- **Browser E2E / tour:** copy `smoke_browser.mjs` / `visual_tour.mjs`; import
  `BROWSER_PATH` from `./browser_path.mjs`, read state through `window.__game`,
  `mkdirSync('tmp')` before screenshots.
- **MP integration:** copy `mp_integration.mjs`; reuse its `Client` class + merge helpers.

## Never
- These run directly under Node, not through the vite/esbuild build; keep deps Node-only
  (`ws`, `pg`, `puppeteer-core`). Most never touch `src/`. Scripts that need sim or i18n
  data bundle the TS with `esbuild` themselves (e.g. `export_loot_spreadsheet.mjs` and the
  `i18n_*` builders); follow that pattern and never `import` the TS sources raw.
- Don't hand-edit the generated i18n artifacts: regenerate with `npm run i18n:gen` and
  commit the regenerated line-item slices; there is no SHA baseline to update, the
  committed slices plus the CI freshness diff carry the byte-equivalence signal
  (canonical model: `src/ui/CLAUDE.md`).
