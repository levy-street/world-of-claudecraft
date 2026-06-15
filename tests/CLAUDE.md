<!-- tests/ — Vitest suite. Local conventions only; root CLAUDE.md covers repo-wide
     rules, `npm test`, determinism/Rng, and commit style — don't repeat them. -->

# tests/ — Vitest suite

37 `*.test.ts` files (~468 cases). Tests import `src/sim/` and `server/` modules
**directly** and exercise them **deterministically** in plain Node — no live
server, browser, or Postgres for unit tests. Browser/E2E + screenshot tests live
in `scripts/*.mjs` (need `npm run dev`/`server`) — NOT here.

## Naming
`<area>.test.ts` ↔ the module under test: `sim.test.ts`→`src/sim/sim.ts`,
`talents.test.ts`→`src/sim/content/talents.ts`, `social_system.test.ts`→`server/social.ts`,
`snapshots.test.ts`/`bandwidth.test.ts`→`server/game.ts`.

## The core idiom (sim tests)
Most files construct a `Sim` and advance fixed ticks. Each file redefines small
local helpers (not shared) — copy the pattern from `sim.test.ts`:

```ts
const makeSim = (cls='warrior', seed=42) => new Sim({ seed, playerClass: cls, autoEquip: true });
// teleport: set pos.{x,z}, then pos.y = terrainHeight(x,z, sim.cfg.seed), then prevPos = {...pos}
// face a target: sim.player.facing = Math.atan2(t.pos.x-p.pos.x, t.pos.z-p.pos.z)
for (let i = 0; i < 20 * 120 && !done; i++) sim.tick();  // 20 = ticks/sec (DT=1/20); `20*N` = N seconds
const ev = sim.tick();  // tick() RETURNS SimEvent[]; assert on e.type ('death','playerDeath','error',...)
```

- Multiplayer/world tests: `new Sim({ ..., noPlayer: true })` then `sim.addPlayer(cls, name)` → pid (see `social.test.ts`, `arena.test.ts`).
- Reach into internals via `(sim as any).dealDamage(...)`, `(sim as any).grantXp(...)`; set level with `sim.setPlayerLevel(n)`.
- Determinism is asserted by running twice: `expect(run()).toEqual(run())` (`sim.test.ts` RL section).

## Server tests (snapshots/bandwidth/xp/interest/admin/...)
Postgres is mocked at the top — `vi.mock('../server/db', () => ({ pool, saveCharacterState, ... }))`
(hoisted; keep it ABOVE the `server/game` import). Drive `new GameServer()` with a
fake socket: `fakeWs()` collects `JSON.parse`'d sends; `server.join(...)`,
`server.handleMessage(session, JSON.stringify({t:'cmd',...}))`, `(server as any).broadcastSnapshots()`.
For the online client path, build a `ClientWorld` with `Object.create(ClientWorld.prototype)`
(see `bareClient` in `snapshots.test.ts`/`talents.test.ts`) and call `applySnapshot(...)`.

`server/social.ts` etc. take injected interfaces — implement an in-memory `FakeDb`/
transport (see `social_system.test.ts`) rather than mocking.

## Coverage breadth
Formulas/combat/AI (`sim`, `threat`), all 9 classes & abilities (`social`, `progression`),
parties/duels/trades/arena/crypt (`social`, `arena`), progression/xp incl. max-level overflow
(`progression`, `xp`), talents (`talents`), social/guilds (`social_system`), snapshots/delta-bandwidth
(`snapshots`, `bandwidth`, `interest`), security/auth/rate-limit (`security`), keybinds/mobile
(`keybinds`, `mobile_controls`, `locomotion`), admin/moderation (`admin`, `moderation_db`).

## Running & adding
- Single file (preferred while iterating): `npx vitest run tests/<file>.test.ts`.
- DOM-less env: stub `localStorage`/`WebSocket` on `globalThis` when needed (`keybinds.test.ts`).
- YOU MUST add/update a test here when you change sim or server behavior (see root CLAUDE.md).
