# State: UI Architecture and HUD Modularization (cross-phase cheat sheet)

The next session reads THIS file, not the transcript. It records locked
decisions, the validation matrix, the review-dispatch matrix, key file paths, and
the running ledger of what each phase added. Keep it current at the end of every
phase.

Current phase: not started (packet authored 2026-06-17).
Critical path: Phase 1 -> Phase 7 -> Phase 13 -> Phases 15-23 (windows). Phase 3
unblocks the Social window (Phase 19). Phase 5 (visual baselines) should land
early so baselines capture the PRE-refactor HUD.

---

## Locked decisions (do not re-litigate)

1. No frontend framework in the game HUD; raw imperative DOM stays.
2. No signals library in the HUD; dependency-free `ReactiveDiff<T>` instead.
3. No big-bang rewrite; leaf-first, one card per PR, behind gates.
4. Window rendering stays zero-dependency (humble widgets + per-frame pull +
   targeted DOM writes). No lit-html / no templating lib.
5. Playwright `@playwright/test` for DOM-HUD visual-regression baselines
   (pre-merge) + Playwright MCP for live-game QA every QA phase; keep
   puppeteer-core; canvas verified via `window.__game` state, not pixels.
6. Svelte admin pilot deferred to a separate packet (out of scope).
7. New deps are devDependencies ONLY. Zero new runtime deps in the game bundle.

## Non-negotiable invariants every phase preserves

1. IWorld-only access. Modules read the world through `IWorld`, never
   `Sim`/`ClientWorld` concretely. New data need -> extend `IWorld` first, then
   both worlds. (None expected this packet; if needed, STOP and surface.)
2. `t()`-only render sink. Every player- and operator-visible string resolves
   through `t()`. No concat, fallback literals, default params, `const LABELS={}`
   maps, or literals in `setAttribute('aria-label'|'title'|'placeholder'|'alt')`
   / `document.title` / native confirm/prompt/alert. Numbers/money/dates via
   `formatNumber`/`formatMoney`/`formatDateTime`/`Intl`.
3. DOM id/class contract. The ~214 `id`s and the classes `index.html` and CSS
   depend on stay byte-identical through every extraction.
4. One shared `hotWriteCache`. Extraction threads a single `HotWriteGate` instance
   by reference; never duplicate the cache per module, or the skip rate regresses.
5. Signature stability. Recompute signatures keep exact diff semantics: they fire
   iff real state changed. A silent signature regression ships a stale-UI bug with
   no compile guard. Every signature migration needs a fixture-based
   "new sig flips iff old sig flipped" test.
6. Per-frame core stays imperative under rAF (player/target frame, cast bar,
   action bar, auras, minimap). No frameworkization, no per-frame allocations added.
7. Determinism. No `Math.random`/`Date.now`/`performance.now` in `src/sim/`; sim
   stays DOM-free. (HUD may read wall-clock for animation; sim may not.)
8. Shared-worktree commit hygiene. Stage only your card's files with explicit
   paths. Never `git add -A`. Commit nothing unrelated. One card, one branch
   (`feature/<card-id>-<slug>`), one PR. Push to origin (levy-street), never the fork.
9. No em dashes or emojis in any doc, code comment, or player-facing string.

## Validation matrix (by change type)

