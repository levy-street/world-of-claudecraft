# Masterwrought power verification (R5)

PROMOTED 2026-08-30 from `docs/prd/masterwrought/` into `docs/design/` (Phase 17,
NEW WORK N13, on the farming-asset-manifest precedent) so the live citations
(`tests/r5_envelope_probe.test.ts`, `tests/masterwrought_budget.test.ts`,
`tests/provisioning_supply_line_apex.test.ts`, `scripts/r5_envelope_probe.ts`,
and the two `src/sim/content` KNOWN COST comments) outlive the eventual
packet-doc teardown. The body below is the unedited record: a bare `state.md`
in it means `docs/prd/masterwrought/state.md`, its former sibling.

The measured pass for masterwrought R5, the packet's defining gate:

> R5 Power envelope: full kit (2 Perfected pieces + apex enchants + flask + food)
> at most 5 percent total throughput over pre-packet raid BiS, measured via
> `docs/design/spell-balance-framework.md` before merge. Heroic raid and S-rift
> clear difficulty is the protected asset.
> (`docs/prd/masterwrought/state.md`, locked ruling 5.)

The model, the kit, the baseline, the constants, the targets, the fixture and the
arithmetic are all in this file, and no number here is quoted from another
document. The two things a reader must RUN rather than read are named where they
are used: the fight harness, committed as `scripts/r5_envelope_probe.ts` (section
9.1 gives the invocation), and the catalog read behind section 12's reagent-cost
column (section 12.3 defines it).

## Verdict

**CLOSED BY RULING (2026-08-29).** The maintainer delivered all four priced
rulings at the Phase 16 gate (the verbatim dated rows: state.md, "Maintainer
rulings (2026-08-29)"): the baseline pool stands as written with its
denominator caveat on the record (ruling 1a, section 3); the modelled
"+2 lead-stat points" term is RATIFIED as the R5 quantity, its published
percentages stated as floors (ruling 2b, section 8.1); R5 closes on the four
measured lanes with enhancement bounded by argument (ruling 3a, section
9.3); and the merge-inherited apex-bag tie is resolved by amending the
strictly-best position (ruling 4-amend: the rescoped no-general-bag-exceeds
arm plus the named tie set in `tests/masterwrought_budget.test.ts` is
final). The envelope question this Verdict re-opened on 2026-08-28 is
thereby SETTLED BY RATIFICATION, not by a demonstrated bound: the ratified
quantity is a floor, an at-most bound cannot be verified from floors, and
the maintainer accepts the measured record below, together with section
9.6's equipped-kit measurement (roughly twice the envelope on the binding
fury lane), as the closure. The four downward content tunes stand.

The table below is the ratified quantity, RE-CUT 2026-08-29 from the
committed harness at the closure tip (the section 9.2 re-cut; every cell
reproduces from `scripts/r5_envelope_probe.ts` at the documented
invocations):

| lane | heroic raid, level 22 | S-rift, level 23 |
|---|---|---|
| rogue, combat | +3.28% | +3.22% |
| rogue, assassination | +3.79% | +3.86% |
| rogue, subtlety | +3.78% | +3.79% |
| warrior, fury (the binding lane) | **+4.60% +/-0.91** | **+5.76% +/-0.90** |
| caster, 60 s burst profile | +4.90% | +4.74% |
| caster, 180 s sustained profile | +4.93% +/-0.26 | +4.63% +/-0.25 |
| caster, apex chest actually equipped, 60 s | +2.53% | +2.41% |
| tank, effective health | +4.28% | +4.27% |

Read the binding row honestly. At the recorded sample (60 seeds, 600 s) its
central estimate is INSIDE the envelope at heroic (2-standard-error interval
[3.69, 5.51]) and ABOVE the nominal 5 at S-rift (interval [4.86, 6.66]); the
300-seed precision pair at 600 s reads **+5.06% / +5.24%** (+/-0.40 each,
byte-reproduced at the closure tip), the tightest
committed estimate of the lane, sitting AT the line; and resolving 5.0 from
5.2 on this lane needs roughly 1200 seeds at 600 s, so what the sample
establishes is proximity to the line, not a crossing in either direction.
Two ratified caveats frame those numbers, both stated by the rulings: the
percentages are FLOORS that exclude the apex rating deltas (ruling 2b), and
they are measured against the ratified raw-stat-sum pool, which the record
states runs roughly 3 percent under a hand-optimised kit on the physical
lanes (ruling 1a), so the premium over an optimised denominator reads lower
than printed (the size of that margin rests on the non-reproducible
throwaway readings ruling 1a prices with their uncertainty on the record).
Every other measured lane's central estimate
is inside the envelope at both targets. The caster's 180 s row is
mana-stable and reads with its 60 s twin; the mana-bound coupling begins
past 180 s (section 9.4). The flask trim in section 10.4 remains a
conservative margin rather than a proof that 15 was outside and 13 is
inside.

Before the tunes the same fixtures read **+5.86% / +6.08%** on warrior fury and
**+6.24%** on tank effective health, both outside the envelope.

Every percentage in the table above is the MODELLED kit, the ratified R5
quantity: a floor, not the equipped premium. Section 9.6 carries what the
modelled term omits, measured (fury equipped +10.42 / +10.21 against
modelled +4.97 / +5.27 at 60 seeds, 300 s), kept on the record as the
acceptance ruling 2b names.

HISTORY, kept for the trail. On 2026-08-28 this Verdict was **SUSPENDED**
and the envelope question RE-OPENED: a fresh reader's adversarial pass
found, and this document's own harness then confirmed, that the gear term
measures a STAT MODEL of the kit rather than the kit, and on the measured
fury lane the model is a LOWER bound rather than the claimed upper one
(section 9.6 carries the measurement, the mechanism and the rogue scoping),
so the phase escalated under its own stopping rule instead of closing. The
verdict the phase had originally reached, "INSIDE the envelope on every
measured kit and both protected targets, after four downward content
tunes", was withdrawn as written. The Phase 15 QA (2026-08-29) verified the
escalation four independent ways and priced the two owed definitions, the
lane-set question and the apex-bag tie; the full pricing text (including
the item-swap arm's piece-choice rule and its unmeasured class-free mail
alternates, `spiritweld_girdle` and `wardspeaker_sabatons`) is preserved in
state.md's "WHAT THE MAINTAINER OWNS" mirror and this file's git history.

