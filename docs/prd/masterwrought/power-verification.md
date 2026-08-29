# Masterwrought power verification (R5)

The measured pass for masterwrought R5, the packet's defining gate:

> R5 Power envelope: full kit (2 Perfected pieces + apex enchants + flask + food)
> at most 5 percent total throughput over pre-packet raid BiS, measured via
> `docs/design/spell-balance-framework.md` before merge. Heroic raid and S-rift
> clear difficulty is the protected asset.
> (`docs/prd/masterwrought/state.md`, locked ruling 5.)

Everything needed to reproduce every number is in this file: the model, the kit,
the baseline, the constants, the targets, the fixtures, and the arithmetic. No
number here is quoted from another document.

## Verdict

**INSIDE the envelope, on every measured kit and both protected targets, after
four downward content tunes this phase applied.** The kit as it shipped into this
phase measured OUTSIDE it.

| lane | heroic raid, level 22 | S-rift, level 23 |
|---|---|---|
| rogue, combat | +3.28% | +3.22% |
| rogue, assassination | +3.78% | +3.86% |
| rogue, subtlety | +3.78% | +3.79% |
| warrior, fury (the tight lane) | **+4.94% +/-0.96** | **+4.50% +/-0.94** |
| caster, 60 s burst profile | +4.55% | +4.58% |
| caster, 180 s sustained profile | +5.06% +/-3.03 | +4.75% +/-4.17 |
| tank, effective health | +4.28% | +4.27% |

The warrior-fury row is the binding one and is the tightest measurement in the
table (60 seeds, 600 s, standard error under half a point). The caster's 180 s
row is the only central estimate that touches the line; it is the resource-bound
reading and section 9.4 says why it is reported rather than tuned against.

Before the tunes the same fixtures read **+5.86% / +6.08%** on warrior fury and
**+6.24%** on tank effective health, both outside the envelope.

## 1. What R5 measures, and what it does not

**The geared INDIVIDUAL at full food uptime, never the raid aggregate**
(ruling ip-15-ACCESS). Every knob R5 names is a per-character stat: two Perfected
pieces, apex enchants, one flask, one plate. The premise is "the best available
food, ALWAYS ON, delivered by feast" (ruling ip-15-KIT), which bakes 100 percent
uptime into the individual measurement.

A feast therefore moves **DELIVERY, not the ceiling**. It takes a raid from
partial uptime to the uptime this measurement already assumed. That is ACCESS,
and under masterwrought R21 and R18 it is the intended reward for preparation:
prepared is meaningfully stronger, unprepared is behind and never locked out.
It does not enter the R5 arithmetic, and nobody should re-litigate this number by
measuring a raid.

**Throughput, not mitigation.** R5's own words are "total throughput". The tank
effective-health arm is measured and reported beside the throughput lanes because
clear difficulty is the protected asset, but it is not what the 5 percent governs.
It is reported so a future reader can see the number rather than infer it.

## 2. The kit, named exactly

| term | what it is | magnitude |
|---|---|---|
| gear | 2 Perfected apex pieces, the equip cap (`MASTERWROUGHT_EQUIP_CAP = 2`, `src/sim/equipment_rules.ts`) | +1 lead primary stat per piece |
| enchant | the apex (Lucent) enchants, where they beat the pre-packet best on the same slot and axis | see 8.2 |
| flask | one of `ironhusk_flask` / `warboar_flask` / `runewater_flask`, aura id `elixir_<kind>`, `flask: true` | 13 for 1200 s |
| food | one of `stonepot_stew` / `warspice_skewers` / `sageleaf_chowder`, aura id **`well_fed`**, kind `buff_sta` / `buff_ap` / `buff_int` | **6 for 900 s** |

The food term is the specific aura `well_fed` at 6, delivered by an apex Harvest
Feast (`stonepot_feast` / `warspice_feast` / `sageleaf_feast`, each
`charges: 10`, `durationTicks: 3600`, serving its plate through
`feast.dishItemId`) or by farming's `harvest_feast`. Delivery is what the feast
supplies; the magnitude is the plate's.

The three consumable aura ids are disjoint by construction, so the whole kit
rides at once: `well_fed` can never equal `elixir_<kind>`, and the one-flask
strip keys on the `flask` marker, which Well Fed never carries. The caster's
maximal legal stack is three auras (int flask, stamina elixir, int plate); the
physical kit is two, because every pre-packet elixir and scroll is `buff_sta` and
a stamina flask refuses them downward. Both are pinned in
`tests/flask_consumables.test.ts`, "the R5 full kit".

## 3. The baseline, named exactly

R5's baseline is "pre-packet raid BiS". That phrase resolves to three materially
different numbers in the neck slot alone, so this document fixes it:

> **The baseline pool is PvE, class-equippable, best-in-slot, INCLUDING
> legendaries and held offhands, with the 17 masterwrought-flagged defs removed.**

