# Nythraxis mechanics redo: a dynamic three-phase raid

Status: PLAN, owner-reviewed (nothing implemented yet)
Branch: `feature/nythraxis-mechanics-redo` (worktree `wocc-nythraxis`), based on
`origin/release/v0.42.0`.
Companion docs: `docs/prd/heroic-nythraxis-tier.md` (the heroic tier as shipped),
`docs/prd/dungeon-mechanic-primitives.md` (the primitive vocabulary),
`docs/prd/ignivar-raid-loot.md` (the newer raid whose mechanics this borrows from).

## 1. Goal

Nythraxis is the older raid. Its fight is a stand-still tank-and-spank with two
good ideas (Soul Rend's stack-to-split and the wardstone channels that break
Deathless Rage) and no movement between them: nothing asks anyone to dodge, no
tank swap exists on normal, and DPS never switch targets. The Ignivar raid since
shipped a full vocabulary (meteor circles, expanding rings, rotating rays,
tethers, intercept lines, soak circles, tank-swap brands, timed hard enrages,
structured center-screen callouts, and an in-game Raid Boss Guide).

This redo keeps the wardstones and the story beats (Aldric, the court) and
rebuilds the rest so that:

- the raid moves constantly (telegraphed circles that leave burning ground, a
  traveling fire line, pools that force the stack point to rotate, a sigil the
  tank must drag the boss onto, a charging Bone Storm);
- a stacking tank debuff forces a swap on BOTH difficulties;
- Bone Spikes (Marrowgar style) impale raiders that the DPS must free;
- every role has a task with a wipe behind it (section 4);
- EVERY mechanic runs on normal; heroic changes only counts and damage
  (section 5). The one heroic-only element is the existing court (Aldren,
  Malric, Voss), which this plan leaves as shipped.

Owner decisions folded in: no scripted healer task (healing pressure comes from
the mechanics themselves); no healer cap on Bone Spike targeting; the existing
deeds stay untouched; voice lines for the new yells are deferred.

## 2. What exists today (verified against `src/sim/encounters/nythraxis.ts`)

| Mechanic | Phase | As coded |
|---|---|---|
| Gravebreaker | 1, 2 | Charged auto-attack: armed every 12 s, released by the next LANDED swing; 11 yd, 120 degree frontal splash at 1.5x the swing roll to everyone but the swing target |
| Raise Fallen | 1 | Two Risen Royal Guards behind the boss every 30 s, seeded onto the tank |
| Dread Curse | 1, 2, heroic only | +10% damage taken per stack every 15 s, max 10, 45 s; stack counter RESETS on a target change (so it never actually forces a swap) |
| Transition at 70% | | 21 s room stun, Aldric walks in, wardstones light |
| Soul Rend | 2 | 3 marks (6 heroic), 8 s fuse, max hp damage divided by marked players within 5 yd |
| Deathless Rage | 2 | 10 s cast every 45 s; three DIFFERENT players each finish a 5 s wardstone channel or the raid takes 82% (normal) / 115% (heroic, lethal) |
| Heroic court | 2, heroic only | Aldren (cleave), Malric (interruptible ramping boss heal), Voss (untauntable) after a failed Rage or after the interrupt stun |
| Final Stand | 2, below 5% | +45% haste, no other change |

Arena (`NYTHRAXIS_LAYOUT` in `src/sim/dungeon_layout.ts`): a crypt hall about
460 yd wide and 145 yd long, boss dais at local (0, 96) with radius 13.5, twenty
pillars on a 4 x 5 grid, wardstones at (-40, 79), (40, 79), (0, 63), entry door
near z = 4. Ten players, normal and heroic.

Gaps this plan closes: no telegraphed ground mechanic, no forced movement, no
normal-mode tank swap, no target-switch task on normal, no wall-clock pressure,
no Raid Boss Guide entry (the guide covers only Ignivar and Varkhul), and no
`sim_i18n` matcher rows for any Nythraxis ability name (they render in English
in every locale).

## 3. The fight