- DOM/UI logic (most phases): `npx tsc --noEmit` + `npx vitest run tests/hud_harness.test.ts tests/hud_perf_budget.test.ts <the card's own test>`; if any player text changed or a matcher moved, add `npx vitest run tests/localization_fixes.test.ts`.
- i18n matcher change (Phase 3, Social window): `npx vitest run tests/localization_fixes.test.ts` + `npx tsc --noEmit`. cross-platform-sync review.
- IWorld parity (Phase 3): `npx vitest run tests/iworld_read_surface.test.ts tests/snapshots.test.ts tests/interest.test.ts`.
- Sim-purity boundary (Phase 3): `npx vitest run tests/architecture_boundaries.test.ts` + `npm run lint` (new).
- Visual (Phase 5 and any window touch): `npx playwright test` (DOM HUD baselines) + a mobile screenshot script (`node scripts/mobile_visual.mjs` or a `mobile_*_shot.mjs`) against a phone viewport with `npm run dev` running.
- Online mode (ANY HUD-behavior phase): the offline `Sim` harness drives steady state only, so also verify the surface against the online path. Start `npm run server` and log in through `ClientWorld`, then exercise the surface under interest-scoped (~120 yd) partial snapshots, latency, and target loss (open a window, move out of interest range, lose the current target). Per-frame surfaces (player/target frame, nameplates, cast bar, Social online announcements) are the ones most likely to diverge under snapshot churn. For per-frame phases this can also be simulated offline via the Phase 1 `fake_world` entity-drop path (a mutator that removes entities mid-run to mimic a partial snapshot).
- Build / pre-merge (mirrors CI `.github/workflows/ci.yml`): `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`.
- Bundle-footprint check (every phase adding a dep): `npm run build` must show the game (`main`) bundle does not pull in the new dep (dev-only).

Test environment note: keep the default Vitest env on `node` for the ~150 pure
sim tests (speed); opt only HUD/DOM files into the DOM env via per-file
`// @vitest-environment happy-dom` (or `jsdom` where an API is missing). Do NOT
flip the global env.

## Review-dispatch matrix (spawn ONLY the agents whose surface the diff touches)

Check `git diff --name-only` against the phase-start commit. Most phases here are
pure `src/ui` + `tests` + `scripts` + build-config changes, so they trigger
`qa-checklist` only. Do not default to running all four.

| Agent | Spawn ONLY when the diff touches | This packet |
|---|---|---|
| `privacy-security-review` | `server/`, `src/admin/`, `src/net/`, a deploy/secret/CI file, or new SQL/auth/secret/`ALLOW_DEV_COMMANDS`/`Math.random`\|`Date.now`\|`performance.now` in `src/sim/` | Rare. Only if a phase edits CI yml or an E2E script that toggles `ALLOW_DEV_COMMANDS`. |
| `migration-safety` | `server/db.ts`, `server/social_db.ts`, a `server/*_db.ts`, or a `characters.state` JSONB path | Never (no server/persistence changes). |
| `cross-platform-sync` | `src/world_api.ts`, `src/sim/` behavior/obs/`SimEvent`, `src/net/online.ts`, `server/game.ts` wire/dispatch, the matchers `src/ui/sim_i18n.ts`\|`src/ui/server_i18n.ts`, or the RL surface | Phase 3 (matcher decouple, IWorld parity), Phase 19 (Social window touches the matcher area), and any phase that unexpectedly touches `IWorld`. |
| `qa-checklist` | a phase/deliverable set is complete | Every phase (the completion gate). |

## Key file paths

Existing (refactor targets and contracts):
- `src/ui/hud.ts` (6,280) - the target.
- `src/world_api.ts` (307) - `IWorld` seam, `:185-307`.
- `src/main.ts` - frame loop `:901-978`, modal gate `:910`.
- `src/render/renderer.ts` - `sync()` `:1019`, `AnimState` `:1201`, modular factory precedent.
- `src/ui/icons.ts` (1,523) - `iconDataUrl`, `iconCanvas`, `QUALITY_COLOR`.
- `src/ui/sim_i18n.ts` (1,814), `src/ui/server_i18n.ts` (197) - matcher mirrors.
- `src/ui/i18n.ts` (275) - `t()`, `supportedLanguages`. `i18n.resolved.generated.ts` (53,053, generated).
- `tests/localization_fixes.test.ts` - S3/B1 guard (source-coupled to hud.ts; Phase 3 fixes).
- `tests/client_shell.test.ts` - string-scraping HUD test (Phase 1 replaces the scraping).
- `tests/snapshots.test.ts`, `tests/interest.test.ts` - existing parity precedent.
- `vite.config.ts` - Vitest config lives here (`test:` block ~`:97-100`); no DOM env yet.
- `.github/workflows/ci.yml` - PR + release gates.
- `index.html` - the ~214 `id`s / classes contract.
- E2E: `scripts/feel_smoke.mjs`, `perf_tour.mjs`, `arena_visual.mjs`, `market_visual.mjs`, `mobile_*_shot.mjs`; `window.__game` hook.