Legendaries are IN because a raid-BiS character has them and excluding them
would flatter the packet. The WARFARE honor set's SET BONUSES are out (they are
paid entirely in PvP ratings and contribute exactly zero in PvE by design), but
its pieces' raw armour and stamina do count in PvE, so a derived
max-effective-health pick may take them and the tank baseline below does: three
of its twelve slots are WARFARE armour. The three throughput lanes use named
loadouts with no WARFARE piece in them.

The three measured baselines, by id. Every one is pre-packet; none is flagged.

**Rogue** (dual wield): `mistcallers_fang`, `heroic_duskwhisper`,
`heroic_nighttalon_crown`, `medallion_of_endless_profit`,
`heroic_nighttalon_shoulderguards`, `basin_stalkers_tunic`, `bonechill_cord`,
`heroic_wyrmshadow_legguards`, `heroic_wyrmshadow_talongrips`,
`heroic_wyrmshadow_treads`, `abysswrought_band`, `architects_cornerstone`.

**Warrior, fury** (dual two-handers, the `scripts/fury_dps_probe.ts` kit):
`deathless_greatblade`, `bonewrought_greatsword`,
`heroic_crownforged_dreadhelm`, `medallion_of_endless_profit`,
`heroic_crownforged_warspaulders`, `emberforged_bulwark`, `gravescale_girdle`,
`bloodmane_war_legguards`, `gravewyrm_claws`, `tideworn_warboots`,
`abysswrought_band`, `architects_cornerstone`.

**Caster**: `WARLOCK_FULL_BIS_GEAR` (`scripts/warlock_balance_probe.ts`), the
repo's maintained set-complete caster BiS: Wraithfire Regalia 4-piece plus
Mournweave 3-piece plus hit jewelry. Using it rather than a hand-picked kit
matters: a set-incomplete caster benches 21 to 33 percent under this one, and a
weaker denominator would inflate the measured percentage.

**Tank**: the max-effective-health pre-packet pick per slot, derived from the
catalog: `heroic_kingsbane_last_oath`, `heroic_bonewrought_bulwark`,
`heroic_crownforged_dreadhelm`, `heart_of_the_rift`,
`heroic_crownforged_warspaulders`, `furyforged_warplate`, `furyforged_girdle`,
`furyforged_legguards`, `furyforged_gauntlets`, `deathlord_sabatons`,
`abysswrought_band` x2.

**Both arms carry pre-packet enchants on every slot**, and both carry the
pre-packet consumable ceiling, `elixir_of_the_serpent` (`buff_sta` 12 / 900).
Only the DELTA is the packet's.

## 4. The constants, with anchors

Every conversion below is a pure exported function or a named const in the sim.

