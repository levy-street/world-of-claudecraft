# Target Architecture for the Systems Refactor (v0.15.0+)

Status: proposal, for adoption at the start of the post-0.15.0 freeze.
Companion to `refactor-workstreams-v0.15.0` (the WHAT and the priority order).
This document is the HOW: the shape every system migrates toward and the rules
every new module follows from now on.

Audience: any contributor (human or AI agent) touching `src/sim/`, `server/`,
`src/net/`, or `src/world_api.ts`. The frontend (HUD/render) program is already
specified in `docs/ui-architecture-hud-modularization/`; this document adopts its
patterns repo-wide and focuses on the backend (sim, server, protocol, persistence,
content) that is not yet covered.

---

## 0. The one sentence

Turn the four god-objects (`sim/sim.ts` 15.3k lines, `ui/hud.ts` 13.1k, `server/game.ts`
2.7k, `net/online.ts` 1.7k) into thin composition roots over small, single-responsibility
modules that depend on **ports (interfaces), not on each other**, with every boundary
**machine-checked** so that many agents can extract and rewrite in parallel without
breaking determinism, three-host parity, or the wire protocol.

The expensive part (AI compute and iteration) is acceptable. The thing we are buying
with it is **mechanically verifiable decoupling**, so the cost is bounded by gates, not
by reviewer attention.

---

## 1. The constraints that do not move

Every decision below is subordinate to these. They are the substrate, not the target,
and the refactor must make them *easier* to keep, never weaker.

1. **Determinism.** Fixed 20 Hz tick (`DT = 1/20`). All randomness through `Rng`
   (`src/sim/rng.ts`), never `Math.random`/`Date.now`/`performance.now`. Same seed,
   same world. The order of RNG draws is part of the contract: reordering work inside a
   tick changes the world. (Guarded by `tests/architecture.test.ts`.)
2. **One sim, three hosts.** The exact `src/sim/` runs offline (browser `Sim`), on the
   authoritative server, and headless (RL env). Behavior is identical everywhere.
3. **`IWorld` is the render/ui seam.** `src/render/` and `src/ui/` talk only to
   `IWorld` (`src/world_api.ts`), never to a concrete `Sim`/`ClientWorld`.
4. **Server authority.** Clients send movement intent plus commands at 20 Hz; the server
   runs the one shared `Sim` and returns interest-scoped (~120 yd) snapshots plus
   per-player events. Combat, loot, quest credit, economy resolve server-side.
5. **`src/sim/` import purity.** Zero DOM/Three/`render`/`ui`/`game`/`net`/`server`
   imports (one sanctioned `import type` edge into `world_api.ts` shapes).
6. **i18n boundary.** `src/sim/` and `server/` stay language-agnostic but their
   player text is in scope: emit a stable key plus values, or English re-localized via
   the client matchers (`src/ui/sim_i18n.ts`, `src/ui/server_i18n.ts`) in the same change.
   The S3 guard (`tests/localization_fixes.test.ts`) enforces it.

These already have tests. The refactor extends those tests to each new module rather
than relying on them only at the package edge.

---

## 2. Principles, instantiated

The generic principles map onto concrete, already-proven patterns in this repo. We are
not inventing a framework; we are naming five patterns that already exist in good
modules and applying them everywhere.

| Principle | What it means here | Already proven by |
|---|---|---|
| **Dependency inversion** | Systems depend on a `Context`/port interface, not on the `Sim`/`GameServer`/`Hud` that owns them. The owner builds the port and injects it. | `threat.ts`, `colliders.ts`, `pathfind.ts` take `Entity`/data in, return results out, never reference `Sim`. |
| **Single responsibility** | One module owns one nameable slice of behavior plus its state and its tests. | `entity.ts` owns stat recomputation; `spatial.ts` owns the hash grid. |
| **Modularity / pure-core + thin-host** | Lift pure domain/presentation logic into a host-agnostic module a Vitest imports directly; leave the host a thin consumer. | `ui/unit_portrait.ts` + `unit_portrait_painter.ts`; `ui/vendor_view.ts` + `vendor_window.ts`. |
| **Open/closed for content** | New mobs/items/quests/abilities/encounters are *data plus declared effects*, merged by a registry, never new branches in `sim.ts`. | `src/sim/content/*` merged by `src/sim/data.ts` into `MOBS`/`ITEMS`/`QUESTS`. |
| **Decoupled communication** | Cross-system signalling goes through the existing `SimEvent` queue and delayed-event queue, not direct method calls, wherever tick order allows. | `sim.tick()` already drains `this.events`; the server routes them to wire events. |