Three phases plus the existing transition. Phase 3 replaces Final Stand.
"Aggro holder" below means the player Nythraxis is currently hitting; every
personal mechanic picks from everyone else, the off-tank included.

### Phase 1: The Throne (100% to 70%)

Teaches the habits the rest of the fight assumes: swap the tank, break the
spike, move off the circle, drag him to the sigil.

**Gravebreaker** (kept unchanged). Tank faces him away; melee stay behind.

**Dread Curse** (reworked, both difficulties: THE tank swap). Every 10 s, if the
aggro holder is in melee reach: a 25% max hp shadow hit plus one stack of Dread
Curse. Each stack is +35% damage taken from Nythraxis (heroic +45%), max 3,
30 s, not dispellable. Stacks live on the aura, so they stay on the old tank
through the swap and expire on their own; the counter no longer resets on a
target change. Swap at 2 stacks (published as
`NYTHRAXIS_DREAD_CURSE_TANK_SWAP_STACKS`, the way Varkhul publishes
`VARKHUL_MAKERS_BRAND_TANK_SWAP_STACKS` to the guide). Three stacks plus a
Gravebreaker is a dead tank.

**Bone Spike** (new). Every 20 s (heroic 16 s), first at 12 s: TWO players
(heroic THREE) are impaled. Anyone is eligible except the aggro holder; there is
no role protection, so both healers can be spiked in one wave (owner decision).
Each victim is stunned (unbreakable, encounter-owned), dropped into the death
pose with a bone spike through them (section 3.5), and drains 8% max hp per
second (heroic 10%). A Bone Spike mob rises at each victim's feet: stationary,
never swings, immune to CC and taunt, no loot, hp tuned to about four seconds of
two DPS so the raid must split onto the spikes. Killing a spike frees its victim
at once. Left alone a victim dies in about 12 s (normal) / 10 s (heroic). A
player already carrying a live Soul Rend mark is skipped for that cast (never
two personal mechanics on one raider). Every spike shatters at the transition,
on a wipe, and on the kill.

**Grave Eruption and Grave Flame** (new). Every 15 s (heroic 12 s): four
(heroic six) skeletal hands burst from the floor under distinct random players
(aggro holder placed last), radius 3 yd, 2.5 s warning ring, then 45% max hp
(heroic 75%) shadow damage to anyone still inside. Each burst leaves a Grave
Flame patch (green fire) on the same 3 yd circle for 12 s (heroic 18 s) at 6%
max hp per second (heroic 9%). Because the hands target the floor under
players, the fire always appears in the raid's own footprint: a raid that
holds one spot is standing in about three patches at any moment on normal and
about nine on heroic, while a raid that drifts to fresh floor after each wave
leaves the fire burning out behind it.

**Raise Fallen** (kept). Two Risen Royal Guards every 30 s: the off-tank's job
between swaps.

**Binding Sigil** (new, the pull mechanic). Every 45 s (heroic 40 s), first at
30 s: a sigil of the old wards flares on the floor at a random point 12 to 30 yd
from Nythraxis's current position. Placement is valid floor only: inside the
arena, never in a pillar, 6 yd clear of every wardstone, and on normal never
inside live fire (on heroic it may land in fire). He begins Deathless Ascension:
a stack every 2 s, each +4% damage and haste (heroic +5%), shown on his frame.
The tank has 15 s (heroic 12 s) to drag him onto the sigil (radius 4 yd, heroic
3 yd). Bound: his Ascension is purged, he is stunned 4 s (heroic 3 s), and he
takes +25% damage for 10 s (the burn window, shown as a debuff on him).
Unbound: a 40% max hp (heroic 60%) raid-wide shadow hit and he keeps +20%
damage (heroic +25%) until the next successful binding. Melee follow the drag,
ranged re-read the Gravebreaker facing, and the drag route crosses whatever
fire the raid left behind.

### Transition (70%)

Unchanged: Shuddering Stomp, Aldric's walk and speech, wardstones light. The
transition clears spikes, flames, the sigil, and Ascension so phase 2 starts
clean.

