<!-- src/sim only (excluding content/ — that has its own CLAUDE.md). The
     one-sim-three-hosts architecture, the determinism/dependency invariants,
     and build/test commands live in the root + src CLAUDE.md — don't repeat
     them here. This file is the practical map of the deterministic core. -->

# src/sim — the deterministic game core

The host-agnostic source of truth: tick loop, combat, abilities/auras, mob AI +
aggro/leash, parties, duels, arena, trade, market, dungeon instances, terrain,
and the RL observation surface. Same code runs offline / on the server / headless.

## Key files
- **`sim.ts`** (~4.7k lines) — the whole simulation. `class Sim`; one `tick()` does everything. See the nav map below.
- **`types.ts`** (~740) — ALL shared types AND the global tuning constants + vanilla formulas (`TICK_RATE`, `DT`, `GCD`, ranges, `XP_TABLE`, hit/armor/rage math, post-cap `virtualLevel`/prestige). Plus the `SimEvent` union and the `Entity` shape.
- `data.ts` — merges `content/*` into the flat tables (`ABILITIES`, `MOBS`, `NPCS`, `QUESTS`, `ITEMS`, `CAMPS`, `DUNGEONS`) and owns world-layout consts (`WORLD_SIZE`, `instanceOrigin`, `arenaOrigin`, `zoneAt`, `dungeonAt`).
- `entity.ts` — `createPlayer/createMob/createNpc/createGroundObject` + `recalcPlayerStats` (the ONE place derived stats are computed from class/level/gear/auras/talent `mods`).
- `rng.ts` — `class Rng` (mulberry32) + stateless `hash2/noise2/fbm2` for terrain.
- `world.ts` — `groundHeight`/`terrainHeight` (pure fn of x,z,seed), `WATER_LEVEL`, `generateDecorations`. **Renderer samples the same fns** — keep them identical.
- `colliders.ts` — `resolvePosition` (static collision + slide); reads `PROPS` and the dungeon/arena layouts.
- `dungeon_layout.ts` — plain-number interior layouts; single source for BOTH render geometry and `colliders.ts` interior sets.
- `pathfind.ts` — local A* (`findPath`), used for warrior Charge.
- `threat.ts` — vanilla hate-table math (`addThreat`, `threatModifier`, taunt, stealth detection).
- `spatial.ts` — `SpatialGrid` entity hash for radius queries; re-bucketed at end of tick.
- `obs.ts` — RL surface: `ACTIONS`/`applyAction`/`encodeObs`/`obsSize`. Consumed by `headless/` + `python/` (see those dirs).

## Determinism as it bites here
- Randomness: `this.rng` only (`Rng`). NEVER `Math.random`, `Date.now`, `performance.now`. `time`/`tickCount` are sim-clock fields advanced by `tick()` — use them, not wall-clock.
- Fixed step: everything scales by `DT` (=1/20). There is no variable delta. The seed is fixed once in the `Sim` ctor.
- Order matters: changing the entity-iteration order in `tick()` changes RNG draw order ⇒ different worlds. Don't reorder loops casually.

## sim.ts navigation map (banner-comment regions, in order)
Entity roster (add/remove/teleport) · Players join/leave/persistence · **Back-compat accessors** (`player`/`inventory`/`xp`/… delegate to the primary player; per-player state lives in `PlayerMeta`, not the `Entity`) · Talents · **Main tick** (`tick()` ~944) · Player movement · Regen/timers/auras · Casting/channeling/abilities · Hunter pets · Auto-attack/melee · Damage/death (`dealDamage`) · Mob AI · Targeting · Inventory/items/vendor · Interaction (loot/quest NPCs/objects) · Quests · Player death/respawn · Hostility · Parties · Duels · Arena (Elo) · Trading · World Market (auction house) · Dungeons/instances.

## Tuning constants — change numbers THERE, not inline
- Global gameplay/formulas: top of **`types.ts`** (`MELEE_RANGE`, `GCD`, `XP_TABLE`, rage/hit/armor fns, …).
- Sim-internal knobs: the `const` block atop **`sim.ts`** (lines ~34–83: `LEASH_DISTANCE`, `MELEE_ARC`, `GRAVITY`, `PARTY_*`, `ARENA_*`, `MARKET_*`, `CHARGE_*`, `PET_*`, swim/climb, …). Edit the named const; don't hardcode magic numbers in methods.

## Talking to the outside
- Output is the **`SimEvent`** union (`types.ts`). Code calls `this.emit(ev)`; `tick()` returns the drained `SimEvent[]`. An event with `pid` is personal (delivered only to that player's owner); without `pid` it's world-visible.
- Stepping: callers run `sim.tick()` per frame (`server/game.ts`; `headless/env_server.ts` loops it `frameSkip` times). The sim never self-schedules.

## Adding a mechanic here
1. Add state to `Entity` (`types.ts`) and/or `PlayerMeta`; init it in `entity.ts` `baseEntity` / `createPlayer`.
2. Implement in the right `tick()` region; new randomness through `this.rng`; new output via `emit` (add a `SimEvent` variant if needed).
3. If render/UI must see it or trigger it: **extend `IWorld` (`src/world_api.ts`) and implement in BOTH `Sim` and `ClientWorld` (`src/net/online.ts`)** — presentation never reaches into `Sim` directly.
4. Add/adjust a Vitest (`tests/`), ideally a determinism/replay assertion.

## Never here
- **Never put balance numbers inline** — they go in the const blocks above (and follow vanilla formulas).
- **Never import from `render/`/`ui/`/`game/`/`net/` or anything DOM/Three** — this module must run unchanged in Node.
- **Never derive player stats outside `recalcPlayerStats`**, and don't walk the talent tree per-tick — talents are precomputed into the flat `TalentModifiers` at allocation/respec time.
