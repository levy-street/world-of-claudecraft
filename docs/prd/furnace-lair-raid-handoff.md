# Implementation Handoff: The Undermount Descent (three-wing raid, Volzharr finale)

| | |
|---|---|
| **Status** | BLOCKED on the Levy conversation (PR #2424 is the conversation artifact) and a PBE round. Do not dispatch any slice until both clear. Unlike the sibling handoffs there is NO zone dependency: the raid sits under Thornpeak Heights, which SHIPPED (`src/sim/content/zone3.ts:20`, `ZONE3_ZONE` id `thornpeak_heights`, verified). |
| **Source PRD** | `docs/prd/furnace-lair-raid.md` (pass 6, 2026-07-28): three wings, staged releases, per-wing lockouts, heroic at launch, TWO new sim modules, ZERO engine primitives. Its File plan section is the file inventory this handoff schedules. |
| **Scope** | Three `DUNGEON_DEFS` wings under Thornpeak: wing 1 Kiln-Keepers duo (data-only), wing 2 Odrenn (`src/sim/encounters/odrenn.ts`), wing 3 Volzharr (`src/sim/encounters/volzharr.ts`), Maerin narrator, dig-site pre-quest, per-wing daily lockouts, sealed-door unseals, heroic per wing at launch, loot per the Gravewyrm Sanctum structure, 5pc set tier, deeds, i18n, music, parity, bot tuning. NOT in scope: the cut Quenching wing, Furnace Slam, Vent Surge, the reserve list (The Floor Breathes, Waking Fury; PR D is a later Levy promotion), realm-first gating, state-keyed audio, dynamic colliders. |
| **Verified against** | `origin/release/v0.32.0` (97bd97f), 2026-07-28. Revalidate every anchor against the active release branch before implementation; trust symbols, not line numbers. |
| **Executor routing** | Claude uses `extract-and-test`, `build-dungeon-kit`, `gen-3d-asset`, `gen-icon-art`, and `qa-checklist`; Codex uses the matching `$woc-*` skills. Sim, frontend, and cross-platform reviewers follow the changed surface. No slice depends on a named model. |

## 0. Ground rules

Rules 1 to 6 of `docs/prd/FRONTIER_PHASE1_HANDOFF.md` section 0 apply verbatim (sim purity,
Rng-only randomness, i18n, strict TS, Conventional Commits, command-anchored acceptance).
Deltas for this program:

1. Base branch: the active release branch (`release/v0.32.0` at writing; re-confirm at
   dispatch). Commit scope `feat(undermount): ...`; branches `feature/undermount-s<N>`.
2. ZERO engine primitives, zero `SimContext` exposures, zero new fields on shared records
   is a hard scope wall (PRD pass 6). A slice that seems to need one stops and escalates;
   it never adds the field.
3. The two encounter modules (`odrenn.ts`, `volzharr.ts`) each get a `SIM_LAP_PHASES` pin
   in `server/game.ts` in the SAME slice as their tick call (gotcha G1). Any NEW read
   surface ships as a `src/world_api/` facet in BOTH worlds with its
   `tests/world_api_parity.test.ts` pin in the same slice; prefer riding existing aura,
   ground-AoE, and cast wire state, which needs no facet work.
4. Agent-completability is a hard invariant: every mechanic readable from game state, no
   human-reaction gates, and the Volzharr scheduler rule (no control effect overlaps an
   Eruption telegraph) is part of that invariant, not a polish item.
5. All numbers marked (tuning) in section 1 come from the PRD and are locked for PBE; do
   not retune mid-slice. Everything unmarked is derived from engine formulas.
6. Staged wing releases are calendar dates set at patch cut (wing 2 at +14 days, wing 3 at
   +28), never realm-first or cross-instance state.

## 1. Shared design constants (defined once in S1 in `src/sim/content/undermount.ts`)

```ts
export const UNDERMOUNT_WING_IDS = ['undermount_wing1', 'undermount_wing2', 'undermount_wing3'] as const;
// Lockout ids ARE the dungeon ids on meta.raidLockouts (daily, realm-local 3 AM reset);
// heroic locks derive via heroicLockoutId(id). One lockout per wing, never shared.
export const UNDERMOUNT_MIN_LEVEL = 20;
export const WING_STAGGER_DAYS = 14;            // (tuning) fixed cadence, dates set at patch cut
// Wing 1 duo (all tuning): kill-gap line
export const DUO_FRENZY_WIPE_GAP_S = 20;        // survivor packFrenzy wipes at this stagger
export const DUO_FRENZY_SAFE_GAP_S = 10;        // and is survivable at this one
// Wing 2 Odrenn (all tuning unless noted)
export const ODRENN_MARK_BURN_RADIUS = 12;      // mixed-mark burn range, steady never bursty
export const ODRENN_ARC_RADIUS = 8;             // Cinder Arc chain jump range
export const ODRENN_ARC_CADENCE_S = 20;
export const ODRENN_LATTICE_MIN = 9;            // taught spacing: 9 to 11 yd lattice
export const ODRENN_LATTICE_MAX = 11;
export const ODRENN_ENRAGE_STACK_CADENCE_S = 45; // permanent stacking damage aura
// Wing 3 Volzharr (all tuning unless noted)
export const VENT_CADENCE_S = 25;               // permanent Vent Fissure spawn cadence
export const VENT_BAIT_EVERY = 3;               // every third vent opens under a random ranged player
export const VENT_PULSE_DPS = 15;               // fire per second inside a vent; vents never close
export const FORGEHEAT_RADIUS = 5;              // within this of a vent (not in it) stacks Forgeheat
export const FORGEHEAT_STACK = { dmgPct: 4, hastePct: 4, fireTakenPct: 20, cap: 5 }; // decays seconds after leaving
export const ERUPTION_CADENCE_S = 45;
export const ERUPTION_TELEGRAPH_S = 3.0;
export const ERUPTION_DMG = { min: 350, max: 450 }; // LoS-exempt via lineOfSightClear
```

Volzharr template numbers (tuning, Nythraxis-anchored): level 26, `boss: true`,
`elite: true`, `ccImmune: true`; `hpBase: 69000 / 2.3`, `hpPerLevel: 0` (the elite 2.3x
pre-compensation idiom, ~69,000 effective, 1.15x Nythraxis whose normal pool is
60,000 effective per `dungeons.ts` `60000 / 2.3` times the `entity.ts` elite 2.3x;
review-corrected anchor), `dmgBase 58`,
`dmgPerLevel 11.4`, `attackSpeed 2.6`. Data-only kit: Molten Ejecta fire `aoePulse` min 22
max 30 radius 40 every 8 s (hits the rim); Searing Grip `smolder` on-hit; Tremor `stomp`
radius 10 every ~40 s, 1.5 s stun; Final Fury `enrage` belowHpPct 0.15, dmgMult 1.4,
hasteMult 1.25; template `knockback`; 3 to 4 `yells`. Arena ~70 yd circle, raised vent-free
rim (NOT Ejecta-safe), 5 to 7 static stalagmite pillars (indestructible in V1). Dormant
Cinderlings: 8 to 10, low HP, `aggroRadius` 3 to 4, deterministic-rng positions; no
`summonAdds`. Wings 1 and 2 bosses level 24 (ilvl 33), Volzharr level 26 (ilvl 35); heroic
variants ~37/39. Primary-stat budgets per `tests/item_level` (chest/mainhand 23/25, legs
21/22, waist/gloves 16/17, feet 15/16 at ilvl 33/35). 5pc set tier: +3% crit (crownforged,
nighttalon) / +3% spell crit (soulflame, stormcallers), all tuning; `SET_HASTE_3PC` untouched.

## 2. Verified hook-point map (all on origin/release/v0.32.0; re-find before editing)

| Concern | Anchor |
|---|---|
| Raid lockouts | `raidLockouts: Map<string, number>` on PlayerMeta `src/sim/sim.ts:1134` (serialize ~3103, load ~2407); `isRaidLocked` `src/sim/instances/dungeons.ts:397`; set-on-kill precedent `src/sim/encounters/nythraxis.ts:613`; `heroicLockoutId` `dungeons.ts:177` |
| Sealed Royal Door | Object def `src/sim/content/dungeons.ts:849` (`templateId: 'dungeon_door'`, `dungeonId`); interact routing `src/sim/interaction.ts:809` and `:881`; door registry `entity_roster.ts:125` |
| Door gate predicate | `canEnterNythraxisRaid` `src/sim/instances/dungeons.ts:393`: a PER-CHARACTER `meta.questsDone.has('q_nythraxis_bound_guardian')` check. SURPRISE: no account-wide unseal store exists anywhere. The shipped clear record is `deedStats.dungeonClears` (`src/sim/types.ts:4802`, per character). See gotcha G8 |
| Raid size gate | `RAID_MIN_PLAYERS = 10` in `src/sim/item_level.ts:70` (NOT dungeons.ts); the door check is `RAID_REQUIRED_DUNGEON_IDS` + the convert-to-raid error in `enterDungeon` (`instances/dungeons.ts:211`, guards ~229-253) |
| Content shape | `DUNGEON_DEFS` `src/sim/content/dungeons.ts:787`, merged as `DUNGEONS` `src/sim/data.ts:433`; interiors + colliders `src/sim/dungeon_layout.ts` (`interior: 'nythraxis'` flat-floor precedent, `layoutColliders` :419) |
| Wing 1 boss kit fields | `src/sim/types.ts`: `aoePulse` :1166, `bigCast` :1201, `yells` :1217, `enrage` :1222, `mendAlly` :1248 (interruptible ally heal, Anneal), `stomp` :1319, `terrify` :1354, `cleave` :1385, `smolder` :1434, `packFrenzy` :1495, `polymorphHex` :1649 (Cinder-Toad), `knockbackResistance` :784 |
| Encounter module precedent | `src/sim/encounters/nythraxis.ts`: `onBossDeath` :219, `initNythraxisEncounter` :237, `resetNythraxisEncounter` :266, `wipeNythraxisEncounter` :293, `updateNythraxisEncounter` :300 |
| Narrator NPC (Aldric pattern) | `NYTHRAXIS_ALDRIC_ID = 'brother_aldric_raid'` `nythraxis.ts:65`; dialogue helpers `nythraxisSay` :473, `nythraxisYellEvent` :491, `reserveNythraxisDialogue` :427; Maerin follows this shape |
| Ground AoE (vents) | `pulseGroundAoE` `src/sim/sim_context.ts:507` (shared entry point); `groundAoEs` readonly view :111 (Sim-owned, mutated in place); lap phase `'groundAoEs'` |
| Eruption LoS | `lineOfSightClear` `src/sim/colliders.ts:1939`; Sim wrapper `sim.ts:5245` passes `run?.modules` (samples every 0.5 yd, see `pet_ai.ts:255`) |
| Geyser / fall model | `FALL_SAFE_DISTANCE = 12` `src/sim/player_motion.ts:75`; damage `Math.round(p.maxHp * (drop - 12) * 0.07)` :463. PRD VERIFY bullet RESOLVED: fall damage SCALES with max HP, so the half-HP landing target is a drop of ~19 yd for everyone; tune launch `vy` to that apex |
| Heroic difficulty | `HEROIC_DUNGEON_TUNING` `src/sim/content/dungeon_difficulty.ts:147` (nythraxis rows :136, :223); `HEROIC_DUNGEON_IDS` + `mobTemplateForDungeonDifficulty` `src/sim/instances/difficulty.ts:5`, :28 |
| Heroic loot variants | `heroicVariantId` (`heroic_<id>`) `src/sim/content/heroic_variants.ts:32`; `buildHeroicVariants` :156 (keeps the `set:` field); raid precedent `NYTHRAXIS_RAID_BOSS_ID` + `NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL` (27) `src/sim/content/heroic_loot.ts:32-33` |
| Rating allowances | `heroic_loot.ts:44-47`, module-local (NOT exported): `ARMOR_RATING 40`, `FIVE_MAN_WEAPON_RATING 50`, `RAID_WEAPON_PRIMARY_RATING 65`, `RAID_SECONDARY_RATING 20`. Undermount authors within the raid-tier values; budget guards in `tests/item_level` |
| Tick phase pin | `export const SIM_LAP_PHASES = [` `server/game.ts:335` (entries like `'groundAoEs'`, `'instances'`, `'lootRolls'`) |
| Deeds | `DEEDS` `src/sim/content/deeds.ts:24`; `DEED_ORDER` :2228 derives from table order, APPEND-ONLY; pinned count `expect(DEED_ORDER.length).toBe(219)` `tests/deeds_content.test.ts:58` (bump per addition); trigger kind `dungeonClears` `types.ts:4744` |
| Sim i18n | `AURA_NAME_KEY` `src/ui/sim_i18n.ts:7003` (lookup :7168); entity names `src/ui/world_entity_i18n.ts`; item English catalog `src/ui/i18n.catalog/items.ts`; S3 guard `tests/localization_fixes.test.ts` |
| Music | `ZONE_STREAM_URLS` / `COMBAT_STREAM_URLS` `src/game/music_tracks.ts:13`, :30; `InstanceMusicController` `src/game/instance_music.ts:110` |
| Parity goldens | `tests/parity/` per its CLAUDE.md; mint via `UPDATE_PARITY=1 npx vitest run tests/parity` in its own reviewed commit |
| Dig-site camp anchors | `src/sim/content/zone3.ts`: `ZONE3_NPCS` :1020, `ZONE3_QUESTS` :1256 + `ZONE3_QUEST_ORDER` :1930, `ZONE3_CAMPS` :1971, `ZONE3_OBJECTS` :2013, `ZONE3_PROPS` :3672 |
| Sets / skins | `SET_HASTE_3PC` `src/sim/content/item_sets.ts:29` (leave untouched; 5pc tier lands beside it); chroma skin precedent `MECH_CHROMAS` `src/sim/content/skins.ts:60` |
| 2D physics fact | `SpatialGrid` `src/sim/spatial.ts:10`: radius queries and ground-AoE hits are x/z only; airborne (geysered) players take every ground pulse under them. Goes in both module headers |

## 3. Slices

Dependency order: S1 -> S2 -> S3 -> S4 -> S5 -> S6 -> S7 -> S8 -> S9 -> S10.
PR boundaries honor the PRD's staged plan: **PR A = S1-S2** (wing 1, shippable alone),
**PR B = S3-S4** (wing 2), **PR C = S5-S7** (wing 3). S8 (heroic) is specified once here
but EXECUTES per wing inside its own PR (heroic at launch means each wing PR carries its
heroic rows; see S8). S9 and S10 close inside PR C. Every wing PR carries its own
same-change obligations: deeds rows + pin bumps, sim matcher rows, English item catalog,
wiki regen, and this closeout:
`npx vitest run tests/deeds_content.test.ts tests/localization_fixes.test.ts tests/guide.test.ts && npm run wiki:content`.

### S1. Shell: wing 1 instance, lockout, dig-site camp dressing
- Goal: an enterable 10-player `undermount_wing1` under Thornpeak with its own daily lockout and the statically dressed surface dig-site, no bosses yet.
- Files: NEW `src/sim/content/undermount.ts` (section 1 constants; wing 1 DungeonDef with `suggestedPlayers: 10`, own graveyard at the wing entrance; the surface door object); MODIFY `src/sim/data.ts` (merge), `src/sim/instances/dungeons.ts` (wing ids into `RAID_REQUIRED_DUNGEON_IDS`, lockout check per the nythraxis at-the-door pattern), `src/sim/dungeon_layout.ts` (new interior stamp, `nythraxis` flat-floor precedent, plus the glass-statue gallery props), `src/sim/content/zone3.ts` (dig-site camp: `ZONE3_CAMPS` + `ZONE3_OBJECTS` + `ZONE3_PROPS` rows, fixed props and mobs, zero zone-side live state; tremors are renderer-only).
- NEW: content module, layout stamp. Reused: enterDungeon flow, raidLockouts, graveyard machinery.
- Tests first: NEW `tests/undermount.test.ts` (entry refuses below level 20, non-raid party, and under 10 players; the wing 1 lockout id is `undermount_wing1` and blocks a second same-day claim; dig-site props exist and register no scheduler).
- Acceptance: `npx vitest run tests/undermount.test.ts tests/dungeon_entry_clearance.test.ts tests/architecture.test.ts && npx vitest run tests/parity` (untouched: no draws outside undermount code paths).

### S2. Vosh + Saan (data-only duo), wing 1 loot/deeds/i18n; closes PR A
- Goal: the balance duo entirely from shipped MobTemplate fields; wing 1 ships as a complete raid wing.
- Composition: Vosh = Glazing stacking slow + fire vulnerability via existing aura effects, `polymorphHex` (Cinder-Toad) on-hit, `cleave`; Saan = fire `aoePulse`, Anneal = `mendAlly` on Vosh (interruptible, tether range tuning), `terrify` texture; BOTH carry `packFrenzy` tuned to the `DUO_FRENZY_*` gap line. ZERO encounter-module code.
- Files: MODIFY `src/sim/content/undermount.ts` (both templates, spawn list, loot: 4 epic feet guaranteed group summing to 1.0 + ~0.55 bonus group per the PRD list incl. the redistributed rings, ratings within raid-tier allowances, budgets computed FIRST), `src/sim/content/deeds.ts` (wing 1 first-kill row, append-only) + pin bump, `src/ui/sim_i18n.ts` (Glazing, Cinder-Toad, Anneal aura rows in `AURA_NAME_KEY` + dictionaries), `src/ui/world_entity_i18n.ts`, `src/ui/i18n.catalog/items.ts` (English), icons via `gen-icon-art`.
- Loot/kill path: fires on the LAST keeper to die regardless of order; a wipe or single-keeper leash resets BOTH (verify the half-pull cannot cheese the duo, PRD open question 5).
- Tests first: extend `tests/undermount.test.ts` (staggered kill frenzies survivor; Anneal interrupt + tether; last-keeper loot both orders; pair reset on leash) + `tests/item_level` budget rows + deed pins.
- Acceptance: `npx vitest run tests/undermount.test.ts tests/item_level.test.ts tests/mob_hex.test.ts` + the PR closeout line, then `npm run gate` (wing boundary).

### S3. `src/sim/encounters/odrenn.ts` (geography marks, mixed-mark burn, arc lattice)
- Goal: the SORT fight: floor-derived marks, proximity burn, Cinder Arc; the first of the two new modules.
- Module state sketch (kills the ambiguity): `Entity['odrenn'] = { markSide: 'scorched' | 'chilled', arcTimer: number, enrageTimer: number, enrageStacks: number }`; mark derivation each tick from x/z vs the room centerline WITH a hysteresis band (a player inside the band keeps the prior mark, so edge-dancing cannot flap per tick); marks applied as two auras; the mixed-burn pass walks the existing 2D player grid at `ODRENN_MARK_BURN_RADIUS`; the arc picks a seeded random raider (`ctx.rng`, tick order) then chain-walks players within `ODRENN_ARC_RADIUS` of the last target, damage growing per jump, each jump a combat-log event; the enrage is a permanent stacking self-aura every `ODRENN_ENRAGE_STACK_CADENCE_S`, plus the ordinary `enrage` field at 15%. Kit texture data-only (`cleave`, modest fire `aoePulse`). Wipe/reset mirrors `resetNythraxisEncounter` (strip marks, clear timers).
- Files: NEW `src/sim/encounters/odrenn.ts`; MODIFY `src/sim/content/undermount.ts` (wing 2 def + arena + Odrenn template), `src/sim/sim.ts` (thin tick call), `server/game.ts` (`SIM_LAP_PHASES` pin, SAME slice), `src/sim/types.ts` (the `odrenn` entity slot only, nythraxis precedent).
- Tests first: NEW `tests/odrenn.test.ts` (exactly one mark always; hysteresis holds at the centerline; mixed pairs burn at 12 yd, same-mark never; arc refuses jumps over 8 yd and grows per jump; stacks accumulate on cadence; full reset) + a parity scenario minted `UPDATE_PARITY=1` in its own commit.
- Acceptance: `npx vitest run tests/odrenn.test.ts tests/architecture.test.ts && npx vitest run tests/parity`.

### S4. Odrenn loot, deeds, i18n; closes PR B
- Goal: wing 2 ships: t2 legs guaranteed group, bonus group per the PRD list (The Even Temper, Cinderarc, the rehomed waist pieces), deed row, all strings.
- Files: MODIFY `src/sim/content/undermount.ts` (loot, `set:` family tags on the four legs), `deeds.ts` + pins, `sim_i18n.ts` (Scorched/Chilled mark aura rows, death line matcher), `world_entity_i18n.ts`, items catalog, icons.
- Tests first: `tests/item_level` rows (legs 21 pts at ilvl 33), deed pins, S3 i18n guard.
- Acceptance: PR closeout line + `npx vitest run tests/item_level.test.ts` + `npm run gate` (wing boundary).

### S5. `src/sim/encounters/volzharr.ts` (vents, geysers, Eruption LoS, Forgeheat, scheduler)
- Goal: the kernel, exactly the PRD's four systems, nothing else (non-goals: no phase machine, no interactables, no dynamic colliders).
- Scheduler sketch (kills the ambiguity): `boss.volzharr = { ventTimer, ventCount, eruptTimer, eruptTelegraphUntil, tremorTimer, tremorSuppressed }`; every timer decrements on sim time; a suppressed control effect (Tremor during a live Eruption telegraph) re-fires after the window and RE-ANCHORS its next fire from when it actually fired, permanently de-syncing harmonic locks. Vents: every `VENT_CADENCE_S` push a permanent entry via `pulseGroundAoE`/`groundAoEs` at a `ctx.rng` position weighted to carve corridors; every `VENT_BAIT_EVERY`th vent centers on a random ranged player; vents never despawn. Geyser: entering a vent sets `vy` for a ~19 yd apex (half-HP landing, verified fall model); fall damage does the rest. Eruption: `bigCast`-style telegraph then the arena hit, each player exempted by `lineOfSightClear` to a pillar. Forgeheat: within `FORGEHEAT_RADIUS` of a vent stacks the composed aura (existing effects only). Cinderlings are template records with deterministic-rng positions. Reset mirrors `resetNythraxisEncounter`: clear vents, despawn woken Cinderlings, strip Forgeheat. Both physics facts (2D hits; airborne players take ground pulses) go in the module header.
- Files: NEW `src/sim/encounters/volzharr.ts`; MODIFY `undermount.ts` (wing 3 def, pillar colliders, Volzharr + Cinderling templates with the full data-only kit from section 1), `sim.ts` (tick call), `server/game.ts` (lap pin, SAME slice), `types.ts` (the `volzharr` entity slot).
- Tests first: NEW `tests/volzharr.test.ts` (vent accumulation and permanence; bait targeting; Forgeheat stack/decay/cap; Eruption exempts a pillar-covered player and hits an exposed one; Tremor suppressed during telegraph and re-anchored after; full reset; two seeded sims produce identical floors).
- Acceptance: `npx vitest run tests/volzharr.test.ts tests/architecture.test.ts && npx vitest run tests/parity` (existing goldens untouched).

### S6. Maerin beats + sealed-door unseals across wings + pre-quest
- Goal: the narrator arc and the wing-to-wing gate; also backfills the S1/S2 skeleton with the real lines.
- Unseal decision (gotcha G8, settle with Levy in #2424 before this slice): the shipped precedent is PER-CHARACTER (`canEnterNythraxisRaid` reads `meta.questsDone`; clears live in `deedStats.dungeonClears`). Character-scoped unseal keyed on `deedStats.dungeonClears['undermount_wing<N>'] >= 1` is zero new machinery; the PRD's "account" wording needs either that downgrade or an explicit account-scope store (new server work, out of the zero-engine budget). Default here: character-scoped, flagged in the PR body.
- Files: MODIFY `undermount.ts` (Maerin spawn per the Aldric pattern: id, entry walk, 2 to 3 lines per boss corpse via the `nythraxisSay` helper shape, door channel; wing 2/3 `dungeon_door` objects with the unseal predicate in `enterDungeon`), `zone3.ts` (the three pre-quest records + `ZONE3_QUEST_ORDER` append; the chain NEVER gates the raid; Runeseeker's Lantern as a no-stat cosmetic), `sim_i18n.ts` matcher rows for every Maerin line and error string in the SAME slice, quest prose on the cheap i18n path (non-Latin sparse overlay only, run `i18n:hash --write`, commit generated files).
- Tests first: extend `tests/undermount.test.ts` (wing 2 door refuses without a wing 1 clear and opens with one; skipping the pre-quest changes nothing; Maerin lines fire in order and only once per kill).
- Acceptance: `npx vitest run tests/undermount.test.ts tests/localization_fixes.test.ts && npx vitest run tests/parity`.

### S7. Volzharr loot, 5pc set tier, deeds; closes PR C with S8 to S10
- Goal: wing 3 pays out: TWO guaranteed groups (t2 chests; ilvl-35 off-pieces) + the chase group (Corebreaker, The Last Restraint, Band of the Ninth Quench, Moltenheart chroma via the `skins.ts` precedent) + 15g; the 5pc set tier.
- Files: MODIFY `undermount.ts` (loot per the PRD tables, budgets first: chests 25, feet 16, waist 17 at ilvl 35), `item_sets.ts` (ONE new 5pc tier per t2 family, +3% crit / spell crit; `SET_HASTE_3PC` untouched; 6/6 stays flex), `skins.ts`, `deeds.ts` (Volzharr first-kill with the raid's title, the full-descent meta deed: all three wings in one lockout week) + pins, items catalog, `sim_i18n` (Searing Grip, Forgeheat aura rows), icons, changed set-bonus text obligations per the established overlay process.
- Tests first: `tests/item_level` rows, `tests/item_sets.test.ts` 5pc rows, deed pins; run ip_scrub over the final name list.
- Acceptance: `npx vitest run tests/item_level.test.ts tests/item_sets.test.ts tests/deeds_content.test.ts`.

### S8. Heroic per wing (executes inside each wing PR)
- Goal: heroic at launch on shipped machinery only: stat multipliers and variant loot, no heroic-only mechanics.
- Files per wing: MODIFY `dungeon_difficulty.ts` (`HEROIC_DUNGEON_TUNING` row -> the wing joins `HEROIC_DUNGEON_IDS` automatically), `heroic_variants.ts`/`heroic_loot.ts` wiring so `buildHeroicVariants` derives `heroic_<id>` items at ~37/39 keeping `set:`, `deeds.ts` heroic first-kill row per wing.
- Tests first: extend the wing test (heroic entry tunes stats by the standing multipliers; heroic kill drops `heroic_` variants and locks `heroicLockoutId(wingId)`; normal drops unchanged).
- Acceptance: rides each wing PR's closeout + `npx vitest run tests/undermount.test.ts tests/item_level.test.ts`.

### S9. Music, ambience, decal color contract at every fx tier
- Goal: one streamed track + one ambient loop per wing; the ONE scripted audio beat (Eruption riser cutting to half a second of silence); the fairness color contract.
- Files: MODIFY `src/game/music.ts` / `music_tracks.ts` / `instance_music.ts` (wing routing), NEW tracks under `public/audio/music/`, render decals for vents (red-orange ring, black core), geyser trigger (white-hot inner ring), Forgeheat ring (thin gold), Scorched/Chilled glyphs (ember-orange vs steel-blue) as new `src/render/` modules, `CREDITS.md`.
- Verification: one hue family per meaning, identical at EVERY `data-fx-level` including reduce-motion; the hot/quench floor sides must read unambiguously at every tier (marks derive from geography, so this is actionable info, not cosmetics). Screenshot the decals at each tier per the headless workflow; `frontend-seam-reviewer` on the render diff.
- Acceptance: `npx vitest run tests/music.test.ts tests/music_tracks.test.ts tests/instance_music.test.ts && npm run build`; tier screenshots committed to `docs/screenshots/`.

### S10. Parity scenarios + bot-raid tuning
- Goal: the mandated determinism proof and the agent-completability proof.
- Files: `tests/parity/scenarios.ts` scenarios for Odrenn (mark/arc determinism) and Volzharr (vent placement + a byte-identical geyser-launch replay; fall damage is sim state), goldens minted `UPDATE_PARITY=1` each in its own reviewed commit; NEW `scripts/undermount_bot_raid.mjs` (10 clients, full three-wing clear on a dev server, `ALLOW_DEV_COMMANDS=1`, dev only); tuning edits confined to `undermount.ts` constants.
- Acceptance: `npx vitest run tests/parity && node scripts/undermount_bot_raid.mjs`; full scripted clear recorded; `npm run gate` final milestone; then the PBE handoff.

## 4. Gotchas (read before every slice)

- **G1, SIM_LAP_PHASES is a pinned list.** Exactly TWO per-tick modules here (`odrenn`,
  `volzharr`); each needs its `server/game.ts:335` entry in the same slice as its tick
  call or the profiler pin test reds. Wing 1 adds none (data-only, that is the point).
- **G2, deeds are append-only.** `DEED_ORDER` derives from table order; append at the end
  and bump the pinned count (219 at verification, `tests/deeds_content.test.ts:58`).
  Deeds land in the SAME PR as their wing's `DUNGEON_DEFS` entry, never retrofitted.
- **G3, item i18n split.** Contributor slices add English catalog rows plus M16 non-Latin
  fills for wordy prose; maintainers fill remaining overlays at release. CAUTION: prior
  item and ability PRs have hit full-coverage gates (`localization_coverage`) beyond the
  documented PR-tier rule; verify which tier the gate runs at before assuming
  English-only passes, and budget translation time for the ~30 item names if not.
- **G4, AURA_NAME_KEY is a no-test trap.** Every mechanic aura name (Glazing, Anneal,
  Scorched, Chilled, Searing Grip, Forgeheat) needs its `sim_i18n.ts:7003` row; NO test
  catches a miss. Explicit review item on every wing PR.
- **G5, parity golden discipline.** One `ctx.rng` draw on a shared code path shifts draw
  order and reds every golden. All undermount draws stay inside undermount code paths;
  mint each new scenario's golden with `UPDATE_PARITY=1` in its own reviewed commit;
  never regenerate an existing golden to hide a diff.
- **G6, wing PRs are self-contained.** Each of PR A/B/C independently carries deeds +
  pins, matcher rows, English catalog, heroic rows (S8), wiki regen, and the closeout
  command line from section 3's preamble. The PR-boundary audit rule: nothing lands in a
  later PR that an earlier shipped wing already needed.
- **G7, worktree discipline.** The shared checkout carries uncommitted WIP; build each
  slice in a fresh worktree off the active release branch (`feature/undermount-s<N>`)
  and re-merge as the release moves.
- **G8, the unseal scope is an open decision.** No account-wide unseal store exists on
  v0.32.0 (section 2); S6 defaults to character-scoped via `deedStats.dungeonClears`.
  Resolve the PRD's "account" wording with Levy in the #2424 conversation before S6.

## 5. Open items carried from the PRD (do not resolve unilaterally)

PRD open questions 1 to 6 stay open into PBE: rim Ejecta mitigation, Cinderling guilt
stacks, crumbling pillars (V2 only), Forgeheat and geyser tuning, the Kiln-Keepers duo
numbers (frenzy gap, Anneal tether, Glazing endpoint, half-pull leash reset), and the
Odrenn room geometry check (burn radius vs arc radius vs a 10-player lattice in the
chamber, hysteresis band width). Plus G8 (unseal scope) and the PR D reserve promotions
(The Floor Breathes, Waking Fury), all Levy calls.

## 6. Dispatch note

Do not dispatch any slice while the Status row says BLOCKED. When unblocked, hand each
owner the slice block, section 0 rules, section 1 constants, its hook-map rows, the
gotchas, and the acceptance commands. Require fails-before/passes-after evidence for
every test written first, exact command output, and a `qa-checklist` pass. S2, S4, and
S10 end with `npm run gate` (the wing boundaries and the final milestone).
