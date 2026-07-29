# Rift Ranks vs the v0.30 Dungeon Ladder: Recalibration and Monte Carlo Analysis

Date: 2026-07-26. Harness: `scripts/rift_montecarlo.ts` (`npm run sim:rift`), a
rift port of the `scripts/healing_montecarlo.ts` and
`scripts/sanctum_fresh_montecarlo.ts` methodology. Every number comes from the
real deterministic `Sim`, inside a REAL rift instance walked down to its boss
floor, one fresh seeded world per run, 6 seeds per cell. Raw data:
`tmp/rift_mc/report.json`. Floors are pinned by
`tests/rift_difficulty_floors.test.ts`.

Units, throughout: **minimum non-crit swing, post-mitigation, on the reference
prot warrior** (level 20, 2861 armor, Defensive Stance, so ~39.8% of a level-22
raw swing passes and ~40.6% of a level-23 one), plus max HP. That is exactly
what `tests/heroic_difficulty_floors.test.ts` pins for dungeons, so rift and
dungeon numbers are directly comparable.

## The problem

Rift ranks were calibrated on 2026-07-22 (#2260) and never moved. The ladder
they were calibrated against moved three times in the four days after:

- **2026-07-23, #2315** retuned every heroic five-man: health doubled, damage
  multipliers to 15.5-20, with stated post-mitigation swing floors (heroic
  spawn-list mobs >= 500, boss-summoned adds >= 150 after the v0.30 40% add
  nerf, heroic Nythraxis 1000).
- **2026-07-25, #2358** doubled crit and haste rating cost (10 to 20 rating per
  1%), halving effective crit and haste from gear. Player DPS is therefore
  LOWER than when the old rift HP pools were set.
- **#2378** made normal Sanctum clearable for fresh 20s and nerfed heroic boss
  adds 40%; **#2396** made ground AoE scale with talent and augment modifiers.

The result was an inversion, at every rank: **rift mobs carried MORE health than
heroic five-man mobs while hitting for about a quarter as much.** Long,
unthreatening fights.

Measured before the retune, against the dungeon reference lines:

| Mob | Swing | HP | Reference |
|---|---|---|---|
| S-rank rift boss | 168-190 | 22,494-27,140 | heroic Korzul 708 / 13,138 |
| A-rank rift boss | 64-72 | 8,294-10,007 | heroic Korzul 708 / 13,138 |
| C-rank rift boss | 40-45 | 4,365-5,267 | normal Korzul 280 / 6,127 |
| S-rank rift trash | 114-140 | 4,807-6,808 | heroic trash floor 500 |
| B-rank rift trash | 36-44 | 1,383-1,960 | heroic trash floor 500 |

An S-rank rift boss hit for 26% of a heroic five-man boss while carrying 195% of
its health. The code comment in `src/sim/rift/ranks.ts` still claimed the
multipliers "stay below the heroic five-man ladder (damage x4-5)"; that ladder
had become 15.5-20.

## The decided target ladder

Maintainer, 2026-07-26. Direction, not hypotheses:

| Rank | Damage | Final boss min HP | Audience benched |
|---|---|---|---|
| C | tuned as NORMAL Gravewyrm Sanctum is tuned | ~6,100 | freshly-capped level-20 group, quest greens and blues |
| B | heroic five-man line, 1.0x | 20,000 | best-in-slot |
| A | 1.2x heroic | 40,000 | best-in-slot |
| S | 1.33x heroic | 60,000 | best-in-slot |

Damage, ability/mechanic damage and boss-summoned adds all follow the HEROIC
model at B/A/S; C follows the NORMAL Sanctum model. Rank remains the only
difficulty axis (no party-size scaling), mob levels stay capped at 22 (23 at S),
and rifts stay group content at every rank including C.

The audience statement is new: rifts had none. Because rank is the only
difficulty axis, the GROUP is held constant across B/A/S and only the rank
varies; C is benched against the fresh-capped audience the normal Sanctum model
it copies was priced for.

## Method: targets are the input, multipliers are the output

Following the house method (`docs/healing-monte-carlo-analysis.md`): state the
target per mob class as a floor in reference-warrior units, solve the multiplier
at the WEAKEST template of that class so the whole roster clears it, then pin
the resulting absolute floor in a test. Never transplant another dungeon's
multipliers: rift base templates are heavier than Sanctum's (a rift boss is
~4,982 hp at level 22 against Korzul's ~3,064 base), so copying normal Sanctum's
uniform `healthMultiplier: 2.0` would put a C boss at ~9,964, over half way to B
and flattening the bottom of the ladder.