HISTORY, second entry (2026-08-30, the eighth v0.41.0 sync, release tip
3e801dc925, merge 4f72218ed4): THE CATALOG MOVED UNDER THIS RECORD, the first
sync where it did. The release's incumbent set-stack retune (d404eab938)
swapped hit for crit or haste on pieces of every measured baseline kit
(fury: the crownforged pair plus gravescale_girdle, bloodmane_war_legguards
and tideworn_warboots, WAR_BIS 355 to 165 hit; rogue: the nighttalon pair,
ROGUE_BIS 190 to 120 hit; caster: the soulflame pair, CASTER_BIS 160 to 50
hit) and replaced the crownforged 2pc bonus (ap 40 becomes str 10 / sta 10);
the span's Crucible hit rebalance (c920f39c85) lowered the hit ramp itself
(ABOVE_LEVEL_MISS_PCT [0, 2.5, 14, 21] to [0, 2.5, 8, 14], so the merged
melee needs read 130 heroic / 190 S-rift against this record's 190 / 260);
the legendary band retune (4ed7a279b4) moved heart_of_the_rift (measured +60
of the tank move; the 2pc replacement above is about +100 more) and, with
the lineage lines, took the section 9.5 tank baseline from 3332 to 3532
health while buffing the caster's legendary mainhand; and the raid catalog's
incumbents put the section 8 apex chest lead at -1 against the ratified cap
of 2 while displacing every apex piece from bestEpicGearFor's picks. NOTHING
IN THIS RECORD WAS REWRITTEN: its figures are the measurement of the
pre-raid catalog they were taken on, the nine contradicted pins across
tests/r5_envelope_probe.test.ts, tests/masterwrought_budget.test.ts,
tests/dev_bis_gear.test.ts and tests/server/pbe_boost.test.ts are kept
byte-identical under it.fails with escalation notes, and the maintainer's
ruling is Phase 19 decision table rows 12 to 16
(docs/prd/masterwrought/phase-19-rulings-gate.md): re-measure R5 on the
merged world (which would also decide whether the new raid joins the
protected-asset set beside heroic Nythraxis and S-rift) or ratify this
record as the pre-raid measurement; the eighth-sync AMENDED block in
state.md's Phase 15 ledger carries the item-by-item deltas.
RULED (masterwrought qr-19-apex-tier-vs-crucible-placement, 2026-09-01), the
PLACEMENT half only: the raid tier sitting above the masterwrought apex tier is
ACCEPTED, and the packet amends its own placement prose rather than re-tiering
any def. Nothing in THIS record is rewritten under that ruling and no figure
here moves: the sentence above about nothing having been rewritten still holds
literally. Two of the nine contradicted pins are discharged by it, the
tests/dev_bis_gear.test.ts pair, re-derived against the merged measurement and
flipped back to it(). The other seven stay expected-fail and split between TWO
owners, which is worth stating because a reader sent to one will not find the
other: FIVE belong to the masterwrought R5 RE-MEASURE question (this file's own
tests/r5_envelope_probe.test.ts arms, the tests/server/pbe_boost.test.ts pair
whose note names that row, and the tests/masterwrought_budget.test.ts lead-cap
arm). The remaining TWO are the forgefold_legguards and spiritweld_girdle twin
rows at tests/masterwrought_budget.test.ts, whose own comment offers
re-complementing the twins against the retuned references as an arm independent
of any re-measure; they belong to the twin-complement row, not to the
re-measure. Both rows are still the maintainer's.

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
and the physical melee's maximal legal stacks are three auras each (their own
flask, a stamina elixir, their own plate): the downward refusal fires only inside
one `elixir_<kind>` family and the singleton strip sheds only flask-marked auras,
so an attack-power or intellect flask leaves a stamina elixir alone. Only the
TANK kit is two, because its flask IS the stamina one and refuses the stamina
elixir downward. The caster and physical melee stacks are pinned in
`tests/flask_consumables.test.ts`, "the R5 full kit"; the tank's two-aura kit is
the downward-refusal arm in the same file's "flasks: one at a time" block.

## 3. The baseline, named exactly

R5's baseline is "pre-packet raid BiS". That phrase resolves to three materially
different numbers in the neck slot alone, so this document fixes it:

> **The baseline pool is PvE, class-equippable, best-in-slot (this phrase was
> under Verdict item 1's ruling; RATIFIED as written 2026-08-29, ruling 1a,
> with the denominator caveat recorded below), with the 17
> masterwrought-flagged defs
> removed. The three THROUGHPUT lanes take the repo's maintained EPIC-ONLY
> pickers; the derived TANK arm additionally takes legendaries and held
> offhands.**

QA note (the Phase 15 QA, 2026-08-29): the caster lane's maintained set is not
epic-only. `WARLOCK_FULL_BIS_GEAR` carries the LEGENDARY mainhand
`heroic_deathless_heartwood`, a STRONGER denominator, so the caster rows read
lower than an epic-only pool would print, which is the safe direction.

RULING 1a, RATIFIED 2026-08-29 (the maintainer, at the Phase 16 gate; the
dated row is in state.md, "Maintainer rulings"): the pool rule above STANDS
AS WRITTEN. `bestEpicGearFor`'s raw-stat-sum scoring (class-agnostic and
rating-blind: ratings and spellPower score zero, armor counts) remains the
R5 baseline definition, and THE CAVEAT IS THE RECORD: the physical
denominators are roughly 3 percent under a hand-optimised kit (the two
physical baselines carry two rings worth zero attack power, and the fury
baseline carries 355 hit against a need of 190 or 260). The +7.69 / +6.44
percent readings behind that figure are a non-reproducible throwaway
measurement (the AP-correct baseline was never committed as an arm) and are
priced with that uncertainty. The caveat cuts in the packet's favour when
reading the table: a throughput-correct denominator is stronger, so every
published percentage would read LOWER against it, never higher.

The split is stated rather than assumed because the two readings differ by 20
stat points in the neck slot alone. The throughput loadouts are
`bestEpicGearFor(cls, spec)` (`src/sim/dev/bis_gear.ts`, which filters on
quality epic AND kind armor-or-weapon: legendaries fall to the quality
filter, held offhands to the kind filter) with the flagged picks swapped out,
plus the fury lane's two
greatswords; the maintained caster set is `WARLOCK_FULL_BIS_GEAR`. Using the
epic-only pickers runs in the packet's DISFAVOUR and is therefore the safe
choice: a legendary-inclusive denominator is stronger, so re-deriving with it
moves every percentage DOWN, never up. `heart_of_the_rift` (legendary neck,
primary sum 32) is the piece that would move most, and the tank arm does take it.

The WARFARE honor set's SET BONUSES are out (they are paid entirely in PvP
ratings and contribute exactly zero in PvE by design), but its pieces' raw armour
and stamina do count in PvE, so a derived max-effective-health pick may take them
and the tank baseline below does: four of its twelve slots are WARFARE armour.
The three throughput lanes use named loadouts with no WARFARE piece in them.

The four measured baselines, by id. Every one is pre-packet; none is flagged.

**Rogue** (dual wield; `bestEpicGearFor('rogue', spec)` with its two flagged
picks `wyrmfall_pendant` and `prismglass_loop` replaced by
`medallion_of_endless_profit` and `architects_cornerstone`): `mistcallers_fang`, `heroic_duskwhisper`,
`heroic_nighttalon_crown`, `medallion_of_endless_profit`,
`heroic_nighttalon_shoulderguards`, `basin_stalkers_tunic`, `bonechill_cord`,
`heroic_wyrmshadow_legguards`, `heroic_wyrmshadow_talongrips`,
`heroic_wyrmshadow_treads`, `abysswrought_band`, `architects_cornerstone`.

**Warrior, fury** (dual two-handers: `scripts/fury_dps_probe.ts`'s two
greatswords and rotation, with the remaining ten slots from
`bestEpicGearFor('warrior', 'fury')` and its flagged neck pick replaced by
`medallion_of_endless_profit`):
`deathless_greatblade`, `bonewrought_greatsword`,
`heroic_crownforged_dreadhelm`, `medallion_of_endless_profit`,
`heroic_crownforged_warspaulders`, `emberforged_bulwark`, `gravescale_girdle`,
`bloodmane_war_legguards`, `gravewyrm_claws`, `tideworn_warboots`,
`abysswrought_band`, `architects_cornerstone`.

**Caster**: `WARLOCK_FULL_BIS_GEAR` (`scripts/warlock_balance_probe.ts`), the
repo's maintained set-complete caster BiS: Wraithfire Regalia 4-piece plus
Mournweave 3-piece plus hit jewelry, with the LEGENDARY mainhand
`heroic_deathless_heartwood`. Using it rather than a hand-picked kit
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

Every conversion below is a pure function or a named const in the sim. Two are
module-private and must be read in place rather than imported: `apFromStats` is a
function-local `const` inside `recalcPlayerStats`, and `hpFromStamina` is a
module-private function, both in `src/sim/entity.ts`.

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
| epic item-level bonus | +6, so Perfected source 28 budgets at 34 and the recipe's own 25 at 31 | `src/sim/item_budget.ts` `QUALITY_ILVL_BONUS`, applied by `apexBudgetAtSource` (`src/sim/professions/perfecting.ts`) |
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
template's `armorPerLevel` is 42 (`nythraxis_scourge_of_thornpeak`,
`src/sim/content/dungeons.ts`), so:

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
The choice is load-bearing rather than cosmetic: a caster in raid BiS carries 160
hit rating and lands at 98 percent effective spell hit against the level-22
heroic boss, so most of a further hit term clamps away there and none of it does
at level 23. Measuring only one target would have missed a
single-slot outlier worth 2.8 to 4.1 percent (section 10.2).

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
`bog_beet` 2, per ruling 11g-D-C, landed in 11g. (This paragraph once called
that ruling by a stale "11e decision 6" label and recorded the staleness;
CORRECTED 2026-08-31 under qr-18-REOPEN, Phase 18 item
stale-11e-decision-6-label.)