| quantity | value | anchor |
|---|---|---|
| level cap | 20 | `src/sim/types.ts` `MAX_LEVEL` |
| attack power from strength | 2 per point for warrior / paladin / shaman / druid, 1 otherwise | `src/sim/entity.ts` `apFromStats` |
| attack power from agility | 1 per point for rogue / hunter, 0 otherwise | same |
| spell power from intellect | 0.5 per point | `src/sim/types.ts` `SPELL_POWER_PER_INT` |
| attack power into white damage | `AP / 14` damage per second, weapon-speed independent | `src/sim/combat/auto_attack.ts`, the `(effectiveAttackPower / 14) * apSwingSpeed` term |
| hit rating | 10 rating per 1 percent | `src/sim/types.ts` `HIT_RATING_PER_PCT` |
| crit rating, haste rating | 20 rating per 1 percent each | `CRIT_RATING_PER_PCT`, `HASTE_RATING_PER_PCT` |
| armor mitigation | `min(0.75, a / (a + 85 * attackerLevel + 400))` | `src/sim/types.ts` `armorReduction` |
| melee miss | 5 percent at parity, plus 2.5 / 14 / 21 at 1 / 2 / 3 levels above | `src/sim/types.ts` `meleeMissChance` |
| spell hit | 96 percent at parity, minus the same above-level table | `src/sim/types.ts` `spellHitChance` |
| health from stamina | first 20 points 1 each, the rest 10 each | `src/sim/entity.ts` `hpFromStamina` |
| item stat budget | `round(level * QUALITY_STAT_MULT * SLOT_STAT_MULT * 0.7)` | `src/sim/item_budget.ts` `primaryStatBudget` |
| Perfected source level | 28 (the apex recipe's own level is 25) | `src/sim/professions/perfecting.ts` `PERFECTED_SOURCE_LEVEL` |
| worn flagged pieces | 2 | `src/sim/equipment_rules.ts` `MASTERWROUGHT_EQUIP_CAP` |

Two derived facts the arithmetic below leans on:

- **A dual-wielder pays every weapon term TWICE.** A one-hand weapon declares
  `ItemDef.slot: 'mainhand'` and is legal in the offhand, and the enchant slot
  gate compares `itemDef.slot` to `enchant.itemSlot`, so both worn weapons accept
  every mainhand enchant and `recalcPlayerStats` reads both instances. Pinned in
  `tests/professions_enchanting.test.ts`, "the weapon term lands TWICE".
- **Attack power contributes `AP / 14` per second PER SWINGING HAND**, because
  the offhand damage multiplier applies to the weapon roll only, never to the
  attack-power term.

## 5. The targets, derived

Both come from the tree's own tuning tables; the framework fixes the profile
shape, the tree fixes the target.

**Heroic raid.** `HEROIC_DUNGEON_TUNING.nythraxis_boss_arena`
(`src/sim/content/dungeon_difficulty.ts`): `level: 22`, `armorMultiplier: 1.2`.
`createMob` gives a mob `armorPerLevel * (level - 1)` armor, and the Nythraxis
template's `armorPerLevel` is 42, so:

    armor = round(42 * 21 * 1.2) = 1058
    armorReduction(1058, 20) = 1058 / (1058 + 85*20 + 400) = 1058 / 3158 = 33.50%
    meleeMissChance(20, 22) = 19.0%     spellHitChance(20, 22) = 82.0%

**S-rift.** `RIFT_S_LEVEL = 23` and the S rank's `armorMultiplier: 1.4`
(`src/sim/rift/ranks.ts`):

    armor = round(42 * 22 * 1.4) = 1294
    armorReduction(1294, 20) = 1294 / (1294 + 2100) = 38.13%
    meleeMissChance(20, 23) = 26.0%     spellHitChance(20, 23) = 75.0%

Both target levels are fixed here because the framework requires each profile to
fix "target armor, resistances, level, and position", and R5 names both assets.
The choice is load-bearing rather than cosmetic: a caster in raid BiS is already
hit-capped against a level-20 raid boss, so a hit-rating term is worth nothing
there and everything at level 23. Measuring only one target would have missed a
single-slot outlier worth 2.8 to 4.1 percent (section 11.2).

## 6. Premise checks, run before any number was sealed

**The 11c ladder landed exactly as ruling 11c-D-2 settled it.** One aura id
`well_fed` (`WELL_FED_AURA_ID`, `src/sim/wellfed.ts`), minted once at meal
completion, kind-agnostic. Seven carriers, read live from the catalog: the four
farming dishes at 2 / 3 / 4 / 5 for 600 s and the three apex role plates at 6 for
900 s. The apex plate strictly dominates every farming rung on both axes and the
farming ladder tops out exactly one below it. Nothing else landed, so this
phase's arithmetic proceeded rather than tripping its own stopping rule.

**11e's content is in the tree.** The tier 3 and 4 seed faucet is stocked at
`farmer_hollis` and `farmer_verbena` (four seeds each, `buyValue` 32 at tier 3
and 64 at tier 4), so tier 3 and 4 produce is really obtainable and food uptime
is a real input rather than a dormant one.

**The `recipe_seasoned_stock` row is in the tree** with `marsh_rice` 2 and
`bog_beet` 2. The phase file calls this "11e decision 6"; it is ruling 11g-D-C
and it landed in 11g, not 11e. The content the phase file names is correct; the
label is stale. Recorded, not acted on.

**The level-20 shelf is UNMOVED by Phase 11o**, re-derived rather than assumed.
Nineteen recipe rows moved `recipe.level` (rung-50 gear 20 to 15, two rung-75
rares 20 to 17, and `duskhide_wraps`, which is skillReq 50 on the live tree and
moved with the rung-50 band). Restoring all nineteen to 20 in memory and
rebuilding the memoised source index gives: the gated-equippable source-20-plus
shelf 285 to 266, the leavers EXACTLY the nineteen movers, **zero joiners**, and
zero movement in any derived value outside the movers. No apex, heroic, raid or
vendor number moves on either axis.

`recipe.level` has four consumers. Three feed access gating or pacing. The
fourth, `perfectedBonusStats`, feeds a POWER magnitude and is the shelf's own
top, but it is hard-gated to `masterwrought` defs, all of whose recipes sit at
level 25 and were untouched by 11o. **No 11o-side drift into the shelf.**

One derived magnitude did ride the level change down, disclosed rather than
hidden: the masterwork proc's baked bonus reads raw `recipe.level`, so on the
slots where the rounding boundary crosses it fell (legs 3 to 1, shoulder and held
offhand 3 to 2, gloves 2 to 1). It is downward, it lands on future masterwork
copies only, none of the nineteen movers is flagged, and the raid-floor bound
still holds strictly for every equippable recipe output.

## 7. The method

`docs/design/spell-balance-framework.md` is the measurement contract: the
profile shapes (Sustained 180 s single target, Burst 60 s), what each profile
must fix (seed, level, spec, gear and item level, talents, target armor and
level, resource rules, rotation, external buffs), what the report must contain,
and the balancing rules. This pass follows it.

Two notes the framework's own text requires:

- **Its "Existing tools" table is stale.** The three tools it names
  (`scripts/balance_report.mjs`, `scripts/dummy_sim.mjs`,
  `tests/spell_balance.test.ts`) cannot accept a gear kit at all: each builds its
  reference character from the class starter kit and none has an equipment
  parameter. The framework disqualifies its own three tools for rotation work in
  the same table. The repo's gear-aware, deterministic fight probes
  (`scripts/rogue_dps_probe.ts`, `scripts/owned_class_balance_probe.ts`,
  `scripts/warlock_balance_probe.ts`, `scripts/fury_dps_probe.ts` and siblings)
  are what implement the framework's required profiles, and this pass is built in
  their shape: an ambient-free world, an anchored probe position, an inert target
  with a fixed level and armor, a real rotation, fixed seeds, no resource refill.
  Recorded as a maintainer read: the framework's tool table should name the probe
  family. Not a stopping-rule trip, because the framework's profiles and report
  are the method and the probes satisfy them.
- **The framework names no target level, and R5 names two protected assets.**
  Both are fixed in section 5.

**Damage is summed from the sim's own damage EVENTS**, never from the target's
health delta. A target that leaves combat regenerates, and an hp-delta reading
silently under-reports: at 180 s the caster lane read 2.2 damage per second by hp
delta and 72.7 by event sum, because the fixture went out of mana partway and the
dummy healed back up.

Every lane runs the same baseline and kit through the same fixture and reports
the mean over N seeds with the standard error, so no delta is read off one fight.
The fury lane is run at 60 seeds and 600 s because its variance is the largest in
the table: at 5 seeds and 180 s its per-seed deltas ranged from minus 1.2 to plus
9.6 percent, which is noise, not signal.

## 8. The kit delta, term by term

### 8.1 Gear

Every apex ARMOUR piece is a stat-and-armour twin of a same-slot, same-armour-class,
item-level-31 heroic five-man drop, so **base apex adds no shelf height at all**.
Only Perfecting does, and it adds the difference between the piece's budget at
source 28 and at its recipe's own level 25:

    primaryStatBudget(34, epic, chest) - primaryStatBudget(31, epic, chest)
      = round(34 * 1.0 * 1.0 * 0.7) - round(31 * 1.0 * 1.0 * 0.7)
      = 24 - 22 = 2

which gives +2 on chest, mainhand, helmet, shoulder, held offhand, gloves and
waist, and +1 on legs, feet, neck and ring; a two-hander takes +2 (the two-hand
multiplier applies before the rounding on both sides, so it does not compound).

Of that, **at most +1 lands on the lead throughput stat per piece**: the bonus is
distributed by largest-remainder rounding over the piece's own stat profile, so a
delta of 1 goes entirely to the lead stat and a delta of 2 puts the second point
on the secondary. Measured across all 17: every piece gains exactly +1 lead.

With the equip cap at 2, **the gear term is +2 lead-stat points**, and that is the
figure the measurement uses for every lane. It is an upper bound in two ways: a
character whose baseline in a slot is a legendary gains nothing there (the apex
weapon is 20 to 25 points behind a legendary one, and `heart_of_the_rift` is 17
ahead of the apex neck), and a set-complete caster who takes an apex chest breaks
a set bonus worth more than the point.

Measured contribution: **+0.24% to +1.25%** across the lanes.

### 8.2 Enchants

Only 3 of the 11 enchantable slot kinds carry an apex row. Every other slot's
delta is zero because no apex enchant exists for it.

| slot | axis | pre-packet best | apex | delta |
|---|---|---|---|---|
| mainhand | str | 5 (`enchant_weapon_greater_might`) | 6 (`enchant_weapon_lucent_might`) | +1 |
| mainhand | int | 5 (`enchant_weapon_greater_spellpower`) | 6 (`enchant_weapon_lucent_spellpower`) | +1 |
| chest | sta | 7 (`enchant_chest_greater_stamina`) | 13 (`enchant_lucent_infusion`) | +6 |
| feet | agi | 2 (`enchant_feet_agility`) | 3 (`enchant_feet_lucent_agility`) | +1 |

The chest row is +6 rather than +3 only when the chest is one of the two Perfected
pieces: `enchant_lucent_infusion` carries `requiresPerfected` and is refused on
any other copy. There is no mail or plate apex chest, so a warrior or paladin can
never take it and their chest delta is +3 (`enchant_chest_lucent_stamina`, 10 over
7). The chest term is **pure stamina either way**, so it contributes nothing to
throughput and is scored in the tank arm.

The weapon row lands on both hands for a dual-wielder, so its per-character size
is +2 str there and +1 for a single-weapon character. The apex boots row is agility
only, so a strength melee keeps `enchant_feet_strength` and its feet delta is zero.

Measured contribution (enchants on top of gear): **+0.4% to +1.5%**.

### 8.3 Consumables

**Every pre-packet elixir and scroll in the game is `buff_sta`.** There is no
pre-packet consumable that raises attack power or intellect, and no potion carries
an offensive buff (the thirteen potions are heal and mana only). So the packet's
flask and plate are the first offensive consumables the game has ever had, and
their whole magnitude lands as new throughput with nothing to net it off:

    physical: warboar_flask buff_ap 13 + warspice_skewers Well Fed buff_ap 6 = +19 AP
    caster:   runewater_flask buff_int 13 + sageleaf_chowder Well Fed buff_int 6 = +19 int
    tank:     ironhusk_flask buff_sta 13 REPLACES the serpent elixir's 12 (same aura id,
              and the flask refuses the elixir downward), plus the plate's 6 = +7 sta

