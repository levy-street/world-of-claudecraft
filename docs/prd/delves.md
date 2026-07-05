# PRD — Delve System (Replayable Instanced PvE)

| | |
|---|---|
| **Status** | Approved / Ready to implement |
| **Owner** | TBD |
| **Created** | 2026-06-17 |
| **Source demand** | Design plan `delve_system_design_b9ca2faf.plan.md`; framework-first delivery with Crypt vertical slice |
| **Related systems** | Dungeons (`src/sim/sim.ts`, `src/sim/dungeon_layout.ts`), arena x-bands (`src/sim/data.ts`), pets (`src/sim/sim.ts` `updatePet`), quests (`brother_aldric` / Hollow Crypt arc), IWorld seam (`src/world_api.ts`) |
| **Implementation handoff** | `docs/prd/DELVE_IMPLEMENTATION_HANDOFF.md` |

---

## 1. Summary

Delves are a **new replayable instanced PvE layer** between quest chains and full dungeons: 10–20 minute modular runs for 1–4 players (max 5), seeded reruns, lighter than dungeons but richer than single quests. The engine (`DelveRun`) handles enter/leave/complete, module picking, tiers, affixes, rewards, and optional solo companions. **Phase 4** ships one vertical slice: **The Collapsed Reliquary** (Crypt theme) with **Brother Halven**, **Acolyte Tessa**, and boss **Deacon Varric**.

All outcomes resolve in the authoritative `Sim`; clients mirror via `IWorld` / `ClientWorld`. Content is declarative in `src/sim/content/delves/`.

---

## 2. Background & motivation

### 2.1 Content gap
Quests are one-time; dungeons are 25–45 minute social commitments. Players level 7–12 need a **repeatable solo-or-duo activity** with visible variety (seeded modules, affixes) without replacing dungeon loot/social value.

### 2.2 Design pillars
- **Framework first (Phases 1–3), content second (Phase 4)** — engine PRs merge with minimal HUD conflict.
- **Deterministic variation** — run-local `Rng(seed)` for module/spawn picks; no procedural geometry generator in v1.
- **Spatial isolation** — dedicated x-band at `DELVE_X_MIN = 3600`, past arena (`ARENA_X_MIN = 2800`, `ARENA_X = 3000`).
- **No cross-credit** with Hollow Crypt / `q_sexton` — separate instance band, boss id `deacon_varric` (not `sexton_marrow`).

---

## 3. Positioning vs existing content

| Layer | Duration | Group | Layout | Replay |
|-------|----------|-------|--------|--------|
| Quests | 5–15 min chains | Party credit on kills | Overworld | Once per character |
| **Delves** | 10–20 min | 1–4 recommended, max 5 | Compact modular instance | Seeded reruns |
| Dungeons | 25–45 min | 5 suggested | Fixed corridor + boss | Instance reset after 5 min empty |

1 Normal delve ≈ 1 good quest for XP; 3 quests still beat 1 delve for raw XP; dungeons remain best group loot/social value.

---

## 4. Current state in the codebase

> Re-verified 2026-06-17 against `main`. Line numbers drift — re-find before editing.

| Concern | Location | Notes |
|---|---|---|
| Dungeon instances | `src/sim/sim.ts` ~6658+ | `enterDungeon`, `claimInstance`, `InstanceSlot` |
| Instance x-bands | `src/sim/data.ts` ~160–215 | `instanceOrigin`, `dungeonAt`, `arenaOrigin`, `ARENA_X_MIN` |
| Collision routing | `src/sim/colliders.ts` ~210–236 | `dungeonAt` / `isArenaPos` branches; **no delve branch yet** |
| Renderer instances | `src/render/renderer.ts` ~897 | dungeon origin loop; arena separate |
| Player death / respawn | `src/sim/sim.ts` ~5050+ | `releaseSpirit()` uses `dungeonAt()` only |
| Hunter pets | `src/sim/sim.ts` ~4131+ | `updatePet`; `PetState` on `CharacterState` ~398 |
| IWorld dungeon API | `src/world_api.ts` ~281 | `enterDungeon` / `leaveDungeon` |
| Server cmd dispatch | `server/game.ts` ~987+ | `enter_dungeon` / `leave_dungeon` |
| Quest NPCs (no conflict) | `src/sim/content/zone1.ts` ~261 | `brother_aldric` — **do not reuse for delve board** |
| Hollow Crypt boss | `src/sim/content/dungeons.ts` ~29 | `sexton_marrow` — separate from `deacon_varric` |
| Zone 2 boss (no conflict) | `src/sim/content/zone2.ts` ~202 | `deacon_voss` — different id/zone from `deacon_varric` |

