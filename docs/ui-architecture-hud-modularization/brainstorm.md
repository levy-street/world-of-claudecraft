# Brainstorm: UI Architecture and HUD Modularization

Feature slug: `ui-architecture-hud-modularization`
Branch: `feature/ui-architecture-hud-modularization` (and one branch per phase/card under it)
Owner: Fernando
Status: Approved vision, phased packet authored 2026-06-17.

This file is the vision and research record. The execution lives in
`implementation-plan.md` (phase table + canonical workflow), `state.md` (locked
facts the next session needs), `progress.md` (status), and the per-phase starter
prompts. The original design brief the maintainer wrote is `00-design-brief.md`
in this same directory; this brainstorm distills and ratifies it against deep
codebase recon plus external best-practice research.

---

## 1. Vision

`src/ui/hud.ts` is a 6,280-line single `Hud` class (about 338 fields, 172
methods, 16 windows, 538 `t()` calls, 7 copy-pasted reactivity schemes). The
codebase core is healthy (one deterministic sim, three hosts, a clean `IWorld`
seam, a best-in-class i18n net). The scaling pain localizes almost entirely to
this one file.

The end state: `hud.ts` reduced to persistent chrome plus the per-frame loop
coordinator. Each on-demand window lives in its own `src/ui/hud/<window>.ts`
module that consumes a shared `HudContext` service bag and exposes
`render()`/`toggle()`/`update()`. Shared primitives (`HotWriteGate`,
`ReactiveDiff`/`StructuralDiff`, `IconService`) are defined once and unit-tested.
The HUD gains real behavioral tests, a perf gate, an `IWorld` read-surface parity
test, a sim-purity boundary check, a runtime-behavior i18n guard, and Playwright
DOM visual baselines, so a fresh AI session can extract a window and prove it
safe with `npx vitest run <oneFile>` plus the gates, no human whole-file mental
model required.