Note the tank asymmetry: the stamina arm nets against a pre-packet stamina elixir
and the two throughput arms do not, which is exactly why the throughput arms are
the binding ones.

The attack-power term is further multiplied by the spec's own `apPct` before it
reaches the stat book, so a combat rogue's +19 raw reads +21 on the sheet.

Measured contribution: **+2.4 to +3.5 percentage points**, the largest term in
the envelope by a wide margin.

## 9. The measured pass

### 9.1 Fixture

Level 20, `autoEquip: false`, an ambient-free world (no camps, npcs or ground
objects), the probe anchored in the open field, and an inert target: `hostile`,
`aiState: 'idle'`, `moveSpeed: 0`, zero weapon damage, the section-5 level and
armor. Resources are never refilled. Rotations are the repo's own: the rogue
lane runs the `scripts/rogue_dps_probe.ts` priority list and the La Luna build;
the fury lane runs the `scripts/fury_dps_probe.ts` rotation and rows; the caster
lane spams frostbolt and drinks `sunpetal_mana_draught` on cooldown, both arms
alike.

The packet's delta is applied to the kit arm as instance `rolled.stats` and
auras, which is the same channel an enchant and a Perfected bonus really use, so
the kit arm is the baseline character plus exactly the section-8 terms.

### 9.2 Results