Decoupling is the goal; **explicit ports are the mechanism**; **machine-checked gates**
are what let us trust it at AI scale.

---

## 3. The layered model (target dependency graph)

Read every arrow as "is allowed to import from." This extends the rules already in
`src/CLAUDE.md` down into the sim and out into the server.

```
                 content/ (data + declared effects)         persistence/ (versioned state fragments)
                          |  registry merge                            |  normalize/serialize
                          v                                            v
  rng / spatial / pathfind / colliders / world  ->  sim systems (mob, combat, threat, entity-lifecycle,
        (pure leaf helpers, no game state)              loot, quests, pets, instances, social, progression)
                          \                                   |  each depends on -> SimContext (port)
                           \                                  v
                            \--------------->  Sim  (composition root: owns world state + tick registry)
                                                    |  satisfies structurally
                                                    v
                                              IWorld facets  (world_api.ts: domain ports, re-exported as IWorld)
                                              ^                              ^
                  net/ClientWorld implements -/                              \- render/ + ui/ consume (read + command)
                                                                                (HudContext / pure-core + painter)

  server runtime (game.ts) = composition root over: command router, snapshot codec,
        event router, session registry, autosave, live-ops  ->  each behind a port,
        all driving the one shared Sim; infra (auth/db/social/wallet/chat/ratelimit) already split.
```

Direction rules, additive to the existing ones:

- **Sim systems never reference `Sim` directly.** They take a `SimContext` (Section 4.2).
  This is the new rule that makes the sim decoupled. `Sim` is the only place that knows
  every system; a system knows only the port.
- **A system never imports another system.** If system A needs B's behavior mid-tick, it
  goes through a narrow capability on the `SimContext` (a port method B registered) or
  through an event. No `import { combat } from './combat'` inside `mob`.
- **The server depends on `IWorld`-style ports of the Sim plus its own runtime ports**,
  not on Sim private fields. Today `game.ts` reaches into Sim internals; the target is a
  thin authoritative surface.
- **`world_api.ts` becomes a barrel of domain facets** (Section 4.4) that still exports
  the aggregate `IWorld`, so render/ui callers and the parity tests are unaffected while
  new code can depend on a narrow facet.

---

## 4. The seam patterns (the whole architecture is these eight shapes)

Everything below is one of eight reusable shapes. New code picks the shape that fits;
migration moves old code into a shape. There is deliberately a *small fixed vocabulary*
so agents do not invent new seams.

### 4.1 Pure system module (sim-side)

The leaf shape. A module that owns one slice of rules, has no reference to `Sim`, and is
unit-testable in isolation. Inputs and outputs are plain data and `Entity`. This already
exists: `threat.ts`, `entity.ts`, `spatial.ts`, `pathfind.ts`, `colliders.ts`,
`tab_target.ts`, `world.ts`. The refactor produces many more of these (damage
calculator, hit table, aura runner, loot roll engine, xp curve, leash policy).

```ts
// src/sim/combat/damage_calc.ts  (pure, no Sim, no I/O)
export function resolveDamage(input: DamageInput, rng: Rng): DamageResult { ... }
```

Rule: if a piece of logic does not need the live world map, it is a pure module and gets
its own Vitest file. Extract on the rule of three or on a single nameable responsibility.

### 4.2 `SimContext`: dependency inversion inside the sim (the keystone)

Today every method on `Sim` reads and writes `this.entities`, `this.rng`, `this.time`,
per-entity fields, and calls sibling methods directly (`sim.ts` tick body, lines ~2052
to 2156). That shared mutable `this` *is* the coupling.

The keystone move: define a `SimContext` interface (a port) that exposes exactly the
capabilities a system needs, and have `Sim` implement it and pass it to each system.

