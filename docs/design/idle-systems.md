# Idle Classic: Systems Design Specification

Synthesized from the idle implementation (`idle/`, worktree `idle-classic-engine`), the
sim surface it runs over (`src/sim/obs.ts`, `src/sim/types.ts`, `src/sim/data.ts`),
and its pinned tests (`tests/idle/`). This document records the intended policy design
for the Idle Classic host, framed as how the systems should work against the classic-era
sim math. All thresholds are pinned by existing tests unless marked PROPOSAL.

---

# Part A. Auto-Combat Policy Systems

The idle engine is a pure policy over the deterministic sim. It never extends the
action vector (`ACTIONS` in `src/sim/obs.ts`); it picks one action index per step.
Every decision below operates on that one-index-per-step constraint.

---

## 1. Engagement Ceiling: `safeLevelGap`

**Module:** `idle/difficulty.ts` `safeLevelGap`
**Pinned by:** `tests/idle/difficulty.test.ts` (gap-value assertions across the level breakpoints)

| Player Level Range | Gap (max mob level above player) | Reference |
|----|----|----|
| 1 to 2 | 1 | Tight gate: fresh-character fragility |
| 3 to 6 | 2 | Opening toward classic gate |
| 7+ (zone cap) | 2 | Full classic-era +2 gate |

**Design rationale:** The classic-era MMO engagement rule is "fight mobs within +2 of
your level." This is correct at cap (level 7 in zone 1, level 13 in zone 2, level 20 in
zone 3) where the full ability kit, gear, and stamina cushion make +2 survivable. It is
WRONG at level 1-2: a fresh warrior has approximately 50 HP, no usable rage ability kit,
and 0 armor contribution from gear. A level 3 mob (2 levels above) hits hard enough to
kill the player before the player grinds it down.

The +1 floor at levels 1-2 enforces the classic "yellow" fight: a single above-level mob
is a real challenge but not a guaranteed death. This tightens the gate at low level instead
of using a flat +2 because the player's defensive margin is smallest when their HP pool
and talent kit are most limited. By level 3 (approximate first ability rank unlock, 2-3
talent points allocated, partial vendor gear), the margin widens enough to absorb +2.

The gap opens to 2 at level 3, not at 7, because the early-to-mid leveling experience
(wolves through spiders, level 1-5 mobs) has a narrower level spread per camp. The
level 7+ row exists for API completeness; the gap never exceeds 2 at any level.

**The formula is purely deterministic in the player level:** no mob data read, no rng.

```
safeLevelGap(playerLevel) =
    if playerLevel <= 2: return 1
    if playerLevel <= 6: return 2
    return 2
```

| Symbol | Type | Range | Description |
|--------|------|-------|-------------|
| `playerLevel` | int | 1 to 20 | The player's current level |
| `return` | int | 1 or 2 | Max number of levels a mob may exceed the player |

---

## 2. Affix Exclusion

**Module:** `idle/difficulty.ts` `isTooDangerous`
**Pinned by:** `tests/idle/difficulty.test.ts` (boss and rare assertions at levels 5-6)

A mob is NEVER an idle target when its template carries any of: `boss`, `rare`, `elite`,
or `worldBoss`. The idle player fights solo; these affix mobs are group content (aoePulse,
summonAdds, enrage mechanics) tuned for a full party, and the idle solo player dies to
their mechanics regardless of raw level.

```
isTooDangerous(playerLevel, mob) =
    if mob.template has affix (boss | rare | elite | worldBoss): return true
    return mob.level > playerLevel + safeLevelGap(playerLevel)
```

**Agreement with the threat map:** The engagement gate (`isTooDangerous`) and the flee
gate (`assessThreat` in `idle/threat_map.ts`) share the same affix test. If the threat
map says flee from an affix mob, the combat gate will never have engaged it. This is
the "strong-test": both gates must agree or the player dies to content it should have
fled.

**Classification agreement vs cross-step ordering (PROPOSAL, not implemented).** The two
gates agree on CLASSIFICATION because they share the same affix predicate and the same
level-gap formula, but they run at different phases of the step ladder. In
`idle/auto_combat.ts` `pickAction`, `resolveTarget` calls `findDanger` (which calls
`assessThreat`) at the top of every step on the CURRENT nearby set, before any target
resolution; when it finds lethal it clears `p.targetId` and returns the flee action. The
engagement gate (`findBestTarget` via `isTooDangerous`) only runs after that, and only on
the 2-step scan cadence, picking into `p.targetId` from a possibly EARLIER snapshot.

The design-correct ordering, stated as intended design because the live gap is real:

1. The flee gate runs EVERY step in `pickAction` BEFORE target resolution. A target
   cleared by the flee gate drops engagement for that step.
2. Camp re-seek (`idle/progression_target.ts` `findBestCampTarget`), which today lives in
   `idle/engine.ts` `IdleEngine.step` and fires after `pickAction` returns FORWARD (action
   index 1) with `!sim.player.targetId`, must run ONLY when `assessThreat` returns `safe`.
   Today (`idle/engine.ts` `IdleEngine.step`) the camp-resume block gates on
   `action === 1 && !sim.player.targetId` with no `assessThreat` re-check, so on a step
   where the flee gate returns FORWARD (the player is already facing away from the
   centroid) AND it cleared `targetId`, camp-resume CAN fire and re-steer toward a camp
   centroid that may be the lethal camp the player is standing in. Marking this as
   PROPOSAL: camp re-seek must be gated on `assessThreat(sim).level === 'safe'`, so the
   player flees OUT of a camp that turned lethal mid-fight BEFORE re-evaluating other
   camps.

**The concrete corner case this guards.** An at-level mob is engaged inside a camp before
the camp's affix members enter radius (the navigator steered the player toward the camp
centroid because `findBestCampTarget` filters by level+affix at camp-selection time, not by
live threat). The next tick an affix member wanders into `THREAT_RADIUS` (22). `assessThreat`
flips `lethal`. The intended design guarantees the flee-from-centroid action fires and
`p.targetId` clears BEFORE any camp-resume logic, so the player exits the lethal camp rather
than being re-steered toward a camp target (possibly the same lethal camp). Without the
`assessThreat === 'safe'` gate on camp-resume, the player can ping-pong: flee one step, get
re-steered toward a camp centroid the next, never actually leaving the lethal radius.