**The level-20 shelf is UNMOVED by Phase 11o**, re-derived rather than assumed.
Nineteen recipe rows moved `recipe.level` (rung-50 gear 20 to 15, two rung-75
rares 20 to 17, and `duskhide_wraps`, which is skillReq 50 on the live tree and
moved with the rung-50 band). Restoring all nineteen to 20 in memory and
rebuilding the memoised source index gives: the gated-equippable source-20-plus
shelf 285 to 266, the leavers EXACTLY the nineteen movers, **zero joiners**, and
zero movement in any derived value outside the movers. No apex, heroic, raid or
vendor number moves on either axis.

`recipe.level` has four consumers. `perfectedBonusStats` is the only one feeding
a shelf-band POWER magnitude, and it is hard-gated to `masterwrought` defs, all
of whose recipes sit at level 25 and were untouched by 11o. Of the other three,
two feed access gating or pacing and the masterwork bake feeds a magnitude
outside the shelf band, disclosed in the next paragraph.
**No 11o-side drift into the shelf.**

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
- **Two departures from the framework's letter, named rather than left silent.**
  (a) The framework asks every damage specialization for an Area profile
  (60 s, 5 targets). This pass runs single target only: R5's protected assets are
  a heroic raid boss and an S-rift boss, and every term in the kit is a flat stat
  with no area-specific component, so an Area profile would re-measure the same
  delta against a different denominator. (b) The framework's required report lists
  per-hand white damage, damage by ability, proc and pet attribution, resource
  generated and wasted, cooldown uptime and an RNG digest. This pass reports the
  throughput DELTA between two arms and its standard error, because the quantity
  R5 governs is that delta and every other column cancels between two arms that
  share a seed, a rotation, a target and a fixture.

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

Each of the nine WEARABLE apex armour pieces is a stat-and-armour twin of a
same-slot, same-armour-class, item-level-31 heroic five-man drop (the shield's
reference is the item-level-33 raid shield, section 10.3), so **base apex adds
no shelf height at all**.
Only Perfecting does, and it adds the difference between the piece's budget at
source 28 and at its recipe's own level 25. Both levels are raised by
`QUALITY_ILVL_BONUS.epic = 6` before the budget is taken, so 28 becomes 34 and
25 becomes 31:

    primaryStatBudget(34, epic, chest) - primaryStatBudget(31, epic, chest)
      = round(34 * 1.0 * 1.0 * 0.7) - round(31 * 1.0 * 1.0 * 0.7)
      = 24 - 22 = 2

which gives +2 on chest, mainhand, held offhand, gloves, waist and the shield,
and +1 on legs, feet, neck and ring; a two-hander takes +2 (the two-hand
multiplier applies to the budget before the rounding, identically on both
sides, so the delta stays 2).
The formula gives +2 on helmet and shoulder too, but the apex set occupies
neither slot, so no piece collects it.

Of that, **at most +1 lands on the lead throughput stat per piece**: the bonus is
distributed by largest-remainder rounding over the piece's own stat profile, so a
delta of 1 goes entirely to the lead stat and a delta of 2 puts the second point
on the secondary. Measured across all 17: every piece gains exactly +1 lead.

With the equip cap at 2, **the gear term is +2 lead-stat points**, and that is the
figure the measurement uses for every lane. **Section 9.6 shows that on the
FURY lane this is a LOWER bound rather than an upper one, and by roughly the
width of the envelope (the rogue lane's equipped arm is unmeasured and its
expected sign is at or below the modelled row), so read the rest of this
subsection with that correction in front of it.** The reasoning below was written before that was
measured and is kept because it is still right about the caster.

RULING 2b, RATIFIED 2026-08-29 (the maintainer, at the Phase 16 gate; the
dated row is in state.md, "Maintainer rulings"): the modelled "+2 lead-stat
points" term IS the R5 quantity. The record states plainly that the
published percentages EXCLUDE the apex pieces' rating deltas and are
therefore FLOORS, and the maintainer accepts on the record, per the
Verdict's own pricing of this arm, that an at-most bound cannot be verified
from floors and that the equipped fury kit moves the binding lane roughly
twice the envelope (section 9.6's 10.42 / 10.21 against modelled
4.97 / 5.27). The gear term does NOT become an item swap on any lane; the
three item-swapping arms (tank, maximal caster, fury equipped) remain
reported evidence beside the ratified quantity, not the quantity itself.

It is claimed as an upper bound in two ways: a
character whose baseline in a slot is a legendary gains nothing there (the apex
weapon is 20 to 25 points behind a legendary one, and `heart_of_the_rift` is 17
ahead of the apex neck), and a set-complete caster who takes an apex chest breaks
a set bonus worth more than the piece.

The abstract term deliberately excludes the apex pieces' own RATING lines, and
the caster chest is the slot where that exclusion could hide the most, so it is
MEASURED rather than argued. The maximal caster loadout, `sunspun_vestments`
actually equipped as one of the two Perfected pieces (its haste 40, its Perfected
`{int:1, spi:1}`, and the Perfected-only `enchant_lucent_infusion` on that slot),
runs as its own arm in section 9.2. It reads about 2.4 points BELOW the abstract
term, not above it: the Mournweave 3-piece it breaks is +10 intellect and +10
stamina, which 40 haste rating (2 percent cast rate) does not repay. So the
abstract +2 lead-stat model is the conservative reading for the caster too, and
the exclusion is a bound in the safe direction rather than a gap.

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
reaches the stat book, so a combat rogue's +19 raw reads +23 on the sheet (a
subtlety rogue's reads +21).

Measured contribution: **+2.4 to +3.5 percentage points**, the largest term in
the envelope by a wide margin. Over a 19-stat term that is **0.13 to 0.18
points per stat**, which is the sensitivity sections 10.4 and 13 size their
arguments with.

## 9. The measured pass

### 9.1 Fixture

**The harness is committed: `scripts/r5_envelope_probe.ts`.** The documented
table takes TWO invocations, because the binding lane needs a bigger sample
than the others and a single default run would print a different fury row:

    npx tsx scripts/r5_envelope_probe.ts                       # rogue, caster, tank
    WOC_R5_SEEDS=60 WOC_R5_SECONDS=600 \
      npx tsx scripts/r5_envelope_probe.ts fury                # the binding row

The binding-row command runs WITHOUT `WOC_R5_ARMS`, so it prints the fury
gear and gear+ench columns and the equipped aside alongside FULL (the
2026-08-29 re-cut took all four fury cells from that one command;
`WOC_R5_ARMS` remains available for a precision pass on one arm, e.g.
`WOC_R5_ARMS=FULL` at 300 seeds).

`WOC_R5_SEEDS`, `WOC_R5_SECONDS` and `WOC_R5_ARMS` override the sample and
restrict which kit arms run. The binding-row invocation's 60 seeds at 600 s is
the recorded sample, and the documented invocation and the recorded sample
were kept identical at the post-ruling re-cut (executed 2026-08-29, the R5
closure: the fury row including its gear and gear+ench cells was taken from
the fury command above run WITHOUT `WOC_R5_ARMS`, and the rogue, caster and
tank rows from the default run). Its constants (`HEROIC_TARGET`,
`SRIFT_TARGET`, the baseline loadouts, the enchant maps, the kit deltas) are
the section-3 and section-8 tables in executable form, and the enchant and
consumable deltas are READ from the catalog rather than written as literals,
so a magnitude the packet later moves moves the harness with it; the gear and
Perfecting deltas are literals cross-pinned by
`tests/masterwrought_budget.test.ts`'s Perfected-lead arm.
`tests/r5_envelope_probe.test.ts` pins the deterministic tank lane and the
target derivations against this document.

