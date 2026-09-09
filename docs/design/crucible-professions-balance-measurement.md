# Crucible professions balance measurement

This is development evidence for the proposed collection tier, not a claim that
raid encounters are balanced or that these are optimized best-in-slot loadouts.
The source of the proposed player contract is
`docs/design/crucible-professions-integration.md`.

## Scope and controls

The controlled fixture equips six armor pieces in every variant. The incumbent
uses helmet, shoulder, chest, waist, gloves, and feet from one existing cross-tier
lineage. Replacing any two of chest, waist, and feet therefore leaves exactly
four incumbent pieces. The Crucible variant wears four legal pieces of its
matching current raid set and the same two crafted slots. Waist plus feet keeps
the raid chest; a crafted chest uses raid legs instead. The seventh armor slot is
empty in every variant, and weapons and jewelry are fixed across each profile.
This is a clean comparison of the requested set transition, not a gear optimizer.

All eleven crafted profiles and all three slot pairs are checked for legal
equipment and exact set counts. Representative combat measurements use the real
simulation, class rotations, damage, healing, and absorb paths. Unrelated world
entities are removed before combat to bound runtime and prevent their random
activity from dominating the sample. This also means the random stream is not
identical to the historical full-world class-probe baseline.

The damage target borrows Nythraxis's armor at level 20 but is inert. It does not
cast boss mechanics, require movement, or pressure the attacker. Healer pressure
comes from the existing three-ally probe, not from a recorded raid encounter.
Three seeds are repeatable examples, not confidence intervals or exhaustive
coverage of every class, talent choice, uptime pattern, or raid composition.

Controls disable only the proposed crafted signature, or only the incumbent
six-piece tier, in process-local content copies restored after each run. This
separates item-stat changes from the set packages. No shipped content is retuned
by the measurement scripts. The physical incumbent capstone includes 4% haste,
3% hit, and its bleed; the caster capstone includes 4% haste and Soulblaze.

## Literal budget checks

The new base items use primary-stat budgets of 25 for chest, 17 for waist, and
16 for feet. Perfecting raises those budgets to 27, 19, and 17 respectively.
Consequently, a Perfected pair gains only four primary-stat points for chest
plus waist, or three points for either pair containing boots. Ratings, armor,
flat Spell Power, flat Healing Power, and the two-piece signature do not improve.
Perfecting is a marginal finishing step, not the source of the pair's usefulness.
Here armor means the item's flat armor line: additional Agility still grants its
normal derived armor, just as Strength and Intellect still feed their usual stats.

Each physical or tank pair supplies 120 Crit rating and 50 Haste rating. Each
caster or healer pair supplies 50 Crit rating and 120 Haste rating. Caster pairs
have 28 flat Spell Power with a chest or 24 without it. Healer pairs have 20 flat
Spell Power with a chest or 16 without it, plus 8 flat Healing Power. Because the
live stat fold adds Spell Power to Healing Power, the caster/healer profiles must
also be compared for conversion healing and not only by their displayed labels.

The active equipment ceiling remains two Masterwrought items. A crafted armor
pair therefore excludes all Masterwrought weapons and jewelry. The six-slot
fixture does not measure that opportunity cost; it must not be used to claim
that the pair wins against every other profession setup.

## Armor correction from the measurement

The initial boots exceeded the corresponding current raid armor lines: mail
280 versus 255, leather 160 versus 145, and cloth 80 versus 70. The correction
sets crafted boots to 255, 145, and 70. Chest armor remains 380, 215, and 105;
waist armor remains 265, 150, and 75. All match or sit below the corresponding
current Crucible raid pieces. The old cloth Necromancer boots already carry 80,
so comparing only the maximum of all historical gear would miss the current
raid's cloth-boot boundary.

`tests/heroic_difficulty_floors.test.ts` still checks every flagged item against
the actual non-Masterwrought per-slot ceiling. Its census distinguishes the
original 17 items from the 33 new collection items. Equal-armor choices prefer
the existing non-Masterwrought piece before comparing IDs, so merely adding an
equal-armor item no longer changes the reference kit by alphabetical accident.
The real 4085-armor, 1582-health calibration pins are unchanged. No encounter
damage floor or `REF_ARMOR` constant was adjusted to accommodate crafted gear.

