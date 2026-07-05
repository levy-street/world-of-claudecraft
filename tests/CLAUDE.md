<!-- tests/: Vitest suite. Local conventions only; root CLAUDE.md covers repo-wide
     rules, `npm test`, determinism/Rng, and commit style, don't repeat them. -->

# tests/: Vitest suite

Around 464 `*.test.ts` files. Tests import `src/sim/` and `server/` modules
**directly** and exercise them **deterministically** in plain Node: no live
server, browser, or Postgres for unit tests. Browser/E2E + screenshot tests live
in `scripts/*.mjs` (need `npm run dev`/`server`), NOT here.

## Naming
`<area>.test.ts` pairs with the module under test: `sim.test.ts` to `src/sim/sim.ts`,
`talents.test.ts` to `src/sim/content/talents.ts`, `social_system.test.ts` to `server/social.ts`,
`snapshots.test.ts`/`bandwidth.test.ts` to `server/game.ts`.

## The core idiom (sim tests)
Most files construct a `Sim` and advance fixed ticks. Each file redefines small
local helpers (not shared); copy the pattern from `sim.test.ts`:

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
transport (see `social_system.test.ts`) rather than mocking.

## Coverage & guards
One test area per subsystem (combat/AI, the 9 classes, progression/xp, talents, social/guilds,
snapshots/bandwidth/interest, security/auth, keybinds/mobile, admin/moderation, i18n); `ls tests/`
to find the file for an area.
`architecture.test.ts` is the `src/sim` purity backstop: it scans every sim file and fails on a
render/ui/game/net/three import, a DOM global, or `Math.random`/`Date.now`/`performance.now`. Run
it after any `src/sim/` change. It ALSO completeness-checks the UI/render pure cores, so a NEW pure
core MUST follow the `*_view`/`*_core` naming (a bare name escapes the reverse sweep) and be
registered in `UI_PURE_CORES`/`RENDER_PURE_CORES`, or the guard fails.
`malware_scan.test.ts` is the release-gate backstop (signatures from `scripts/malware_scan.mjs`,
zero high-severity findings allowed in the tree); run it after touching the scanner.

## i18n gates live here (don't produce strings, enforce them)
Run them after any sim/server player-text or English-catalog change. They depend on generated
artifacts: `pretest` runs `npm run i18n:gen`, so `npm test` regenerates the resolved tables and
`src/ui/i18n.status.json` first; a bare `npx vitest run` does NOT, so run `npm run i18n:gen`
yourself or the S3 guard throws "status.json is missing".
- **`localization_fixes.test.ts` is the S3 guard**: it parses `src/sim/sim.ts` and `server/game.ts`,
  enumerating every player-facing emit and asserting each is recognized by a `hud.ts` localize arm or
  the `localizeServerText`/`localizeSimText` matchers (plus `simDICT`/`serverDICT`/`adminDICT`
  completeness + placeholder parity per locale). Add or change a sim/server player string and update
  the matcher in the SAME change or this fails.
- **Two tiers via `I18N_RELEASE_TIER`** (also read by `localization_coverage`, `i18n_status_registry`,
  `i18n_t_behavior`): unset = PR tier (registration/key-existence only, English-only legal); `=1` =
  release tier (hard-fails on any `pending` locale row + full-localization checks).

## Running & adding
- Single file (preferred while iterating): `npx vitest run tests/<file>.test.ts`.
- **DOM in tests:** the default Vitest env is plain Node (no `document`/`window`) and **jsdom is
  deliberately NOT a dependency**. When you need one global, stub it on `globalThis` (`localStorage`
  in `keybinds.test.ts`, `WebSocket` in `snapshots.test.ts`). For a DOM-touching UI test (focus
  wiring, a write-elided painter, a keyed pool), build a small **hand-rolled fake DOM** that models
  only the contract under test (`focus_manager.test.ts`, `painter_host.test.ts`,
  `hud_perf_budget.test.ts`); do NOT reach for jsdom. The real-browser path (WebKit/Safari CSS, axe,
  target-size) is the OPT-IN Playwright suite `tests/browser/*.browser.test.ts`
  (`npm run test:browser`), never a bare `vitest run`.
- Add/update a test here when you change sim or server behavior (see root CLAUDE.md).