**Gap:** No `DelveRun`, `delveOrigin`, `delveAt`, content registry, wire commands, or UI.

---

## 5. Goals & non-goals

### Goals
- Replayable 10–20 min modular instances with seeded module order and spawn variants.
- Normal + Heroic tiers with thematic affixes (Crypt slice: 1 affix on Heroic).
- Delve Marks meta currency + companion upgrade ranks (Acolyte Tessa).
- Solo companion support (healer); pet stow/restore for hunter/warlock.
- Definitive death/wipe rules, daily XP/Mark efficiency caps.
- Online/offline identical behavior; full i18n in Phase 4.

### Non-goals (v1)
- Full procedural room generation.
- Account-wide delve progress.
- Cross-realm matchmaking.
- Power creep past existing item tiers.
- Replacing dungeons.
- Escort / investigate objective kinds in Crypt slice (engine may define types; Crypt uses `recover_artifact` + kill boss only).
- Headless RL obs encoding for delves (`src/sim/obs.ts`) — excluded v1.

---

## 6. Functional requirements

### 6.1 Spatial band (critical)

- **FR-1.1** Add `DELVE_X_MIN = 3600`, `DELVE_SLOT_COUNT = 6`, `delveOrigin(delveIndex, slot)`, `isDelvePos(x)`, `delveAt(x)` in `src/sim/data.ts` **after** the arena block (~L215). Mirror `arenaOrigin()` z-slot stacking; **do not** use `instanceOrigin(4+)`.
- **FR-1.2** `dungeonAt(x)` must return `null` for `x >= DELVE_X_MIN`. Delve positions must never route through dungeon colliders/renderers.
- **FR-1.3** Update `src/sim/colliders.ts` `resolvePosition` with `else if (isDelvePos(x))` **before** the generic `x > DUNGEON_X_THRESHOLD` dungeon branch (~L231).
- **FR-1.4** Update `src/render/renderer.ts` and `src/ui/hud.ts` minimap zone logic with parallel `isDelvePos` branch.
- **FR-1.5** `groundHeight()` already flat-floors `x > DUNGEON_X_THRESHOLD` — no change required.
- **FR-1.6** Login sanitization (`src/sim/sim.ts` `addPlayer` ~649): if saved `pos` is delve (`isDelvePos`), eject to delve board door (`brother_halven` door coords).

### 6.2 DelveRun lifecycle

- **FR-2.1** `enterDelve(delveId, tierId, companionId?, pid?)` — gate: not in dungeon (`dungeonAt`), arena (`isArenaPos`), active trade, or duel.
- **FR-2.2** Fork run-local `Rng(run.seed)` at enter; module order = shuffle pool minus finale, take `moduleCount`, append finale.
- **FR-2.3** `updateDelveRuns()` each tick — empty-party timeout (`emptyFor`, 300s same as dungeons).
- **FR-2.4** Module transition at far-edge portal — despawn previous module entities, spawn next at `origin + moduleOffsetZ`.
- **FR-2.5** `completeDelve()` — completion chest, marks, XP, lore unlock; `leaveDelve()` — voluntary exit at board portal.
- **FR-2.6** Keep `DelveRun[]` separate from `InstanceSlot[]`; never share slot indices.

### 6.3 Death & wipe (definitive)