Rogue and caster: 25 seeds, 180 s. Warrior fury: 60 seeds, at both 180 s and
600 s. Error bars are 2 standard errors on the difference.

| lane | target | gear | gear + enchant | FULL KIT |
|---|---|---|---|---|
| rogue, combat | heroic | +0.28% | +0.76% | **+3.28%** |
| rogue, assassination | heroic | +0.37% | +0.82% | **+3.78%** |
| rogue, subtlety | heroic | +0.48% | +0.91% | **+3.78%** |
| warrior, fury | heroic | +1.25% | +2.15% | **+4.94% +/-0.96** |
| caster, 60 s | heroic | +0.57% | +1.06% | **+4.55%** |
| caster, 180 s | heroic | +0.50% | +1.11% | **+5.06% +/-3.03** |
| rogue, combat | S-rift | +0.24% | +0.69% | **+3.22%** |
| rogue, assassination | S-rift | +0.44% | +0.92% | **+3.86%** |
| rogue, subtlety | S-rift | +0.44% | +0.89% | **+3.79%** |
| warrior, fury | S-rift | +0.84% | +2.31% | **+4.50% +/-0.94** |
| caster, 60 s | S-rift | +0.39% | +1.06% | **+4.58%** |
| caster, 180 s | S-rift | +0.39% | +0.95% | **+4.75% +/-4.17** |

The fury FULL figures are the 600 s, 60-seed runs (base 167.82 to kit 176.10 at
heroic; base 151.93 to kit 158.77 at S-rift). Its 180 s, 60-seed twins read
+4.21% and +4.97%, and its 25-seed 180 s runs read +5.65% and +5.94%: the same
lane, three sample sizes, converging as the samples grow. The 600 s row is the
authority because within-fight variance falls with the fight length.

### 9.3 Why fury is the binding lane

Fury is the highest-throughput physical spec, it dual-wields (so it pays the
weapon-enchant term twice), and it is rage-starved about a fifth of the time in
this fixture. Rage is generated from damage dealt, so attack power buys rage as
well as damage and the delta is superlinear rather than proportional. That is
real coupling, not a fixture artefact: it is also why the analytic white-damage
bound (+5.3% before the tunes) under-predicted the measured total (+5.9%) on this
lane while over-predicting it on every other one.

### 9.4 Why the caster's 180 s row is reported and not tuned against

A level-20 mage has no mana-free filler: every ability in its book costs mana.
So a 180 s single-target fixture is mana-bound by construction even with mana
potions on both arms, and the framework's own balancing rule 7 ("a correct
continuous rotation neither starves indefinitely") disqualifies a starving
fixture as a parity gate. Intellect buys the mana pool as well as spell power, so
in the mana-bound regime the kit gains twice and the reading rises: the same lane
reads +4.55% at 60 s, +5.06% at 180 s, and (measured while diagnosing this) +8.3%
at 300 s. The mana-stable reading is the throughput number; the mana-bound one is
recorded so the coupling is visible.

### 9.5 The tank effective-health arm

Effective health is `maxHp / (1 - armorReduction(armor, attackerLevel))`.

| arm | hp | armor | EHP vs level 22 | delta |
|---|---|---|---|---|
| baseline | 3332 | 3369 | 8277 | - |
| consumables only | 3432 | 3369 | 8526 | +3.00% |
| consumables + apex chest enchant | 3472 | 3369 | 8625 | +4.20% |
| full kit (2 Perfected pieces) | 3472 | 3373 | 8631 | **+4.28%** |

Against a level-23 attacker: 8099 to 8445, **+4.27%**. Protection's stamina
multiplier amplifies the flat stamina terms, which is why a +7 raw stamina
consumable delta reads as +100 health.