## Damage results

Each entry below is the mean of three 120-second runs. A range spans the three
crafted slot pairs, not statistical uncertainty. The old six-piece column is
the same controlled baseline for all pairs in that row. The first four rows
preceded the flat boot-armor correction above; the two remaining caster rows
use the corrected armor. The inert-target damage fixtures receive no incoming
damage, and no offensive stat or signature changed in that correction.

| Profile | Old six | Old four + base pair | Old four + Perfected pair | Crucible four + base pair | Crucible four + Perfected pair |
|---|---:|---:|---:|---:|---:|
| Warspirit, Strength mail | 186.46 | 192.80 to 194.92 | 193.72 to 195.83 | 208.55 to 211.15 | 209.85 to 212.22 |
| Packlord, Agility leather | 166.31 | 178.57 to 178.72 | 178.98 to 179.44 | 198.67 to 200.41 | 200.04 to 201.60 |
| Wildfang cat, Strength leather | 148.04 | 155.31 to 156.89 | 155.87 to 158.33 | 218.93 to 221.46 | 219.51 to 222.05 |
| Moongrove, caster leather | 148.31 | 164.11 to 167.70 | 164.79 to 168.64 | 198.86 to 201.57 | 199.41 to 202.11 |
| Thundercall, caster mail | 150.29 | 158.22 to 161.21 | 158.79 to 161.69 | 183.63 to 188.43 | 184.63 to 189.50 |
| Vespers, caster cloth | 157.84 | 167.63 to 172.36 | 168.23 to 173.90 | 203.07 to 207.64 | 204.63 to 209.40 |

The base mixed pairs improve these six fixtures by about 3.4% to 13.1% over
the incumbent six-piece setup. The signature itself contributes about 2.7% to
3.4% when compared with the same equipment with only that signature disabled.
This does not support increasing base offensive stats further on these profiles.
For example, Warspirit's old six-piece capstone package is worth about 7.5%
against the otherwise identical old-six loadout with that capstone disabled;
the crafted pair still beats the complete old package without Perfecting.

Wildfang's larger jump on replacing the remaining four old pieces is not caused
by a disproportionately large crafting signature: its Crucible-four control
without the crafting signature already reaches 212.12 to 214.46 DPS. Native
Strength itemization and the existing raid-set engine matter substantially.
This is a reason to keep evaluating whole loadouts, not to attribute every gain
in the final column to the new profession bonus.

The crafted chest is useful rather than mandatory. Its pairs lead these damage
fixtures modestly, while waist plus feet preserves a current raid chest and
still improves the incumbent baseline. That conclusion concerns these six-slot
fixtures; it does not establish the best seventh offpiece or a universal BiS pair.

## Tank pressure results

Both tank profiles were rerun after the flat-armor correction. This fixture
applies one physical hit per second for 120 seconds through the real armor,
damage, aura, and absorb paths. Stonebound has Rockbiter Weapon and the druid
is in Bear Form. It does not run active tank rotations, avoidance, or repeated
Lightning Shield smoothing. Health is restored before each hit, so cumulative
health loss measures incoming pressure, not death risk or time to die.

At 180 to 220 raw damage per second, old-six cumulative health loss is 9574 for
Stonebound and 8921 for Bear. Base mixed pairs reduce that to 8406 to 8528 and
8162 to 8560 respectively. Base Crucible-four pairs take 8105 to 8300 and 8474
to 8714. These are rounded three-seed means, with ranges across the three slot
pairs, not uncertainty intervals.

At this pressure, some better-mitigated or higher-health configurations never
lose 40% of maximum health inside the rolling ten-second window. In particular,
the Crucible-four Bear configurations consume no collection ward. Perfecting
can also move a configuration below that threshold: more maximum health does
not guarantee more ward absorption at a fixed incoming damage rate. That is
consistent with a burst-defense trigger, not a permanently active mitigation
bonus. The 20-second cooldown further limits repeated activation.