Level 20, `autoEquip: false`, an ambient-free world (no camps, npcs or ground
objects), the probe anchored in the open field, and an inert target: `hostile`,
`aiState: 'idle'`, `moveSpeed: 0`, zero weapon damage, the section-5 level and
armor. Resources are never refilled. Rotations are the repo's own: the rogue
lane runs the La Luna build with `scripts/rogue_dps_probe.ts`'s COMBAT
priority list applied to all three specs (the probe's per-spec rotation
branches are not carried over);
the fury lane runs the `scripts/fury_dps_probe.ts` rotation and rows; the caster
lane is a MAGE at the class's default spec (the probe calls no `setSpec`, so no
spec mastery multiplier rides on either arm) spamming frostbolt, the level-20
mage's own single-target filler, wearing the maintained caster BiS set that
`WARLOCK_FULL_BIS_GEAR` happens to name (every piece is mage-legal: nine list
`mage` in `requiredClass`, and the neck and the two rings carry no class
restriction at all), and drinking `sunpetal_mana_draught` when mana falls
below 45 percent, both arms alike.

On the three THROUGHPUT lanes the packet's delta is applied to the kit arm as
instance `rolled.stats` and auras, which is the same channel an enchant and a
Perfected bonus really use, so the kit arm is the baseline character plus exactly
the section-8 terms. Three arms depart from that model and say so where they
are reported: the maximal caster arm (9.2), the whole tank arm (9.5) and the
fury equipped arm (9.6) SWAP ITEMS instead, because their gear term is a
rating line or armour rather than a lead primary.

### 9.2 Results

> **RE-CUT 2026-08-29 FROM THE COMMITTED HARNESS** (Phase 16 STEP 0.5, the
> R5 closure, under ruling 2b; the refresh this blockquote's earlier form
> deliberately deferred pending that ruling). Every fury and caster cell
> below now REPRODUCES from `scripts/r5_envelope_probe.ts` at the
> documented invocations (fury: 60 seeds at 600 s; everything else: the
> default run), measured at the closure tip, never a mid-span capture. The
> superseded-fixture figures this table carried until the re-cut (fury
> 4.94 / 4.50, caster 4.55 / 5.06 / 4.58 / 4.75, and their gear columns),
> and the three understood causes of their staleness (caster figures taken
> at 10 seeds while the section claimed 25; a first-version resource refill
> handing a fury warrior 100 rage it must earn; unpaired error bars on a
> paired design inflating the rogue and caster intervals about 35-fold, all
> three fixed in the committed harness), are preserved in this file's git
> history and the Phase 15 ledgers. The rogue rows and the whole of 9.5
> reproduced unchanged throughout (the assassination heroic cell read +3.78
> from an intermediate harness state; the Phase 15 QA corrected it to the
> committed +3.79, 2026-08-29). The fury gear and gear+enchant columns sit
> inside their own noise at this sample (bars near +/-0.8 on centrals at or
> under 2 points, per-seed spreads over 10 points) and are reported as
> printed.

Rogue: 25 seeds, 180 s. Caster: 25 seeds, at both the 60 s burst and the 180 s
sustained profile. Warrior fury: 60 seeds, at both 180 s and 600 s. Error bars
are 2 standard errors on the paired difference.

| lane | target | gear | gear + enchant | FULL KIT |
|---|---|---|---|---|
| rogue, combat | heroic | +0.28% | +0.76% | **+3.28%** |
| rogue, assassination | heroic | +0.37% | +0.82% | **+3.79%** |
| rogue, subtlety | heroic | +0.48% | +0.91% | **+3.78%** |
| warrior, fury | heroic | +0.53% | +0.64% | **+4.60% +/-0.91** |
| caster, 60 s | heroic | +0.50% | +1.00% | **+4.90%** |
| caster, 180 s | heroic | +0.49% | +1.03% | **+4.93% +/-0.26** |
| caster, 60 s, apex chest equipped | heroic | (item swap) | (item swap) | **+2.53%** |
| caster, 180 s, apex chest equipped | heroic | (item swap) | (item swap) | **+2.53%** |
| rogue, combat | S-rift | +0.24% | +0.69% | **+3.22%** |
| rogue, assassination | S-rift | +0.44% | +0.92% | **+3.86%** |
| rogue, subtlety | S-rift | +0.44% | +0.89% | **+3.79%** |
| warrior, fury | S-rift | +1.14% | +2.00% | **+5.76% +/-0.90** |
| caster, 60 s | S-rift | +0.44% | +1.00% | **+4.74%** |
| caster, 180 s | S-rift | +0.47% | +0.99% | **+4.63% +/-0.25** |
| caster, 60 s, apex chest equipped | S-rift | (item swap) | (item swap) | **+2.41%** |
| caster, 180 s, apex chest equipped | S-rift | (item swap) | (item swap) | **+2.36%** |

The two "apex chest equipped" rows are the MAXIMAL caster loadout and the only
throughput arm that swaps an item: `sunspun_vestments` replaces
`heroic_necromancers_starshroud` as one of the two Perfected pieces, carrying its
haste 40 and its Perfected `{int:1, spi:1}`, and the chest enchant becomes the
Perfected-only `enchant_lucent_infusion` at 13 rather than the pre-packet 7.
Their gear and enchant columns are blank because the swap is not decomposable
into those terms. The loadout reads about 2.4 points BELOW the abstract kit
because it breaks the Mournweave 3-piece (+10 intellect and +10 stamina), which
the chest's rating line does not repay. A caster whose best chest is not a set
piece would keep the haste and pay no set penalty, but that character's baseline
is correspondingly weaker and the tree maintains no such BiS set to measure
against; the effect is bounded by the +2.00 percent a 40-haste line is worth at
either target.

The fury FULL figures are the 600 s, 60-seed runs (base 168.35 at heroic,
base 151.18 at S-rift; all re-cut 2026-08-29 from the committed harness).
The same run prints the equipped aside at +9.33% / +10.39%: equipped
evidence of the kind ruling 2b's acceptance covers, at this sample (the
pair the ruling itself names is 9.6's 300 s 10.42/10.21), never the
ratified quantity (the modelled term is the R5 quantity per ruling 2b,
the published percentages floors).
Its 180 s, 60-seed twins read +4.82% and +5.36%, and its 25-seed 180 s runs
read +4.17% and +5.25%: the same lane, three sample sizes, every draw within
a point of the recorded row. The 600 s row is the recorded sample because
within-fight variance falls with the fight length; the 300-seed precision
pair at 600 s reads **+5.06% / +5.24%** (+/-0.40 each, byte-reproduced at
the closure tip), the tightest committed estimate of
the binding lane and the pair the Verdict reads beside the recorded row.

### 9.3 Why fury is the binding lane, and the one lane not measured

**Named gap, stated rather than argued away: enhancement shaman is not
measured.** `canDualWield` is rogue, warrior-fury and shaman-enhancement, and
`apFromStats` gives strength times 2 to warrior, paladin, shaman and druid, so
enhancement is the only unmeasured spec carrying BOTH multipliers this section
uses to explain why fury binds. The measured throughput set is rogue (str plus
agi), warrior fury and mage. The rage argument below does not transfer to it,
because enhancement is not rage-driven, so what bounds it is the weapon term
landing twice, which fury already pays. That is an argument, not a measurement,
and the record says so rather than implying the set is complete.

QA addendum (the Phase 15 QA, 2026-08-29): the QA ran an exploratory
enhancement measurement, a throwaway probe adapted from this file's fury lane
and `scripts/owned_class_balance_probe.ts`'s maintained warspirit fixture, not
committed and re-derivable in about a day. The modelled kit read +3.0 percent
at both targets (12 seeds at 150 s), inside the envelope and below fury,
supporting this section's transfer argument. The realisable S-rift kit read
+5.41 (32 seeds at 180 s) against the maintained baseline and +7.64 against an
epic-only baseline via `duskforged_warblade`'s crit-for-hit twin mechanism,
but +2.87 against a hit-corrected pre-packet baseline that itself beats the
maintained fixture by +2.56 percent, so the lane's envelope answer inverts on
the section 3 pool choice alone, which was the pool ruling's question
(settled 2026-08-29 as ruling 1a). These are
QA-run throwaway numbers, with the same non-reproducibility caveat as the
7.69 / 6.44 figures.