The thesis (why this matters more in a 100%-AI open-source repo): the tax of a
6,280-line hot file is not the cost to read it. It is merge-conflict surface
(touched by roughly 155 of the last 200 commits), per-change verification surface
(every edit must re-prove the whole file's invariants), and targeted-edit
reliability (an exact-string edit on a unique anchor in a 200-line module is far
more reliable than in a 6,280-line file with 7 near-duplicate signature blocks).
With no human reviewer holding a whole-file mental model, the deterministic gates
ARE the trust substrate. That is why the gates (P0) precede the extraction (P1+).

## 2. Sequence (the load-bearing decision)

The destination is correct; the sequence is the point. The first work is not
extraction, it is building the test and gate scaffold that makes extraction
verifiable. Skipping straight to extraction is the single most dangerous move in
this repo, because the file is untested at runtime, hot-path, signature-fragile,
the highest-churn file in the tree, and one of its "obvious" extractions (the
i18n matcher trio) is wired into a release gate by file path.

Phase order: P0 (gates + scaffold) -> P1 (shared primitives) -> P2 (windows, one
per PR, concurrency-safe) -> P3 (per-frame perf hardening, last and smallest).

## 3. Current state (so no session re-discovers it)

### 3.1 hud.ts internals (anchors approximate; re-grep, line numbers drift)
- One `Hud` class. Constructor `hud.ts:338` uses clean dependency injection
  (renderer, keybinds, hooks injected, not constructed internally) - good for testability.
- `update()` entry `hud.ts:1556`. Three throttle tiers: fast ~100ms
  (`:1560`, includes `updateMinimap()`), medium ~250ms (`:1562`, quest tracker,
  party frames, trade, arena, map, vendor/loot distance), slow ~500ms (`:1564`,
  Social struct/content diff, Market refresh).
- Per-frame core (`:1578-1741`): player HP/resource, target frame, cast bar,
  action bar with cooldown overlay, auras. Latency-critical; stays imperative.
- Write-side dedup: `hotWriteCache` `Map<HTMLElement,string>` (`:270`) gates every
  DOM write through `setText`/`setDisplay`/`setTransform`/`setWidth` (`:482-505`).
  Tracks `hotDomWrites` vs `hotDomSkippedWrites`. Skip rate must stay above ~80%.
- 7 copy-pasted recompute gates: `lastTradeSig :287`, `lastPartySig :288`,
  `lastArenaSig :289`, `lastMarketSig :297`, `lastSocialStruct/Content :317-318`
  (dual struct-vs-content model preserving typeahead), `lastPetBarSig :331`, aura
  sig `:1838`. Bodies: Market `:3461`, Party `:4747`, Trade `:5471`, Social `:1820-1828`.
- Windows: Spellbook `:4191`, Talents `:4269` (staged-edit, loadouts,
  import/export), Market `:3419` (browse/sell/collect tabs), Social `:5090`,
  Trade `:5435`, Bags `:2752`, Character `:3830` (preview canvas), Arena `:2064`,
  QuestLog `:3714`, Minimap/Map `:1875-2059`, Options/Keybinds `:5549`.
- Client i18n matchers: `localizeErrorText :2821`, `localizeSystemText :2928`,
  `localizeLootText :3012`. Each maps server/sim English to `t()` keys and falls
  back to `localizeServerText`.
- DOM contract: 119 hardcoded queries coupling to ~214 `id`s in `index.html`
  (`#player-frame`, `#target-frame`, `#actionbar`, `#minimap`, `#spellbook`,
  `#bags`, ...). These selectors are a contract shared with CSS; keep byte-identical.

### 3.2 The loop and the seam
- Frame loop `main.ts:901-978`, recursive rAF. Per-frame: input -> `sim.tick()`
  (offline) -> `hud.handleEvents(events)` -> `renderer.sync(alpha, dt, facing)`
  -> `hud.update()` -> `perf.tick()`. The loop owns the tempo; the HUD never
  pauses it. Modal state gates input: `input.suspendMovement = hud.isModalOpen()`.
- `IWorld` is the only seam (`src/world_api.ts:185-307`). Both `Renderer` and
  `Hud` take `private sim: IWorld` and never import `Sim`/`ClientWorld`/`net`.
  Confirmed clean by recon: hud.ts imports only `sim/types`, `sim/data`,
  `sim/world` helpers, `sim/content/talents`, plus `render/renderer` (presentation
  dep, for `worldToScreen`/`showChatBubble`/`handleEvent`), `game/keybinds`,
  `game/settings`, `game/audio`, `game/music`. No `Sim` class, no `net/` imports.

### 3.3 i18n net (most mature subsystem; do not weaken it)
- `t()` is the sole runtime render sink. Keys typed `TranslationKey`, so `tsc`
  rejects invalid keys. The dense resolved table
  `src/ui/i18n.resolved.generated.ts` (53,053 lines, generated, never hand-edit)
  types every locale `: typeof en`, so a missing/renamed key red-fails `tsc`.
- Sim/server stay English and re-localize at the client boundary via the matchers
  plus `sim_i18n.ts` (1,814 lines) and `server_i18n.ts` (197 lines) mirrors.
- Registry `src/ui/i18n.status.json` (0 pending as of 2026-06-17 baseline). Two
  tier CI: PR-tier permits English-only; release-tier (`I18N_RELEASE_TIER=1`)
  hard-fails on any pending key.
- THE LANDMINE: `tests/localization_fixes.test.ts` does
  `fs.readFileSync('src/ui/hud.ts')` and regex-matches the matcher method bodies
  by name and shape. Extracting those matchers into a module red-fails the gate
  even with identical runtime behavior. This must be decoupled (Phase 3) before
  the matchers, and therefore the Social window, can move.

### 3.4 Performance reality
The per-frame core is already strategically tuned (write-dedup cache,
100/250/500ms tiers, distance-tiered animation mixer, nameplate throttle 15Hz
mobile / 24Hz desktop, pooled fire lights, perf.ts wrapping each subsystem with
p95/max + overlay). Remaining wins are real but micro (single-digit to low-tens
of microseconds/frame): `AnimState` literal per visible entity per frame
(`renderer.ts:1201`), aura sig `.map().join()` (`hud.ts:1838`, already diff-gated),
three minimap `Set`s rebuilt every 100ms (`hud.ts:1952-1954`). Treat perf as
something to PROTECT with a gate and harvest opportunistically, not the headline.

### 3.5 Verification gaps (what P0 fills)
- No DOM test environment installed (no jsdom/happy-dom/@vitest/browser in
  package.json). `Hud` is never instantiated in a test. `tests/client_shell.test.ts`
  greps the source as a string, which breaks on reformat and verifies no behavior.
- No per-frame perf-budget assertion. The skip rate, tier cadence, GC hot spots
  have zero regression protection.
- `IWorld` parity is only half-covered. `snapshots.test.ts`/`interest.test.ts`
  compare Sim vs ClientWorld for sim/net state, not the read surface render/ui consume.
- No ESLint config and no test enforcing the sim-purity invariant (CLAUDE.md
  admits it is "enforced by convention only").
- No visual regression. ~73 puppeteer-core scripts capture one-off screenshots to
  `tmp/` for manual review; none diff against a baseline.

## 4. Reusable surface (what already exists)

- `IWorld` (`src/world_api.ts:185-307`): the complete read+action surface. HUD-
  critical reads: `player`, `entities`, `inventory`, `equipment`, `known`,
  `questLog`/`questsDone`/`questState`, `partyInfo`, `socialInfo`, `tradeInfo`,
  `duelInfo`, `arenaInfo`, `marketInfo`, `talents`/`talentSpec`/`loadouts`,
  `copper`/`xp`/`prestigeRank`. All actions (cast, target, loot, buy/sell, quest,
  party, guild, trade, market, talents) are methods on `IWorld`.
- The render layer's modular factory pattern (`src/render/`: `terrain.ts`,
  `props.ts`, `foliage.ts`, `vfx.ts`, etc., each `build*() -> *View` with a
  `sync()`) is the structural precedent the HUD modularization mirrors.