| Symbol | Type | Range | Description |
|--------|------|-------|-------------|
| `playerLevel` | int | 1 to 20 | The player's current level |
| `mob.template` | MobTemplate | any | The mob's content template from `MOBS` |
| `mob.level` | int | 1 to 20 | The mob's current level (may differ from template range) |
| `return` | bool | true/false | true when the mob should NOT be engaged |

---

## 3. Pack-Aware Threat: `assessThreat`

**Module:** `idle/threat_map.ts` `assessThreat`
**Pinned by:** `tests/idle/difficulty.test.ts` (pack-classification assertions: safe, lethal, pack, centroid)

The classic auto-combat ladder reacts to ONE mob. That is not enough in a world where
murloc packs ("where there is one mudfin, there are five") and boss camps kill a
low-level player before any single mob trips the danger gate. This module reads the
AREA around the player, counts how many hostile mobs are within a radius, and classifies
the region as safe, cautious, or lethal.

### Thresholds

| Constant | Value | Rationale |
|----|----|----|
| `THREAT_RADIUS` | 22 yd | Bigger than any camp mob's aggro radius (longest is 13), so a pack has to be ON the player to count. This is a detection window, not a chase radius. |
| `PACK_SIZE` | 3 | At-level, three mobs' summed damage outpaces a solo player's healing. Even if each individual mob is level-appropriate, the combined DPS kills the idle player. |

### Classification

| Condition | Classification | Player Action |
|----|----|----|
| Any in-radius mob is above-gap OR affixed | `lethal` | Flee from the pack centroid |
| Pack of 3+ hostiles regardless of level | `lethal` | Flee from the whole group centroid |
| 2 level-appropriate hostiles | `caution` | Engage one, avoid pulling the third |
| 0 to 1 level-appropriate hostiles | `safe` | Engage freely |

**Flee-from centroid:** When lethal, the navigator flees from the CENTROID of all
lethal mobs (strong mobs first, falling back to all nearby when the pack is purely
at-level). Running out of the pack by centroid ensures the player runs away from the
cluster center, not away from one member while walking toward another.

```
assessThreat(sim) =
    nearby = [m for m in sim.entities if mob, alive, hostile, dist <= THREAT_RADIUS]
    strongNearby = [m for m in nearby if m.level > playerLevel + safeLevelGap(playerLevel) OR hasAffix(m)]
    isPack = length(nearby) >= PACK_SIZE
    lethal = length(strongNearby) > 0 OR isPack

    if lethal: level = 'lethal'
    else if length(nearby) >= 2: level = 'caution'
    else: level = 'safe'

    fleeFrom = centroid of (strongNearby if strongNearby else nearby) when lethal
```

| Symbol | Type | Range | Description |
|--------|------|-------|-------------|
| `THREAT_RADIUS` | float | 22 | Detection radius in yards around the player |
| `PACK_SIZE` | int | 3 | Hostile count that constitutes a lethal pack |
| `nearby` | Entity[] | 0 to N | Hostile mobs within the threat radius |
| `strongNearby` | Entity[] | 0 to N | Subset: above-gap or affixed |
| `level` | enum | safe/caution/lethal | Area danger classification |
| `fleeFrom` | Vec3 or null | position | Centroid to flee FROM; null when safe |
| `hostileCount` | int | 0 to N | Number of hostiles in radius |
| `hasAffixDanger` | bool | true/false | Whether any in-radius mob carries an affix |

---

## 4. Camp Selection: `findBestCampTarget`

**Module:** `idle/progression_target.ts` `findBestCampTarget`
**Pinned by:** `tests/idle/difficulty.test.ts` (wolf camp at L1, boar camp at L3, null for empty)

When the character has no active quest and the area has no mob it should fight, it needs
a destination. This module walks `CAMPS` and picks the nearest camp whose mobs are within
the player's current safe engagement gap.

### Selection rules

1. Skip camps whose template is boss/rare/elite/worldBoss (group content, never safe for
   idle solo).
2. Skip camps whose `maxLevel` exceeds `playerLevel + safeLevelGap(playerLevel)`.
3. Among remaining camps, prefer the nearest one, breaking ties by preferring the camp
   whose `maxLevel` is closest to the player (higher mob level within budget = better XP).

**Death handling:** A noop action on death suffices because `applyAction` in
`src/sim/obs.ts` fires `releaseSpirit` + `resurrectAtSpiritHealer` automatically when
`sim.player.dead`. The idle engine does not need a separate death/recovery state machine.

**Worked example:** A level 1 warrior at spawn (0, -2). `safeLevelGap(1) = 1`, so
`maxAllowedLevel = 2`. The forest_wolf template has `maxLevel: 2` and its camp sits at
approximately (-15, 55), distance ~57 yd. This is within budget, so the engine steers
the player toward the wolf camp. A boar camp (`maxLevel: 3`) at the same seed would be
skipped because 3 > 1 + 1 = 2.

| Symbol | Type | Range | Description |
|--------|------|-------|-------------|
| `playerPos` | Vec3 | world coords | The player's current position |
| `playerLevel` | int | 1 to 20 | The player's current level |
| `gap` | int | 1 to 2 | From `safeLevelGap(playerLevel)` |
| `maxAllowedLevel` | int | 2 to 22 | `playerLevel + gap`; camp mobs must be at or below this |
| `return` | CampTarget or null | position + metadata | Nearest valid camp, or null if none exists |

---

## 5. The Action-Index Policy

**Module:** `idle/auto_combat.ts` `pickAction`
**Pinned by:** `tests/idle/engine.test.ts` (determinism, progression, all-9-classes)

One action index per step, chosen by a priority ladder. The action surface is NOT defined
in the idle module; it comes from `ACTIONS` in `src/sim/obs.ts`. The idle never extends
the action vector.

### Priority ladder (per step)

