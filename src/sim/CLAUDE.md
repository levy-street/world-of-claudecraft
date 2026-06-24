<!-- src/sim only (excluding content/ — that has its own CLAUDE.md). The
     one-sim-three-hosts architecture, the determinism/dependency invariants,
     and build/test commands live in the root + src CLAUDE.md — don't repeat
     them here. This file is the practical map of the deterministic core. -->

# src/sim — the deterministic game core

The host-agnostic source of truth: tick loop, combat, abilities/auras, mob AI +
aggro/leash, parties, duels, arena, trade, market, dungeon instances, terrain,
and the RL observation surface. Same code runs offline / on the server / headless.

## Key files
- **`sim.ts`** — the whole simulation. `class Sim`; one `tick()` does everything. See the nav map below.
- **`types.ts`** — ALL shared types AND the global tuning constants + vanilla formulas (`TICK_RATE`, `DT`, `GCD`, ranges, `XP_TABLE`, hit/armor/rage math, post-cap `virtualLevel`/prestige). Plus the `SimEvent` union and the `Entity` shape.
- `data.ts` — merges `content/*` into the flat tables (`ABILITIES`, `MOBS`, `NPCS`, `QUESTS`, `ITEMS`, `CAMPS`, `DUNGEONS`) and owns world-layout consts (`WORLD_SIZE`, `instanceOrigin`, `arenaOrigin`, `zoneAt`, `dungeonAt`).
- `entity.ts` — `createPlayer/createMob/createNpc/createGroundObject` + `recalcPlayerStats` (the ONE place derived stats are computed from class/level/gear/auras/talent `mods`).
- `rng.ts` — `class Rng` (mulberry32) + stateless `hash2/noise2/fbm2` for terrain.
- `world.ts` — `groundHeight`/`terrainHeight` (pure fn of x,z,seed), `WATER_LEVEL`, `generateDecorations`. **Renderer samples the same fns** — keep them identical.
- `colliders.ts` — `resolvePosition` (static collision + slide); reads `PROPS` and the dungeon/arena layouts.
- `dungeon_layout.ts` — plain-number interior layouts; single source for BOTH render geometry and `colliders.ts` interior sets.
- `pathfind.ts` — local A* (`findPath`); the player-tuned wrapper `findPlayerPath` (body radius, climb, swim) is what warrior Charge calls via `findChargePath`.
- `threat.ts` — vanilla hate-table math (`addThreat`, `threatModifier`, taunt, stealth detection).
- `spatial.ts` — `SpatialGrid` entity hash for radius queries; re-bucketed at end of tick.
- `obs.ts` — RL surface: `ACTIONS`/`applyAction`/`encodeObs`/`obsSize`. Consumed by `headless/` + `python/` (see those dirs).

## Determinism as it bites here
- Randomness: `this.rng` only (`Rng`). NEVER `Math.random`, `Date.now`, `performance.now`. `time`/`tickCount` are sim-clock fields advanced by `tick()` — use them, not wall-clock.
- Fixed step: everything scales by `DT` (=1/20). There is no variable delta. The seed is fixed once in the `Sim` ctor.
- Order matters: changing the entity-iteration order in `tick()` changes RNG draw order ⇒ different worlds. Don't reorder loops casually.

## sim.ts navigation map (banner-comment regions, in order)
Entity roster (add/remove/teleport) · Players join/leave/persistence · **Back-compat accessors** (`player`/`inventory`/`xp`/… delegate to the primary player; per-player state lives in `PlayerMeta`, not the `Entity`) · Talents · **Main tick** (`tick()`, under the `// Main tick` banner) · Player movement · Regen/timers/auras · Casting/channeling/abilities · Hunter pets · Auto-attack/melee · Damage/death (`dealDamage`) · Mob AI · Targeting · Inventory/items/vendor · Interaction (loot/quest NPCs/objects) · Quests · Player death/respawn · Hostility · Parties · Duels · Arena (Elo) · Trading · World Market (auction house) · Dungeons/instances.

`sim.ts` is large by necessity (one deterministic tick), but a self-contained subsystem that grows its own state and helpers can be lifted into a sibling pure module the way `threat.ts`/`spatial.ts`/`pathfind.ts` already are; mirror that pure-core pattern rather than splitting just to cut line count.