```ts
// src/sim/context.ts
export interface SimContext {
  readonly time: number;
  readonly tick: number;
  readonly rng: Rng;                       // the only randomness source
  entities(): Iterable<Entity>;
  get(id: number): Entity | undefined;
  add(e: Entity): void;
  drop(id: number): void;
  inRadius(x: number, z: number, r: number, fn: (e: Entity) => void): void;  // spatial
  emit(ev: SimEvent): void;                // decoupled signalling
  schedule(delaySec: number, ev: SimEvent, guard?: () => boolean): void;
  content: ContentRegistry;                // MOBS/ITEMS/QUESTS/ABILITIES (read-only)
  // narrow cross-system capabilities, registered by their owning system:
  combat: CombatPort;   // dealDamage / applyHeal / applyAura
  threat: ThreatPort;   // addThreat / topThreat / clear
  loot: LootPort;       // rollLoot / distribute
  // ...one port per system that others legitimately need
}

export interface MobSystem {
  update(ctx: SimContext): void;           // runs once per tick for all mobs
}
```

Why this is the dependency inversion the founder is asking for: `MobSystem` depends on
`CombatPort` and `ThreatPort` (abstractions), not on the `Sim` class or the combat
module's concrete file. The composition root (`Sim`) wires concrete implementations into
the context. Systems become independently testable with a fake `SimContext`, and an
agent can rewrite `MobSystem` knowing only the port surface it consumes.

This does not change the tick math: the `SimContext` is a thin facade over the same
`this.entities`/`this.rng`. It is a *seam*, not a rewrite of the data model. Determinism
is preserved because the context does not reorder anything; the registry (4.3) does.

### 4.3 System registry with an explicit, fixed tick order

The `tick()` body is load-bearing and order-sensitive (players before mobs, then a
combat-state consolidation pass, then higher-level systems, then spatial refresh, then
event drain: `sim.ts` lines ~2052 to 2156). We make that order **data**, not a wall of
inline calls, so it is reviewable, testable, and stable.

```ts
// src/sim/systems.ts  (the one place that fixes order = fixes determinism)
export const TICK_ORDER: ReadonlyArray<SystemSlot> = [
  { phase: 'pre',     run: ctx => mobRespawn.update(ctx) },
  { phase: 'pre',     run: ctx => groundAoe.update(ctx) },
  { phase: 'players', run: ctx => playerSystems.update(ctx) },   // movement, casting, regen, auras
  { phase: 'mobs',    run: ctx => mob.update(ctx) },             // aggro/pursuit/leash/combat
  { phase: 'combatState', run: ctx => engagement.update(ctx) },
  { phase: 'systems', run: ctx => duels.update(ctx) },
  { phase: 'systems', run: ctx => arena.update(ctx) },
  // ... trades, loot rolls, instances, market, delayed events
];
// Sim.tick() becomes: advance clock; for (const s of TICK_ORDER) s.run(this.ctx);
//                      refresh grids; return drained events.
```

The migration safety net for this is the determinism replay test: capture a fixed-seed,
fixed-action byte trace before extracting a system, assert byte-identical after. A
reordering bug shows up as a failed replay, not as a silent world divergence.

### 4.4 `IWorld` split into domain facets (preserving the aggregate)

`world_api.ts` is one ~120-member interface mixing player-state reads, ~70 command
methods, and ~25 domains. We split it into facet interfaces and recompose them:

```ts
// world_api/combat.ts
export interface CombatWorld {
  castAbility(id: string): void;
  castAbilityBySlot(slot: number): void;
  targetEntity(id: number | null): void;
  startAutoAttack(): void; stopAutoAttack(): void;
  // ...
}
// world_api/social.ts -> SocialWorld; world_api/market.ts -> MarketWorld; etc.

// world_api.ts (barrel, unchanged export name)
export interface IWorld extends
  PlayerStateWorld, CombatWorld, InventoryWorld, QuestWorld,
  SocialWorld, TradeWorld, ArenaWorld, MarketWorld, PetWorld,
  TalentWorld, DungeonWorld, ProgressionWorld { /* aggregate */ }
```