### Phase 2: The Wardstones (70% to 30%)

Everything from phase 1 continues. Three mechanics join.

**Soul Rend** (kept) plus **Soulfire** (new). Marks and the 5 yd split rule are
unchanged. Each detonation now leaves a Soulfire pool (red fire, radius 4 yd,
15 s, 8% max hp per second, heroic 12%) where each marked player stood. The
stack point must move every time. Pools never form within 6 yd of a wardstone,
so channeling is never forced through fire. Cap of 12 live pools, oldest first.
The Soul Rend aura becomes encounter-owned (nothing in the game can dispel it
today, but the mark still detonates if the aura is stripped, so the flag makes
the contract honest).

**Deathless Rage and the wardstones** (kept). The 10 s cast, the three distinct
5 s channels, the 5 s self-stun on success, the 82% / 115% raid hit on failure,
and the heroic court all stay exactly as they are. The Rage window is now a
calm window by rule: Eruption, Gravefire, Spike, and Sigil all hold while the
cast is up (section 3.4), so the raid's only job is to reach the stones.

**Gravefire** (new, the Coldflame). Every 12 s (heroic 10 s) Nythraxis ignites a
line of violet grave-fire from his feet toward a random eligible player's
position. The line grows at 12 yd per second to 40 yd; each burning yard lasts
6 s (heroic 8 s) and deals 10% max hp per second (heroic 15%) to anyone standing
in it, half-width 1.5 yd. Sidestep it. Ranged players can no longer stand still.

### Phase 3: The King's Wrath (30% to 0%)

Replaces Final Stand. Entered at 30% once no major cast is in flight (the way
Ignivar gates Judgment). On entry Nythraxis roars and gains a permanent +20%
damage (heroic +25%). Grave Eruption tightens to 10 s and Gravefire to 8 s;
Bone Spike, Binding Sigil, Soul Rend, and Deathless Rage continue on their
phase 2 cadences.

**Bone Storm** (new, the Marrowgar signature). Every 50 s, first at 8 s into the
phase: for 12 s Nythraxis ignores threat and taunts, cannot be knocked back, and
whirls, dealing 10% max hp per second to anyone within 9 yd. He charges four
random living, non-impaled players in sequence (3 s each) at 2.2x move speed;
on reaching one, Bone Slam: 35% max hp (heroic 55%) physical to everyone within
9 yd, plus a Gravefire line down the charge direction. One Bone Spike cast lands
mid-storm on both difficulties (two victims normal, three heroic), so the raid
frees the spiked while running from him. When it ends the threat table is
intact, the top-threat tank picks him up, and Gravebreaker re-arms in 3 s.
Melee cannot attack safely; the raid spreads and runs.

**The Crown Endures** (new, the hard enrage). At 6:00 from the pull (heroic
5:00) Nythraxis gains +50% damage and +50% haste, and +25% more damage every
30 s after that, until the raid or the king is dead. Yells at 60, 30, and 10 s
remaining (text now; voice deferred). No timer bar (classic fidelity, the same
call the primitives PRD makes). The clock starts on the first encounter tick
and PAUSES for the 70% transition (owner decision 2026-09-04: Brother
Aldric's entrance is not the raid's time). Both times are placeholders for the Monte Carlo
pass (section 8).

### 3.4 Scheduling rules

- Majors that own the boss's body never overlap and keep a 6 s gap, the rule
  Ignivar's driver applies: Deathless Rage (he stands casting), Bone Storm (he
  runs), Binding Sigil (he is dragged). Soul Rend may overlap a Sigil drag but,
  as today, never a Rage or a Storm.
- Phase 3 triggers at 30% only when none of those majors is in flight.
- Players who cannot move are protected: Grave Eruption and Gravefire never aim
  at an impaled player or an active wardstone channeler (a growing line may
  still cross them); Bone Storm never charges an impaled player.
- The Deathless Rage cast is a calm window: Eruption, Gravefire, Spike, and
  Sigil hold and fire the moment it resolves. Nothing may stun a channeler.