- **FR-3.1** Track `deathsThisRun: number` on `DelveRun` (per player or per run — implement per-player death count on run state).
- **FR-3.2** **First death in a delve run:** respawn at **current module entry** with **50% HP** (and appropriate resource refill per class rules). Run continues.
- **FR-3.3** **Second death in the same run:** run **fails** — eject all party members to **Brother Halven** door (`brother_halven` board NPC door position). **No completion rewards** (no Marks, no completion chest, no first-clear XP bonus). **Partial copper** from trash mobs killed before wipe is retained.
- **FR-3.4** `releaseSpirit()` while in a delve must use **`delveAt(pos)`**, not `dungeonAt(pos)`. Implement `releaseSpiritInDelve()` or branch at top of `releaseSpirit` (~L5058). Delve respawn follows FR-3.2/3.3; never send delve deaths to overworld graveyard unless run has failed.
- **FR-3.5** Failed run clears `DelveRun` state; players may re-enter with a new seed.

### 6.4 Pet stow & restore (definitive)

- **FR-4.1** On `enterDelve`: **Hunter** — serialize live pet to `PetState` on `PlayerMeta` / run stash, despawn pet entity. **Warlock** — despawn demon pet entity. Stowed state survives module transitions.
- **FR-4.2** On `leaveDelve` and `completeDelve`: restore hunter pet from stashed `PetState` via existing `restorePet()` (~L2675). Warlock demon respawns per normal class rules on exit.
- **FR-4.3** Delve companion (`companion_tessa`) uses separate spawn path; does not conflict with stowed hunter pet.
- **FR-4.4** Block `enterDelve` if pet state cannot be stowed (document edge case: pet in unrecoverable state — treat as despawn + restore attempt on exit).

### 6.5 Daily limits (definitive)

Persist on `PlayerMeta` / `CharacterState`:

```typescript
delveDaily: {
  date: string;              // UTC date 'YYYY-MM-DD'
  firstClearXp: Set<string>; // keys: `${delveId}:${tierId}` — full first-clear XP once per day each
  markClears: number;        // total delve completions today (all delves/tiers)
}
```

- **FR-5.1** On UTC date change, reset `delveDaily` to `{ date: today, firstClearXp: empty, markClears: 0 }`.
- **FR-5.2** **First-clear XP bonus** (Normal 700 / Heroic 1050 solo): granted only if `${delveId}:${tierId}` not in `firstClearXp` for today; else repeat XP (420 / 650).
- **FR-5.3** **Mark payout:** full Marks for first **3** completions per UTC day (`markClears < 3`). After 3: Normal 50% chance for 1 Mark; Heroic 1 Mark guaranteed.
- **FR-5.4** Copper and basic loot always available regardless of daily caps.

> **Implementation note (v0.10.0).** This formula is implemented in
> `delveMarkPayout` (full = 1 base Mark × tier `rewardMult`; after 3/day the
> diminished rule applies; the lockpick ante adds a separate tier bonus). The
> §6.7 Heroic "+30% Marks" rides `rewardMult` (1.3) but rounds to no per-clear
> change at the base of 1 Mark, so the Heroic mark advantage is realised through
> the post-3 guaranteed-vs-50% rule (and the ante bonus). The §6.6 per-tier XP
> table (Heroic 1050/650, copper 16–24) is **not** yet wired — XP/copper are the
> same both tiers today; a per-tier XP pass is tracked roadmap.

### 6.6 Rewards & economy

- **FR-6.1** `delveMarks: number` on `PlayerMeta` (meta counter, not inventory item).
- **FR-6.2** XP/copper per tier (solo); duo ~80% per member via `eligible.length` party split.

| Tier | First clear XP | Repeat clear XP | Copper |
|------|---------------:|----------------:|-------:|
| Normal | 700 | 420 | 8–14 |
| Heroic | 1,050 | 650 | 16–24 |

- **FR-6.3** Companion upgrade costs (Acolyte Tessa):

| Rank | Cost | Cumulative marks |
|------|------|------------------|
| 1 | Free (intro) | 0 |
| 2 | 4 Marks + 20 copper | 4 |
| 3 | 9 Marks + 60 copper | 13 |
| 4 | 16 Marks + 1s 20c | 29 |
| 5 | 28 Marks + 2 silver | **57** |