Payoff: a new HUD window can depend on `MarketWorld` (7 members) instead of `IWorld`
(120). Both `Sim` and `ClientWorld` still implement the aggregate, so the existing
parity tests (`tests/snapshots.test.ts`) and render/ui callers are untouched. This is
"interface segregation" with zero behavioral change.

### 4.5 Server runtime modules behind ports

`game.ts` (the `GameServer` god-object, ~2.7k lines) bundles the world loop, command
validation and routing, snapshot encoding (`wireEntity`/`applyWire`/`selfWireJson`),
event routing, the session registry, chat policy, autosave, market and social
persistence, holder-tier refresh, and admin live-ops. Infra is already cleanly split
(`auth.ts`, `db.ts`, `social.ts`, `wallet*.ts`, `chat_filter.ts`, `ratelimit.ts`,
`moderation_db.ts`, `admin.ts`): that is the proof the pattern works.

Target: `GameServer` becomes a composition root over runtime modules, each behind a port:

```
server/runtime/
  command_router.ts   // inbound cmd -> validate -> dispatch into Sim port
  snapshot_codec.ts    // wireEntity / applyWire / selfWireJson / interest-scoping / deltas
  event_router.ts      // SimEvent[] -> per-player wire events
  session_registry.ts  // ClientSession lifecycle, lookups by pid/characterId
  autosave.ts          // cadence, overlap-skip, shutdown drain
  live_ops.ts          // admin teleport/level/announce, holder refresh
```

`GameServer` holds the Sim and the modules, and the tick loop calls them in order. The
command router and snapshot codec are the two with the highest test value (they define
the wire contract); extract those behind ports first so a snapshot-format change does not
require editing the whole server.

### 4.6 Pure-core + thin-host (ui-side, adopted from the HUD program)

The HUD program already defines this end-state (`HotWriteGate`, `ReactiveDiff`,
`HudContext`, one window per module consuming `HudContext`, the pure view plus thin
painter split proven by `unit_portrait` and `vendor_view`). The backend refactor does
not touch the HUD; it only commits to feeding it through `IWorld` facets and to the same
pattern name so the vocabulary is shared. New presentation logic is a pure view module
plus a thin painter, never a method bank on `hud.ts`/`renderer.ts`.

### 4.7 Content as data plus declared effects (open/closed)

The content layer is half-done: `content/*` is declarative, but content-specific behavior
still leaks into `sim.ts` as id checks (for example conjure-item generation around
`sim.ts` line 3416 keyed on `ability.id === 'conjure_water'`; the Nythraxis raid encoded
as ~500 lines of bespoke `updateNythraxis*` methods; `undead`/`gorrak` healing special
cases). The target: behavior is *declared* on the content record and run by a small set
of generic runners.

```ts
// content: an ability declares effects, it does not get a branch in sim.ts
{ id: 'conjure_water', effects: [{ kind: 'conjureItem', itemId: 'conjured_water', qty: 2, tieredByRank: true }] }
// encounters: a phase/script table, run by one EncounterRunner, not 500 inline lines
{ id: 'nythraxis', phases: [ { ... mechanics: [ ... ] } ] }
// mobs: tags/resistances instead of id checks
{ id: 'gorrak', healingResist: 1.0, tags: ['undead', 'arena_forbidden'] }
```

Rule (already in root `CLAUDE.md`, made stricter here): no new `id ===` or `templateId ===`
branch in `sim.ts`. A new content behavior is either an existing effect/tag/hook, or a new
generic runner plus a declared field, added to `content/` and the `/wiki` generator.

### 4.8 Versioned persistence boundary

`CharacterState` is JSONB with optional-field accretion and no version field (typed at
`sim.ts` ~820 to 864; serialize at ~1390; restore/backfill in `addPlayer` ~1188 to 1310).
This "add an optional field whenever a system needs one" is flexible but will fight
system ownership: each system wants to own its own slice of saved state.

Target:

```ts
interface CharacterState {
  v: number;                      // schema version, explicit
  // per-domain fragments, each owned + (de)serialized by its system:
  progression: ProgressionState;  // level, xp, lifetimeXp, prestige, rested
  combat: CombatState;            // talents, loadouts, equipment
  social: SocialState;            // (relational tables stay in social_db)
  pet?: PetState;
  // ...
}
// one normalize(state) step at load applies version upgrades; each system
// exposes serialize(meta)/restore(meta, fragment). No reach-across.
```