- Personal mechanics are exclusive per player: a raider carrying a Soul Rend
  mark or an Impale is not picked for the other until it clears.
- Nothing new fires during the transition; the transition clears all live
  hazards.
- Grave Eruption placement, Bone Storm target order, and Binding Sigil
  placement use the hash idiom Ignivar's meteors use (`hash2(castKey, id)`),
  not the shared rng stream, so the only new shared-stream draws are the Bone
  Spike and Gravefire target picks.

### 3.5 The impale look

The impaled player plays the character death clip and holds its final frame,
lying on the floor. The Bone Spike is a low-angled cluster of bone shards
erupting from the ground through the torso at the player's position, so the
two read as one body skewered on the floor. Shadow mist and a bone-burst VFX on
impale; a shatter VFX and the player standing back up on free. The player is
alive the whole time: nameplate, health bar, heal targeting, and an Impaled
debuff showing the drain all stay live. The impale is an aura, so the online
client sees it for free, and the pose override hangs off the same
aura-to-character-effect seam the Soul Rend overlay already uses
(`src/render/character_effects_core.ts`). The spike itself is the spike mob's
model: a real GLB generated through the Tripo asset pipeline
(`asset-pipeline` skill, `scripts/asset_pipeline/pipeline.mjs`, key in the
gitignored repo-root `.env`), reviewed in the rendered previews and wired
through the pipeline's registry step, never a procedural stand-in. The same
pipeline produces any other new model this fight needs (the sigil decal and
the fire patches are shader-driven ground visuals and need no GLB).

## 4. Every role has a task, and a wipe behind it

| Role | Task | What failure costs |
|---|---|---|
| Tanks | Taunt-swap at 2 Dread Curse stacks | Third stack plus Gravebreaker kills the tank |
| Tanks | Face Gravebreaker away from the raid | 1.5x splash on the melee |
| Tank | Drag him onto every Binding Sigil inside 15 s, through the fire | 40% raid hit and a permanent +20% until the next binding |
| Off-tank | Pick up Royal Guards (phase 1) and the heroic court (phase 2) | Guards free-cast on healers; Malric heals the boss |
| Tanks | Regain the boss after Bone Storm | He whirls into the ranged |
| Healers | Keep impaled raiders alive at 8 to 10% per second, two or three at a time | Impaled raider dies |
| Healers | Heal the tank through a 25% hit every 10 s on top of the stacks | Tank dies |
| Healers | Triage the Soul Rend stack, Bone Slam victims, and Unbound hits | Splits and slams kill the unhealed |
| DPS | Shatter Bone Spikes in under 10 s, split across two or three | Impaled raider dies |
| DPS (heroic) | Interrupt Malric's Mending | Boss heals; the enrage clock is lost |
| DPS | Beat the 7:00 / 6:00 clock through Storm and Rage downtime; use the Bound window | The Crown Endures wipes the raid |
| Everyone | Move off Grave Eruption, drift off Grave Flame, sidestep Gravefire, rotate the stack off Soulfire | 45 to 75% hits, 6 to 15% per second fire |
| Everyone | Three DIFFERENT players channel the wardstones every Deathless Rage | 82% raid hit; on heroic an unconditional wipe |
| Everyone | Spread and run during Bone Storm | 35 to 55% slams on a stacked raid |

Hard wipes: a resolved Deathless Rage (heroic), the enrage clock, and a chain of
Unbound sigils (compounding boss damage against the clock).

## 5. Normal versus heroic