### Finding 1: the trash spread is 1.22x, not 2x, so one multiplier per class is enough

An earlier review concluded that a single per-rank damage multiplier could not
hold a trash floor, because rift trash base swings spread about 2x, leaving the
weakest trash at ~51% of target at every rank.

That measurement counted `rift_bonewalker`, which is a boss-SUMMONED add
template (non-elite, roughly half a trash template's base weapon damage), not a
spawn-list mob. Across the real spawn-list roster (`RIFT_TRASH_IDS`, 17
templates) the spread at level 22 is **27 to 32** post-mitigation, a 1.22x band.
Solving at the weakest lands the entire roster inside a 22% band above the
floor, which is exactly the shape heroic dungeons already use ("solving the 500
floor at each dungeon's weakest spawn-list mob").

So no per-mob damage table is needed, and no base template stats were changed.

### Finding 2: the real gap is HEALTH, and it is between mob classes

One health multiplier per rank cannot serve the boss target and the trash target
at the same time:

| Rank | Boss pool needs | Trash pool wants | Same multiplier on trash would give |
|---|---|---|---|
| C | 1.4x (6,112) | 2.4x (2,214, normal Sanctum's own trash line) | inverted: 1.4x leaves trash at 1,291 |
| B | 4.6x (20,081) | 4.6x (4,243, the heroic trash band) | coincide |
| A | 9.17x (40,031) | 5.5x (5,073) | 8,448-11,967 each, 572k per rift |
| S | 13.34x (60,014) | 6.1x (5,865) | 12,825-18,164 each, 868k per rift |

An average rift is 4.7 floors and 56 mobs, so at S a uniform multiplier would
put roughly **868,000 HP of trash** in front of the boss: about 16 minutes of
uninterrupted five-man DPS before anyone reached it. At C the conflict runs the
other way (rift trash is LIGHTER than Sanctum trash while rift bosses are
HEAVIER than Korzul), so C's two health multipliers invert.

At C the same conflict also lands on damage: trash needs 3.7x for the 100 line
while the boss needs 7.05x for the 280 line. That is precisely why
`NORMAL_DUNGEON_TUNING` is per-mob in the dungeon seam.

**Decision: split health and damage by MOB CLASS** (spawn-list trash / boss /
boss-summoned add), one level coarser than the dungeon tables' per-mob maps.
Six knobs per rank, 24 literals total, versus roughly 108 for a per-mob table
covering a 1.22x spread that one multiplier already handles.

### Finding 3: a boss riding the trash multiplier lands at exactly 1.48x the trash floor

Measured at every rank, which means the heroic-dungeon model ("bosses ride the
dungeon-wide multiplier and land their natural premium above trash") would put
rift bosses at 740 / 887 / 982 against targets of 708 / 850 / 942, a consistent
+4.3% overshoot. Since the class split exists anyway for health, the boss damage
multiplier is solved at its own target instead and lands exactly on it. This is
why `bossDamageMultiplier` sits slightly BELOW `damageMultiplier` at B/A/S: rift
boss templates carry a heavier base line relative to rift trash than dungeon
bosses do relative to dungeon trash. The multipliers are outputs.

### Finding 4: a summoned-add template could reach a spawn list, and did

Found while benching. `applyRiftUpgrade` (`src/sim/rift/upgrade.ts`) substitutes
each floor's roster from the upgrade manifest, filtering only `!RIFT_MOBS[id].boss`.
The shared summoned-add templates are non-boss AND appear in the `bone`, `void`
and `infernal_citadel` theme rosters in `monster_index.ts`, so the heuristic
manifest that EVERY natural rift portal carries was seeding them as spawn-list
trash. Observed live in the sim: an S-rank bone-theme boss floor fielded two
`rift_bonewalker` where the generator had placed `rift_marrow_troll`.

As spawn-list trash on the trash multiplier they land at:

| Template | S-rank swing on the trash multiplier | S trash floor |
|---|---|---|
| `rift_bonewalker` | 386 | 665 |
| `rift_spawnling` | 362 | 665 |

That is 54-58% of the floor: the exact symptom the earlier review attributed to
the base roster. They also carry no loot table at all (`loot: []`), so a pack of
them pays nothing, and the procedural generator itself never places one (0
occurrences across 400 seeds x 4 ranks).

**Fix:** `applyRiftUpgrade` now filters substitutions to `RIFT_TRASH_IDS`
(spawn-list grade) rather than "not a boss". A manifest naming only adds leaves
the generated roster in place, which is the safe fallback. Manifests can arrive
from an optional server-side AI service, so this is a trust boundary, not a
tidy-up. Pinned end to end in `tests/rift_difficulty_floors.test.ts`, which
walks the real generated floors WITH the heuristic manifest applied.

### Finding 5: a per-swing floor is not DPS-equivalent across a 1.9-2.8s speed spread

Every difficulty floor in this repo is stated per SWING, which is the right unit
for "can a heal land between hits" but not for sustained pressure. Heroic
dungeons get away with it because their bosses cluster near 2.6s. Rift boss
attack speeds span **1.9s (Broodmother Vysska) to 2.8s (Warlord Grask)**, so the
same per-swing floor produces a 47% DPS spread. Analytic melee DPS on the
reference warrior (mean swing / attack speed, 12% avoidance):

| Boss | Speed | C | B | A | S |
|---|---|---|---|---|---|
| Broodmother Vysska (venom) | 1.9 | 166 | 421 | 505 | 560 |
| Archon Nyxaris (arcane) | 2.0 | 158 | 400 | 480 | 532 |
| Bonelord Xarreth (necro) | 2.2 | 144 | 364 | 436 | 483 |
| Tempest Vharok (storm) | 2.3 | 143 | 361 | 433 | 480 |
| Abyssal Maw (tide) | 2.4 | 132 | 333 | 400 | 443 |
| Hoarfrost Warden (frost) | 2.5 | 126 | 320 | 384 | 425 |
| Emberforge Tyrant (ember) | 2.6 | 126 | 319 | 383 | 424 |
| Azgorath (pit lord) | 2.7 | 129 | 326 | 391 | 433 |
| Warlord Grask (brute) | 2.8 | 127 | 321 | 386 | 428 |
| **heroic Korzul (reference)** | **2.6** | | **307** | | |
| **normal Korzul (reference)** | **2.6** | **121** | | | |

Read against the reference rows: the slow half of the roster lands almost
exactly on its target (B 319-326 against Korzul's 307; C 126-132 against normal
Korzul's 121), and the fast half runs 30-37% hotter. That is a property of the
per-swing unit, not of these multipliers, and it reads in play as boss identity
(the Broodmother hits fast and light, the Warlord slow and hard). It is recorded
here because it is the reason the benched DTPS sits above the heroic band while
the floors sit exactly on it. Normalizing it would need a per-boss damage table
(rejected, see finding 2) or base attack-speed edits (a content change beyond
this retune).

## The shipped tuning

`src/sim/rift/ranks.ts`. C lives in a new sibling `RIFT_NORMAL_TUNING`, not as a
C entry in `RIFT_HEROIC_TUNING`, because `riftHeroicTuningFor(baseLevel) === null`
is overloaded as the "is C rank" predicate and gates two other behaviors: the
2-floor authored Infernal Citadel is C-only content (`isSetPieceRift`), and C
boulders chip instead of executing (`tickRiftRollers`). A C entry would have
closed the citadel forever and made C boulders lethal, and no test would have
caught either.

| Rank | trash hp | trash dmg | boss hp | boss dmg | add dmg | armor | move floor |
|---|---|---|---|---|---|---|---|
| C | 2.4 | 3.7 | 1.4 | 7.05 | 3.4 | 1.0 | none |
| B | 4.6 | 18.6 | 4.6 | 17.85 | 10.3 | 1.12 | 8 |
| A | 5.5 | 22.3 | 9.17 | 21.4 | 12.3 | 1.25 | 8 |
| S | 6.1 | 23.3 | 13.34 | 22.4 | 12.85 | 1.4 | 8 |

C keeps each template's own move speed: the anti-kite floor of 8 (player run
speed is 7) is a heroic property, and C is a normal dungeon.

## Before and after, in absolute numbers

Post-mitigation minimum non-crit swing on the reference warrior, and max HP.
Ranges span the whole roster of that mob class.

| Rank | Trash swing | Trash hp | Boss swing | Boss hp | Add swing |
|---|---|---|---|---|---|
| C before | 27-32 | 922-1,306 | 40-45 | 4,365-5,267 | 14-15 |
| **C after** | **100-122** | **2,214-3,135** | **280-315** | **6,112-7,374** | **50-53** |
| B before | 36-44 | 1,383-1,960 | 54-60 | 6,548-7,900 | 16-17 |
| **B after** | **500-610** | **4,243-6,009** | **709-798** | **20,081-24,228** | **150-161** |
| A before | 43-52 | 1,752-2,482 | 64-72 | 8,294-10,007 | 18-20 |
| **A after** | **600-732** | **5,073-7,185** | **851-958** | **40,031-48,298** | **180-192** |
| S before | 114-140 | 4,807-6,808 | 168-190 | 22,494-27,140 | 47-50 |
| **S after** | **666-811** | **5,865-8,306** | **943-1,062** | **60,014-72,410** | **200-213** |

Reference lines: heroic Korzul 708 swing / 13,138 hp; normal Korzul 280 / 6,127;
heroic spawn-list trash floor 500 at 4,108-6,219 hp; heroic summoned-add floor
150; normal Sanctum trash 103-112 at 2,199-2,410; normal Sanctum adds 50.

Time to kill, at the modeled five-man group DPS (fresh-capped 320, best-in-slot
900; four damage dealers plus the tank's own real swings):

| Rank | Boss TTK before | Boss TTK after | Trash TTK before | Trash TTK after | 56-mob trash pool before | after |
|---|---|---|---|---|---|---|
| C | 14s | 19s | 3.5s | 8.3s | 62k | 150k |
| B | 7s | 22s | 1.9s | 5.7s | 94k | 287k |
| A | 9s | 44s | 2.4s | 6.8s | 118k | 343k |
| S | 25s | 67s | 6.4s | 7.9s | 325k | 396k |

Note S: its trash pool barely moves (325k to 396k, +22%) because the old uniform
5.0x was already inflating trash to pay for the boss. The class split is what
lets S's boss triple while its trash grind stays flat.

## The dungeon reference, measured on the same code the same day

So that "B is heroic" and "C is normal Sanctum" are claims about measurements
rather than about multipliers, both reference harnesses were re-run against this
tree. These are the lines rift ranks are being compared to.

`npx tsx scripts/healing_montecarlo.ts --quick --runs 3`, bench B, immortal-probe
best-in-slot prot warrior:

| Heroic dungeon encounter | Tank DTPS (p10, p90) | Max hit |
|---|---|---|
| Crypt trash, 3x Shambler | 630 (572, 742) | 784 |
| Morthen (Crypt boss) | 261 (231, 328) | 965 |
| Vael (Bastion boss) | 285 (223, 305) | 880 |
| Ysolei (Temple boss) | 259 (176, 272) | 916 |
| Sanctum trash 3-pull | 732 (721, 750) | 824 |
| Korgath (Sanctum mid-boss) | 275 (234, 324) | 1,055 |
| **Korzul (Sanctum final boss)** | **226 (191, 289)** | **1,078** |
| Nythraxis heroic (melee only) | 324 (274, 416) | 1,547 |

So the heroic five-man **boss band is 226-285 DTPS** and the **trash 3-pull band
is 630-732 DTPS**.

`npx tsx scripts/sanctum_fresh_montecarlo.ts --quick --runs 3`, bench A, fresh
prot warrior (1,902 hp / 1,378 armor), which is the line C copies:

| Normal Sanctum encounter | Hit p50 (% of pool) | Tank DTPS |
|---|---|---|
| Trash, 2 boneguard + 1 drakonid | 189 (9.9%) | 199 |
| Korgath (mid-boss) | 515 (27.1%) | 219 |
| **Korzul (final boss)** | **454 (23.9%)** | **156** |

And its own solo line: a best-in-slot warrior takes 105-124 DTPS from normal
Sanctum encounters against a ~140 hps self-heal ceiling, so **normal Sanctum is
already out-sustainable solo**, which is the accepted #2378 trade ("clear time,
not lethality, now carries the anti-solo economics").

## Bench A: damage intake (immortal probe, 6 seeds x 60s per cell)

Same six rift seeds at every rank, so the boss roster is held constant and only
the rank varies (the cells span Warlord Grask, Abyssal Maw, Hoarfrost Warden,
Bonelord Xarreth and Broodmother Vysska). C is probed on the fresh-capped tank
(1,902 hp), B/A/S on the best-in-slot tank (3,222 hp buffed).

| Rank | Shape | Hit p50 (% of pool) | Max hit (% of pool) | DTPS p50 | Melee-only DTPS | Avoided |
|---|---|---|---|---|---|---|
| C | boss | 461 (24.2%) | 706 (37.1%) | 202 | 187 | 12.8% |
| C | trash pack | 185 (9.7%) | 266 (14.0%) | 213 | 206 | 16.9% |
| B | boss | 831 (25.8%) | 1,216 (37.7%) | 317 | 307 | 17.4% |
| B | trash pack | 662 (20.5%) | 944 (29.3%) | 697 | 662 | 24.0% |
| A | boss | 1,046 (32.5%) | 1,580 (49.0%) | 406 | 390 | 17.4% |
| A | trash pack | 793 (24.6%) | 1,132 (35.1%) | 836 | 794 | 24.0% |
| S | boss | 1,164 (36.1%) | 1,872 (58.1%) | 484 | 430 | 18.6% |
| S | trash pack | 887 (27.5%) | 1,263 (39.2%) | 841 | 869 | 25.1% |

Read against the reference lines measured above:

- **C lands on normal Sanctum, precisely.** C boss 461 per hit / 24.2% of a
  fresh pool against Korzul normal's 454 / 23.9%; C trash 185 / 9.7% against
  Sanctum trash's 189 / 9.9%; C boss 202 DTPS inside Sanctum's 156-219 boss
  band, C trash 213 against Sanctum trash's 199. This is the decided target hit
  on the nose.
- **B trash lands on heroic, precisely.** 697 DTPS against the heroic five-man
  trash band of 630-732.
- **B's boss runs above the heroic boss band.** 317 DTPS against 226-285, which
  is 11% to 40% hot even though its per-swing floor is exactly on the line (709
  against Korzul's 708). Finding 5 is why: the boss roster averages faster
  attack speeds than Korzul's 2.6s, and 2 live mechanics ride on top at B. The
  swing floor was the decided spec and is met exactly; the DTPS overshoot is a
  derived consequence.
- The ladder above B is monotonic and roughly on target: melee-only DTPS runs
  307 / 390 / 430 for B / A / S, so A is 1.27x B and S is 1.40x B against
  decided damage targets of 1.2x and 1.33x (the extra comes from S's level-23
  pin).
- Max hits never reach the pool: 37.7% at B, 49.0% at A, 58.1% at S. Two
  back-to-back max rolls threaten at S, which is the intended shape, and tanks
  have been crit-immune since v0.29.1 so nothing spikes past the 1.25x roll cap.

## Bench B: tank plus healer survival (6 seeds, 300s cap)

Real HP and mana, real boss, the modeled group-DPS drain doing the killing, and
both members playing the death-zone telegraph. A tank death ends the run.

| Rank | Healer | Killed | Deaths | First death p50 | Kill p50 | Healer coverage p50 | Deaths from pressure / zone |
|---|---|---|---|---|---|---|---|
| C | holy priest | 33.3% | 4/6 | 23.0s | 23.0s | 67.1% | 4 / 0 |
| C | resto shaman | 33.3% | 4/6 | 17.3s | 27.1s | 53.4% | 4 / 0 |
| B | holy priest | 16.7% | 5/6 | 19.6s | 26.9s | 48.1% | 5 / 0 |
| B | resto shaman | 0% | 6/6 | 19.6s | n/a | 39.5% | 6 / 0 |
| A | holy priest | 0% | 6/6 | 25.5s | n/a | 60.6% | 4 / 2 |
| A | resto shaman | 0% | 6/6 | 15.4s | n/a | 35.5% | 6 / 0 |
| S | holy priest | 0% | 6/6 | 18.1s | n/a | 49.9% | 5 / 1 |
| S | resto shaman | 0% | 6/6 | 9.8s | n/a | 35.6% | 6 / 0 |

Three things this says, and one thing it does not:

1. **Nothing kills before a heal can land.** The earliest first death anywhere
   on the ladder is 9.8s (S rank, resto shaman), against a 2.5s cast. The
   Gravebreaker failure mode (dead at t=1.5s, before any heal resolves) does not
   exist here at any rank. Healer time-to-OOM never bound either: 0 of 48 runs
   went OOM, because the tank dies first.
2. **Deaths are sustained pressure, not missed telegraphs.** 45 of 48 deaths
   were classed as pressure; only 3 were a death zone the bench failed to clear.
   The recalibration moved the auto-swing line, and that is what is killing.
3. **Healer coverage is the binding constraint**: 35-67% of incoming, against
   the 55-78% the healing analysis measured for heroic five-man bosses. At B the
   shaman covers 39.5% of 317 DTPS, so the tank loses ~192 hp/s against a 3,222
   pool: dead at ~19.6s, while the kill needs ~22s.
4. **What it does NOT say: that these ranks are unclearable.** The bench tank
   casts nothing but its stance and auto-attacks, and the healer is an autopilot
   priority list. No defensive cooldowns, no potions, no crowd control, no
   second healer, no tank swap. This is the same worst-case model the first v0.30
   normal-Sanctum calibration used, and #2378 records that priced-to-that-model
   content came out soft in real play. Treat these as a warning flag on B and
   above, not as proof.

## Bench C: clear time, and the anti-solo line

Whole-rift walks, floor by floor, with the modeled group drain killing and the
real tank tanking. Every benched seed rolled a 6-floor rift of 74 mobs, so these
are near the top of the 3-to-6 floor range (a p50 rift is 4.7 floors, 56 mobs,
roughly 75% of these times).

| Rank | Clear p50 | Trash phase | Boss phase | Group DPS modeled |
|---|---|---|---|---|
| C | 615.9s (10.3 min) | 593.4s | 19.8s | 320 (fresh-capped) |
| B | 444.1s (7.4 min) | 418.7s | 23.1s | 900 (best-in-slot) |
| A | 544.7s (9.1 min) | 496.7s | 46.0s | 900 |
| S | 652.3s (10.9 min) | 578.8s | 68.9s | 900 |

Clear time is 94-97% trash at every rank, which is the lever fallback 3 targets.
B is the FASTEST rank to clear despite being far harder than C, because
best-in-slot DPS outruns the health increase.

The anti-solo line, a best-in-slot warrior's intake against the ~140 hps
self-heal ceiling of the strongest solo archetype:

| Rank | Solo boss DTPS (p10) | Solo trash-pack DTPS (p10) | Verdict |
|---|---|---|---|
| C | 129 (115) | 131 (125) | out-sustainable, so clear time carries it |
| B | 317 (290) | 697 (605) | solo dies |
| A | 406 (355) | 836 (726) | solo dies |
| S | 484 (417) | 841 (808) | solo dies |

C sits exactly where the content it copies already sits (normal Sanctum reads
105-124 DTPS solo, also out-sustainable), so a best-in-slot player grinding out
a C rift alone faces the 10-minute clear rather than a wall of lethality. That
is the accepted #2378 trade, and it satisfies the constraint that a pro soloing
a low rank is an outlier rather than a design target. B and above are lethal by
a factor of 2 to 6.

## Decision ledger

| Question | Decision | Why |
|---|---|---|
| The C to B cliff (x5.0 trash damage, x2.5 boss damage in one rung, against +20% and +11% for B to A and A to S) | Ship as decided | It is the same cliff normal-to-heroic already has in dungeons (normal Sanctum trash 103 to heroic 500, boss 280 to 708), so it is a shape players know. B/A/S then separate on boss pool (17s/44s/67s of sustained pressure) and mechanic budget (2/3/4), not on swing size. |
| How to shape the tuning table | Split by mob class, six knobs per rank | Hits all four decided targets exactly with 24 literals; a per-mob table would need ~108 to cover a 1.22x spread one multiplier already handles; lifting base stats solves neither the health split nor the add-in-spawn-list hole. |
| Audience per rank | C fresh-capped, B/A/S best-in-slot | Rank is the only difficulty axis, so the group must be the constant inside B/A/S. C copies the normal Sanctum model, so it is benched against the audience that model was priced for. |
| C's trash health | Raised to normal Sanctum's line (2.4x, 2,214+) | C trash was under half of Sanctum trash. Raising damage 3.7x without health would make C trash glass cannons, which is not "tuned as normal Sanctum is tuned". |
| C's boss health multiplier | 1.4x, not the ~1.2x an earlier draft derived | The target is a FLOOR, so it is solved at the WEAKEST boss template (4,365 base) rather than the pit lord (4,982). Heavier bosses land up to 7,374. |
| Whether rift mechanic damage needs a decoupling override (normal Sanctum's `mechanicDamageMultiplierByMob`) | No | Rift lethal mechanics (death zones, boulder, S lava) are guaranteed kills by design and are not damage-scaled at all, and non-dodgeable ones already pass `capRiftNonLethalMechanicDamage` (capped below the target's max HP). The dungeon override exists to make an avoidable mechanic lethal while melee stays priced; rifts already have that property structurally. |
| Anti-solo lever: lethality or clear time | Lethality at B/A/S, CLEAR TIME at C | Measured, not assumed. At B/A/S a best-in-slot warrior takes 260-503 DTPS from a boss and 697-907 from a trash pack, far past the ~140 hps solo self-heal ceiling: a lone player dies. At C the boss reads 129 and a trash pack 131, both just under the ceiling, so C is out-sustainable in isolation and its barrier is the 10-minute clear at group DPS. That is the same place normal Sanctum already sits (105-124 DTPS solo, also out-sustainable), which is the content C is defined to copy, and it is the accepted #2378 trade rather than a new hole. |
| The mechanic budget, zone tempo, boulder and lava gates | Untouched | Constraint: do not make dodgeable mechanics deadlier and do not weaken `capRiftNonLethalMechanicDamage`. The gap being closed is sustained tank-and-healer pressure, which lives in the auto-swing line. |

## Pre-measured fallback options, if PBE says otherwise

Each of these is a single-literal change in `RIFT_HEROIC_TUNING` or
`RIFT_NORMAL_TUNING`, with the resulting floors already derived. The floors test
pins the current values, so each fallback is a test edit plus a tuning edit.

1. **The most likely first move: B's boss cannot be out-healed inside its own
   kill window.** The bench dies at 19.6s against a 22s kill. The cheapest fix
   that keeps the decided per-swing line untouched is to shorten the fight:
   drop `B.bossHealthMultiplier` 4.6 to 3.7 (boss pool 20,081-24,228 to
   16,151-19,488, kill ~18s at 900 group DPS, inside the 19.6s death time). Its
   trash health stays on 4.6 and nothing else moves. A larger version, to full
   heroic Korzul parity, is 4.6 to 3.0 (pool 13,095-15,801, ~15s); that was
   offered as a pre-emptive softening and declined, so 3.7 is the smaller step
   that the bench actually justifies. Applying the same shape upward keeps the
   ladder proportional: A 9.17 to 7.4 (32,300-38,970) and S 13.34 to 10.7
   (48,140-58,090).
2. **The alternative: cut boss DAMAGE instead of pool.** `B.bossDamageMultiplier`
   17.85 to 15.0 lands the boss at 596-671 per swing and roughly 266 DTPS,
   inside the heroic 226-285 band, at the cost of breaking the decided 708
   floor. Scaled up: A 21.4 to 18.0, S 22.4 to 18.9. Prefer option 1 unless the
   intent changes from "B swings like heroic" to "B pressures like heroic".
3. **Clear times are too long.** Drop each rank's `healthMultiplier` (trash
   only) by 20%: C 2.4 to 1.92, B 4.6 to 3.68, A 5.5 to 4.4, S 6.1 to 4.88.
   Clear time is 94-97% trash at every rank, so this takes roughly 20% straight
   off it (B 7.4 to ~6.0 min, S 10.9 to ~8.8 min) without touching any boss or
   any swing floor. Note it breaks the C trash health floor of 2,199, so C
   should stay at 2.4 if the normal-Sanctum equivalence matters more than C's
   clear time.
4. **C is too hot for a fresh group.** The bench kills it only 33% of runs, but
   it reads within a few percent of normal Sanctum on every intake number, so
   the likelier reading is that the worst-case bench model is pessimistic for
   both. If C does need softening, drop `C.bossDamageMultiplier` 7.05 to 6.0
   (boss swing 280-315 to 238-268) and `C.damageMultiplier` 3.7 to 3.2 (trash
   100-122 to 86-105). That puts C BELOW the normal Sanctum line, so it is a
   deliberate departure from "tuned as normal Sanctum is tuned" and should move
   normal Sanctum with it if the two are meant to stay equivalent.
5. **The arcane boss's Mana Shield is an outlier at A/S.** Archon Nyxaris is the
   only rift boss whose `rankMechanics` lists `stoneskin` (index 1, so it is
   live from B up; the frost boss carries the field but does not list it, so it
   stays suppressed at every rank). `stoneskin.amount` (800) rides
   `mechanicHealMult`, which is now the BOSS health multiplier, so at S it
   absorbs 10,672 every 15s for a 6s window. At the modeled 900 group DPS the
   group can only push 5,400 into that window, so 6 of every 15 seconds are
   fully negated: his effective TTK is ~111s against ~67s for the other eight
   bosses. It was already an outlier before this retune (4,000 absorb on a
   22,494 pool, ~35s against ~25s), and it is not a competitive fairness
   problem, because every instance racing one rift event shares the same
   content artifact and therefore the same boss. If it plays badly, stamp
   `mechanicHealMult` from the TRASH health multiplier instead of the boss one
   (a one-line change in `spawnRiftFloor`), taking S's shield to 4,880.

## Rank-by-rank verdict

| Rank | Target | Where it landed | Open risk |
|---|---|---|---|
| C | normal Gravewyrm Sanctum's line | on it, within a few percent on trash and boss, per hit and per second | benched kill rate 33%, but normal Sanctum reads the same on this worst-case model |
| B | the heroic five-man line 1.0x | trash exactly on it (697 DTPS against 630-732); boss swing exactly on it (709 against 708) but 317 DTPS against a 226-285 band | the boss cannot be out-healed inside its own 22s kill window on an autopilot tank plus one healer; fallback 1 is the one-literal answer |
| A | 1.2x heroic | 1.27x B on melee DTPS, boss pool 40,031-48,298, 46s boss phase | inherits B's risk, scaled |
| S | 1.33x heroic | 1.40x B on melee DTPS, boss pool 60,014-72,410, 69s boss phase | inherits B's risk, scaled; the arcane boss's absorb is a separate outlier (fallback 5) |

Everything the recalibration was for is fixed: rift mobs no longer carry more
health than heroic five-man mobs while hitting for a quarter as much. The
inversion is gone at every rank, the floors are pinned so the next ladder move
breaks a test, and the one remaining question is whether B and above are now a
step too hot rather than a step too cold, which is a PBE question with
pre-measured answers rather than an unknown.

## Caveats

- The harness plays perfectly (threat pinned, no movement mistakes, focus fire),
  so it reads roughly **20-25% above live parses**, the same bias the sibling
  harnesses carry (a live 363 DPS report measured 449.9 in-harness).
- Bench B models tank + one real healer + a modeled group-DPS drain, not five
  live actors. It never dodges a telegraphed `bigCast`, so its DTPS includes a
  standing mechanic tax that better play removes; bench A reports melee-only
  DTPS separately so the two are distinguishable.
- Group DPS is modeled as a flat drain (900 best-in-slot, 320 fresh-capped) from
  the healing MC's measured BiS fire mage figure of ~233 DPS per head. Real
  five-mans vary widely; TTK numbers scale inversely with this figure.
- Boss identity varies by seed (the generator picks the theme, and therefore the
  boss, per floor), so a bench cell spans several boss templates. Seeds are held
  constant ACROSS ranks, so rank comparisons are like for like.
- Bench C makes the tank immortal: it measures clear TIME, not survival, which
  bench B owns. A real group that wipes clears slower than these numbers.
- Every benched seed happens to roll a 6-floor, 74-mob rift, the top of the
  3-to-6 floor range. A median rift is 4.7 floors and 56 mobs, so median clear
  times are roughly 75% of the bench C figures.
- Bench A's `dtps` is a p10/p50/p90 summary over runs while `meleeDtps` is a
  mean, so the two are not subtractable per run; they are reported side by side
  to separate the auto-swing line from the mechanic tax, not to be differenced.
- Three harness bugs were found and fixed while building this, all of which
  understated or overstated a rank: an immortal probe that restored HP but not
  the `dead` flag (a death zone silently ended combat and halved A and S melee
  counts), threat pinning that forced `aiState: 'attack'` so a boss never chased
  a dodging tank, and a dodge that stepped out of a zone and immediately walked
  back into it. Any future port of this harness should keep all three.
- The citadel set piece is excluded from the benches (it is C-only authored
  content, so including it would make ranks non-comparable). Its numbers are
  derived, not benched: the pit lord lands 290 swing / 6,762 hp at its level-21
  pit floor, and the miniboss 223 / 3,671 at the level-20 halls.