- The existing `setText`/`setDisplay`/`setTransform`/`setWidth` write-dedup is the
  precedent for `HotWriteGate`. The 7 signature gates are the precedent for
  `ReactiveDiff`. `icons.ts` (`iconDataUrl`, `iconCanvas`, `QUALITY_COLOR`) is
  what `IconService` wraps.
- Existing pure UI modules already split out and tested: `hotbar.ts`, `meters.ts`,
  `xp_bar.ts`, `touch_peek.ts`, `player_context_menu.ts`, `profanity.ts`,
  `auth_utils.ts`. They show the target shape (pure logic, own test).
- E2E harness: `window.__game` debug hook (`sim`, `world`, `hud`, `input`,
  `perf`); puppeteer-core scripts (`feel_smoke.mjs`, `perf_tour.mjs`,
  `arena_visual.mjs`, `market_visual.mjs`, 19 `mobile_*_shot.mjs`). Dev commands
  (`dev_level`, `dev_give`) gate behind `ALLOW_DEV_COMMANDS=1` (dev only).

## 5. New work needed

- New dev deps (devDependencies only, not runtime HUD deps): a DOM env
  (`happy-dom` default, `jsdom` per-file where needed) and `@playwright/test`.
- New test files: `tests/helpers/fake_world.ts`, `tests/hud_harness.test.ts`,
  `tests/hud_perf_budget.test.ts`, `tests/iworld_read_surface.test.ts`,
  `tests/architecture_boundaries.test.ts`, per-primitive and per-window tests, and
  Playwright `tests/visual/*.spec.ts` baselines.
- New source modules under a new `src/ui/hud/` folder: `hot_write_gate.ts`,
  `reactive_diff.ts`, `icon_service.ts`, `hud_context.ts`, then one file per window.
- A behavioral rewrite of the i18n S3/B1 guard (assert runtime localization
  across all `supportedLanguages`, not `hud.ts` source shape).
- A reusable Playwright MCP QA runbook every QA phase follows.

No sim, server, net, or wire-protocol changes are expected. This is a client-only
(`src/ui/`, `tests/`, `scripts/`, build config) packet. If a phase finds it needs
a new `IWorld` member, that is a stop-and-surface event (the seam should already
expose everything the HUD reads).

## 6. Research findings (primary sources)

External best-practice research corroborated the seed plan:

- Strangler Fig (incremental replacement, never big-bang) is the load-bearing
  pattern; big-bang rewrites fail on undocumented existing behavior. Identify
  seams, deliver replacements incrementally, accept a transitional architecture
  where old and new coexist. (martinfowler.com/bliki/StranglerFigApplication.html;
  shopify.engineering/refactoring-legacy-code-strangler-fig-pattern)
- Characterization tests FIRST: pin actual current behavior as a regression net
  before moving code. (Feathers, Working Effectively with Legacy Code;
  en.wikipedia.org/wiki/Characterization_test)