- **FR-6.4** Lore journal: `delveLoreUnlocked: Set<string>` — five entries unlock across repeat clears.
- **FR-6.5** Completion chest uses `rollGroup` loot tables per tier (see §9).

### 6.7 Tiers & affixes

- **FR-7.1** Normal: base levels, 0 affixes. Heroic: +2 enemy levels, 1 affix from pool, +30% Marks, better loot.
- **FR-7.2** Optional blessing `chapel_candle` at board: safer run (−15% mob damage, +trap reveal), **−1 Mark** on completion (min 0). *(Not built in v0.10.0: there is no blessing opt-in on `enterDelve`/`enter_delve` and no sim hook; the `chapel_candle` affix def + its `delveUi.blessing.*` copy and HUD color are authored scaffolding, kept and excluded from the affix roll until implemented — same pattern as the unimplemented affixes. Tracked as roadmap.)*

**Heroic affix pool (v1 registry):**

| id | name | themes | sim hook |
|----|------|--------|----------|
| `restless_graves` | Restless Graves | crypt | Trash may spawn weak undead add after 3s |
| `bad_air` | Bad Air | crypt, mine, sewer | Periodic poison aura in marked rooms |
| `candleblind` | Candleblind | crypt, mine | Reduced `detectRange` in flagged zones |
| `old_mechanisms` | Old Mechanisms | vault, sewer | Timed door/barrier objects |
| `flooded_paths` | Flooded Paths | sewer, mine | Slow movement in z-band |
| `grave_tax` | Grave Tax | crypt, vault | Cursed chest: loot + debuff |
| `unstable_roof` | Unstable Roof | mine, crypt, vault | Extra debris AoE on stomp/traps |
| `cult_remnants` | Cult Remnants | crypt, vault, sewer | Ritual object buffs mobs until used |

Crypt Heroic rolls from crypt-themed subset: `restless_graves`, `bad_air`, `candleblind`, `grave_tax`, `unstable_roof`, `cult_remnants`.

> **Implementation note (v0.10.0).** Only `restless_graves`, `bad_air`, and
> `candleblind` have sim hooks today, so `rollDelveAffixes` draws from that v1
> subset only (`DELVE_IMPLEMENTED_AFFIXES`); a Heroic run never rolls an inert
> affix. `grave_tax` / `unstable_roof` / `cult_remnants` keep their registry +
> UI/i18n entries and join the roll once implemented.

### 6.8 Interactables (v1 mechanics)

Dispatch via `interactWithDelveObject()` / wire `delve_interact`:

| Mechanic | Behavior |
|----------|----------|
| Pressure plate | Radius trigger → door or trap `aoePulse` |
| Locked door | Key item or adjacent plate puzzle |
| Destructible wall | Object HP; melee damage; shortcut |
| Darkness zone | Client fog + reduced `detectRange` |

Crypt slice uses: pressure plate, locked door, darkness zone, timed escape finale.

### 6.9 Companion (Acolyte Tessa)

- **FR-9.1** Solo (`partyKey` starts with `solo:`): auto-spawn `companion_tessa`. Group ≤2: optional hire.
- **FR-9.2** Role healer; ranks 1–5 modify `CompanionModifiers` at rank-up.
- **FR-9.3** Wire: `companion_ability`, `setCompanionRole` via `IWorld`.

### 6.10 Wire protocol & persistence

| Client `cmd` | Server → Sim |
|--------------|--------------|
| `enter_delve` | `{ delveId, tierId, companionId? }` |
| `leave_delve` | proximity-gated exit |
| `delve_interact` | object id |
| `companion_ability` | ability id |

Snapshot `self` fields (delta-guarded): `delveRun`, `delveMarks`, `companionUpgrades`, optional objective summary.

Character JSONB: extend `serializeCharacter` / `CharacterState` — no SQL migration.

---

## 7. Authored content — The Collapsed Reliquary

### 7.1 Delve definition