| Mechanic | Normal | Heroic |
|---|---|---|
| Dread Curse | 25% hit, +35% per stack, swap at 2 | 30% hit, +45% per stack, swap at 2 |
| Bone Spike | every 20 s, 2 victims, 8%/s | every 16 s, 3 victims, 10%/s |
| Grave Eruption | every 15 s, 4 circles, 45%, flame 12 s at 6%/s | every 12 s, 6 circles, 75%, flame never goes out (clears at the transition) at 9%/s |
| Binding Sigil | every 45 s, 10 to 24 yd out, 4 yd, 15 s to bind, +4%/stack, Bound 10 s, Unbound 40%, keeps +20% | every 40 s, 3 yd, 12 s, +5%/stack, Bound 8 s, Unbound 60%, keeps +25%, may land in fire |
| Soul Rend / Soulfire | 3 marks, 100% split, pools 15 s at 8%/s | 6 marks, 150% split, pools never go out at 12%/s |
| Deathless Rage | 82% on failure (unchanged) | 115% on failure, lethal, court rises (unchanged) |
| Gravefire | every 12 s, burns 6 s at 10%/s | every 10 s, burns 8 s at 15%/s |
| Phase 3 Wrath | +20% damage, eruptions every 10 s, Gravefire every 8 s | +25% damage, eruptions every 8 s, Gravefire every 6 s |
| Bone Storm | every 50 s, whirl 10%/s, Bone Slam 35% | every 40 s, whirl 20%/s, Bone Slam 55% |
| The Crown Endures | 6:00 (the clock pauses for the transition), +25% every 30 s | 5:00, +25% every 20 s |
| Court (Aldren, Malric, Voss) | absent | after a failed Rage and after each interrupt stun |

Avoidable damage fractions get a Nythraxis block in
`tests/raid_avoidable_damage_tuning.test.ts` beside the Ignivar and Varkhul
pins, so the "punishing on normal, severe on heroic" rule is literal.

Normal is now a real raid: two tanks become mandatory (the swap), so the
dungeon finder's normal raid composition in `src/sim/content/dungeon_finder.ts`
must require them, and every normal number is calibrated against an explicit
"a coordinated pug clears it" target (section 8).

## 6. Engineering plan

Module-first, on the pattern the newer raids use: one pure leaf per mechanic
beside `src/sim/encounters/`, holding tuning constants, geometry, and (when the
client must see it) an `Active*` readout with a stable id; the driver in
`src/sim/encounters/nythraxis.ts` owns timers, damage, and mutation.

### Sim

- `src/sim/nythraxis_dread_curse.ts`: tuning, the melee-reach gate, aura
  application on stacks (kind `vuln_source`, source-scoped, encounter-owned).
  The encounter-state stack counter and its reset-on-retarget go away.
- `src/sim/nythraxis_bone_spike.ts`: target eligibility (everyone but the aggro
  holder, minus live Soul Rend carriers), spike hp by difficulty, drain tick,
  free-on-death. The impale is an aura with `unbreakableControl` and
  `encounterOwned`, `value2` = the spike entity id (the idiom Chains of the
  Forge uses for its partner id). The spike is a `MobTemplate` in
  `src/sim/content/dungeons.ts` (`nythraxis_bone_spike`), pinned in place every
  tick the way `updateIgnivarApocalypseAdd` pins the Heart of the End,
  dispatched from the same `src/sim/mob/locomotion.ts` ladder, and excluded
  from the Nythraxis add AI, the transition stun, and add-kill deed credit.
- `src/sim/nythraxis_grave_eruption.ts`: `ActiveNythraxisGraveEruption` and
  `ActiveNythraxisGraveFlame`, their `active*` projectors, the hash-placed
  pattern with min separation (mirror `ignivarMeteorPattern`), and the flame
  residue list with its cap.
- `src/sim/nythraxis_binding_sigil.ts`: valid-floor placement (arena bounds,
  pillar and wardstone clearance, the normal-only fire exclusion), the
  Ascension stack ramp, the bound / unbound resolutions,
  `ActiveNythraxisBindingSigil` and its projector.
- `src/sim/nythraxis_gravefire.ts`: line extent over time, point-in-line,
  `activeNythraxisGravefires`.
- `src/sim/nythraxis_soulfire.ts`: pool list, wardstone exclusion, cap, tick,
  `activeNythraxisSoulfires`.
- `src/sim/nythraxis_bone_storm.ts`: charge sequence state machine (pure
  next-target and timing); the driver moves the boss with `ctx.moveToward`
  while `locomotion.ts` treats the storm as a script-locked state, the way it
  already treats the transition and Deathless Rage.