| Priority | Condition | Action |
|----|----|----|
| 0 | Player dead | NOOP (applyAction fires releaseSpirit + resurrect) |
| 1 | Danger detected (lethal threat or single strong mob) | Flee: turn away from centroid, then FORWARD |
| 2 | No current target, scan cycle ready (every 2 idle steps) | Find best target via `isTooDangerous` filter |
| 3 | Target acquired, gap 8-25 yd | Cast first ready ability (gap-closing ability usage) |
| 4 | Target acquired, not in melee range | `steerToward`: turn or FORWARD toward target |
| 5 | In melee range, not auto-attacking | ATTACK (index 9) |
| 6 | Low HP (< 30% maxHp) | EAT_DRINK (consume best food/drink from bags) |
| 7 | Ability off cooldown, enough resource, GCD clear | Cast first ready ability (ABILITY_1 = index 10) |
| 8 | None of the above | NOOP |

### Key implementation details

**ABILITY_1 = 10:** Abilities index `ACTIONS` starting right after `attack` (index 9),
so `ability_1` is index 10. `applyAction` maps action N to slot `N - 10`.

**WeakMap per-Sim idle steps:** The scan throttle (target scan every 2 idle steps) uses
a `WeakMap<Sim, number>` keyed by the Sim instance, not a bare module global. This
ensures two IdleEngine instances stepping in the same process cannot perturb each other's
scan cadence, keeping the determinism test's two engines independent even if interleaved.

**The filterless FORWARD problem:** When `pickAction` returns FORWARD and there is no
active target, the player is walking into a void. The engine handles this by checking
for a target after the forward return and, when none exists, calling `findBestCampTarget`
to steer toward a level-appropriate camp. This is the progression navigator: it migrates
the character to the right hunting grounds. This is in `engine.ts`, not `auto_combat.ts`,
because it needs `Sim` access for position data that the pure policy module does not own.

---

## 6. Macro Decision Hierarchy Per Step

**Module:** `idle/engine.ts` `IdleEngine.step`
**Pinned by:** `tests/idle/engine.test.ts` (determinism, progression), `tests/idle/quest_navigation.test.ts` (quest acceptance integration)

The decision order per step is:

| Priority | Domain | Module |
|----|----|----|
| 1 | Quest: turn-in near NPC | `idle/auto_quest.ts` `evaluateQuest` |
| 2 | Quest: navigate to objective area | `idle/auto_quest.ts` `evaluateQuest` |
| 3 | Quest: accept available quest near giver | `idle/auto_quest.ts` `evaluateQuest` |
| 4 | Quest: navigate to giver NPC | `idle/auto_quest.ts` `evaluateQuest` |
| 5 | Combat: pick action | `idle/auto_combat.ts` `pickAction` |
| 6 | Navigation: steer toward camp | `idle/engine.ts` (after combat returns FORWARD with no target) |
| 7 | Anti-stuck: escape sequence | `idle/anti_stuck.ts` `AntiStuck.check` |

**Why combat comes after quest turn-in/accept:** Quest turn-in yields XP and copper that
directly advance the character. Accepting a quest opens kill objectives that give XP while
fighting. Doing these first means the character never wastes steps killing in a camp when
a quest turn-in NPC is nearby.

**Anti-stuck priority:** Anti-stuck overrides everything except quest actions with a
`didQuestAction` result. When the player has an active target, anti-stuck yields to
combat, avoiding interference with an in-progress fight. Anti-stuck fires after
`STUCK_THRESHOLD + 4` steps of no movement (> 0.3 yd), giving a generous grace period
to avoid false triggers during slow melee swings.

**Quest evaluation note:** When `evaluateQuest` performs a quest action (turn-in or
accept), the engine sets `action = 0` (NOOP) and returns. When it steers toward an NPC
but does not act, it returns a steer action that the engine issues. When there is no
quest goal, it returns NOOP, letting combat take over.

**The sanctioned idle-to-sim write surface (NOTE).** The policy mutates the sim through
`src/sim/obs.ts` `applyAction` (one index per step). Beyond that, `idle/engine.ts`
`IdleEngine.step` performs exactly two classes of direct sim-field write, both
deterministic and per-step, neither a precedent for adding more:

1. The per-turn action-effect write: after `applyAction`, when the resolved action is a
   turn (indices 3 or 4), the engine sets `sim.moveInput.forward = false` so the player
   turns in place rather than walking forward while rotating (turn actions auto-set
   `moveInput.forward = true` inside `applyAction`). This is a pure function of the action
   index (no wall-clock, no rng) and is cleared by the next `applyAction` each step, so it
   cannot leak across hosts and does not break determinism.

2. The render-interpolation staging write: the engine snapshots `sim.player.pos` /
   `sim.player.facing` BEFORE the tick batch and, after the ticks, writes
   `sim.player.prevPos.*` and `sim.player.prevFacing` to the snapshot values. These fields
   are render-interpolation state, not gameplay state (per the `prevPos` comment in
   `src/sim/types.ts` Entity: "for render interpolation"), so a host that never renders (the
   headless CLI) still writes them harmlessly, and a renderer reads them only for smooth
   frame interpolation. They are a pure function of the pre-tick position snapshot (no
   wall-clock, no rng) and are re-staged every step, so they cannot accumulate or leak.

The sanctioned idle-to-sim surface is therefore exactly `applyAction` PLUS these two
per-step deterministic staging writes, and NOTHING else. The idle does NOT write
`sim.player.pos`, `sim.player.facing`, `sim.player.targetId`, `sim.player.level`, or any
other gameplay field directly; all such changes are produced by `applyAction` and the tick.
(The throwaway diagnostic `idle/diagnose5.ts` does teleport `p.pos` / set `p.facing` /
`p.targetId` directly, but it is a scratch script that is not part of the idle host surface
and is not imported by the engine barrel; it is out of scope for this contract.) Naming
these writes here is so a future reader does not treat them as unexplained purity
exceptions and so neither becomes a precedent for adding more direct sim-field writes from
the idle.

### Mechanical purity and determinism guard for `idle/` (PROPOSAL, not implemented)