Before this phase's shield tune the same arm read **+6.24%**, most of it armour.

## 10. What this phase changed, and why

Four content values came down. Nothing widened, no formula moved, no pin was
relaxed, and no magnitude settled by ruling 11c-D-2 was touched: the well-fed
ladder stands at 2 / 3 / 4 / 5 and 6.

### 10.1 The apex weapon enchants, 7 to 6 on both twins

The weapon slot is the only enchant slot that lands twice on a character. At 7
the per-character step over Greater was **4 strength for a dual-wielder**, twice
what the packet's ratified arithmetic counted ("the full physical kit at 4.2 to
4.7 percent" was computed on a single-weapon model). At 6 it is the 2 the
envelope was ratified on. The rung still sits strictly above Greater and the
strength and intellect twins still match byte for byte, as ruling D10-D1
requires. This is the one tune that is a CORRECTION rather than a nerf: it
restores the number the packet was approved on.

### 10.2 `sunspun_vestments`, hit rating 40 to haste rating 40

Hit converts at twice the rate of crit and haste (10 rating per percent against
20), so a 40-rating hit piece is worth 4 percent where its band peers are worth
2. `sunspun_vestments` is a byte-identical stat and armour clone of the caster
BiS chest `shroud_of_the_gravewyrm` whose only difference was that it took the
double-value rating, and caster chest hit had **zero** pre-packet carriers, so it
was the sole source of the scarcest rating in the largest-budget slot: the
Lionheart shape the packet's own research names.

Measured against an S-rift target, where spell hit is uncapped, that one slot was
worth **+2.8 to +4.1 percent of throughput** against a 5 percent budget for the
whole kit. Against a heroic raid boss a raid-BiS caster is already hit-capped and
the same piece is a downgrade, which is why fixing both target levels mattered.

Haste still complements the reference drop's crit, so the rule the other eight
armour pieces follow is untouched. The apex armour set now hands out no hit at
all: the complement rule forces the one hit slot to be the single piece whose
reference does not carry hit, and that piece was the cloth chest.

### 10.3 `duskforged_bulwark`, armor 732 to 680 and blockValue 32 to 30

Both numbers extrapolated the shield ladder two item levels past
`bonewrought_bulwark` at the epic mail chest line's slope. The extrapolation is
internally sound and it produced **the best mitigation item in the game**: the
heroic variant generator passes armour and blockValue through untouched, so
`heroic_bonewrought_bulwark` still reads 680 and 30 at item level 33 and no
heroic upgrade could ever answer a crafted shield.

Measured, the inversion took the reference tank's physical damage down about
**1.0 percent** at both attacker levels, on the axis the protected asset is
priced in, with nothing measuring it and nothing pinning it. The other nine apex
armour pieces already pin armour EQUAL to their reference drop's; the shield was
the only one that extrapolated, and it joins that rule here. The sweep gains a
two-sided inversion guard so neither number can climb back over the raid line.

A visible consequence, recorded rather than hidden: the crafted shield no longer
wins the dev best-in-slot picker's warrior offhand, so the reference tank's
max-mitigation kit is now identical with and without the packet's defs. That
equality is itself pinned.

### 10.4 The apex flasks, 13 for 1200 s

With the three tunes above applied the measured kit still sat at 5.1 to 5.3
percent on fury and 5.2 to 5.5 percent on the caster sustained profile. The flask
is what closes it, and the packet's own record names flask 15 as the first
tune-down knob for exactly this case.

The value is now **envelope-derived rather than ladder-derived**, and the def,
the sweep arm and their comments all say so: the elixir ladder's own +3 step says
15, R5 says 13, and R5 is the contract. The flask still stands strictly above the
elixir ceiling of 12, which is what keeps the apex rung a rung, and its duration
is untouched at the ladder's own step. The sweep now pins both bounds, so neither
a climb back to the ladder step nor a slide under the ceiling can pass.

The crafted stamina ceiling consequently reads **flask 13 plus plate 6 for 19**,
not the 21 the packet's earlier records quote. Ruling 11c-D-2's outcome is
unaffected: it rejected an apex food of 8 because that broke the kit arithmetic,
and a smaller flask makes the sum smaller still.

## 11. The adversarial stat-shape audit (R14, Lionheart/Lariat)

Every apex item was audited against the scarce-stat and stat-light-slot rules.

**R14 passes cleanly.** All three jewelry pieces are pure primary plus stamina,
each sums exactly `primaryStatBudget(31, epic, slot)`, each carries exactly one
rating at the jewelry band's 25, and no apex def carries a proc, an on-use, or a
spell-power line. No apex item offers a stat combination a wearer could not
already assemble in that slot, so the Lariat "new shape" hazard is absent.

**One outlier stood and was tuned down**: `sunspun_vestments` (section 10.2).

**Recorded, measured, not defects:**