RULING 3a, RATIFIED 2026-08-29 (the maintainer, at the Phase 16 gate; the
dated row is in state.md, "Maintainer rulings"): R5 CLOSES ON THE FOUR
MEASURED LANES. Enhancement stays bounded by this section's transfer
argument plus the QA addendum above (the modelled kit measured inside and
below fury; the realisable-kit inversion rides the pool question ruling 1a
settled), and no committed enhancement lane is added. The lane remains
re-derivable in about a day from the named committed parts if a future
pass wants it measured.


Fury is the highest-throughput physical spec, it dual-wields (so it pays the
weapon-enchant term twice), and it is rage-starved about a fifth of the time in
this fixture. Rage is generated from damage dealt, so attack power buys rage as
well as damage and the delta is superlinear rather than proportional. That is
real coupling, not a fixture artefact: it is also why the analytic white-damage
bound (+5.3% before the tunes) under-predicted the measured total (+5.9%) on this
lane while over-predicting it on every other one.

### 9.4 The caster's mana coupling, and why a mana-bound profile is not a gate

A level-20 mage has no mana-free filler: every ability in its book costs mana.
With mana potions on both arms the committed fixture stays mana-stable
through 180 s (the 180 s base holds the 60 s rate, 101.11 against 100.60),
which is why the re-cut 180 s row reads with its 60 s twin (+4.93 against
+4.90 at heroic); the superseded fixture had read the 180 s profile
noticeably higher, which is what this section's earlier form explained.
Past 180 s the fixture starves by construction, and the framework's own
balancing rule 7 ("a correct continuous rotation neither starves
indefinitely") disqualifies a starving fixture as a parity gate. Intellect
buys the mana pool as well as spell power, so in the mana-bound regime the
kit gains twice and the reading rises: re-cut 2026-08-29 from the committed
harness, the same lane reads +4.90% at 60 s, +4.93% at 180 s, and +7.67% at
300 s (base 81.34 at 300 s against 101.11 at 180 s, the starvation made
visible; the earlier mid-span diagnostic capture had read +8.3%). The
mana-stable readings are the throughput numbers; the mana-bound one is
recorded so the coupling is visible.

### 9.5 The tank effective-health arm

Effective health is `maxHp / (1 - armorReduction(armor, attackerLevel))`. This
arm SWAPS ITEMS rather than adding a stat delta, because its gear term is armour
and stamina rather than a lead primary. Its inputs, all executable in
`scripts/r5_envelope_probe.ts` (`TANK_BIS`, `TANK_ENCH`, `TANK_KIT_ITEMS`,
`TANK_KIT_DELTA`):

- the section-3 tank baseline in the `prot` spec at level 20;
- the pre-packet enchant set both arms carry: mainhand str 5, gloves str 3,
  shoulder and both rings str 2, helmet and legs sta 6, chest sta 7, waist and
  offhand sta 3, feet sta 2, neck spi 3;
- the two Perfected pieces this arm equips (the max-effective-health pair:
  the other class-free apex mail, `spiritweld_girdle` and
  `wardspeaker_sabatons`, trades stamina-bearing baseline pieces for caster
  primaries and strictly lowers effective health): `duskforged_bulwark` in the
  offhand (Perfected `{str:1, sta:1}`) replacing `heroic_bonewrought_bulwark`,
  and `forgefold_legguards` (Perfected `{str:1}`) replacing
  `furyforged_legguards`;
- a chest enchant step of +3, not +6: no mail or plate apex chest ships, so the
  Perfected-only Lucent Infusion is unreachable for a plate wearer;
- `ironhusk_flask` REPLACING the serpent elixir rather than riding beside it.

| arm | hp | armor | EHP vs level 22 | delta |
|---|---|---|---|---|
| baseline | 3332 | 3369 | 8277 | - |
| consumables only | 3432 | 3369 | 8526 | +3.00% |
| consumables + apex chest enchant | 3472 | 3369 | 8625 | +4.20% |
| full kit (2 Perfected pieces) | 3472 | 3373 | 8631 | **+4.28%** |

The last row's +4 armour with ZERO health is the piece swap, not a stat delta,
and it is worth spelling out because no additive model produces it: the shield is
armour-identical (680 on both sides) and nets +1 stamina from Perfecting, the
legs are armour-identical (315 on both sides) and net minus 1 stamina (9 against
10), so stamina lands at 326 either way and health does not move. Strength nets
+4 (shield 6 to 6, legs 8 to 12) and protection's `armorFromStrPct` turns that
into the +4 on the stat book.

Against a level-23 attacker: 8099 to 8445, **+4.27%**. Protection's stamina
multiplier (`staPct: 0.40` on the prot mastery,
`src/sim/content/talents_warrior.ts`, which also carries `armorPct: 0.10` and
`armorFromStrPct: 0.70`) amplifies the flat stamina terms, which is why a +7 raw
stamina consumable delta reads as +100 health.

Before this phase's shield tune the same arm read **+6.24%**, most of it armour.

### 9.6 What the modelled gear term omits, measured

The gear term everywhere above is "+2 lead-stat points" (section 8.1), applied
as an instance stat delta. Section 8.1 claimed that as an upper bound before
the 2026-08-29 ruling ratified it as a floor. On the FURY
lane it is a measured lower bound, and the gap is larger than the envelope.
The rogue lane's equipped arm is UNMEASURED and its hit arithmetic differs:
the rogue baseline carries exactly 190 hit rating, at the heroic cap with zero
headroom and 70 short at S-rift, so the fury dead-rating mechanism does not
transfer, and the rogue equipped arm's expected sign is at or below its
modelled row (converting live hit to crit is a loss at both targets there).

**The mechanism.** `swingMissChance` is `max(0, miss - hitBonus)` and `hitBonus`
is `hitRating / 1000`, so hit past the miss chance is worth exactly nothing.
`WAR_BIS` carries **355 hit rating**; the heroic target needs 190 and the S-rift
target 260. Its effective miss on SPECIAL attacks is already **0.0 percent at
both targets**, and 95 to 165 rating is dead weight. White swings additionally
carry the flat dual-wield 10 percent penalty
(`DUAL_WIELD_WHITE_MISS_PENALTY`, `src/sim/combat/auto_attack.ts`), added
after the `max(0, ...)` floor, which no amount of hit rating reduces, so the
dead-rating conclusion is unchanged. Now compare the two legs:

| def | armour | str | sta | hit | crit |
|---|---|---|---|---|---|
| `bloodmane_war_legguards` (baseline) | 315 | 11 | 9 | 40 | 0 |
| `forgefold_legguards` (apex) | 315 | 11 | 9 | 0 | 40 |

They are stat-and-armour identical except that the apex piece's 40 hit is 40
CRIT (the defs also differ on sellValue, requiredLevel, requiredClass and the
masterwrought flag, none of which moves combat stats).
Equipping it converts dead rating into live rating, a gain the "+1 lead stat per
piece" model scores as ZERO, because Perfecting moves primary stats only.

**Measured**, same fixture, same seeds, same consumables, 60 seeds at 300 s,
the only difference being whether the two Perfected pieces this arm equips
(the phase's arithmetic pick, `forgefold_legguards` and `warhewn_signet`;
the not-taken item-swap arm's piece-choice note, preserved in state.md's
ruling mirror, named `spiritweld_girdle` and `wardspeaker_sabatons` as the
unmeasured class-free mail alternates) are applied as a
stat delta or EQUIPPED as items:

| arm | heroic raid, L22 | S-rift, L23 |
|---|---|---|
| modelled, "+2 lead-stat points" | +4.97% +/-1.18 | +5.27% +/-1.03 |
| **the same two pieces EQUIPPED** | **+10.42% +/-1.42** | **+10.21% +/-1.20** |

Roughly twice the envelope, and about double what the modelled term reports.
Reproduce with `WOC_R5_SEEDS=60 WOC_R5_SECONDS=300 WOC_R5_ARMS=FULL,FULL+equipped
npx tsx scripts/r5_envelope_probe.ts fury`.

**The bound on the bound.** This measurement uses section 3's baseline, which
carries the dead hit above and two rings worth zero attack power, so it flatters
the packet: a throughput-correct baseline is stronger and the percentage lower.
The adversarial reader who first raised this measured +7.69 and +6.44 percent
against an attack-power-correct baseline (a throwaway measurement: that
baseline was never committed as an arm, so the two figures are not
reproducible from the harness). Every reading, on every baseline
tried, is above 5. That is why the 2026-08-28 verdict was suspended rather
than restated with a new number: which baseline is correct was section 3's
ruling to make, not this section's, and ruling 1a (2026-08-29) made it by
keeping the pool with the caveat on record. This measurement stays on the
record as the acceptance ruling 2b names.

Note what this does NOT say. The caster lane's equipped arm (section 9.2) reads
BELOW its modelled arm, because a caster's apex chest breaks a set bonus and its
baseline is not rating-capped. The direction of the omission is not uniform, and
that is precisely why it has to be measured per lane rather than argued once.

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
requires. This is the one tune that is a CORRECTION rather than a nerf: it puts
the weapon term back at the size the packet's ratified arithmetic is consistent
with. It does not by itself return the kit to the ratified 4.2 to 4.7 percent
band. The measured post-tune physical kit (re-cut 2026-08-29 from the
committed harness; the superseded fixture had printed 4.94 / 4.50 here) is
4.60 at heroic and 5.76 at S-rift at the recorded 60-seed sample, with the
300-seed precision pair at 5.06 / 5.24: above the ratified band's top, and
at or above the nominal envelope line within the sample's resolving power
(the Verdict reads it honestly, framed by the two ratified caveats); the
band was a ratified estimate, the envelope is the contract, and it is the
envelope this phase measured against.

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
whole kit. Against the heroic raid boss the same piece is close to a WASH rather
than an outlier, and the mechanism is a clamp rather than a cap: a raid-BiS
caster carries 160 hit rating and sits at 98 percent effective spell hit, so
`min(1, ...)` clamps half of a further 40 hit away and the piece reads +2.04
percent against haste-40's +2.00. That is exactly why fixing both target levels
mattered. At one target the swap is a rounding error; at the other it removes
2.4 points.

Haste still complements the reference drop's crit, so the rule the other eight
armour pieces follow is untouched. The nine WEARABLE apex armour pieces now hand
out no hit at all: the complement rule forces the one hit slot to be the single
piece whose reference does not carry hit, and that piece was the cloth chest.
The apex shield keeps its reference's hit at 20, which is the held-and-shield
family's own band and a threat stat rather than a caster one.

### 10.3 `duskforged_bulwark`, armor 732 to 680 and blockValue 32 to 30

Both numbers extrapolated the shield ladder two item levels past
`bonewrought_bulwark` at the epic mail chest line's slope. The extrapolation is
internally sound and it produced **the best mitigation item in the game**: the
heroic variant generator passes armour and blockValue through untouched, so
`heroic_bonewrought_bulwark` still reads 680 and 30 at item level 33, so before
the tune the item-level-33 raid shield could never even MATCH the crafted one.
It now ties it exactly, and the two are separated by their ratings (the raid
shield's hit 55 plus crit 20 against the crafted piece's hit 20) and by strength,
which is the shape the packet wants: a crafted piece beside the raid line, never
above it.

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

That picker feeds a SHIPPED body, so the tune has a live ripple and it is
recorded rather than left to a reader to rediscover: the friendly practice
dummy derives its vitals from `bestEpicGearFor('warrior', 'protection')`, and
its body moved from **1702 health / 2993 armour to 1712 / 2941** with the
offhand and neck re-pick. It is applied at every world construction, production
included. `tests/practice_dummies.test.ts` pins the post-tune literals.

A demand consequence, recorded and NOT tuned, the same treatment section 14
gives the apex weapon rung. After the tie the crafted shield is dominated by
the raid drop it now matches: both read armour 680 and block 30, and
`heroic_bonewrought_bulwark` additionally carries hit 55 plus crit 20 and one
more strength. Even Perfected the crafted piece trades 35 hit and 20 crit for
+1 primary, so a tank who already holds the heroic shield has no reason to
craft one. The tie is R5-mandated and raising either number re-creates the
inversion, so this is a judged R21 demand risk for a future pass rather than a
magnitude R5 will let us move.

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
not the 21 the packet's earlier records quote. Ruling 11c-D-2's OUTCOME is
unaffected, but its stated REASON no longer carries it, and that is recorded here
rather than left to be rediscovered. 11c-D-2 rejected an apex food of 8 because
"flask 15 plus food 6 equals 21" and an 8 broke that sum; at flask 13 an apex
food of 8 sums to exactly 21, the number the ruling treated as acceptable. What
keeps 8 rejected now is the LADDER, not the sum: the apex plate must sit exactly
one rung above farming's top rung of 5, and that ordering is what the Well Fed
band and dominance arms in `tests/masterwrought_budget.test.ts` pin. The ruling
stands on the pinned rule; only its arithmetic rationale is superseded.

Two smaller tunes were available and are recorded as NOT taken, with the reason.
(a) **Flask 14.**
By section 8.3's sensitivity of 0.13 to 0.18 points per stat, a one-point trim
moves the pre-tune fury reading of 5.1 to 5.3 down to roughly **4.9 to 5.2**,
whose top half is still OUTSIDE the envelope. That is the argument against 14
rather than a near miss: it does not reliably land the kit inside. (b) **Tune only `warboar_flask` and `runewater_flask`.** `ironhusk_flask`
is `buff_sta` and contributes exactly zero to "total throughput", so leaving it
at 15 would cost nothing on any throughput lane; the price is that the tank arm
would move to roughly +5.1 percent and the three role flasks would lose their
uniform magnitude. 13 across all three was chosen for the margin and the
uniformity. Nothing structural forced it, and both alternatives remain open to a
future tuning pass that wants the ladder step back.

## 11. The adversarial stat-shape audit (R14, Lionheart/Lariat)

Every apex item was audited against the scarce-stat and stat-light-slot rules.
"Apex" carries three scopes in this packet and they are distinguished wherever it
matters: the **17 masterwrought-FLAGGED defs** (the equippable set), the **33
apex recipe OUTPUTS** (which also include stations and consumables), and the **10
apex ARMOUR pieces** (nine wearable plus the shield).

**R14 passes cleanly.** All three jewelry pieces are pure primary plus stamina,
each sums exactly `primaryStatBudget(31, epic, slot)`, each carries exactly one
rating at the jewelry band's 25, and no apex EQUIPMENT def carries a proc, an
on-use, or a spell-power line: not one of the 17, weapons, shield and jewelry
included. (FOUR apex OUTPUTS carry `use` payloads: the three
placeable stations `masters_field_forge`, `grand_cauldron` and `laden_hearth`,
plus `makers_charm`, the apex tool-effect charm. None of the four is equipment,
so R14's equipment rule is not in play for any of them.)

The packet does introduce one combination the slot did not previously hold: a
cloth chest carrying haste, since every pre-packet cloth chest carries either no
rating or crit. It carries it at the ordinary armour-family rate of one rating at
40, the same price the other eight body armour pieces pay (the shield sits on
the held-and-shield band at 20 instead), so it is a new SHAPE at a known rate
rather than a Lariat's new-shape premium. It is also the
least-bad option in the slot: the complement rule forbids crit (the reference
carries it) and hit is the double-value field this phase tuned away from.

**One outlier stood and was tuned down**: `sunspun_vestments` (section 10.2).

**Recorded, measured, not defects:**

- `wyrmfall_pendant` is the packet's dominant piece and the closest thing to a
  Lariat it contains: it is the only flagged NECK with neither an armour class
  nor a class restriction (the two apex rings share that pair), so all nine
  classes wear the same neck, and it is the only flagged def in a slot with no
  pre-packet PvE EPIC item-level-31 incumbent at all (the epic field tops
  out at 12 at item level 26, and the three item-level-31 necks are PvP honor
  rows). The legendary `heart_of_the_rift` sits 17 points ABOVE the Perfected
  apex neck, so a character holding it gains nothing here, which is the same
  bound section 8.1 states. Perfected 15 against the best epic 12 is the packet's
  largest single-slot move against the throughput baseline. It sits exactly on its budget and its rating is the vendor band's, so
  there is no number to bring down; it is named here so the concentration is on
  the record.
- `gyrelens_array` is the Lionheart shape in miniature and it is self-limiting:
  its two-stat profile concentrates a smaller budget into +2 intellect over the
  item-level-33 heroic orb (+3 once Perfected), but it gives up 55 rating to do
  it, which is the larger term. The compensating relation is now stated in the sweep.
- `warhewn_signet` is a strict superset of the item-level-26 vendor ring
  `seal_of_the_nine_oaths` by one point on each axis with the same rating field.
  That is what five item levels buy, and hit at 25 is the vendor band's own
  allocation for a strength ring. It carries the same double-value rating that
  made `sunspun_vestments` a tune, so the asymmetry is stated rather than left
  implicit: the chest was the SOLE carrier of hit in its slot and family, at 40,
  while the ring sits at the jewelry band's 25 beside a pre-packet vendor twin
  that already allocates hit to a strength ring. Concentration at the band rate
  beside an incumbent is progression; concentration with no incumbent at twice
  the rate is the Lionheart shape. The band-scoped twin sweep pins the rule that
  actually matters (no two pieces the same shape in the same band).

## 12. The gray-grind record (qr-GRAY)

A recorded MEASUREMENT, not a tune. No gain-curve change lands in this packet:
the 11e, 11f and 11i pacing models were all derived against the shipped
multiplier. This is the judgment surface for the future-tier revisit.

### 12.1 The gain function

Every symbol in this subsection is in `src/sim/professions/wheel.ts`, with two
exceptions a reader must read in place: `CRAFT_SKILL_GAIN` is a module-private
const in `src/sim/professions/crafting.ts`, and each craft's `maxSkill` sits on
`CRAFT_RING` in `src/sim/content/professions.ts` (read via `craftMaxSkillFor`).

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
Floor spam = the lowest-`skillReq` recipe that still yields anything. (RENAMED
2026-09-02 under qr-19-qr-gray-row-wording-false: this path was labelled "cheap" here
while the table below shows it LONGER than the intended path on all ten crafts and
section 12.3 measures it DEARER in reagent value on eight of the ten, only
leatherworking and inscription coming out cheaper, so 12.2 now carries the floor-spam
name 12.3 uses; the numbers are unchanged.)

| craft | intended | floor spam | ratio | the floor recipe (skillReq, reagent value) |
|---|---|---|---|---|
| engineering | 125 | 375 | 3.00 | `recipe_cogwheel_blank` (0, 26c) |
| alchemy | 150 | 375 | 2.50 | `recipe_growth_tonic` (0, 11c) |
| cooking | 125 | 375 | 3.00 | `recipe_tough_jerky` (0, 4c) |
| leatherworking | 125 | 375 | 3.00 | `recipe_fenbridge_hide_boots` (0, 14c) |
| tailoring | 125 | 375 | 3.00 | `recipe_homespun_mitts` (0, 15c) |
| inscription | 125 | 375 | 3.00 | `recipe_silverleaf_scroll` (0, 17c) |
| enchanting | 150 | 225 | 1.50 | `recipe_gatherers_cache` (25, 383c) |
| jewelcrafting | 125 | 375 | 3.00 | `recipe_hammered_copper_band` (0, 33c) |
| weaponcrafting | 125 | 375 | 3.00 | `recipe_copper_bearded_axe` (0, 29c) |
| armorcrafting | 125 | 375 | 3.00 | `recipe_coppermail_sabatons` (0, 31c) |

Two rows do not read 125 / 375 / 3.00 and both reasons are structural.
**Alchemy's** intended path is 150 because it has no repeatable band-3 recipe
(section 12.4): its repeatable `skillReq` set is 0, 25, 50, 100, 125, so the 75
to 100 leg runs at the 0.5 multiplier and costs 50 crafts rather than 25.
**Enchanting's** two columns BOTH start at skill 25, because its lowest
`skillReq` is 25 and nothing on its roster is craftable at skill 0 at all; from
that start the floor-spam path is 25 + 50 + 100 on `gatherers_cache` then 50 on
`recipe_lucent_reagent`, which is 225.

The CRAFT-COUNT columns are worked by hand below, so they reproduce from this
document alone. The reagent-value column does NOT: "reagent value" means the sum
over a recipe's reagents of each reagent's `sellValue` times its quantity, read
out of the live catalog, so re-deriving it means re-running that read rather than
working from anything printed here. The same applies to the 8075 copper below and
to every cost figure in 12.3.

Cooking, worked by hand. Intended path, band-matched so the multiplier is 1 on
every leg: 25 crafts of
`recipe_tough_jerky` (0 to 25), 25 of `recipe_ashwood_smoked_eel` (25 to 50), 25
of `recipe_silvered_carp_supper` (50 to 75), 25 of
`recipe_highwatch_barley_porridge` (75 to 100), 25 of
`recipe_evergarden_braised_greens` (100 to 125). Total 125 crafts, 8075 copper of
reagents. Floor-spam path, staying on the lowest recipe that still pays: jerky at 1.0
for 25 crafts, at 0.5 for 50, at 0.25 for 100 (it dies at 75), then the eel at
0.25 for 100, then the carp supper at 0.25 for 100. Total 375 crafts.

### 12.3 Three corrections the measurement forced

The three paths compared here are, precisely: **intended**, the cheapest recipe
whose tier equals the crafter's current tier (falling back to the highest tier
available when the band has no row); **floor spam**, the lowest-`skillReq`
recipe that still pays anything; and **cheapest**, the lowest reagent cost per
skill point among the recipes that still pay. All three walk one craft at a time
through the real `craftSkillGainMultiplier` and `gainCraftSkill`, exclude
`oncePerDay` rows, refuse any recipe whose `skillReq` is above the current skill,
and start at the craft's own lowest `skillReq`.

- **The qr-GRAY row's own claim is false as literally written.** It says the
  cheapest path to any skill number is always bulk-spamming low recipes. Measured
  in reagent value, the tier-0 spam path is DEARER than the intended path for 8
  of the 10 crafts (only leatherworking and inscription come out cheaper). On the
  NINE crafts with a tier-0 row, alchemy included, the floor path is the same 375
  crafts: three times the intended 125 on eight of them, and 2.5 times alchemy's
  longer intended 150, which comes from its missing band-3 rung rather than from
  where its floor column starts. Enchanting is the tenth and the only one whose
  columns start elsewhere: its roster has no tier-0 row at all, so both columns
  start at skill 25 and the floor path is 225 against an intended 150. The gray grind is real; its lever is not the
  floor. The genuinely cheapest path in materials is **the lowest reagent cost
  per skill point among the recipes that still pay**, which in practice means
  staying one or two tiers under the band rather than at the floor. It beats the
  intended path for 9 of the 10 crafts at 0.66 to 0.88 of the cost, taking 1.0x
  to 2.6x the crafts; enchanting is the tenth and it ties at 1.00, because with
  only three rows its cheapest-per-point path IS its intended path. That
  arbitrage, not the floor spam, is what a future revisit should aim at.
  (AMENDED 2026-09-02, qr-19-qr-gray-row-wording-false: the qr-GRAY row now carries
  this correction in place, dated, and section 12.2's label is renamed to match.)
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
  rows print all three. (AMENDED 2026-08-29: 63 of 170 after the seventh
  v0.41.0 sync brought the release's four tailoring bag recipes; the numerator
  and the 12 skill-125 rows re-verified unchanged, since the new rows sit at
  skillReq 25/50 whose boundaries top out at 125.) The fix is a clamp in `scripts/wiki/build_content.mjs`
  plus an arm in the guide test, which is a `scripts/` change outside this phase's
  content-plus-tests-plus-docs scope.

## 13. What would breach this, and what pins it

Each row names the tripwire and the guard that reds if it moves.

| if this moved | the envelope moves by | pinned in |
|---|---|---|
| a flask value | about 0.8 to 1.1 points per 6 stat, from section 8.3's 0.13 to 0.18 points per stat | `tests/masterwrought_budget.test.ts`, the flask band arm (both bounds) |
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
plate's duration reverted. **All twelve red.** Each run proved its baseline
green, its patch applied and its tests actually executed, and every worktree
ended with a clean porcelain. The worktrees were throwaway and are gone, so this
is a maintainer RECORD of a run rather than a reproducible artifact; the twelve
mutations are named above so any of them can be re-applied by hand.

## 14. Recorded, not acted on

- **The framework's tool table is stale** (section 7). Its three named tools
  cannot measure a gear kit; the probe family can and does. The committed
  `scripts/r5_envelope_probe.ts` is a fourth member of that family and the table
  should name them.
- **Two tooltips change their text and no screenshot was captured.** The apex
RE-OPENED (qr-18-REOPEN, 2026-08-31): actioned by Phase 18 as tooltip-screenshots-judged-below-bar.
  cloth chest's rating line moves from Hit 40 to Haste 40 and the three flask
  tooltips move from 15 to 13, both rendered from the live def. The repo's
  default workflow asks a visual change for before/after screenshots; this
  phase judged a changed stat NUMBER and a changed rating FIELD in an existing,
  already-screenshotted tooltip layout to sit below that bar, since no layout,
  no string and no surface moved. Recorded as a judgment rather than an
  omission, so a reviewer can overrule it.
- **The apex weapon rung is now +1 over Greater, which is a DEMAND risk under
  R21.** `src/sim/content/enchants.ts` carries its own law that every Greater
  enchant must beat the best base option on its slot and axis by at least 3, on
  the stated reasoning that a shard tier collapsing to a point or two over base
  kills the `arcane_shard` sink. The Lucent weapon rung now clears Greater by
  exactly 1 while costing a `lucent_reagent`, an `arcane_shard` and two
  `arcane_essence` at enchanting 100: the same shape, one tier up. The envelope
  forced it (the term lands twice on a dual-wielder, so +2 over Greater is +4 on
  the binding lane), and raising it is precisely the move R5 forbids. Recorded
  as a judged risk to the `lucent_reagent` sink for a future demand pass, not
  tuned here.
  (RULED (qr-19-disenchant-ratio-outlier, 2026-09-02, under qr-19-best-for-project):
  ACCEPTED on the record with this note standing; the commissioned shard
  supply-and-demand read lives in docs/prd/masterwrought/state.md, THE SINKS
  section of the Phase 11m ledger, and counts reagent rows rather than spend,
  so it leaves this substitution risk as recorded.)
- **The phase file's "11e decision 6"** is ruling 11g-D-C, landed in 11g. The
  content is correct; the label is stale.
  ACTIONED (qr-18-REOPEN, 2026-08-31): Phase 18 corrected the label everywhere
  it stood (item stale-11e-decision-6-label); this row stays as the record.
- **The server PBE boost gives a prot tank a caster belt.** `spiritweld_girdle`
  wins the tank waist in `server/pbe_boost.ts`'s scorer, because a tank role adds
  any armour to identity and the rating term then breaks the tie, costing the
  boosted tank 60 health, 9 strength and 6 stamina for 9 dead intellect. The fix
  is server scorer logic, which is outside this phase's scope. `spiritweld_girdle`
  is correct on its own budget and must not be nerfed for it.
- **`REF_ARMOR = 2861` is a pinned calibration constant, not a live property of
  the catalog** (`tests/heroic_difficulty_floors.test.ts` and its three sibling
  floor suites, `tests/rift_difficulty_floors.test.ts`,
  `tests/gravewyrm_normal_tuning.test.ts`,
  `tests/wildheart_normal_tuning.test.ts`). The real max-armour kit is several hundred points above it and
  was already so before this packet. Raising it would move every difficulty floor,
  so this phase pinned the claim that protects the model instead: removing the
  packet's defs leaves the max-mitigation kit unchanged.
  RULED (qr-19-ref-armor-calibration-constant, 2026-09-01, under qr-19-best-for-project): REF_ARMOR
  stays pinned at 2861 and the widened calibration gap is recorded as the model's stated
  conservatism. Both ladders were solved AT their floors (`src/sim/content/dungeon_difficulty.ts`
  solves the 500 floor at each dungeon's weakest spawn-list mob, `src/sim/rift/ranks.ts` at the
  weakest template of each class), so re-basing the constant is a live difficulty change to R5's two
  protected assets, not a calibration tidy, and the packet's stopping rule sends it to the row 12
  re-measure rather than to this gate. Derived from the committed `armorReduction` in
  `src/sim/types.ts`, never from an R5 re-measure: against the level-22 heroic pin the armour step
  passes 44.24 percent at 2861 and 35.72 percent at 4085, so post-armour melee falls about 19 percent
  (19.3 at level 22, 19.0 at the S-rank level 23) and holding a melee floor would need about 24
  percent more mob melee, while the "~39.8%" the comments quote would read about 32.1 percent.
  AMENDED (qr-19-ref-armor-calibration-constant, 2026-09-01): the sealed sentence above understates
  the gap, and on the raw basis it never described it. The committed max-armour kit pins at 4085
  (`tests/heroic_difficulty_floors.test.ts`, re-pinned 2969 to 4085 at the release/v0.41.0 merge), so
  the live gap is 1224 points, where the pre-raid gap on that same raw basis was 108 (2969 minus
  2861). A gap of 508 does exist, but to R5's own prot-spec tank baseline of 3369 in section 9.5,
  which is a different kit again. The BASIS of 2861 is UNSETTLED and this line does not paper over
  it: the four floor-suite headers call 2861 the max-armour kit with prot mastery folded in, the
  re-pin note calls 4085 and 1582 the raw kit numbers without prot mastery, and prot mastery RAISES
  armour (Recompense `armorPct` 0.10 plus `armorFromStrPct` 0.70 in
  `src/sim/content/talents_warrior.ts`, applied in `src/sim/entity.ts`), so 2861 cannot be a
  mastery-folded reading of a catalog whose raw max-armour kit measured 2969. A third reading sits
  beside those two: `scripts/healing_montecarlo.ts` and `docs/healing-monte-carlo-analysis.md` pair
  2861 armour with 2762 hp on a max-EHP (stamina-first) pick, not a max-armour one. Settling which
  tank and which basis 2861 names belongs to the row 12 re-measure. Phase 18's scoped but unlanded
  provenance debt ("REF_ARMOR's stale calibration comment states its provenance") is paid in this
  same change at the fifteen sites that quote the constant as live fact.
- **The two-piece bound is an equip-transition rule, not a worn-set invariant.**
  A save already over the cap keeps everything it was wearing, deliberately and
  pinned. No shipped player path reaches three; a direct write to
  `meta.equipment` would. Closing it needs a load-time bench, which is sim logic
  and out of scope.
  RULED (qr-19-over-cap-load-bench, 2026-09-01, under qr-19-best-for-project): the
  two-piece bound stays an equip-transition rule and no load-time bench is built.
  Checked: no shipped player path reaches three worn pieces (only a direct write to
  meta.equipment does), so the bench would defend a state the game cannot produce, at
  the price of new sim load logic, a which-piece-benches rule, a full-bag destination
  answer, and save-migration risk on every legacy character. Ratifying the pinned bound
  is the stable answer the directive asks for, not a deferral of the work.
- **The druid balance harness drifted when the packet's defs landed** (its bear
  arm takes 12 percent more damage in the fixture) and was never re-pinned. Its
  assertions are `> 0`, so nothing reds. The per-class gear-identity pin added
  this phase reds on the CAUSE instead, which is the part a band cannot say.
