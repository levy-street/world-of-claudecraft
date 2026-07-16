<!-- tests/: Vitest suite. Local conventions only; root CLAUDE.md covers repo-wide
     rules, `npm test`, determinism/Rng, and commit style, don't repeat them. -->

# tests/: Vitest suite

Tests import `src/sim/` and `server/` modules **directly** and exercise them
**deterministically** in plain Node: no live server, browser, or Postgres for unit
tests. Browser/E2E + screenshot tests live in `scripts/*.mjs` (need `npm run
dev`/`server`), NOT here.

## Where a new test lands (module-first, test-first)
A NEW module (sim system, pure-core view, painter, RouteDef) gets its OWN paired
`tests/<module>.test.ts` (RouteDef suites under `tests/server/`); never append its
cases to `sim.test.ts` or another existing big suite. Bug fixes are test-first: a
failing repro test first (extract the buried unit into its own module if needed),
then the smallest change that turns it green (`extract-and-test` skill).

## Map
Most tests sit flat here: `<area>.test.ts` pairs with the module under test; `ls tests/`
to find an area. Cross-boundary pairs worth knowing: `social_system.test.ts` to
`server/social.ts`, `snapshots.test.ts`/`bandwidth.test.ts` to `server/game.ts`.
Subdirectories (plus one shared fixture):
- `parity/`: the golden-trace sim-drift gate; own `CLAUDE.md` (see Coverage & guards).
- `server/`: the RouteDef/http-pipeline suite. REUSE the shared fakes in
  `tests/server/helpers/` (`fake_ctx`, `fake_db`, `fake_http`, ... via the `index.ts`
  barrel) instead of hand-rolling mocks; scaffold a new endpoint with
  `npm run new:endpoint` (see `server/http/CLAUDE.md`).
- `admin/`: the Svelte admin components, per-file jsdom (DOM rule below; the
  `tests/admin/_setup.ts` header documents the convention).
- `browser/`: OPT-IN real-browser Playwright suite (`*.browser.test.ts`,
  `npm run test:browser`) for WebKit/Safari CSS, axe, target-size; never a bare `vitest run`.
- `progression/`: mirrors `src/sim/progression/` (unit tests for the extracted modules).
- `helpers/` + `util/`: shared cross-suite utilities (`fake_dom.ts`, the reusable
  hand-rolled fake DOM for controller suites, `i18n_determinism.ts`, `alloc_probe.ts`).
- `global_setup.ts`: runs on every vitest invocation (`vite.config.ts` `test.globalSetup`);
  mints the SFX Studio temp root (`WOC_SFX_STUDIO_TEST_ROOT`).

## The core idiom (sim tests)
Most files construct a `Sim` and advance fixed ticks. Sim test files redefine small
local helpers (cross-suite fakes live in `tests/server/helpers/` and `tests/helpers/`);
copy the pattern from `sim.test.ts`:

```ts
const makeSim = (cls='warrior', seed=42) => new Sim({ seed, playerClass: cls, autoEquip: true });
// teleport: set pos.{x,z}, then pos.y = terrainHeight(x,z, sim.cfg.seed), then prevPos = {...pos}
// face a target: sim.player.facing = Math.atan2(t.pos.x-p.pos.x, t.pos.z-p.pos.z)
for (let i = 0; i < 20 * 120 && !done; i++) sim.tick();  // 20 = ticks/sec (DT=1/20); `20*N` = N seconds
const ev = sim.tick();  // tick() RETURNS SimEvent[]; assert on e.type ('death','playerDeath','error',...)
```

- Multiplayer/world tests: `new Sim({ ..., noPlayer: true })` then `sim.addPlayer(cls, name)` returns pid (see `social.test.ts`, `arena.test.ts`).
- Reach into internals via `(sim as any).dealDamage(...)`, `(sim as any).grantXp(...)`; set level with `sim.setPlayerLevel(n)`.
- Determinism is asserted by running twice: `expect(run()).toEqual(run())` (`sim.test.ts` RL section).

## Server tests (snapshots/bandwidth/xp/interest/admin/...)
Postgres is mocked at the top: `vi.mock('../server/db', () => ({ pool, saveCharacterState, ... }))`
(hoisted; keep it ABOVE the `server/game` import). Drive `new GameServer()` with a
fake socket: `fakeWs()` collects `JSON.parse`'d sends; `server.join(...)`,
`server.handleMessage(session, JSON.stringify({t:'cmd',...}))`, `(server as any).broadcastSnapshots()`.
For the online client path, build a `ClientWorld` with `Object.create(ClientWorld.prototype)`
(see `bareClient` in `snapshots.test.ts`/`talents.test.ts`) and call `applySnapshot(...)`.
`server/social.ts` etc. take injected interfaces: implement an in-memory `FakeDb`/
transport (see `social_system.test.ts`) rather than mocking. REST/RouteDef endpoints
use the `tests/server/helpers/` fakes (see Map), not a bespoke GameServer rig.