- `src/sim/nythraxis_enrage_clock.ts`: thresholds and the warn marks.
- `src/sim/nythraxis_raid_readouts.ts`: the `collectActive*` functions the
  `Sim` getters delegate to (sibling of `ignivar_raid_readouts.ts`).
- `src/sim/types.ts`: `NythraxisEncounterState` gains `phase: 3`, the spike,
  eruption and flame, sigil, gravefire, soulfire, storm, and clock fields; a
  new `nythraxisCallout` `SimEvent` mirroring `varkhulCallout` (calls such as
  `impaled`, `spikeBroken`, `dreadCurseSwap`, `sigilAppears`, `bound`,
  `unbound`, `boneStormBegins`, `boneStormEnds`, `crownEnduresSoon`,
  `crownEndures`).
- `src/sim/encounters/nythraxis.ts`: its header's "MOVE, not a rewrite" prime
  directive is retired in this change; the mechanics ARE changing and the
  `nythraxis_full_pull` parity golden is regenerated on purpose (section 7).
  Every reset path clears spikes, flames, pools, the sigil, Ascension, Wrath,
  the storm, and the clock.

### Wire and IWorld

- `src/world_api/combat.ts` gains `activeNythraxisGraveEruptions`,
  `activeNythraxisGraveFlames`, `activeNythraxisBindingSigils`,
  `activeNythraxisGravefires`, `activeNythraxisSoulfires`; implemented on both
  `Sim` and `ClientWorld`; pinned in `tests/world_api_parity.test.ts`.
- `server/ground_telegraph_wire.ts` plus a `server/nythraxis_wire.ts` encode
  them on the event-radius rule; `src/net/ground_telegraph_wire.ts` decodes
  with row-level validation; `tests/snapshots.test.ts` keys updated.
- The impale aura, the spike entity, Dread Curse stacks, Ascension stacks, the
  Bound debuff, the boss cast bar, and the Bone Storm aura all ride
  `wireEntity` unchanged.

### Client

- `src/render/nythraxis_encounter.ts` plus a pure
  `nythraxis_encounter_core.ts`, registered in
  `src/render/raid_encounter_visuals.ts`. Eruption rings join
  `syncWorldMeteorWarnings` in `src/render/mage_ground_fx.ts` as a fourth
  source (bone hands instead of a falling meteor for the impact VFX). Grave
  Flame, Gravefire, Soulfire, and the sigil get their own visual modules with
  distinct palettes (green, violet, red, gold); the fires can share the Varkhul
  cinder-fire material. The impaled pose override lands in the character
  effects seam. All actionable geometry is tier-independent, the fairness rule
  the Forgestorm visual states. Dispatch `render-performance-reviewer`.
- `src/ui/nythraxis_callout.ts`, the `hud.ts` case, and `combat_sfx.ts` cues,
  mirroring the Varkhul callout channel (second copy; the rule of three says
  extract a shared raid callout on the third).
- `src/ui/raid_boss_guide_view.ts`: add `'nythraxis'` with phases and
  mechanics whose numbers import the sim constants, plus
  `raidBossGuideBossForDungeon('nythraxis_boss_arena')`. This is the first
  time the guide covers Nythraxis.
- `src/ui/aura_effect.ts` descriptors and `src/ui/icons.ts` /
  `mob_aura_icon_art.ts` entries for the new aura ids; `src/ui/sim_i18n.ts`
  matcher rows for EVERY Nythraxis ability name (new and existing);
  `src/ui/world_entity_i18n.ts` name for the Bone Spike; English-only catalog
  rows in `src/ui/i18n.catalog/hud_chrome.ts` for callouts, guide text, and the
  `dungeonFinder.mech.*` blurbs; `src/sim/content/dungeon_finder.ts` encounter
  lists and the two-tank normal composition.

### Content obligations

- `src/sim/content/dungeons.ts`: the spike template; `dungeon_difficulty.ts`:
  per-mob spike health on both tuning tables.