Doubling the pressure to 360 to 440 raw damage per second exercises that burst
defense in every pair. Results below use the corrected armor. "Absorb" is total
damage actually consumed by wards, not the nominal amount of shields created.

| Profile and armor stage | Base health loss | Base absorb | Perfected health loss | Perfected absorb |
|---|---:|---:|---:|---:|
| Stonebound, old six | 19140 | 0 | n/a | n/a |
| Stonebound, old four + pair | 17137 to 17495 | 735 to 740 | 17122 to 17490 | 740 to 755 |
| Stonebound, Crucible four + pair | 15823 to 16253 | 715 to 730 | 15818 to 16243 | 725 to 735 |
| Bear, old six | 17843 | 0 | n/a | n/a |
| Bear, old four + pair | 16392 to 16885 | 715 to 735 | 16335 to 16851 | 730 to 750 |
| Bear, Crucible four + pair | 16095 to 16584 | 835 to 855 | 16050 to 16554 | 845 to 865 |

Disabling only the crafted signature increases health loss by exactly the
absorbed totals in the base columns. The remainder of the improvement is
itemization and the retained raid package, not the new ward. Base mixed maximum
health is 1833 to 1853 for Stonebound and 1784 to 1836 for Bear, versus 1763 and
1628 on old six. The Crucible-four Bear configuration raises that further to
2083 to 2135. These results support a useful defensive option but do not prove
that the proc is tuned for the actual frequency of any raid boss's damage spikes.

## Healing and absorb results

All three healer profiles were rerun after the pure-healer ward correction.
The earlier implementation required the healer's own `inCombat` flag, which
excluded a healer who only restored engaged allies and never attacked or took
damage. The corrected collection logic accepts those engaged friendly targets
without changing global combat state. Both Spiritmend and Groveheart now create
usable wards while their own `inCombat` flag remains false. Real Regrowth and
Wildbloom regressions separately pin that behavior.

The existing healer fixture starts three allies at 35% health. Once all have
recovered to 80%, it applies 12% of each ally's maximum health as damage every
second until the 60-second run ends. An earlier initial recovery therefore also
starts sustained pressure earlier. HPS is effective healing, not unlimited
healing capacity. "Absorb" below includes all consumed shields: Doctrine's
class shields as well as any collection ward. Ranges span the three crafted
pair means, each averaged over the same three seeds.

| Profile and armor stage | Base HPS | Perfected HPS | Base absorb | Perfected absorb |
|---|---:|---:|---:|---:|
| Spiritmend, old six | 230.01 | n/a | 0 | n/a |
| Spiritmend, old four + pair | 262.54 to 268.48 | 262.29 to 267.79 | 496 to 606 | 533 to 629 |
| Spiritmend, Crucible four + pair | 265.62 to 265.84 | 265.32 to 265.78 | 1197 to 1218 | 1202 to 1239 |
| Groveheart, old six | 126.31 | n/a | 0 | n/a |
| Groveheart, old four + pair | 217.23 to 227.08 | 217.47 to 236.65 | 96 to 146 | 104 to 152 |
| Groveheart, Crucible four + pair | 265.66 to 268.79 | 267.45 to 270.34 | 515 to 538 | 528 to 532 |
| Doctrine, old six | 82.67 | n/a | 2147 | n/a |
| Doctrine, old four + pair | 97.26 to 98.39 | 97.51 to 100.89 | 2400 to 2406 | 2401 to 2404 |
| Doctrine, Crucible four + pair | 135.31 to 164.77 | 158.86 to 165.24 | 3008 to 3432 | 3331 to 3433 |

Spiritmend keeps all three allies alive in every mixed and raid run. Its old
six-piece baseline ends with 2, 0, and 3 living allies across the three seeds.
Groveheart loses all three on old six and usually loses allies on mixed gear,
but keeps all three alive in every raid run. Doctrine loses all three on old
six and mixed gear. On base raid gear, its chest-containing pairs finish with
1, 0, and 0 survivors; waist plus feet finishes with 1, 0, and 3. Perfecting
improves the chest-pair result to 1, 1, and 0 but does not turn this pressure
fixture into a stable three-target Doctrine healing result.