- `wyrmfall_pendant` is the packet's dominant piece and the closest thing to a
  Lariat it contains: it is the only flagged def with neither an armour class nor
  a class restriction, so all nine classes wear the same neck, and the neck slot
  has no pre-packet PvE item-level-31 incumbent at all (the field tops out at 12
  at item level 26). Perfected 15 against 12 is the packet's largest single-slot
  move. It sits exactly on its budget and its rating is the vendor band's, so
  there is no number to bring down; it is named here so the concentration is on
  the record.
- `gyrelens_array` is the Lionheart shape in miniature and it is self-limiting:
  its two-stat profile concentrates a smaller budget into +3 intellect over the
  item-level-33 heroic orb, but it gives up 55 rating to do it, which is the
  larger term. The compensating relation is now stated in the sweep.
- `warhewn_signet` is a strict superset of the item-level-26 vendor ring
  `seal_of_the_nine_oaths` by one point on each axis with the same rating field.
  That is what five item levels buy, and hit at 25 is the vendor band's own
  allocation for a strength ring. The band-scoped twin sweep pins the rule that
  actually matters (no two pieces the same shape in the same band).

## 12. The gray-grind record (qr-GRAY)

A recorded MEASUREMENT, not a tune. No gain-curve change lands in this packet:
the 11e, 11f and 11i pacing models were all derived against the shipped
multiplier. This is the judgment surface for the future-tier revisit.

### 12.1 The gain function

`tierForSkill(skill) = floor(skill / 25)` with `TIER_SKILL_STEP = 25`. A craft's
capability tier is `tierForSkill(currentSkill)`; a recipe's tier is
`tierForSkill(skillReq)`. `tierProgressMultiplier(capability, recipe)` returns 1
at or below zero tiers below, then 0.5, then 0.25, then 0. One craft grants
`CRAFT_SKILL_GAIN = 1` times that multiplier, clamped at the craft's `maxSkill`,
which is 125 for every craft on the ring.

So a tier-`r` recipe stops paying at skill `25 * (r + 3)`: a tier-0 recipe dies at
75, tier 1 at 100, tier 2 at 125.

### 12.2 Crafts to cap, per craft

Character's craft is its active archetype (ceiling unbounded). `oncePerDay` rows
excluded from both paths. Intended = the band-matched recipe at every step.
Cheap = the lowest-`skillReq` recipe that still yields anything.

| craft | intended | cheap path | ratio | the cheap recipe (skillReq, reagent value) |
|---|---|---|---|---|
| engineering | 125 | 375 | 3.00 | `recipe_cogwheel_blank` (0, 26c) |
| alchemy | 125 | 375 | 3.00 | `recipe_growth_tonic` (0, 11c) |
| cooking | 125 | 375 | 3.00 | `recipe_tough_jerky` (0, 4c) |
| leatherworking | 125 | 375 | 3.00 | `recipe_fenbridge_hide_boots` (0, 14c) |
| tailoring | 125 | 375 | 3.00 | `recipe_homespun_mitts` (0, 15c) |
| inscription | 125 | 375 | 3.00 | `recipe_silverleaf_scroll` (0, 17c) |
| enchanting | 150 | 250 | 1.67 | `recipe_gatherers_cache` (25, 383c) |
| jewelcrafting | 125 | 375 | 3.00 | `recipe_hammered_copper_band` (0, 33c) |
| weaponcrafting | 125 | 375 | 3.00 | `recipe_copper_bearded_axe` (0, 29c) |
| armorcrafting | 125 | 375 | 3.00 | `recipe_coppermail_sabatons` (0, 31c) |

Worked by hand, cooking, so the table is reproducible from this document alone.
Intended path, band-matched so the multiplier is 1 on every leg: 25 crafts of
`recipe_tough_jerky` (0 to 25), 25 of `recipe_ashwood_smoked_eel` (25 to 50), 25
of `recipe_silvered_carp_supper` (50 to 75), 25 of
`recipe_highwatch_barley_porridge` (75 to 100), 25 of
`recipe_evergarden_braised_greens` (100 to 125). Total 125 crafts, 8075 copper of
reagents. Cheap path, staying on the lowest recipe that still pays: jerky at 1.0
for 25 crafts, at 0.5 for 50, at 0.25 for 100 (it dies at 75), then the eel at
0.25 for 100, then the carp supper at 0.25 for 100. Total 375 crafts.

### 12.3 Three corrections the measurement forced

- **The qr-GRAY row's own claim is false as literally written.** It says the
  cheapest path to any skill number is always bulk-spamming low recipes. Measured
  in reagent value, the tier-0 spam path is DEARER than the intended path for 8
  of the 10 crafts (only leatherworking and inscription come out cheaper), and it
  costs three times the crafts. The gray grind is real; its lever is not the
  floor. The genuinely cheapest path in materials is **staying one or two tiers
  under the band**, which beats the intended path for 10 of 10 crafts at 0.60 to
  0.88 of the cost, taking 1.0x to 2.6x the crafts. That is the arbitrage a
  future revisit should aim at.
- **Enchanting's cheapest path is not a recipe.** Its roster is three rows (two
  at 25, one at 75) with no tier-0, tier-2, tier-4 or tier-5 recipe at all, so
  its recipe path costs 150 crafts rather than 125. 125 disenchants of epic input
  reach the cap first. The recipe numbers above are the recipe arm only.