- The Bone Spike GLB via the Tripo asset pipeline (owner decision: real assets,
  not procedural), with its `templateId` to model mapping in
  `src/render/characters/manifest.ts` and the pipeline's guard tests green.
- Deeds: unchanged by owner decision. The existing task deeds
  (`dgn_nythraxis_gravebreaker`, `dgn_nythraxis_wardens`,
  `dgn_nythraxis_deathless`) keep their rules; Kneel to No King simply gets
  harder. No new deeds in this change.
- `npm run wiki:content` regen (the spike is a new mob id) gated by
  `tests/guide.test.ts`; the generator still never emits mechanics.
- New yells (spike, sigil, ascension, storm, the three enrage warnings) ship as
  text through the existing dialogue scheduler; voice clips are a deferred
  follow-up through the raid-boss voice pipeline.
- Dispatch `content-obligations-reviewer` on the content diff.

## 7. Tests

- One Vitest per leaf (pure geometry, tuning pins, deterministic replays).
- Driver tests in `tests/nythraxis_encounter.test.ts` in the Varkhul style
  (`isolateMechanics`, call the driver by hand, assert on events, readouts,
  auras, hp deltas): swap persistence through a retarget; spike frees on kill
  and on transition; two and three victims never including the aggro holder;
  eruption placement, damage boundary, and flame residue; sigil placement
  validity on both difficulties, bound and unbound resolutions, Ascension
  purge; Soulfire wardstone exclusion; the Rage calm window; immobile-player
  protection; phase 3 gating; storm target order, slam, mid-storm spike, and
  pickup; clock warns and enrage; personal-mechanic exclusivity.
- Render, wire, and guide tests mirroring `varkhul_*_render.test.ts`,
  `varkhul_*_wire.test.ts`, and `raid_boss_guide_view.test.ts`.
- `tests/raid_avoidable_damage_tuning.test.ts` Nythraxis block.
- Parity: regenerate `tests/parity/golden/nythraxis_full_pull.json` with
  `UPDATE_PARITY=1` (an expected change, called out in the PR) and add
  scenarios covering the new rng draw sites.
- Guards that must stay green: `tests/architecture.test.ts`,
  `tests/sim_context.test.ts`, `tests/world_api_parity.test.ts`,
  `tests/snapshots.test.ts`, `tests/localization_fixes.test.ts`,
  `tests/monolith_budget.test.ts`, `tests/deeds_content.test.ts`,
  `tests/guide.test.ts`, `tests/dungeon_finder.test.ts`.

## 8. Balance calibration

`scripts/nythraxis_matrix.ts` runs the real fight with bot raids and is pinned
by `tests/nythraxis_matrix.test.ts`. Its bots do not dodge, so the new avoidable
mechanics would kill them and skew every number. The matrix bots need minimal
mechanic responses (step off an eruption ring, drift off flame, sidestep
Gravefire, stack Soul Rend, switch to spikes, taunt at 2 stacks, drag to the
sigil) or a `MATRIX_MECHANICS=off` bench switch for pure sustain runs. The
enrage clock, the spike hp, and every normal-mode fraction are then set from
the matrix's kill-time and DPS distributions against two explicit targets: a
coordinated pug clears normal, and heroic is a real progression fight. Melee
take the worst of Gravefire, Grave Flame, and Bone Storm, so the class-balance
pass (`docs/nythraxis-class-balance-monte-carlo.md`) is re-run for melee versus
ranged.

## 9. Engineering risks to prototype first

1. Boss pathing around the twenty pillars during the Sigil drag (existing chase
   locomotion) and the Bone Storm charges (scripted `moveToward`).
2. The impaled pose override on the character rig: death clip held, then stand
   back up, on both the offline and online clients.
3. Floor readability with four hazard types live at once: distinct palettes
   plus a hard cap on live hazards, playtested.
4. The matrix bots (section 8).

## 10. Delivery