These survival boundaries rule out reading the table as a clean percentage
power increase. Absorbs can also reduce measured HPS by preventing the injury
that would otherwise need healing. For example, the Spiritmend raid control
with only the crafted signature disabled heals 284.02 to 284.12 HPS and absorbs
zero; with the signature it heals about 266 HPS and absorbs about 1200 damage,
while all three allies survive both versions. The Groveheart raid control
without the signature likewise keeps all three alive. The collection ward is
working, but cannot be credited with all the improvement over old six.

Doctrine is a remaining tuning caution, not evidence of a new regression or a
reason to automatically raise profession item budgets. A targeted conversion-
healer comparison should hold survivable incoming pressure constant and test
the competing caster and healer collection profiles with an appropriate
rotation. This bounded matrix establishes legal item coverage and real healing
integration for the conversion-healer profile, not universal healer parity.

## Zeal supplementary measurement

The existing full-world `runOwnedClassDpsProbe` was also run on its unchanged
Warspirit PBE loadout, `OWNED_CLASS_LEVEL_20_BOSS_SCENARIO` (120 seconds), with
seeds 29900, 29901, and 29902. Unlike the isolated collection matrix, unrelated
world entities were retained for this supplementary comparison. The only setup
change was stamping `enchant_weapon_lastflame_zeal` onto both equipped weapon
instances. There were no new armor pieces, Perfecting bonuses, or other enchants.

| Weapon setup | Seed 29900 DPS | Seed 29901 DPS | Seed 29902 DPS | Mean DPS |
|---|---:|---:|---:|---:|
| Neither weapon enchanted | 166.31 | 173.29 | 181.29 | 173.63 |
| Zeal on both weapons | 197.15 | 199.41 | 201.23 | 199.26 |

The mean increase was 14.76%. This is already a substantial offensive enchant
for a Strength-scaling dual-wield build. It is not evidence that every class
receives that gain: weapons, special-attack frequency, Strength conversion,
dual-wield availability, and encounter uptime differ. Healing was not measured
by this DPS probe, and three seeds do not establish a confidence interval.

## Reproduction and verification

The matrix uses seeds 29900, 29901, and 29902. Each profile emits 20 JSONL rows,
including the old-six capstone control and rank-zero signature-disabled
controls. Every row retains the three individual runs as well as their mean.
Run profiles sequentially on shared development machines:

```sh
npx tsx scripts/crucible_professions_balance_probe.ts --stats
npx tsx scripts/crucible_professions_balance_probe.ts str_mail agi_leather str_leather caster_leather caster_mail caster_cloth
npx tsx scripts/crucible_professions_balance_probe.ts healer_mail healer_leather healer_cloth
npx tsx scripts/crucible_professions_balance_probe.ts tank_mail tank_leather
npx tsx scripts/crucible_professions_balance_probe.ts tank_mail tank_leather --tank-burst
node node_modules/vitest/vitest.mjs run tests/heroic_difficulty_floors.test.ts tests/crucible_collection_armor.test.ts tests/owned_balance_probe_setup.test.ts tests/crucible_balance_probe.test.ts --maxWorkers=1
```

The armor-only census produces 143 rows across all eleven profiles, all three
slot pairs, both mixed stages, and both Perfecting ranks. The focused test
command passes all 18 tests. The separate real-healer integration and collection
effect suites pass all 43 tests after the healer correction. These diagnostic
checks supplement, and do not replace, the branch's shared QA gate.

## Balance conclusion and limits

The measured base offensive pairs already give players a reason to break their
old six-piece set, including the waist-plus-feet option that keeps a raid chest.
Perfecting adds a small finishing gain rather than unlocking the useful power.
Both tank profiles gain useful stats and show real ward mitigation under the
higher-pressure fixture. All three healer profiles have working item and ward
integration, with the conversion-healer pressure caveat described above.

The evidence does not support increasing base offensive budgets now. It also
does not establish a universal best-in-slot ranking, quantify the opportunity
cost of giving up Masterwrought weapons or jewelry, or prove performance against
live raid movement, add waves, damage-school mixes, tank spikes, and healing
assignments. These are simulation measurements, not observed player sentiment
or data about how quickly players will acquire the items.