- Humble View / Passive View: split each widget into a pure presenter (world ->
  view-model struct, unit-testable) and a thin DOM applier. "Test most of the risk
  of the UI without touching the hard-to-test widgets." Prefer flow synchronization
  (explicit per-tick update) over an observer web ("implicit behavior is hard to
  debug"). (martinfowler.com/eaaDev/uiArchs.html)
- Immediate-mode pull beats reactive push for an always-updating HUD: a single
  pull each frame (read world, diff against last view-model, write only changed
  DOM) is more deterministic and cheaper than fine-grained signals. Signals/stores
  are most valuable for rarely-changing menus, not the combat HUD. (Glazkov,
  retained-and-immediate-mode; Muratori, IMGUI rationale)
- Feature folders over layer folders; every widget imports only `IWorld` + its VM
  type, preserving dependency direction. (Feature-Sliced Design)
- TC39 Signals is Stage 1 (polyfill-only); nanostores (<1KB) is the tiny-deps
  store option if ever wanted for menus. Both deferred; the dependency-free
  `ReactiveDiff` is the chosen answer.
- Testing: Vitest `environment` per-file (`// @vitest-environment jsdom`);
  happy-dom faster, jsdom higher-fidelity. Characterization via
  `toMatchFileSnapshot()` with a serializer normalizing volatile bits. Playwright
  `toHaveScreenshot()` with `animations:'disabled'` + masks is reliable for the
  DOM HUD; the WebGL canvas is flaky across machines, so assert canvas state via
  `window.__game` + `page.evaluate`, not pixels. Playwright MCP
  (`@playwright/mcp`) drives via the accessibility tree (excellent for catching
  i18n English-leaks) but is blind to the canvas. (vitest.dev/guide/environment,
  vitest.dev/guide/snapshot, playwright.dev/docs/test-snapshots,
  playwright.dev/docs/getting-started-mcp, github.com/microsoft/playwright-mcp,
  testing-library.com/docs/dom-testing-library/intro)

## 7. OPEN items (resolve before or during the relevant phase; never assume)

- Exact `lit-html`/`morphdom` bundle sizes were unverified. Moot: decision is
  zero-dep humble widgets, so neither is adopted.
- Native TC39 Signals: Stage 1, polyfill-only. Moot for the same reason.
- GPU-accelerated WebGL in Docker CI (NVIDIA Container Toolkit) is a community
  pattern, not official Playwright doc. Relevant only if canvas pixels are ever
  baselined; the chosen strategy avoids canvas pixel gating (state assertions
  instead), so this stays OPEN and out of the critical path.
- `maxDiffPixelRatio` starting values (0.01 2D / 0.02 WebGL) are community
  guidance, not official; tune empirically if canvas screenshots are ever added.
- happy-dom vs jsdom for the HUD harness: default happy-dom for speed; if a
  HUD path needs an API happy-dom lacks (canvas 2D context for the minimap /
  character preview is the likeliest gap), opt that file to jsdom per-file, or
  stub the canvas context in the fake world. Confirm during Phase 1.

## 8. Locked decisions (do not re-litigate; see also state.md)

1. No frontend framework in the game HUD. It would fight the rAF heartbeat, the
   read-only `IWorld` seam, and the hand-tuned per-frame gates, and adds a second
   convention for drive-by AI contributors. The HUD stays raw imperative DOM.
2. No signals library in the HUD. The HUD is a snapshot-pull system; signals would
   reintroduce the per-frame compare the signatures already do, plus subscription
   bookkeeping. The dependency-free `ReactiveDiff<T>` captures the real benefit
   (deduping the 7 diff sites).
3. No big-bang `hud.ts` rewrite. Leaf-first, one card per PR, behind gates.
4. Window rendering stays zero-dependency (humble widgets + per-frame pull +
   targeted writes). No lit-html, no templating lib. (User decision 2026-06-17.)
5. Playwright is added for DOM-HUD visual-regression baselines (pre-merge gate) +
   Playwright MCP for live-game QA in every QA phase; puppeteer-core scripts stay;
   canvas verified via `window.__game` state, not pixels. (User decision 2026-06-17.)
6. The Svelte 5 admin pilot (ADM-*) is deferred to its own future packet. Out of
   scope here. (User decision 2026-06-17.)
7. New deps are devDependencies only (DOM env + Playwright). Zero new runtime deps
   ship in the game bundle; `npm run build` must prove the game bundle is unchanged
   in dependency footprint.