The root invariant guards `src/sim/`: `tests/architecture.test.ts` mechanically scans
every `src/sim/` file for forbidden up-hill imports (from `render/`, `ui/`, `game/`,
`net/`, `dom`/`three`) and for `Math.random` / `Date.now` / `performance.now`. That scan
does NOT cover `idle/`, because `idle/` is a host in a worktree, not a subtree of `src/sim/`.
`idle/CLAUDE.md` re-states the same rules ("never use `Math.random` / `Date.now` /
`performance.now` in idle decision logic", "never import from `src/render/`, `src/ui/`,
`src/game/`, `src/net/`, or `three`"), but the doc's purity and determinism claims for
`idle/` therefore rest on REVIEW DISCIPLINE ALONE today: a violation landing in `idle/`
passes CI rather than failing it.

The intended design closes that gap with a guard test. PROPOSAL: add `tests/architecture.idle.test.ts`
(or extend `tests/architecture.test.ts` to also scan the `idle/` host tree) that
mechanically pins, for every `idle/*.ts` file:

- no up-hill imports from `src/render/`, `src/ui/`, `src/game/`, `src/net/`, `three`, or
  any DOM global;
- no `Math.random`, `Date.now`, or `performance.now` in idle decision logic (matching the
  `idle/CLAUDE.md` "Never here" rule), with the same exception the CLI already relies on:
  the host's wall-clock feeds only setInterval cadence, never a sim decision.

This makes an `idle/` purity violation a CI failure, not a review artifact, and keeps the
idle host under the same mechanical guarantee the rest of the codebase has for `src/sim/`.
Until that guard lands, the doc's purity and determinism statements for `idle/` are
review-enforced, not test-enforced.

---

# Part B. Macro Idle Loop

---

## 1. The Idle Loop Shape

A "step" is one call to `IdleEngine.step(realMs)`. The default `frameSkip` is 20, which
equals 1 sim-second (20 ticks at `DT = 1/20`). At the default cadence of 1 step per
real second (driven by `setInterval` in the CLI), this produces a 1:1 real-time to
sim-time ratio. The player perceives a living world unfolding at normal speed.

### Per-step cycle

```
Step N:
  1. Check anti-stuck (if no active target)
  2. Evaluate quest state (turn-in / navigate / accept)
  3. Pick one action index from the auto-combat policy
  4. Apply action once via applyAction
  5. Run frameSkip ticks, collecting SimEvent[]
  6. Build summary: counter deltas (kills, deaths, xp, quests, copper, levelups)
  7. Persist between steps (save only, never mid-tick)
  8. Return IdleStepSummary to the host
```

**The read-print-persist cycle:** The engine reads sim state (phase 1-3), mutates via
applyAction (phase 4), advances the world (phase 5), reads the result (phase 6), and
persists (phase 7). The summary returned to the host carries counter deltas, not
absolute values, so each step's output is self-contained.

**Determinism contract:** Two engines with the same seed, same class, same frameSkip,
and same number of steps produce byte-identical counter snapshots. This is proven by
`tests/idle/engine.test.ts` (the `toEqual` determinism assertion) and the WeakMap-based
per-Sim scan throttle that prevents cross-engine contamination.

---

## 2. Offline Progression Model

**Module:** `idle/storage.ts` `IdleSaveData`, `idle/engine.ts` `IdleEngine.save` / `IdleEngine.restore`
**Pinned by:** `tests/idle/engine.test.ts` (save/restore round-trip), to be extended for the offline window.

**Current implementation:** `idle/storage.ts` provides per-character JSON save/load. The
engine persists after every step (in the CLI, every 10 steps). On restore, a fresh
`Sim(seed)` reproduces the seed-derived spawn world; the saved `CharacterState` carries
the PLAYER only (position, level, gear, quest state, counters). The world is reconstructed
from the seed, not saved.

### Design: simulate the missed window, cap on the window (Melvor Idle model)

Melvor Idle does NOT grant a lump summary. It SIMULATES the offline interval tick-by-tick
against a capped window (an in-game time bound), then presents the RESULT as a summary.
This is the correct model for Idle Classic, and it is fully deterministic: the sim is
deterministic by seed (the "one sim, three hosts" thesis), so re-running ticks against a
saved snapshot reproduces byte-identical results. There is no "full simulation is
nondeterministic" objection; the sim never forks across hosts by construction.

The only real objection to simulating the missed window is COST, and it is real. At the
default `frameSkip = 20` (1 sim-second per step, 20 Hz) an 8-hour offline window is
8 * 3600 * 20 = 576,000 ticks to replay at restore time. On a single core that is on the
order of seconds to tens of seconds of CPU at restore, depending on the host, blocking the
player's return. The mitigation is a two-part cap:

1. **Cap the WINDOW in sim-hours, not the XP.** The offline window is clamped to a maximum
   of `OFFLINE_WINDOW_CAP_HOURS` (PROPOSAL: 8) of sim-time. XP and copper accrue at the
   REAL kill rate the idle policy produces (the same `pickAction` + `applyAction` + tick
   path the live loop runs), up to that boundary. There is no XP ceiling; the cap IS the
   window.

2. **Optional deterministic summary-cache fallback.** For host environments where the
   restore cost is unacceptable, the engine may cap the window more aggressively (PROPOSAL:
   a `--offline-cap-hours` flag) or, as a last resort, fall back to a deterministic summary
   computed from a cached kill-rate sample taken during the last live session. The
   summary-cache is a downgrade in fidelity (it does not roll quest state forward, does not
   loot, does not level mid-window), so the simulation path is the default and the cache is
   the explicit fallback, never the other way around.

### Why the cap moved off the XP level

The earlier draft capped offline XP at `2 * xpForLevel(playerLevel)`. Recomputed against
`src/sim/types.ts` `mobXpValue` and `xpForLevel` (XP_TABLE), that XP cap binds far below the
declared 8-hour window for almost the entire ladder, making the 8-hour claim rhetorical.

Using a kill rate of 144 kills/hr (a representative number; the real rate is whatever the
deterministic offline simulation produces, but the cap-shape argument holds at any plausible
rate) and the live at-level kill value `mobXpValue(L, L) = 45 + 5*L`:

`capXP = 2 * xpForLevel(L)`. The XP cap binds (fills) at `capXP / (killXp * killsPerHour)`
hours. Computed against XP_TABLE:

| Player Level | `mobXpValue(L,L)` | `xpForLevel(L)` | `capXP = 2*xpForLevel` | XP/hr @ 144 kills/hr | Cap binds at |
|----|----|----|----|----|----|
| 1  | 50  | 400   | 800     | 7,200   | 0.11 hr (6.7 min)  |
| 7  | 80  | 4,500 | 9,000   | 11,520  | 0.78 hr (47 min)   |
| 13 | 110 | 11,400| 22,800  | 15,840  | 1.44 hr (86 min)   |
| 18 | 135 | 19,400| 38,800  | 19,440  | 2.00 hr (120 min)  |

The XP cap binds between roughly 7 minutes (level 1) and 2 hours (level 18). An 8-hour
offline window declared while the XP cap fills in under 2 hours for the entire ladder is
not an 8-hour window; it is a level-dependent ceiling the player never sees as time. The
cap is also non-monotonic in the relevant sense: a higher-level character with a bigger
`xpForLevel` pool earns MORE offline XP than a lower-level one for the same elapsed time,
which is the opposite of what a flat-time-accumulator should do.

**The window-cap fixes both:** the elapsed sim-time is identical regardless of level, so a
returning level 1 character and a returning level 18 character each consume the same
capped window of sim-time. XP accrues at the real kill rate up to the boundary. The cap is
monotonic in elapsed sim-time and binds exactly at the wall (the window), not partway
through it for mid-level characters.

### Save struct extension (PROPOSAL, not implemented)

`IdleSaveData` today has NO timestamp field. The offline window must be derived from the
sim-clock, not `Date.now()`, so it is a function of sim-steps elapsed, not wall-clock. This
makes the window deterministic and byte-reproducible.

```
IdleSaveData (proposed additions):
    seed: number                  // (existing)
    playerClass: PlayerClass      // (existing)
    playerName?: string           // (existing)
    characterState: CharacterState// (existing)
    counters: CounterSnapshot     // (existing)
    savedSimTime: number          // NEW: sim-seconds at the save step (sim.tickCount * DT)
    savedStepCount: number        // NEW: IdleEngine step count at save (for replay parity)
```

| Symbol | Type | Range | Description |
|--------|------|-------|-------------|
| `savedSimTime` | float | 0 to unbounded | Sim-clock (seconds) at the save step; the sim-time the offline window starts from |
| `savedStepCount` | int | 0 to unbounded | `IdleEngine.step` invocation count at save; cross-checks against `sim.tickCount / frameSkip` |
| `restoredSimTime` | float | `savedSimTime` to `savedSimTime + windowCap` | The sim-clock the engine reaches by continuing to step; deterministic from `(seed, stepCount)` |
| `offlineWindowSec` | float | 0 to `OFFLINE_WINDOW_CAP_HOURS * 3600` | `min(restoredSimTime - savedSimTime, windowCap)` |
| `OFFLINE_WINDOW_CAP_HOURS` | float | PROPOSAL: 8 | Max sim-time replayed at restore |

### Offline restore sequence

```
restore(savePath):
  data = readSave(savePath)                // existing
  engine = new IdleEngine({ seed, class, noPlayer: true })
  engine.sim.addPlayer(class, name, { state: data.characterState })  // existing
  engine.setCounterBaseline(data.counters)                            // existing
  savedSimTime = data.savedSimTime                                    // NEW
  restoredSimTime = engine.sim.tickCount * DT                        // NEW: deterministic
  offlineWindowSec = min(restoredSimTime - savedSimTime, OFFLINE_WINDOW_CAP_HOURS * 3600)
  if offlineWindowSec > 0:
      replaySteps = offlineWindowSec / (frameSkip * DT)               // sim-sec per step
      for i in 0..replaySteps: engine.step(0)                         // SIMULATE, tick-by-tick
      present summary of counter deltas over the replay window        // the REPORT is a summary
```

`restoredSimTime` is the sim-clock the engine WOULD reach by continuing to step. It is
itself deterministic from `(seed, stepCount)` because the Sim advances `tickCount` by
`frameSkip` per step and the tick is a fixed `DT = 1/20` step with all randomness through
`Rng`. The offline window is therefore a function of sim-steps elapsed, never wall-clock.
A player who saves at step 1000, closes, and restores at step 1000 gets a window of zero;
a player who saves at step 1000 and restores at the sim-clock the engine would have reached
2000 steps later gets a window of `1000 * frameSkip * DT` seconds, capped.

**Critical determinism point:** `restoredSimTime` MUST be derived from the sim-clock
(`sim.tickCount * DT`), not from `Date.now()`. `Date.now()` would couple the offline
window to wall-clock and break the `(seed, session)` byte-reproducibility contract (see
Part B.5). The save carries `savedSimTime`; the restore computes `restoredSimTime` from
the deterministic sim-state, not the host's clock.

**UX framing (AFK Arena borrow).** The offline reward presentation follows the AFK Arena
flat-time-since-last-save pattern: a clear summary screen showing "While you were away for
X sim-hours, your adventurer earned: Y XP, Z copper, K kills." This is a UX/feel decision;
the underlying computation is deterministic simulation, not a flat award. AFK Arena is
referenced ONLY at this UX layer (see the Layered Benchmark Reference for why AFK Journey
is NOT the borrow here).

---

## 3. Prestige and the Paragon Allocation Layer

### What the sim already provides

The sim ships two parallel long-arc tracks at the level cap (`MAX_LEVEL = 20`):

1. **Cosmetic prestige** (`src/sim/progression/xp.ts` `prestige`). At the cap, post-cap XP
   accrues toward prestige ranks; each rank costs
   `PRESTIGE_XP_PER_RANK = xpForLevel(MAX_LEVEL) = 23,200` XP
   (`src/sim/types.ts`). Prestige is cosmetic only: it resets the level XP bar, bumps a
   rank badge, and re-checks deeds. It does NOT reset level, gear, talents, or abilities.
   This is the existing system the idle host inherits unchanged.

2. **Cosmetic milestones** (`src/sim/types.ts` `MILESTONES`). A `MilestoneDef[]` table
   keyed by lifetime-XP thresholds (`veteran` 250k, `champion` 500k, `paragon` 1M,
   `mythic` 2.5M, `eternal` 5M), each granting a title or nameplate border. Already
   cosmetic. Note the name collision: the `paragon` milestone id is a cosmetic
   nameplate border, NOT the paragon allocation layer below.

### The capped character's decision: paragon allocation

The genre question the idle host must answer for a capped player is "what does the player
DECIDE each time they return." A flat XP bar that fills forever offers no decision, only
a wait. The owner decision is a **deterministic long-arc PVE power layer with no reset and
no deed violation**: a paragon-style account stat that the returning idle player ALLOCATES
on each return, delivering the per-return Autonomy choice the idle genre wants WITHOUT the
AFK Arena reset shape.

**The paragon layer (PROPOSAL, not implemented).** Post-cap uptime accrues a paragon
currency distinct from lifetime XP. On each return, the player allocates accumulated
paragon currency across a small set of account-wide PVE stat bonuses (PROPOSAL: +% XP
gain, +% copper gain, +% rested accrual rate, reduced offline-restore wait). Each
allocation is a real per-return choice, not a passive accumulation. The layer models on
Idle Champions of the Forgotten Realms' "patron run" shape: a long-arc progression the
player invests in over sessions, gated by a currency, without ever discarding the
character.

**Grounding in the sim.** The paragon currency accrual rate and the rank-shaped bonus
table reuse the post-cap arithmetic the sim already provides. The accrual rate can be
expressed as a multiple of `PRESTIGE_XP_PER_RANK` (post-cap uptime converts to paragon
currency at a fixed fraction of the prestige XP rate, so the cadence matches the existing
cosmetic-prestige cadence the capped player already experiences). The bonus magnitudes are
PVE-scoped convenience/economy multipliers, not combat-table overrides. The sim's
`MILESTONES` table is the precedent for the "threshold -> reward" shape the paragon
bonus rows follow.

**Invariants the paragon layer must hold (explicit):**

- **Additive to the cosmetic prestige, not replacing it.** The cosmetic prestige rank and
  the paragon allocation are two separate tracks. A capped player earns both: cosmetic
  ranks for display, paragon currency for allocation. Neither consumes the other.
- **PVE-scoped power, no power over other players.** The bonuses apply to the player's own
  PVE progression (XP rate, copper rate, rested rate, offline convenience). They confer no
  advantage in PvP, duels, arena, warfare, or any player-vs-player mode. The sim's PvP
  rating math (`src/sim/pvp/`) is untouched by paragon.
- **No deed confers power.** Consistent with the Book of Deeds invariant (`docs/design/deeds.md`):
  deeds are cosmetic-only (titles, Renown, borders). The paragon layer is NOT a deed and
  is NOT gated by a deed; it is a separate progression system. No deed, no paragon bonus,
  no allocation may confer power that a deed is forbidden from conferring.
- **No reset.** The character never loses level, gear, talents, abilities, cosmetic
  prestige rank, or allocated paragon bonuses. The paragon layer is additive and permanent.

**Why not AFK Arena's reset shape.** AFK Arena drives retention by resetting the run
(tier prestige), discarding the build to re-earn it faster. That conflicts with the
classic-MMO identity (the character IS the investment) and with the offline simulation
model (a reset is a mid-session deterministic state change; the existing cosmetic prestige
already performs one such change deterministically and stays reproducible, but a full
reset loop would make the offline window's replay non-comparable across reset boundaries).
The paragon allocation delivers the per-return decision the genre wants without the reset.

**Reference.** Idle Champions of the Forgotten Realms (patron-run shape: invest a currency
earned across sessions into long-arc bonuses, no reset). NOT AFK Arena (reset shape).
Melvor Mastery is no longer cited here; the earlier draft conflated the reset-loop
retention engine with the milestone engine. The paragon allocation layer is the idle
genre's per-return Autonomy choice, explicitly delivered without a reset.

---

## 4. Pacing and Cadence

### Camp-to-camp progression

The idle character progresses through camps in a deterministic order dictated by
`findBestCampTarget` and the `safeLevelGap` threshold. The progression path:

| Player Level | Best Camp | Mob Template | Distance from Spawn |
|----|----|----|----|
| 1 | Wolf Camp | forest_wolf (L1-2) | ~57 yd |
| 3 | Boar Camp | boar_aggro (L2-3) | ~80 yd |
| 5 | Spider Camp | cave_spider (L2-4) | ~110 yd |
| 7+ | Zone 2 camps | Various (L7-13) | Zone 2 z-band |

The character does NOT re-evaluate its target every step. Target scan happens every 2
idle steps (the `WeakMap<Sim, number>` throttle in `idle/auto_combat.ts`). Camp
re-evaluation happens when: (a) the current camp is cleared (all nearby mobs dead, no
respawn within scan range), (b) the player levels up and new camps become within budget,
or (c) the player dies and respawns at the graveyard.

### Re-evaluation trigger

The idle re-evaluates its camp target whenever `pickAction` returns FORWARD and there
is no active target. This is the "no suitable target here" signal, and the engine
steers toward the nearest appropriate camp. The 15-yard hysteresis in `engine.ts` prevents
oscillation: if the player is already within 15 yards of a camp center, it stays put
rather than steering.

### The "continue offline" UX

When the player closes the game and returns, the save file persists the character state
at the last step. The engine restores from the save, replays the capped offline window of
sim-time tick-by-tick, and presents a summary screen of the counter deltas over the
offline window. The character resumes exactly where it would have been had the live loop
kept running for that window: same position, same quest state, same level (possibly
levelled up during the offline replay).

**Reference: AFK Arena (UX only), NOT AFK Journey.** The offline-UX borrow is AFK
Arena's flat-time-since-last-save accumulator: a clear summary screen of "while you were
away for X hours you earned Y" with clear numbers, no gating on progression frontiers.
AFK Journey is explicitly NOT the borrow here: AFK Journey gates offline rewards on the
cleared-stage frontier (you only earn from stages already beaten), which couples the
offline reward to a progression gate the Idle Classic host does not have. The idle host
replays deterministic sim-time, so the flat-accumulator is the honest match. This is a
UX/feel decision only; the combat math stays classic-era.

---

## 5. Determinism and Reproducibility

The idle host enforces the same determinism contract as the main sim:

**Byte-reproducibility:** `(seed, class, frameSkip, stepCount)` uniquely determines
every counter value (kills, deaths, xpGained, questsCompleted, lootCopper, levelUps).
This is proven by `tests/idle/engine.test.ts` which asserts `expect(a.sim.counters).toEqual(b.sim.counters)`
for two engines with the same seed.

**Why zero Math.random / Date.now matters:**
- `Math.random` would make the idle non-deterministic across runs, breaking replay and
  the determinism test.
- `Date.now` would make the idle depend on wall-clock time, breaking the "same seed gives
  the same world" invariant.
- `performance.now` has the same wall-clock dependency.

The CLI's `Date.now` feeds only `setInterval` cadence (real-time pacing), never a sim
decision. The Sim's `Rng` (mulberry32, seeded once in the ctor) handles all randomness.
The AntiStuck module uses `Math.cos/sin` for deterministic compass directions, not
`Math.random`.

**The WeakMap scan throttle:** Two engines in the same process have independent scan
counters because the throttle is keyed by `Sim` instance (WeakMap), not a module global.
This prevents cross-engine contamination during the determinism test.

### Offline restore determinism

The live-loop contract extends to offline restore, and it is what makes the simulate-the-
missed-window model safe. The offline window is a function of SIM-STEPS elapsed, not of
wall-clock.

**The source of the offline window:** `savedSimTime` (persisted in `IdleSaveData`) and
`restoredSimTime` (the sim-clock the engine reaches by continuing to step at restore).
`restoredSimTime` is `engine.sim.tickCount * DT`, which is deterministic from
`(seed, stepCount)` because the Sim advances `tickCount` by `frameSkip` per `IdleEngine.step`
and the tick is a fixed `DT = 1/20` step with all randomness through the seeded `Rng`.
The offline window is `min(restoredSimTime - savedSimTime, OFFLINE_WINDOW_CAP_HOURS * 3600)`,
a pure function of sim-steps, never `Date.now()`.

**Why `Date.now()` is forbidden here:** `Date.now()` couples the offline reward to the
host's wall-clock. Two identical saves restored at different wall-clock times would grant
different windows, breaking the `(seed, session)` replay contract: a replay that re-runs
restore would not reproduce the original run's offline grants. The persisted `savedSimTime`
and the deterministic `restoredSimTime` close that hole: same seed, same stepCount, same
restore window, byte-identical offline counter deltas.

**The save struct gap (PROPOSAL):** `idle/storage.ts` `IdleSaveData` has NO timestamp
field today. The revision adds `savedSimTime` (sim-seconds at the save step, equal to
`sim.tickCount * DT`) and `savedStepCount` (the `IdleEngine.step` count, as a cross-check
against `sim.tickCount / frameSkip`). `savedSimTime` is the only field the offline window
reads; it is sim-clock, not wall-clock. The save/restore round-trip test
(`tests/idle/engine.test.ts`) is the pinning surface and will be extended to assert that a
save at step N restored at step N + offlineSteps reproduces the same counter deltas as a
control run that never saved and simply stepped forward `offlineSteps`.

**Cross-engine isolation at restore:** Because the offline replay runs through the same
`IdleEngine.step` path, the WeakMap per-Sim scan throttle (see the live-loop determinism
statement above) keeps a restoring engine independent of any other engine in the host
process. An offline replay never perturbs a concurrent live engine's scan cadence.

---

# Layered Benchmark Reference

This section explicitly states which reference game informs each design layer, and why.

| Design Layer | Primary Reference | Secondary Reference | Why This Reference |
|----|----|----|----|
| Loop macro, offline progression (simulate-the-window), camp-to-camp progression | **Melvor Idle** | (none) | Melvor is the closest fit: a real RPG combat idle with stats, hit tables, gear, and zone progression, driven by a deterministic combat sim. Melvor SIMULATES the offline interval tick-by-tick against a capped in-game-time window and only PRESENTS the result as a summary. That is the model the idle host adopts. |
| Paragon allocation layer shape (post-cap, per-return allocation, no reset) | **Idle Champions of the Forgotten Realms** | (none) | Idle Champions drives long-arc retention with a "patron run" shape: invest a currency earned across sessions into permanent account bonuses, never discarding the character. This is the model for the paragon allocation layer (Part B.3). Explicitly NOT AFK Arena's reset shape. |
| Offline UX, pacing feel, offline reward presentation | **AFK Arena** | (none) | AFK Arena presents offline rewards as a flat-time-since-last-save accumulator: a celebratory "while you were away" summary screen with clear numbers, no gating on a progression frontier. The idle host replays deterministic sim-time, so the flat-accumulator is the honest UX match. This is a UX/feel borrow only; the combat math stays classic-era. |
| Adaptive difficulty concealment | **Intrinsic, not borrowed** | (none) | The idle conceals adaptive difficulty by CONSTRUCTION, not by reference. The player never sees `safeLevelGap` (`idle/difficulty.ts`), `assessThreat` (`idle/threat_map.ts`), the pack centroid flee, or the camp re-evaluation. There is nothing to borrow from any reference game here; the concealment is a property of the policy-over-sim architecture. |
| Gameplay math: rage, hit tables, armor DR, XP curves, engagement gaps, mob XP values | **Classic-era MMO formulas already in `src/sim`** | (none) | The sim's math is the source of truth. `mobXpValue` (base = 45 + 5 * mobLevel), `zeroDiff`, `XP_TABLE`, `xpForLevel`, `PRESTIGE_XP_PER_RANK`, `safeLevelGap`, hit/armor/rage formulas all come from classic-era MMO formulas already implemented in `src/sim/types.ts`. The idle policy reads and respects these; it does not override or redefine them. |

### Why AFK Journey is NOT a structural combat benchmark (and is not the offline-UX borrow)

AFK Journey is NOT referenced at any layer of this document.

**Not the combat model:** AFK Journey uses a gacha real-time abstract auto-battle model:
heroes collected from a gacha system, placed on a grid, the battle plays out in
real-time with abstract damage numbers. This contradicts the World of ClaudeCraft
identity: a deterministic sim with classic hit tables, armor DR, rage generation, and
manual-ability priority. The idle host runs over the SAME sim as the online server; its
combat outcomes are the same calculations a live player would see. Referencing AFK
Journey's combat model would split "what the idle player sees" from "what the sim
computes," breaking the one-sim-three-hosts invariant.

**Not the offline UX either:** AFK Journey gates offline rewards on the cleared-stage
frontier (the player only earns offline rewards from stages already beaten). The idle
host replays deterministic sim-time against a capped window, which has no stage-frontier
gate. The flat-time-since-last-save accumulator is the AFK Arena pattern, not AFK
Journey's, so the offline-UX borrow is AFK Arena.

---

# Open Tuning Knobs (PROPOSALS, Not Implemented)

The following are design-level proposals for values that could be revisited. They are
NOT current implementation; they are flagged for future tuning if live testing reveals
the need.

| Knob | Current Value | Proposal | Rationale for Revisiting | Risk |
|----|----|----|----|----|
| Offline window cap | None today (no offline model implemented) | `OFFLINE_WINDOW_CAP_HOURS` = 8 | 8 sim-hours (576,000 ticks at 20 Hz) is the declared ceiling. A tighter cap (e.g. 4h) halves restore cost; a looser one (12h) lets overnight returns feel meaningful. Tune against measured restore CPU. | Too tight: overnight returns feel unrewarding. Too loose: restore blocks for tens of seconds on weak hosts. |
| `safeLevelGap` at level 3-6 | 2 | Keep at 2 (confirmed correct) | No proposal; the 2 at level 3 aligns with the classic gate once the player has at least one ability rank and partial gear. | None. |
| `THREAT_RADIUS` | 22 yd | Consider 20 yd if the idle flees too often in tight camps | 22 is larger than any camp aggro radius (13), meaning the player detects a pack before it aggros. Reducing to 20 would still be safe but reduce false-positive fled-from packs. | Reducing below the aggro radius (13) would let the player walk into a pack before detecting it. |
| `PACK_SIZE` | 3 | Consider 4 if the idle flees from normal 3-mob camps too often | Some camps naturally have 3 mobs (e.g., wolf packs). Fleeing from every 3-mob camp may feel overly cautious. 4 would only flee from genuinely dangerous clusters. | 3 at-level mobs' summed damage IS lethal to a solo player; changing to 4 risks death from packs the policy deemed "safe." |
| Offline restore cost fallback | None today (simulation is the default path) | Optional deterministic summary-cache for weak hosts | The default replays the window tick-by-tick (honest, but CPU-bound at large windows). A summary-cache fallback (downgraded fidelity: no quest roll-forward, no loot, no mid-window level) protects weak hosts. | Making the cache the default would silently downgrade fidelity and diverge from the deterministic-simulation model. |
| Paragon accrual rate | None today (paragon layer is PROPOSAL) | Fraction of `PRESTIGE_XP_PER_RANK` per offline-window sim-hour | Sets the cadence at which a capped player earns allocatable paragon currency. Reusing a fraction of the existing cosmetic-prestige cadence keeps the two tracks feeling aligned. | Too fast: allocations become trivial. Too slow: the per-return decision the genre wants rarely fires. |
| Anti-stuck grace period | `STUCK_THRESHOLD + 4 = 10` steps | Consider 8 or 12 | 10 steps at 1 step/sec = 10 seconds of no movement before anti-stuck fires. This may be too short (false triggers during slow melee) or too long (player is genuinely stuck for 10 seconds). | Too short: false triggers during normal combat. Too long: player is stuck visibly for 10 seconds before escape. |
| `SEARCH_RADIUS` in `findBestTarget` | 55 yd | Consider 40 yd | 55 yd is wide enough to find the next camp. Reducing to 40 would make the player re-evaluate sooner when the current camp is empty. | Too small: player walks forward into dangerous camps. Too large: player walks past safe camps to distant ones. |

---

# Surprises and Under-Specified Areas

The following observations emerged from the code read and are flagged for the owner
to decide on.

1. **Quest evaluation order vs. combat priority.** The engine evaluates quests FIRST
   (turn-in > navigate > accept), then combat. This means a player near a turn-in NPC
   will stop fighting to turn in a quest, even if they are mid-combat with a mob. This
   is correct for progression (quest XP matters), but the implementation lets
   `evaluateQuest` return a steer action even when the player has an active target in
   melee range. The `engine.ts` line `if (questResult.didQuestAction) action = 0` handles
   the case where the quest action was taken, but if the quest steers toward a distant NPC
   while the player is being attacked, the player may die walking away from a fight. This
   is an edge case worth monitoring.

2. **The eat/drink threshold is hardcoded at 30%.** In `auto_combat.ts`, the eat/drink
   action fires when `p.hp < p.maxHp * 0.3`. This is a design choice (heal between fights,
   not during), but the threshold is not tunable via a constant. If different classes need
   different thresholds (mages heal less efficiently, rogues have no self-heal), this may
   need to become a per-class or per-level knob.

3. **The quest navigation integration test uses `frameSkip: 1`.** The quest acceptance
   integration test (`tests/idle/quest_navigation.test.ts`) runs with `frameSkip: 1` (one
   sim-tick per step), not the default 20. This gives fine-grained steering but does NOT
   represent the idle host's normal cadence. The test asserts quest acceptance within 200
   steps (200 sim-ticks at 0.05s each = 10 sim-seconds), which is reasonable for an NPC
   8 yd away at ~6 yd/s walk speed. However, this test does not validate the interaction
   of quest navigation with the default `frameSkip: 20` cadence, where 200 steps = 200
   sim-seconds (3.3 minutes). This gap is acceptable for now but should be noted.

4. **Anti-stuck pathfinding uses `findPlayerPath` from the sim.** The anti-stuck module
   (`idle/anti_stuck.ts`) imports `findPlayerPath` from `src/sim/pathfind.ts`. This is a
   reasonable use of the sim's A* pathfinding, but it means the anti-stuck behavior is
   coupled to the sim's pathfinding implementation. If the pathfinding changes (e.g., the
   voxel layer is integrated), the anti-stuck behavior changes implicitly.

5. **The offline progression model and paragon layer are PROPOSALS, not implemented.**
   The current code has save/load but no offline-window replay and no paragon currency.
   Part B.2 specifies the simulate-the-missed-window model with a window cap, a save-struct
   extension (`savedSimTime`, `savedStepCount`), and an optional summary-cache fallback.
   Part B.3 specifies the paragon allocation layer. Both require the `IdleSaveData`
   extension and new engine plumbing. The owner should decide when to implement them and
   whether the proposed `OFFLINE_WINDOW_CAP_HOURS` of 8 and the paragon accrual fraction
   are the right starting points.