## Tuning constants — change numbers THERE, not inline
- Global gameplay/formulas: top of **`types.ts`** (`MELEE_RANGE`, `GCD`, `XP_TABLE`, rage/hit/armor fns, …).
- Sim-internal knobs: the `const` block atop **`sim.ts`** (`LEASH_DISTANCE`, `MELEE_ARC`, `GRAVITY`, `PARTY_*`, `ARENA_*`, `MARKET_*`, `CHARGE_*`, `PET_*`, swim/climb, …). Edit the named const; don't hardcode magic numbers in methods.

## Talking to the outside
- Output is the **`SimEvent`** union (`types.ts`). Code calls `this.emit(ev)`; `tick()` returns the drained `SimEvent[]`. An event with `pid` is personal (delivered only to that player's owner); without `pid` it's world-visible.
- Stepping: callers run `sim.tick()` per frame (`server/game.ts`; `headless/env_server.ts` loops it `frameSkip` times). The sim never self-schedules.

## Player-facing text is English here (localized at the client)
- The sim carries **no `t()`/DOM/i18n imports**. Player-visible strings are emitted as
  English literals/templates on `SimEvent`s via `this.emit`, `this.error(pid, text)`
  (`type:'error'` toast), `this.notice(pid, text)` (`type:'log'` line), and
  `stopFollow(p, msg)` (routes `msg` through `this.error`). Translation happens only at
  the client boundary, in `src/ui/sim_i18n.ts` (`localizeSimText`): an `EXACT` map of
  placeholder-free strings plus ordered `RULES` regexes that re-render each emit through
  `t()`/`tSim()`.
- **Money is built English here, re-localized client-side.** `sim.ts` has its OWN local
  `formatMoney` (sim.ts bottom, NOT the `src/ui/i18n.ts` one) that yields plain `"3g 5s"`
  fragments inside loot/quest emit text; this is intentional (the sim stays
  language-agnostic). The client re-renders those amounts locale-aware in hud's
  `localizeLootText` arm — `parseSimMoney` reverses the `"Ng Ns Nc"` fragment back to copper,
  then the i18n `formatMoney` formats it. Don't reach for the i18n `formatMoney`/`formatNumber`
  here, and don't hand-format with a separator a locale would change.
- **Dev-channel text stays English.** The sim's only non-player text is the lone
  `console.*` diagnostic (no user-surfaced `throw`s); it is never matched. If a string
  would ever feed both a diagnostic log and a player-visible `SimEvent`, split it so only
  the player arm (`this.error`/`this.notice`) is registered in `sim_i18n.ts`.
- **Changing or adding a player string is a two-file change:** edit the literal in
  `sim.ts` AND add/update the matching `EXACT` value or `RULE` (plus its `BASE_DICT` /
  EXTRA-table key) in `sim_i18n.ts`, in the same change. Broad multi-capture `RULES`
  (e.g. `unleashes`) stay LAST, after the specific `{name} {verb}!` rules.
- The **S3 drift guard** (`tests/localization_fixes.test.ts`) parses `sim.ts` at test
  time and fails CI on any emit no client matcher recognizes. It only sees string
  **literals** at the emit site: variable-routed emits (e.g. `helpLines()` looped through
  `this.error(id, line)`) and `?? 'English'` fallbacks are invisible. Strings that ship
  English on purpose (the v0.7 slash-command readouts) are tracked in the status registry
  (`blockedSource` / `ALLOW_V07_SLASH`); prefer a literal at the emit site so the guard
  keeps working.

## Adding a mechanic here
1. Add state to `Entity` (`types.ts`) and/or `PlayerMeta`; init it in `entity.ts` `baseEntity` / `createPlayer`.
2. Implement in the right `tick()` region; new randomness through `this.rng`; new output via `emit` (add a `SimEvent` variant if needed).
3. If render/UI must see it or trigger it: **extend `IWorld` (`src/world_api.ts`) and implement in BOTH `Sim` and `ClientWorld` (`src/net/online.ts`)** — presentation never reaches into `Sim` directly.
4. Add/adjust a Vitest (`tests/`), ideally a determinism/replay assertion.

## Never here
- **Never put balance numbers inline** — they go in the const blocks above (and follow vanilla formulas).
- **Never import from `render/`/`ui/`/`game/`/`net/` or anything DOM/Three** — this module must run unchanged in Node.
- **Never derive player stats outside `recalcPlayerStats`**, and don't walk the talent tree per-tick — talents are precomputed into the flat `TalentModifiers` at allocation/respec time.