## Coverage & guards
- `tests/parity/` is the golden-trace gate: ANY sim behavior change turns it red by
  design. Read `tests/parity/CLAUDE.md` first; regenerate only deliberately via
  `UPDATE_PARITY=1 npx vitest run tests/parity`, in its own reviewed commit.
- `architecture.test.ts` is the `src/sim` purity backstop: scans every sim file, fails on a
  render/ui/game/net/three import, a DOM global, or `Math.random`/`Date.now`/`performance.now`;
  run it after any `src/sim/` change. It ALSO completeness-checks the UI/render pure cores: a NEW
  pure core MUST follow the `*_view`/`*_core` naming (a bare name escapes the reverse sweep) and
  be registered in `UI_PURE_CORES`/`RENDER_PURE_CORES`, or the guard fails.
- `guide.test.ts` is the wiki freshness gate: new/changed player-facing content in
  `src/sim/content/` fails it until `npm run wiki:content` regenerates (auto in `pretest`).
- `css_corpus.test.ts` guards the CSS union corpus + brace balance (a dropped closing
  brace silently discards all later CSS); re-run after touching `src/styles/` or entry inline styles.
- Perf budgets: `hud_perf_budget` (baseline in `hud_perf_budget.baseline.md`), `render_budget`,
  `tests/server/perf_gate` + `tick_perf_capture`, `alloc_probe` (probe in `tests/util/`).
- SFX gates: the `sfx_*` suites (`sfx_conform`, `sfx_studio_server_security`,
  `tests/server/static_sfx_serving`, ...) mirror `npm run sfx:check`.
- `malware_scan.test.ts` is the release-gate backstop (signatures from `scripts/malware_scan.mjs`,
  zero high-severity findings allowed in the tree); run it after touching the scanner.

## i18n gates live here (don't produce strings, enforce them)
Run them after any sim/server player-text or English-catalog change. They depend on generated
artifacts: `pretest` runs `npm run i18n:gen`, so `npm test` regenerates the resolved tables and
`src/ui/i18n.status.json` first; a bare `npx vitest run` does NOT, so run `npm run i18n:gen`
yourself or the S3 guard throws "status.json is missing".
- **`localization_fixes.test.ts` is the S3 guard**: it parses `src/sim/sim.ts`, `server/game.ts`,
  and a broad set of sim source modules (combat/mob/pet/delves/instances/market/bank/loot and more;
  the authoritative file list lives in the test itself),
  enumerating every player-facing emit and asserting each is recognized by a `hud.ts` localize arm or
  the `localizeServerText`/`localizeSimText` matchers (plus `simDICT`/`serverDICT`/`adminDICT`
  completeness + placeholder parity per locale). Add or change a sim/server player string and update
  the matcher in the SAME change or this fails.
- **Two tiers via `I18N_RELEASE_TIER`** (also read by `localization_coverage`, `i18n_status_registry`,
  `i18n_t_behavior`): unset = PR tier (registration/key-existence only, English-only legal); `=1` =
  release tier (hard-fails on any `pending` locale row + full-localization checks).

## Running & adding
- Single file (preferred while iterating): `npx vitest run tests/<file>.test.ts`.
- **DOM in tests, the two-branch rule.** The default Vitest env is plain Node (no
  `document`/`window`). Game-HUD/UI tests stay there: stub a single global on `globalThis`
  (`localStorage` in `keybinds.test.ts`, `WebSocket` in `snapshots.test.ts`) or build a small
  **hand-rolled fake DOM** modeling only the contract under test (reuse
  `tests/helpers/fake_dom.ts` before hand-rolling a new one; `focus_manager.test.ts`,
  `painter_host.test.ts`); prefer these for pure cores and painters. A HUD controller/window
  suite that needs a real DOM tree opts in with a per-file `// @vitest-environment jsdom`
  docblock (`fiesta_controller.test.ts`; the Svelte admin suite in `tests/admin/` additionally
  imports `./_setup`); jsdom stays scoped per-file so the Node-env majority keeps the fast
  default.
  Enumerate the live jsdom set with `grep -rl '@vitest-environment jsdom' tests/`.
- Add/update a test here when you change sim or server behavior (see root CLAUDE.md).