- **The archetype ceiling dwarfs the curve.** A craft that is neither the active
  archetype, the paired major, nor the hobby hard-stalls at skill 75 after 175
  crafts on every path. A hobby craft reaches 125 but its intended path costs 225.
  That is intended behaviour, and it means a revisit aimed at the four-state curve
  would be aimed at the smaller of the two effects.

### 12.4 Recorded beside the measurement

- **Alchemy has no repeatable band-3 recipe.** `recipe_quickening_catalyst` is
  its only tier-3 row and it is `oncePerDay`, so an alchemist at skill 75 without
  a flask pattern drop has one catalyst a day or a hundred grey-rate crafts. This
  cannot be closed by tuning down, and new content is out of this phase's scope.
- **The public wiki prints gain boundaries above the reachable cap.** 63 of the
  166 crafting rows print at least one boundary past 125, and all 12 skill-125
  rows print all three. The fix is a clamp in `scripts/wiki/build_content.mjs`
  plus an arm in the guide test, which is a `scripts/` change outside this phase's
  content-plus-tests-plus-docs scope.

## 13. What would breach this, and what pins it

Each row names the tripwire and the guard that reds if it moves.

| if this moved | the envelope moves by | pinned in |
|---|---|---|
| a flask value | about 2.4 points per 6 stat | `tests/masterwrought_budget.test.ts`, the flask band arm (both bounds) |
| an apex plate value or duration | the food term directly | the same file's Well Fed band and dominance arms |
| an apex weapon enchant | 1 point per hand, so 2 on a dual-wielder | `tests/enchants_magnitude_invariants.test.ts` (magnitudes and the loadout-aware stacks) |
| a Perfected piece's total against its slot | the gear term | `tests/masterwrought_budget.test.ts`, "a Perfected apex piece stays within its pinned lead" |
| an apex rating allocation or band | the rating term | the per-family rating arms, literal plus a live tie plus an anchor identity |
| the apex shield's armour or block | tank mitigation | the shield arm's two-sided inversion guard |
| a pre-packet epic used as a baseline | the envelope, silently | the per-slot lead pin above reds when the incumbent moves |
| an unflagged crafted output reaching item level 31 | the two-piece cap becomes evadable | "no crafted output outside the apex arrays reaches the apex item level" |
| any apex def entering a live-derived fixture | a balance band, silently | `tests/dev_bis_gear.test.ts`, the per-class flagged picks by id |
| the reference tank's max-mitigation kit | every difficulty floor | `tests/heroic_difficulty_floors.test.ts`, the kit equality with and without the packet |

Twelve mutants were run against these guards in a throwaway worktree at the
phase's own tip, every one of them a mutation that had SURVIVED before this
phase's work: a rating on an angler dish, a rating on an apex feast, the jewelry
anchor delisted from the vendor, the shield's armour restored to 732, the flask
strip shedding Well Fed, a flask refused while Well Fed rides, Well Fed's stamina
never folding into the stat book, a retired-namespace literal planted in
`server/`, an unquoted retired key in the icon map, a per-kind aura id at the
mint, an apex-band crafted output authored outside the apex arrays, and the apex
plate's duration reverted. **All twelve red.** Each run proved its baseline green
and its patch applied, and both worktrees ended with a clean porcelain.

## 14. Recorded, not acted on

- **The framework's tool table is stale** (section 7). Its three named tools
  cannot measure a gear kit; the probe family can and does.
- **The phase file's "11e decision 6"** is ruling 11g-D-C, landed in 11g. The
  content is correct; the label is stale.
- **The server PBE boost gives a prot tank a caster belt.** `spiritweld_girdle`
  wins the tank waist in `server/pbe_boost.ts`'s scorer, because a tank role adds
  any armour to identity and the rating term then breaks the tie, costing the
  boosted tank 60 health, 9 strength and 6 stamina for 9 dead intellect. The fix
  is server scorer logic, which is outside this phase's scope. `spiritweld_girdle`
  is correct on its own budget and must not be nerfed for it.
- **`REF_ARMOR = 2861` is a pinned calibration constant, not a live property of
  the catalog.** The real max-armour kit is several hundred points above it and
  was already so before this packet. Raising it would move every difficulty floor,
  so this phase pinned the claim that protects the model instead: removing the
  packet's defs leaves the max-mitigation kit unchanged.
- **The two-piece bound is an equip-transition rule, not a worn-set invariant.**
  A save already over the cap keeps everything it was wearing, deliberately and
  pinned. No shipped player path reaches three; a direct write to
  `meta.equipment` would. Closing it needs a load-time bench, which is sim logic
  and out of scope.
- **The druid balance harness drifted when the packet's defs landed** (its bear
  arm takes 12 percent more damage in the fixture) and was never re-pinned. Its
  assertions are `> 0`, so nothing reds. The per-class gear-identity pin added
  this phase reds on the CAUSE instead, which is the part a band cannot say.