Created by this packet (ledger; fill as phases land):
- `src/ui/hud/` (new folder for extracted modules)
- (Phase 1) `tests/helpers/fake_world.ts`, `tests/hud_harness.test.ts`, `tests/hud_perf_budget.test.ts`
- (Phase 3) `tests/iworld_read_surface.test.ts`, `tests/architecture_boundaries.test.ts`, `eslint.config.js`
- (Phase 5) `playwright.config.ts`, `tests/visual/*.spec.ts`, `docs/ui-architecture-hud-modularization/mcp-qa-runbook.md`
- (Phase 7) `src/ui/hud/hot_write_gate.ts`, `tests/hot_write_gate.test.ts`
- (Phase 9) `src/ui/hud/reactive_diff.ts`, `tests/reactive_diff.test.ts`
- (Phase 11) `src/ui/hud/icon_service.ts`, `src/ui/hud/hud_context.ts`, `tests/icon_service.test.ts`
  - `HudContext` carries the action-bar drag-state seam: `dragAction`,
    `writeDraggedAction`, and `clearActionDropTargets` are expected members
    (shared by Bags, Spellbook, and Talents; whichever extracts first
    establishes the seam, do not single out Bags).
- (Phase 13+) `src/ui/hud/<window>.ts` + `tests/hud_<window>.test.ts` per window

## New IWorld members / SimEvents / wire fields / endpoints / tables / i18n keys

NONE expected this packet (client-only refactor; behavior preserved). Any
addition here is a red flag, record it and justify it. i18n: no NEW player
strings are intended; extraction preserves existing `t()` keys verbatim.

## Anchors index (re-grep before editing; line numbers DRIFT, anchor on symbol)

`Hud` ctor `:338`; `update()` `:1556`; tiers `:1560/1562/1564`; per-frame core
`:1578-1741`; `hotWriteCache` `:270`; setters `:482-505`; signatures
`lastTradeSig :287`, `lastPartySig :288`, `lastArenaSig :289`,
`lastMarketSig :297`, `lastSocialStruct/Content :317-318`, `lastPetBarSig :331`,
aura `:1838`; matchers `localizeErrorText :2821`, `localizeSystemText :2928`,
`localizeLootText :3012`; windows Spellbook `:4191`, Talents `:4269`,
Market `:3419`, Social `:5090`, Trade `:5435`, Bags `:2752`, Character `:3830`,
Arena `:2064`, QuestLog `:3714`, Map `:1875`, Options `:5549`; minimap Sets `:1952-1954`.

## OPEN items / gotchas

- happy-dom may lack the canvas 2D context the minimap/character-preview use.
  Resolve in Phase 1 (stub the canvas in the fake world, or opt those files to
  jsdom). Record the resolution here.
- The Social window (Phase 19) is blocked on Phase 3 (matcher decouple). Do not
  start it before Phase 3 lands.
- Visual baselines (Phase 5) capture the current HUD as the golden master.
  Re-baseline deliberately (and review the diff) only when a window extraction
  intentionally changes pixels; an unintended diff is a regression.
- If two sessions must touch `hud.ts` at once (two window delegations), land the
  lower-id card first and rebase; delegation edits are tiny and rebase cleanly
  when windows are disjoint.
- Rollback strategy: the rollback unit is one card = one PR = one revertable
  commit, so a bad merge backs out with a single `git revert`. This refactor is
  expected to be behavior-preserving (no risky player-facing change), but the
  rule applies generally: ship any risky player-facing change behind a
  settings/localStorage flag where feasible so it can be disabled without a
  redeploy. `DEPLOY.md` is the production rollback reference.
- i18n backlog: extraction preserves existing keys, but run `npm run i18n:scan`
  mid-program to size the pending-translation release backlog as new keys accrue
  (the maintainer batch-fills any `pending` rows via `npm run i18n:worklist`
  before any `release/**` push; the release-tier gate hard-fails on a pending row).