| Field | Value |
|-------|-------|
| `id` | `collapsed_reliquary` |
| `name` | The Collapsed Reliquary |
| `minLevel` | 7 |
| `suggestedPlayers` | 2 |
| `boardNpcId` | `brother_halven` (**new** — not `brother_aldric`) |
| `doorPos` | Reliquary Hill, world `{ x: -5, z: -52 }` (relocated from the chapel ruin; see DELVE_HANDOFF §2) |
| `objective` | kill `deacon_varric` *(shipped: kill-boss-only; the `recover_artifact` half + `chapel_coffer_relic` item were never built in either source branch — the finale chest/lockpick is the "recover" beat. Tracked as roadmap.)* |
| `artifactItemId` | `chapel_coffer_relic` (quest-kind item, delve-only pickup) |

### 7.2 Brother Halven (board NPC)

Greeting: *"The reliquary below has shifted again. We hear chanting through the floor after midnight, and Acolyte Tessa swears the burial ledgers are changing their own ink. If you have courage enough, $N, take a candle and go below. Do not trust every voice you hear down there. Some of them knew your name before you were born."*

**Intro text**
- Normal: stairwell cold/dark, broken saint-stones, soft bell note; Tessa: *"The reliquary should not be open this far. Stay close, $N."*
- Heroic: doors groan shut; names scrape stone; Tessa's candle burns blue: *"They are not calling the dead now, $N. They are answering something."*

### 7.3 Modules

| module id | display name | flavor line |
|-----------|--------------|-------------|
| `reliquary_sunken_ossuary` | The Sunken Ossuary | Water seeps through burial shelves, carrying old ash in silver-black streams. |
| `reliquary_bell_niche` | The Bell Niche | Dozens of handbells hang in silence, each tied with funeral cloth. |
| `reliquary_saintless_hall` | The Saintless Hall | Statues with faces chiseled away with careful hatred. |
| `reliquary_finale` | The Bell-Buried Chamber | (boss arena) |

Run picks 3 from pool + finale last.

### 7.4 Boss — Deacon Varric (`deacon_varric`)

Separate from Hollow Crypt's **Sexton Marrow** and zone 2's **Deacon Voss**.