ONE PR, off the latest release branch, carrying every mechanic in this plan so
the whole fight can be tested at once (owner decision, 2026-09-03; an earlier
draft split it into three PRs). The branch `feature/nythraxis-mechanics-redo`
is built in three internal slices, each a group of commits on the same branch,
each gated with `node scripts/gate_select.mjs` and `/qa` before the next
begins; only the finished branch opens a PR:

1. **Core loop**: Dread Curse swap on both difficulties, Bone Spike with the
   impale look, Grave Eruption and Grave Flame, the callout channel, the Raid
   Boss Guide entry, finder blurbs, `sim_i18n` rows.
2. **Pressure**: Binding Sigil, Gravefire, Soulfire, the major-cast scheduler
   and the calm-window rules.
3. **Phase 3**: the 30% phase, Bone Storm, The Crown Endures, Final Stand
   removal.

Deferred past this PR (owner decision, 2026-09-03: play it first, then tune):
the matrix bot dodge responses and the tuning pass in section 8, and the
Monte Carlo re-run for melee versus ranged. Every number in section 5 is a
placeholder until then. The gate and the reviewer pass run ONCE, on the
finished branch, not per slice.

One wire epoch bump (25 to 26) covers every new readout, since they are all
additive and land before anything ships, and the `nythraxis_full_pull` parity
golden is regenerated once more at the end rather than per slice.

## 11. Open questions for the owner

1. Bone Storm ships in this PR, or is cut and Gravefire plus the sigil drag carry
   the movement (it is the largest pathing risk).
2. The 7:00 / 6:00 enrage clock and the spike hp are placeholders until the
   matrix runs.
3. The court stays heroic-only, or comes to normal as well.

## 12. Owner adjustments before the first playtest (2026-09-04)

- The arena is one hall, about 100 yd wide by 100 deep (`NYTHRAXIS_LAYOUT`),
  down from 460 by 145 (a first cut at 50 by 52 played too tight); the boss dais
  keeps its local position with 20 yd behind it, the wardstones sit 34 to 38 yd
  out, the sigil band is 12 to 30 yd, eruptions land within 50 yd of the spawn,
  the adds and the court spawn behind the dais.
- Heroic floor fire never goes out on its own: Grave Flame and Soulfire patches
  burn until the transition or a reset clears them (the caps still evict the
  oldest), so the raid has to keep moving.
- The Crown Endures is 6:00 normal, 5:00 heroic, and pauses during the
  transition.
- Nythraxis has 160,000 health on normal and 230,000 on heroic (boss only; the
  adds and the Bone Spikes keep the shared arena multipliers).
- Every redo mechanic now has a heroic step: Bone Storm whirls for 20% and
  recurs every 40 s, Dread Curse hits for 30%, the Bound window is 8 s, phase 3
  tightens eruptions to 8 s and Gravefire to 6 s, and the enrage ramps every
  20 s. Gravebreaker (pre-existing) is the one flat number left.

## 13. First playtest adjustments (2026-09-04)

- Dread Curse lands every 12 s and its stacks last 20 s (was 10 s and 30 s):
  the tank swapped out at two stacks is clean 4 s before the swap comes back,
  so a taunt never lands on live stacks.
- Bone Spikes and fire never overlap. A spike never picks a raider standing in
  Grave Flame, Soulfire, or a burning Gravefire yard; a due spike cast holds
  while an eruption is telegraphing and for 3 s after it lands; a due eruption
  holds for 3 s after a spike wave; and eruption circles never target a raider
  within 6 yd of an impaled one, so no circle reaches a pinned body. Bone
  Spike recurs every 24 s (heroic 20 s).
- Deathless Rage and the impaled: no spike lands in the 8 s before a Rage is
  due, the Rage cast shatters every live spike as it begins, and an impaled
  raider already within reach of a wardstone may start and hold its channel
  (the Impale is the one control effect the channel ignores).
- Soul Rend marks are visible: a floor ring at the exact 5 yd stack range and a
  sigil over the head, red while the raider stands alone and green once another
  mark is inside the ring.
- Nythraxis's swing is 70% of its pre-redo value (Gravebreaker's splash scales
  with it), and his health is 120,000 on normal and 192,000 on heroic.
