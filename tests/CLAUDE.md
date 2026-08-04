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
- `helpers/` + `util/`: shared cross-suite utilities (`bare_client.ts`, the shared
  `bareClient()`/`fakeWs()`/`lastSnap()`/`joinServer()`/`broadcast()` family, see
  "Server tests" below; `fake_dom.ts`, the reusable hand-rolled fake DOM for controller
  suites, `i18n_determinism.ts`, `ts_files_under.ts`
  and `css_tree_under.ts`, the two source walks, `scan_guard_self_audit.ts`, the pin that
  keeps a guard from re-growing its own directory read, `method_call_sites.ts`, the
  `ts.createSourceFile` walk that reports the calls a class method evaluates, each with the
  `if` chain guarding each, `test_block_calls.ts`, the `ts.createSourceFile` walk that reports
  every `describe`/`it`/`test`/`suite` call in a source tagged with the block enclosing it,
  `driver_callback_bodies.ts`, the `ts.createSourceFile` walk that resolves a repeating
  driver's callback and every same-module body one of its ticks can reach, `alloc_probe.ts`).
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
For the online client path, build a `ClientWorld` without the WebSocket plumbing by importing
`bareClient(pid, overrides?)` from `tests/helpers/bare_client.ts` (also hosts the `fakeWs`/
`lastSnap`/`joinServer`/`broadcast` family above) and call `applySnapshot(...)` on the result;
it mirrors every field `ClientWorld` declares a static default for, so a new field never needs
a manual sweep across suites. Import it rather than hand-rolling `Object.create(ClientWorld.prototype)`
again, unless the suite genuinely needs a narrower or differently-shaped fixture (a few do, each
marked with a one-line "kept bespoke on purpose" comment, issue #2088).
`server/social.ts` etc. take injected interfaces: implement an in-memory `FakeDb`/
transport (see `social_system.test.ts`) rather than mocking. REST/RouteDef endpoints
use the `tests/server/helpers/` fakes (see Map), not a bespoke GameServer rig.

## Coverage & guards
- **A guard that scans a directory of sources walks it with a shared walker, never its own
  `readdirSync`:** `helpers/ts_files_under.ts` for `.ts`, `helpers/css_tree_under.ts` for
  the `src/styles` sheets. A single-level read is a defect, not a style choice: the
  day the scanned root grows a subdirectory, everything inside leaves the scan and the
  guard stays green over a quietly smaller surface (#2485, then #2489 three times over,
  then #2502 four more). Apart from `src/ui`, every scan root is flat today, so no
  assertion over the real tree can tell a recursive walk from a flat one: pin the
  recursion with a `mkdtemp` fixture that drives the guard's OWN producer, and keep the
  vacuity floor near the real count (a floor sitting under it is what lets a moved file
  hide, and `it.each` over an empty list registers no cases at all). Where the root IS
  deep, a file-count floor over the real tree pins it directly, as
  `mobile_window_coverage` does. Add `expectScansOnlyThroughSharedWalkers(import.meta.url,
  [...])` (`helpers/scan_guard_self_audit.ts`) too: the fixture pins the producer, that pins
  that no second reader was hand-rolled beside it, which over a flat root nothing else can.
- **A scan that stays single-level BY DECISION says so where the read is, and checks its
  own premise.** The `src/styles` case: a guard that models the sheets an entry LOADS
  (`css_corpus`'s section corpus, `mobile_window_coverage`'s mobile-rule text) must not
  credit a sheet parked in a subfolder, so it REFUSES rather than filtering: it throws on
  `cssTreeUnder(...).dirs`, from the same read, naming the directory. (Refusing, not
  filtering, is the point. A filter would keep the guard green over a surface that quietly
  stopped matching the ruling behind it.) A guard whose miss is a silent pass
  (`css_value_validity`, `focus_visible_guard`) recurses instead. Either way the reasoning
  is written at the read, and a subdirectory fails loudly rather than narrowing the scan
  (#2499, #2502).
- `tests/parity/` is the golden-trace gate: ANY sim behavior change turns it red by
  design. Read `tests/parity/CLAUDE.md` first; regenerate only deliberately via
  `UPDATE_PARITY=1 npx vitest run tests/parity`, in its own reviewed commit.
- `architecture.test.ts` is the `src/sim` purity backstop: scans every sim file, fails on a
  render/ui/game/net/three import, a DOM global, or `Math.random`/`Date.now`/`performance.now`;
  run it after any `src/sim/` change. It ALSO completeness-checks the UI/render pure cores: a NEW
  pure core MUST follow the `*_view`/`*_core` naming (a bare name escapes the reverse sweep) and
  be registered in `UI_PURE_CORES`/`RENDER_PURE_CORES`, or the guard fails. It then classifies
  every REMAINING `src/ui` module (the ones the pure-core and `*_painter` name families miss,
  window painters included: a `*_window.ts` is covered here AND by the painter gate below): one
  that reaches for a browser global must be registered in `UI_PAINTER_HELPERS` (a host-agnostic
  painter-side helper, which then may only mint its own canvas and must stay deterministic and
  colorless) or in `UI_DOM_MODULES` (it owns browser state), and anything unregistered must touch
  no browser global at all.
- **Never register the same block twice.** `duplicate_test_blocks.test.ts` walks every `.ts`
  under `tests/` and fails on any `describe`/`it`/`test`/`suite` call whose source text repeats
  an earlier SIBLING's byte for byte. Vitest runs duplicate titles silently, so nothing else
  can say so, and this defect arrives through MERGES: #2506 deleted the same two
  `gathering.test.ts` blocks that `a1a8cfd56` had already deleted once. Byte-identical and
  sibling-scoped on purpose: the same body under two different describes is ordinary (each
  parent brings its own setup), and a same-TITLE rule would be a different, red guard
  (`professions_crafting.test.ts` names two distinct blocks `self-gathered crafting bonus
  (#1145)`). A duplicate is always deleted, never renamed apart.
- `guide.test.ts` is the wiki freshness gate: new/changed player-facing content in
  `src/sim/content/` fails it until `npm run wiki:content` regenerates (auto in `pretest`).
- `css_corpus.test.ts` guards the CSS union corpus + brace balance (a dropped closing
  brace silently discards all later CSS); re-run after touching `src/styles/` or entry inline styles.
- Perf budgets: `hud_perf_budget` (baseline in `hud_perf_budget.baseline.md`), `render_budget`,
  `tests/server/perf_gate` + `tick_perf_capture`, `alloc_probe` (probe in `tests/util/`).
  `hud_perf_budget` also owns the painter half of the `src/ui` classification, over all three
  DOM-adapter names (`*_painter.ts`, `*_window.ts`, `*_controller.ts`): a painter is facet-routed
  (`HOT_PAINTERS`, no raw per-frame write and no forced-reflow read), canvas
  (`CANVAS_PAINTERS`, same scans plus an identity proof that it really draws on a 2D context),
  or cold, the registration-free default for a window (no forced-reflow read and no repeating
  driver of its own, at any cadence). The raw-write scan is waived for cold NOT because a
  window is cold, which this tree contradicts, but because a COUNT cannot tell a build-time
  write from a repeated one; see the bucket 3 comment for the cadences involved. Inside a
  granted driver's callback it CAN, so a `driverAllow` entry now costs a `drivers` entry per
  call site: the cadence, pinned against the source literal, plus exact counts of raw writes,
  element re-queries and IDL-property writes over everything ONE TICK reaches
  (`helpers/driver_callback_bodies.ts`). The unit is the callback body PLUS every same-module
  function it calls, because a body-only scan is vacuous over this tree: all three live
  callbacks are a guard and a method call, and the writes that motivated the rule are one hop
  further in.
- `hud_update_drive.test.ts` answers the cadence question that gate refuses to: one
  hand-written row per call `Hud.update()` evaluates, carrying its band
  (`frame`/`fast`/`medium`/`slow`), the exact condition text gating it, what it repaints, and
  for a window the source line its invalidation guard is spelled on. Diffed BOTH ways against
  a `ts.createSourceFile` walk (`helpers/method_call_sites.ts`), so adding, deleting,
  re-banding or re-gating a call in `update()` fails until the table says so, and deleting a
  guard it names fails too. It registers the WHOLE body rather than only the windows on
  purpose: a table naming a handful when half the family qualifies reads as a complete
  classification and is not one. Touching `update()` means touching this file.
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
  `i18n_t_behavior`, `deed_i18n`): unset = PR tier (registration/key-existence only, English-only
  legal); `=1` = release tier (hard-fails on any `pending` locale row + full-localization checks).
  The tier runs as its OWN job / gate step over exactly those suites (`release-i18n` in
  `.github/workflows/ci.yml`, `vitest (release-tier i18n)` locally), never over the whole suite:
  a release branch is red for un-filled locales through most of a cycle, and fusing that with
  the test signal let a real regression hide inside expected noise (#2820). Adding a suite that
  reads the flag means adding it to `I18N_RELEASE_TIER_SUITES` (`scripts/lib/gate_steps.mjs`) and
  the ci.yml job; `tests/release_i18n_tier_coverage.test.ts` fails until all three agree.

## Running & adding
- Single file (preferred while iterating): `npx vitest run tests/<file>.test.ts`.
- **Opt-in DB gates.** `*_integration.test.ts` bodies run only when `TEST_DATABASE_URL`
  is set (dev DB via `npm run db:up`; without it they skip green), and SQL differential
  blocks gate on `WOCC_PG_DIFFERENTIAL=1`. Run the relevant ones before calling DB-shape
  work done; CI's floor is the DB-free structural pins.
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