**Mechanics (max 2 active):**
1. **Bell Toll** — `stomp` every 12s, 8 yd radius.
2. **Raise Dead** — at 60% / 30% HP; 5s interrupt on `cracked_grave` object; else `summonAdds` (2). *Shipped: summons `reliquary_funeral_ringer` (the crypt's own undead add); `raised_bonewalker` is a level-18 dungeon mob and is not reused here.*

Heroic: +1 affix; optional `enrage` below 20% HP. *(v0.10.0: `enrage` is gated to Heroic in `updateBossMechanics` — a delve boss on Normal does not enrage; world bosses are unaffected.)*

> **Telegraph wiring status (v0.10.0).** The §7.4 telegraph copy is fully authored
> as `delveUi.boss.varric.*` keys in every locale, but only a subset is emitted by
> the sim today: Raise Dead start (`sim.delve.raiseDead`), interrupt-success
> (`sim.delve.graveFalters`), and interrupt-failure (the
> `delveUi.boss.varric.raise.interrupt_fail` line, wired in this QA pass). Bell Toll
> surfaces via the generic boss-stomp log (`{name} unleashes {ability}!`, currently
> unlocalized — game-wide matcher decision pending). The remaining flavor/telegraph
> lines (bell emote/warning/impact, raise emote/warning/object, pull/intro/mid60/
> mid30/defeat) are authored-but-unwired — tracked roadmap; wiring them (with their
> trigger timing) is a follow-up pass.

**Telegraph i18n keys** (`delveUi.boss.varric.*`):

| Moment | Key content (English source) |
|--------|------------------------------|
| Bell emote | Deacon Varric grips the buried bell with both hands! |
| Bell log | Deacon Varric begins to toll the burial bell. |
| Bell warning | Move away from Deacon Varric! |
| Bell impact | The bell's toll cracks the chamber floor! |
| Raise emote | Deacon Varric calls names from the broken graves! |
| Raise log | Deacon Varric begins Raise Dead. |
| Raise warning | Stop the grave rite! |
| Grave object | The cracked grave shudders with stolen breath. |
| Interrupt success | The grave rite falters. |
| Interrupt failure | The dead answer Deacon Varric's call! |
| Pull | You step on hallowed dust with unclean purpose. Kneel, and be counted. |
| Defeat | No... I had the names... I had them all... |

Boss intro: *"No soul is lost. Only misplaced."* (bell tolls once)

### 7.5 Companion — Acolyte Tessa (`companion_tessa`)

| Field | Value |
|-------|-------|
| Role | healer |
| `mobTemplateId` | `acolyte_tessa` (friendly mob, no loot) |
| Personality | grimly compassionate, superstitious scholar, quietly defiant |

**Bark triggers:** combat_start, low_hp, trap_spotted, boss_pull, completion (see handoff i18n checklist).

**Rank fantasy (UI):** Chapel Novice → Candle-Bearer → Reliquary Acolyte → Gravecall Witness → Chapel Warden.

### 7.6 Lore journal entries

1. `lore_eastbrook_ledger`
2. `lore_first_collapse`
3. `lore_gravecaller_mark`
4. `lore_bell_below`
5. `lore_tessa_note`

Completion chest flavor: *"The dead have surrendered what they can spare."*

### 7.7 Storyline integration

- **Brother Aldric** (`brother_aldric`, zone 1) continues the Gravecaller quest arc including `q_sexton` (kill **Sexton Marrow** inside **Hollow Crypt** dungeon).
- **Brother Halven** is a **new** NPC at chapel ruin — delve board only; no edits to Aldric `questIds`.
- **Deacon Varric** is delve-only; kills do not credit `q_sexton`, `q_deacon` (Voss), or any existing quest unless explicitly wired later (default: **no cross-credit**).

---

## 8. Data model & schema changes

```typescript
// src/sim/types.ts — content defs (bottom of file)
type DelveObjectiveKind =
  | 'kill_boss' | 'recover_artifact' | 'seal_portal'
  | 'survive_ambush' | 'escort_researcher' | 'investigate_clues';

interface DelveDef { /* see plan */ }
interface DelveModuleDef { /* see plan */ }
interface DelveTierDef { /* see plan */ }
interface DelveSpawnSet { /* see plan */ }
interface DelveCompanionDef { /* see plan */ }

// src/sim/sim.ts — runtime
interface DelveRun {
  delveId: string;
  slot: number;
  partyKey: string | null;
  seed: number;
  tierId: string;
  affixes: string[];
  modules: string[];
  moduleIndex: number;
  origin: { x: number; z: number };
  mobIds: number[];
  objectIds: number[];
  objective: DelveObjectiveState;
  companion?: DelveCompanionState;
  completed: boolean;
  emptyFor: number;
  deathsThisRun: Record<number, number>; // pid → death count
}

// PlayerMeta / CharacterState extensions
delveMarks: number;
delveClears: Record<string, number>;       // `${delveId}:${tierId}` → count
companionUpgrades: Record<string, number>; // role id → rank
delveLoreUnlocked: Set<string>;
delveDaily: {
  date: string;
  firstClearXp: Set<string>;
  markClears: number;
};
// Pet stow: transient on run or PlayerMeta stash field `delvePetStash?: PetState`
```

Registry merges in `src/sim/data.ts`: `DELVES`, `DELVE_MODULES`, `DELVE_AFFIXES`, `DELVE_COMPANIONS`.

No SQL migration — JSONB blob pattern (`server/db.ts` `characters.state`).

---

## 9. API / command surface

- **IWorld** (`src/world_api.ts`): `enterDelve`, `leaveDelve`, `delveInteract`, `setCompanionRole`, `companionAbility`, getters for delve state/marks.
- **ClientWorld** (`src/net/online.ts`): `cmd()` wrappers; delta-guarded snapshot fields.
- **Server** (`server/game.ts` `dispatchMessage` ~987+): new cases adjacent to dungeon commands.
- **Offline Sim** (`src/sim/sim.ts`): implement all methods; new `// Delves` banner region at file end.

---

## 10. UI / UX specification

Phase 1–2: event-log tracker strings only (defer full HUD).
Phase 4: Delve Board, Delve Tracker, run summary, companion bar, minimap module boundaries.

All strings via `t('delveUi.*')` + `entity_i18n` manifest entries for NPCs/mobs/delves.

---

## 11. Phasing (6 PRs)

| PR | Scope | Est. |
|---|---|---|
| **0 — PRD** | This doc + handoff | Done |
| **1 — Engine** | Types, `delveOrigin`, placeholder delve, enter/leave/complete, tests | M |
| **2 — Interactables** | Plates, doors, destructibles, affix registry | M |
| **3 — Companion** | Tessa spawn/AI, marks upgrades, HUD bar | M |
| **4 — Crypt slice** | Full content, render, i18n, E2E | L |
| **5 — Catalog** | Mine, sewer, vault themes (follow-up) | M each |

**Merge strategy:** Land 1–2 with minimal HUD; full UI in PR 4 after rebase onto latest `main`. Branch `feature/delves`; do not touch `InstanceSlot` / `claimInstance` / `enterDungeon`.

---

## 12. Testing strategy

### 12.1 Unit (`tests/`)
- `tests/delves.test.ts`: `delveOrigin` band ≥ 3600; same seed → same modules; enter/leave; completion grants marks; death respawn 50% HP; second death ejects; daily reset.
- `tests/delve_companion.test.ts`: solo spawn, healer tick, pet stow/restore.
- Extend `tests/snapshots.test.ts` for new `self` fields when wired.

### 12.2 E2E
- `scripts/delve_crypt.mjs` (Phase 4): enter from Halven, complete Normal, verify boss telegraphs.

### 12.3 Manual
1. Enter delve solo — Tessa spawns; hunter pet stowed.
2. Die once — module entry respawn 50% HP.
3. Die twice — eject to Halven, no chest.
4. Complete Heroic with affix — blue candle intro, marks per daily rules.
5. Confirm `sexton_marrow` kill in Hollow Crypt does not complete delve objectives.

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Arena x-band collision | `DELVE_X_MIN = 3600`; dedicated `delveAt` / collider branch |
| `releaseSpirit` graveyard eject | Branch on `delveAt`; implement death rules FR-3.x |
| hud.ts merge conflicts | Defer full UI to PR 4; tracker-only in PR 1–2 |
| RNG pollution | Run-local `Rng(seed)` for picks |
| Quest cross-credit | Separate band + boss ids; test `q_sexton` isolation |
| Pet + companion overlap | Stow on enter, restore on leave/complete |

---

## 14. Acceptance criteria (Crypt vertical slice)

- Enter **The Collapsed Reliquary** Normal from **Brother Halven** at chapel ruin.
- Run completes in ~12–18 min with 3 modules + finale (`deacon_varric`).
- Recover `chapel_coffer_relic` + kill boss; **no** Hollow Crypt quest cross-credit.
- Second run (new seed): different spawn set / side room.
- Heroic: 1 affix + improved chest; intro candle burns blue.
- Solo: **Acolyte Tessa** auto-spawns; rank 2 unlockable with 4 Marks after first clear.
- Boss telegraphs match approved copy (Bell Toll + Raise Dead interrupt).
- Rewards: Normal 700/420 XP first/repeat per daily rules; 57 Marks to max Tessa.
- Five lore journal entries unlock across repeat clears.
- Death: first = module entry 50% HP; second = fail + eject, no completion rewards.
- Progress persists; online/offline identical; `npm test` green; full i18n all locales.

---

## 15. Future delve themes (Phase 5 brief)

| theme | palette | signature hazards |
|-------|---------|-------------------|
| `abandoned_mine` | black timber, rust, amber lantern | ceiling dust, green gas |
| `flood_sewer` | sickly green water, wet brick | rising water, toxic pools |
| `ancient_vault` | worn gold, blue stone, obsidian | pressure tiles, arcane seams |

Use `interiorKit: 'dungeon'` until `public/models/delve/` packs land (`interior_kit.ts` swap path).