Migration is additive and idempotent (inline DDL re-applied at boot under the advisory
lock; `db.ts`). The `migration-safety` agent reviews every persistence change. A
`tests/character_state_versioning.test.ts` asserts every prior on-disk shape loads
through `normalize` (we already have `tests/character_db.test.ts` and
`tests/quest_progress_persist.test.ts` to build on).

---

## 5. The module contract (how we write ALL new code from now)

Before merging any new system or module, it satisfies this checklist. This is the
durable output of the freeze; it is what "do it this way from now on" means concretely.

1. **One responsibility, named.** The module name is a noun for one slice
   (`loot_roll`, `leash_policy`, `snapshot_codec`). If you cannot name it in one noun
   phrase, it is two modules.
2. **Lives behind a seam, not bolted onto a monolith.** A new sim system is a file/dir in
   `src/sim/<system>/` with an `index.ts` barrel; a new render system is
   `src/render/<thing>.ts`; a new HUD window is `src/ui/hud/<window>.ts`; new content is a
   record in `src/sim/content/`. Never a new method cluster on `sim.ts`/`hud.ts`/
   `renderer.ts`/`game.ts`.
3. **Depends on ports, not concretes.** A sim system takes `SimContext` (and narrow
   capability ports), never the `Sim` class. Presentation takes an `IWorld` facet, never
   a concrete world. The server takes runtime ports, never Sim private fields.
4. **Pure where possible.** Logic that does not need the live world is a pure function in
   its own file with its own Vitest. Side effects (mutating entities, emitting events) are
   pushed to the thin edge.
5. **No cross-content branching.** No `id ===`/`templateId ===` in shared code; declare it
   on the content record.
6. **i18n-clean.** Player text is a stable key plus values, or English with a matcher rule
   added in the same change. Numbers/money/dates through the formatters.
7. **Tested in isolation and gated.** Unit test for the module; if it is a sim system,
   it is covered by the boundary gate (Section 6) and, if extracted from existing
   behavior, by a before/after parity fixture.
8. **One owner.** The module appears in the ownership map (`docs/architecture/ownership.md`)
   with exactly one owning workstream, so two agents never edit it at once.

Decision tree for "where does new behavior X go?":

- Needs the live world map and runs per tick -> a **sim system** (4.1/4.2), registered in
  `TICK_ORDER` (4.3).
- Pure rule/formula -> a **pure module** (4.1), called by a system.
- New mob/item/quest/ability/encounter behavior -> **content data plus effect/hook** (4.7).
- New thing render/ui needs to read or command -> **`IWorld` facet** (4.4), implemented in
  both worlds.
- New server-side concern (routing, codec, persistence, live-ops) -> a **runtime module**
  behind a port (4.5).
- Saved player state -> a **state fragment** owned by its system, with a version bump (4.8).
- New visible UI -> **pure view plus thin painter** (4.6).

---

## 6. Verification and AI-enablement (what makes the expensive iteration safe)

The reason we can spend a lot of AI compute is that correctness is checked by machines,
not by humans rereading diffs. The existing net is already strong:

- `tests/architecture.test.ts`: sim import purity, no DOM globals, no nondeterministic
  clocks/RNG (scans every `src/sim/` file).
- Determinism replay and ~341 test files / ~55k LOC, including 60 `mob_*.test.ts`,
  `threat.test.ts` (1.5k), `nythraxis_raid.test.ts` (2.2k), `snapshots.test.ts` (1.2k wire
  round-trip), the i18n S3 drift guard (`localization_fixes.test.ts`).
- CI gates (`.github/workflows/ci.yml`): Biome lint on changed files, `npm test`,
  `npx tsc --noEmit` (full strict typecheck), env/server/client builds, the malware gate,
  and a two-tier i18n split (PR tier English-legal, release tier full 14-locale).

What we ADD to make the boundaries first-class and the parallelism safe:

1. **Per-module boundary gates.** Generalize `architecture.test.ts` into a reusable
   scanner asserting, for each new `src/sim/<system>/`: imports nothing from sibling
   systems, references no `Sim` concrete (only `SimContext`), no nondeterminism. A new
   system is not "done" until its gate exists.
2. **Extracted-system parity fixtures.** Before moving behavior, capture a fixed-seed,
   fixed-action byte trace (entity states / damage / xp / events) through the old code;
   assert byte-identical through the new module. This is the contract that lets an agent
   rewrite a system aggressively: green replay = behavior preserved.
3. **`SimContext` port-purity test.** Assert systems only touch the world through
   `SimContext` (no direct `Sim` field access), so the dependency inversion cannot silently
   rot.
4. **`IWorld` facet parity test.** Assert `Sim` and `ClientWorld` implement the same facet
   set (extends today's read-surface parity), so the offline and online worlds cannot drift.
5. **Command schema parity test.** Assert `ClientWorld` command payloads match
   `server` command-router validation cases (named in the workstreams doc as a boundary
   test we do not yet have).
6. **Persistence version test.** Every historical `CharacterState` shape loads through
   `normalize` (4.8).
7. **DX/parity convenience.** Add `"typecheck": "tsc --noEmit"` to `package.json` so the
   local loop matches CI exactly (CI already runs it; agents should run it before pushing).
8. **The ownership map** (`docs/architecture/ownership.md`): module -> owning workstream,
   so fan-out does not collide.

Why this is the unlock for AI fan-out: each extraction is an isolated unit with (a) its
own small files, (b) its own boundary gate, and (c) a before/after parity fixture. Many
agents can work different systems in parallel because the modules do not share files and
the gates catch any boundary, determinism, or wire regression mechanically. Merge
conflicts shrink because nobody is editing the 15k-line monolith at once.

---

## 7. Migration: strangler-fig, one system at a time

We do not rewrite the monoliths. We strangle them: introduce the seam, move one system
behind it with the monolith delegating, then delete the old code path.

Per-system loop (repeat for each slice):

1. Capture parity fixtures for the slice (Section 6.2) against current `sim.ts`.
2. Define the system's port surface on `SimContext` and any capability ports it needs.
3. Create `src/sim/<system>/` and move the behavior in, depending only on the context.
4. Replace the inline `sim.ts` calls with one `system.update(ctx)` registered in
   `TICK_ORDER` (preserve position exactly).
5. Run the boundary gate + parity fixtures + full suite + `tsc --noEmit`. Green = done.
6. Delete the dead code from `sim.ts`. Record the module in the ownership map.

Order (from the workstreams doc, validated by where the tests already are):

| Priority | Slice | Why this order |
|---|---|---|
| P0 | Scaffolding: `SimContext`, `TICK_ORDER`, boundary-gate scanner, parity-fixture harness, ownership map | Nothing extracts safely without the seam and the gates. Land during the 3-day freeze, no behavior change. |
| P1 | **Mob system** (aggro/pursuit/evasion/leash/social-pull/special-attacks/death hooks) | Best-covered path: 60 `mob_*.test.ts` are the parity proof. |
| P1 | **Combat calculators + effect runners** (ability resolution, damage/heal, auras, cooldowns, casting, pushback, swings, CC, resources) | Everything else (mobs, pets, loot, quests, arena) depends on these; extract the pure calculators first. |
| P1 | **Entity lifecycle** (add/drop/rebucket/death/respawn/corpse/ground-objects/delayed-events) | Unlocks loot, quests, pets, instances. |
| P2 | Threat and targeting | `threat.ts` already pure; move the policy/call-sites behind a `ThreatPort`. |
| P2 | Pets and summons | Currently interleaved with mob AI; separate `PetBrain` once mob+combat are stable. |
| P2 | Loot and economy | Loot rolls, corpse loot, copper, vendor, market, item grant/remove. |
| P3 | Quests and interactions; instances/encounters (Nythraxis -> `EncounterRunner`); party/duel/arena/fiesta; progression/chat; persistence ownership | Multiplayer state machines and saved-state ownership settle last, after the behavior modules they read. |
| parallel | Server runtime (command router + snapshot codec first) and `IWorld` facet split | Independent of the sim slices; can proceed by a different owner. |

Frontend (HUD/render) proceeds on its own existing roadmap, owned separately. Crypto and
wallet stay feature-active and isolated during the freeze (do not refactor them now).

---

## 8. Risks and non-goals

- **Do not split for line count.** `sim.ts` as a composition root and `Sim` owning the
  world state can stay large. Split for *responsibility and ownership*, never to hit a
  number. A system that needs the world's mutable state is not improved by being a
  sibling file that reaches back in.
- **Determinism is the sharpest edge.** Any reordering inside the tick changes the world.
  The `TICK_ORDER` table plus replay fixtures exist precisely to make this safe; never
  extract a tick-participating system without its fixture green first.
- **The i18n S3 guard parses `sim.ts`/`game.ts` emit shapes by regex.** Moving an emit to
  a new module must keep it matchable (or update the matcher in the same change), or the
  guard goes red. Treat it as part of the extraction.
- **Persistence is the riskiest migration.** Versioned `CharacterState` and per-system
  fragments must stay back-compatible with every live save. Gate with the
  `migration-safety` agent and the version test; ship the version field before the first
  fragment split.
- **Not a feature change.** This is pure restructuring. The shipped behavior, the wire
  format, and the save format stay identical at every step; the gates prove it.
- **Avoid premature ports.** A capability port exists only when a second system actually
  needs it. Do not pre-split a facet or a port for a hypothetical consumer (root rule:
  extract on the rule of three, never for one use).

---

## Appendix A: current-state evidence (where the coupling is)

| Surface | Size | What it bundles | Worst coupling to break |
|---|---|---|---|
| `src/sim/sim.ts` | 15.3k LOC | ~25 implicit systems sharing `this.entities`/`this.rng`/per-entity fields; fixed-order `tick()` (~2052 to 2156) | Ability casting -> `applyAbility` -> `dealDamage` (aura/DR/absorb/threat) all in one call graph (~2890 to 6088); Nythraxis encounter ~500 inline lines; pet AI interleaved into the mob loop |
| `src/ui/hud.ts` | 13.1k LOC | one `Hud` class; ~10 windows + persistent chrome + per-frame tiers + 3 i18n matchers | Already has a full modularization program (`docs/ui-architecture-hud-modularization/`); adopt, do not re-plan |
| `server/game.ts` | 2.7k LOC | world loop, command routing, snapshot codec, event routing, session registry, chat policy, autosave, market/social persistence, holder refresh, admin live-ops | Reaches into Sim internals; command router and snapshot codec define the wire contract and should move behind ports first |
| `src/net/online.ts` | 1.7k LOC | `ClientWorld` mirroring snapshots (`applyWire`/`applySnapshot` ~1011 to 1285) + command send (`cmd()`) | Must stay byte-parity with the server snapshot codec; the facet split (4.4) and snapshot-codec extraction (4.5) are paired |
| `src/world_api.ts` | ~120 members | one mixed read/command interface across ~25 domains | Split into facets (4.4), keep the aggregate export |
| `CharacterState` | JSONB, no version | optional-field accretion (~820 to 864, restore ~1188 to 1310) | Add `v`, normalize on load, per-system fragments (4.8) |

## Appendix B: existing modules that already follow the target (copy these)

- Pure sim modules: `src/sim/threat.ts`, `entity.ts`, `spatial.ts`, `pathfind.ts`,
  `colliders.ts`, `tab_target.ts`, `world.ts`, `obs.ts`, `rng.ts`.
- Pure-core + thin-host (ui): `ui/unit_portrait.ts` + `unit_portrait_painter.ts`;
  `ui/vendor_view.ts` + `vendor_window.ts`; `ui/stat_tooltip.ts` + `stat_tooltip_view.ts`;
  `ui/xp_bar.ts`.
- Content as data: `src/sim/content/*` merged by `src/sim/data.ts`.
- Server infra modules behind their own files: `auth.ts`, `db.ts`, `social.ts`,
  `wallet*.ts`, `chat_filter.ts`, `ratelimit.ts`, `moderation_db.ts`, `admin.ts`.

These are the proof the pattern works at this repo's scale. The refactor is "make the
rest look like these."
