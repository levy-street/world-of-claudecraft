# Crucible of the Last Spring: raid loot plan

## Status

Living design for the complete loot table of the Crucible of the Last Spring
raid (docs/prd/ignivar-raid.md). This is the planning pass: it defines every
set, item, token, and drop assignment before any content records land. The two
shipped encounters (Ignivar, Herald of the Last Flame and Varkhul, Forgefather
of the Last Flame) carry the whole table for now; later bosses in this content
phase will take over slices of it (see "Future redistribution").

Scope decisions fixed by the maintainer:

- Raid drops are item level 35.
- Every class-and-spec pair gets a five-piece tier set in the style of classic
  World of Warcraft tier gear, acquired through class-group tokens that drop
  from bosses and are redeemed at a quartermaster.
- There are 29 sets: one per class-and-spec pair (9 classes times 3 specs,
  the full table in src/sim/content/dev_kit_roles.ts) plus two extra
  off-tank sets, so both hybrid specs carry a damage set and a tank set: a
  druid feral bear tank set and a shaman enhancement tank set.
- The table must cover every equipment slot for every armor variant in the
  game, plus a full weapon spread: one-handers, two-handers, shields, held
  offhands, spell damage weapons, and healing weapons.

The profession arm of this tier (drop-taught recipes, the crafted
best-in-slot pieces, and the core reagent economy) is specified in its
companion doc, docs/prd/ignivar-raid-professions.md.

## Review of the existing armor sets

All current sets live in src/sim/content/item_sets.ts and resolve through
aggregateSetBonuses into recalcPlayerStats; procs resolve in
src/sim/combat/set_procs.ts. Four families exist today:

| Family | Sets | Pieces | Breakpoints | Source |
|---|---|---|---|---|
| Tier 1 | deathlord (mail, Strength), wyrmshadow (leather, Agility), necromancers (cloth, caster) | 4 | 2/3/4 (merging into a 2/4/6 lineage ladder, see the Prerequisite section) | Gravewyrm Sanctum bosses |
| Tier 2 | crownforged, nighttalon, soulflame, stormcallers | 4 | 2/3/4 (merging into a 2/4/6 lineage ladder, see the Prerequisite section) | Nythraxis raid (helm, shoulder) + Thunzharr world boss (gloves, waist) |
| Leveling haste kits | vale_arcanist, boundstone_vanguard, greyjaw_stalker | 3 | 3 | existing world drops, re-tagged |
| WARFARE (PvP) | five honor families | 7 | 2/4/7 | quartermaster, honor priced, zero PvE contribution |

What the review says about the current model, and what this tier changes:

1. **Sets are shared archetypes, not specs.** Tier 2 has four families for 27
   specs: crownforged serves warrior AND paladin in every role, soulflame
   serves every cloth caster. Spec identity comes only from talent baselines,
   never from gear. This tier moves to one set per class-and-spec pair, which
   is the whole point of the 29-set request (one set per spec, plus
   dual-role sets for the two off-tank hybrids).
2. **Caster itemization has no authored affixes.** The spellPower field on
   BaseItemDef is fully engine-wired (recalcPlayerStats sums it; heals and
   damage spells both consume it via directHealBonus/directHitBonus) but not
   one shipped item carries it. Healers are itemized today as int/spi piles,
   identical in shape to damage casters. There is no healing affix at all.
   This tier introduces authored Spell Damage and a new Healing Power affix
   (see "Two affix debuts").
3. **Piece redemption is direct drop.** Tier 2 helms and shoulders drop as
   finished items from the raid boss; gloves and belts from the world boss.
   No token or per-slot redemption mechanic exists. The closest seam is the
   Heroic Marks currency (heroic_mark item + the Heroic Quartermaster stock in
   src/sim/content/heroic_vendor.ts), which this tier extends into per-slot,
   class-group tokens.
4. **Existing bonus structure is 2/3/4 with a 4-piece proc.** The resolver
   surface (SetBonusEffect + SetProc) is rich enough for this tier: the new
   sets keep the same machinery with 5-piece families and 2/4 breakpoints.
   The magnitudes of the incumbent bonuses, however, are a launch blocker
   for this tier; see "Prerequisite: retune the incumbent set stack".
5. **Budget enforcement is real.** tests/item_level.test.ts sweeps every
   shipped item against primaryStatBudget, so every new piece must land its
   exact primary-stat budget. Ratings, spellPower, and armor are off that
   budget by design (the heroic_loot.ts convention).

## Prerequisite: retune the incumbent set stack

### The evidence

Audited 2026-08-26 against the live parse service (the rankings and fight
read API behind parses.worldofclaudecraft.com): the top five Nythraxis
parses per spec, both difficulties, best-per-character, with each top
parser's equipment snapshot classified by set membership (252 top parses,
187 distinct fights).

Result: the top parsers of essentially every spec wear six to seven old-set
pieces at once. The universal pattern is the tier-2 four-piece plus the
tier-1 three-piece, which is possible because the two tiers deliberately
occupy complementary slots: tier 2 covers helmet, shoulder, gloves, waist
and tier 1 covers chest, legs, feet (plus one overlap piece). The rank-one
fury warrior (310 DPS, the top Normal parse alongside combat rogue 330 and
enhancement 320) wears exactly crownforged helm, shoulder, gloves, waist
plus deathlord chest, legs, feet. Casters do the same with soulflame plus
necromancers, mail casters with stormcallers plus necromancers. 36 percent
of the worn set pieces are heroic variants: makeHeroicVariant spreads the
base def, so the `set` tag rides the item-level ladder to 33 and the
bonuses never have to be broken to upgrade.

What the double stack pays (Strength archetype): 80 flat attack power (two
2-piece tiers), 30 primary stats (two 3-piece tiers), 7.5 percent haste,
6 percent Hit, and the Bonesplinter bleed (roughly another 40 attack power
of sustained damage). Casters: 40 flat spell power, 25 primary stats, 7.5
percent haste, full cast-pushback immunity, and the Soulblaze proc. Against
that, an item-level-35 upgrade offers a few primary-stat points per slot
and one ratings step; the new tier's own 2-piece plus 4-piece is far
smaller than what breaking the old stack forfeits. The new sets would be
dead on arrival for exactly the players they target. Confirmed both by the
math and by live behavior: the playerbase has already solved this ladder,
and the answer is the old stack.

### Root causes

1. **Cross-tier stacking.** Tier 1 and tier 2 families share an archetype
   but not slots, so their bonuses sum, and because bonuses start at 2
   pieces a three-piece dip into the second family pays its 2-piece AND
   3-piece tiers. Any new tier competes with the combined package of two
   sets, not one.
2. **Bonus magnitudes sized like a tier, not like a bonus.** 7.5 percent
   haste at 3 pieces and 6 percent Hit at 4 pieces dwarf the per-slot
   item-level deltas (0.7 primary points per level times slot mult) and
   even the whole ratings ladder step (40 to 55 to 65 rating).
3. **Heroic variants inherit set tags**, so the classic tradeoff (break
   the set to wear higher item level) never occurs; the stack upgrades in
   place.

### The retune: merge each archetype into one 2/4/6 lineage, then halve

Two moves, by maintainer decision, and the structural one comes first.

**Move 1: each archetype's tier-1 and tier-2 families merge into one
counted lineage with breakpoints at 2, 4, and 6 pieces.** No single old
family has six pieces, so the requirement raise only works by counting
across the tiers that players already stack: deathlord plus crownforged
(Strength), wyrmshadow plus nighttalon (Agility), and necromancers plus
soulflame plus stormcallers (caster; the two tier-2 caster families share
slots, so they can never be worn together and one lineage covers both).
Every lineage unions to exactly seven wearable slots with one overlap, so
six pieces is a real commitment of six of the seven armor slots. This is
the WARFARE shape (2/4/7 across seven pieces) applied to the PvE
incumbents.

What this does to the meta: today's stack (tier-2 four-piece plus tier-1
three-piece) collects TWO near-full bonus packages from seven pieces.
Under the lineage ladder those same seven pieces are simply 6-of-7 of ONE
package, sized once, and the top of that package now requires six pieces
where today the whole tier-2 payload arrived at four. Nothing existing
players own is invalidated: a full old tier-1 or tier-2 four-piece still
pays the 2-piece and 4-piece tiers, close to its retuned single-family
value, and deep collectors keep a designed capstone instead of an
accidental double-dip.

Mechanism (a small resolver change, test-first): ItemSet gains an
optional lineage id; recalcPlayerStats keeps counting per-family tags
exactly as today, and aggregateSetBonuses sums the counts of families
sharing a lineage and applies the lineage's single bonus table in place
of the per-family tables. Item `set` tags, item ids, and family names do
not change, so there is no shipped-id churn; the set tooltip shows
lineage progress across both tiers.

**Move 2: halve the magnitudes inside the merged ladder** so even the
full six-piece capstone sits below the value of a full new-tier kit. All
three t1 procs survive at the 4-piece tier and all three t2 procs become
the 6-piece capstones, so no named effect is deleted:

| Lineage | 2 pieces | 4 pieces | 6 pieces |
|---|---|---|---|
| Strength (deathlord + crownforged) | Str 10, Sta 10 | attack power 25 + Gravemight at 40 attack power | 4 percent haste + Hit 3 percent + Bonesplinter at 5 per tick |
| Agility (wyrmshadow + nighttalon) | Agi 10, crit 1 percent | attack power 25 + Fangrush at 15 percent attack speed | 4 percent haste + Hit 3 percent + Ragged Gash at 4 per tick |
| Caster (necromancers + soulflame + stormcallers) | Int 10, Spi 10, 50 percent pushback | spell power 12 + Clearcasting at 6 percent chance | 4 percent haste + Soulblaze at 25 spell power |

Constant changes: SET_HASTE_3PC_RATING 150 to 80 (7.5 to 4 percent, with
the test-pinned SET_HASTE_3PC literal moving in step), SET_HIT_4PC_RATING
60 to 30. Full cast-pushback immunity leaves the incumbents (they keep 50
percent at 2 pieces) and moves to the new tier's caster and healer
2-piece bonuses.

**Hit seed flip (part of the retune).** The authored tier-2 pieces are
seeded with hitRating 20 (crownforged, nighttalon, AND soulflame;
stormcallers is crit), and the heroic-variant rule "the base's rating
key wins" turns each heroic-33 copy into 55 Hit: a heroic four-piece
alone carries 220 ambient Hit, 280 with today's 4-piece bonus. That is
past the +3 heroic melee cap (260 rating) and about 80 percent dead
weight against the equal-level Normal raid (cap 50). The retune flips
the authored seeds to the archetype's throughput rating (crownforged
and nighttalon to critRating 20, soulflame to hasteRating 20); the
heroic variants then derive 55 crit or haste through the existing rule
with no variant-code change. After the flip, the retuned 6-piece
lineage bonus (3 percent) is the only Hit the old stack provides, and
old kits stop carrying mostly-dead Hit into Normal content.

**The Hit program is ladder-wide, not raid-only.** Player feedback on the
earlier set-bonus pass called the catch-22 exactly: when the raid tier,
the five-man heroic off-pieces, AND the mark-vendor jewelry all carry
Hit, no gearing path avoids it and no slot presents a choice. The audit
confirms it for the physical slots: both non-tank heroic chests
(morthens_cryptforged_hauberk, basin_stalkers_tunic), both dps heroic
legs (tidewoven_trousers, bloodmane_war_legguards), both heroic feet
(bonechill_striders, tideworn_warboots), and both heroic waists
(bonechill_cord, gravescale_girdle) are Hit; the Strength jewelry lane
is Hit across the board, including oath_of_the_round_table, a Hit ring
wearable twice. So the retune adopts one rule for the whole ladder:

- **Every physical slot family keeps at least one Hit and one non-Hit
  option at comparable power.** Where both options are Hit today, one
  flips to crit or haste: morthens_cryptforged_hauberk (chest),
  bloodmane_war_legguards (legs), tideworn_warboots (feet), and
  gravescale_girdle (waist) flip to crit; basin_stalkers_tunic,
  tidewoven_trousers, bonechill_striders, and bonechill_cord keep Hit
  as the deliberate +3 answers. Helmet, gloves, and weapon pairs
  already offer both and stay.
- **Vendor jewelry keeps exactly one Hit neck and one Hit ring per role
  lane**: seal_of_the_nine_oaths and oath_of_the_round_table remain the
  Strength Hit pair; swiftfang_talisman flips to haste so the melee
  lane gains a non-Hit alternative. Caster five-man pieces already mix
  4 Hit / 8 crit / 6 haste and stay.

These are live-gear changes like the rest of the retune and ship in the
same release as the new loot.

One measured side effect, accepted deliberately: the WARFARE balance
harness (tests/warfare_balance_harness.test.ts) checks that PvE gear
stays within a band of the honor kit in PvP, and the retuned incumbent
reference now measures below its old floors (armor-only 0.701 against a
0.8 floor, full kit 0.756 against 0.9, and the legendary arm 0.824
against 1.0). The harness carries re-pinned INTERIM floors with notes;
the item-level-35 kits become its PvE reference when they land and the
original floors return. Until players re-gear, old-set wearers sit
further behind WARFARE kits in PvP than before, which is the honest
transitional reality of softening the incumbents. WARFARE families are untouched (already PvE-inert and
already lineage-shaped). The haste leveling kits keep their single
3-piece tier and ride the shared haste constant down, which is
acceptable for leveling gear. Heroic set-tag inheritance stays:
it is fine inside a single sized ladder, and stripping tags from heroic
variants would invalidate loot players already won.

The new tier deliberately keeps its 2/4 breakpoints and stays outside the
incumbent lineages. A transitional blend is the intended migration path,
not abuse, and it tapers naturally: the new five-piece slots (helmet,
shoulder, chest, gloves, legs) cut straight through both old tiers'
slots, so a new four-piece leaves room for at most two or three lineage
pieces, which pay only the 2-piece entry tier. The static viability check
(below) shows full-new above the full six-piece capstone and every blend.

After both moves the deep seven-piece collector pays roughly 25 attack
power plus the retuned Gravemight, 20 primary stats, 4 percent haste, 3
percent Hit, and a lighter bleed: one halved package where today there
are two. A full new kit answers with its own 2-piece and 4-piece, two
more item levels of budget over the heroic-33 copies, the 60/25 ratings
step, and for casters and healers the Spell Damage and Healing Power
affix debut (a five-piece caster set carries roughly 58 authored Spell
Damage the old stack simply does not have). The 6-piece capstone values
are the numbers most likely to need a further shave; the static check
below is re-run whenever they move.

### Viability check (static)

Reviewed 2026-08-26 with the live derivation constants (attack power 2 per
Strength for the heavy classes, swing damage AP/14, 20 rating per percent
of crit or haste, 10 per percent of Hit, spell power 0.5 per Intellect).
Both kits are compared at their best case: the old side wears the ideal
retuned six-piece lineage (heroic-33 tier-2 in helmet/shoulder/gloves/
waist, heroic-28 tier-1 in chest/legs, the best free ilvl-31 feet), the
new side a full five-piece plus new waist and feet at 35 with the 60/25
ratings. Armor slots and set bonuses only; jewelry and weapons are common
to both sides.

| Term | Old best kit | New full kit | Delta |
|---|---|---|---|
| Primary stat points (gear + set tiers) | 141 | 136 | old ahead by 5 |
| Rating points (gear + capstone haste/hit as rating equivalents) | 450 | 595 | new ahead by 145 |
| Flat plus proc-average attack power (Strength case) | ~47 | engine bonuses (not AP-denominated) | see note |
| Spell Damage (caster case, affix debut included) | ~22 | ~108 | new ahead by ~86 |
| Healing Power (healer case) | 0 | ~143 | new ahead outright |

Conclusions:

- **Every archetype prefers the full new kit.** The gear itself (budgets,
  the ratings step, the affix debuts) carries the margin before set
  bonuses are counted at all: melee roughly break even on gear alone
  against the best old stack and casters and healers are decisively
  ahead. The new engine-hooking bonuses are the deliberate tiebreaker:
  each 2-plus-4 pair is tuned to be worth at least the retired flat
  package (roughly five to eight percent of spec throughput), so the full
  new kit wins for every archetype once its bonuses are counted, and the
  tuning pass measures exactly that.
- **The old side above is the best case.** It assumes full heroic
  variants; the median raider's mix is weaker, so real margins are wider.
- **There is a one-swap valley, and it is accepted.** The first new piece
  breaks the old six-piece capstone before any new bonus exists, a small
  net loss until the second piece lands the new 2-piece tier. One swap
  deep is classic-normal, and the token flow (a sigil converts to a piece
  immediately) makes the two-piece threshold fast. No further softening
  of the old capstone is needed for this.
- **The melee margin leans on the 60/25 ratings step.** If that proposal
  is trimmed later, melee viability thins first; re-run this check
  whenever either side's numbers move.
- **Hit is honest on both sides after the seed flip.** Before it, the old
  heroic kit carried about 280 Hit rating, mostly dead against Normal
  bosses and past cap even at +3; counting it at face value flattered
  neither side accurately. With old pieces flipped to crit and haste and
  the new tier's Hit confined to elective slots, the rating totals above
  compare live stats to live stats, and the delta stands.

### Guard

Settled 2026-08-27: no simulation harness. The viability contract is the
two levers this plan already pulls, checked three simpler ways:

1. The new gear carries Hit exactly where each role needs it (the Hit
   acquisition guarantee above), so nobody is forced back into old gear
   for Hit.
2. The old set bonuses come down (the lineage retune) so the new set
   bonuses are the draw.
3. Checks: ordinary unit tests pin the retuned lineage tables and
   constants so they cannot silently regress; the static viability check
   below is re-run whenever numbers on either side move; and after
   release the live parse service verifies adoption for real (the same
   top-parse gear audit that exposed the problem shows whether top
   loadouts migrate to the new sets).

### Sequencing

The retune lands on this PR, in the same release as the new loot: softening
the incumbent stack only when the replacement chase exists. It must never
ship on its own ahead of the raid loot.

## Itemization framework

### Item level 35, by derivation

Item level is never authored; it derives in src/sim/item_level.ts as source
level + quality bonus + raid bonus. Both bosses are level 20 with
suggestedPlayers 10, so mob-table drops would read source 20 and land epics at
29. To land 35 the loot registers an explicit source level, exactly the way
NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL already does:

- New constant IGNIVAR_RAID_LOOT_SOURCE_LEVEL = 26 in the new loot content
  module.
- buildSourceIndex registers every Ignivar-tier item id (set pieces, off-set
  pieces, weapons, jewelry, and vendor-redeemed items) at source 26 with the
  raid flag set, so epics read 26 + 6 + 3 = 35.
- Vendor-redeemed set pieces never appear on a mob table, so this explicit
  registration is mandatory for them, not just convenient.
- Boss mob levels stay 20. Raising them would change hit/crit/resist math
  against level-20 players, which is a combat change this loot pass must not
  make.

The current ladder this slots above: Nythraxis normal raid epics 29, five-man
heroic epics 31, Heroic Nythraxis raid epics 33, legendaries 37. Ignivar
normal at 35 is the new best pre-legendary tier. By maintainer decision
this raid runs ONE loot tier across both difficulties: there is no heroic
item-level layer and no heroic_variants pass for this raid. Heroic pays in
ACCESS (the loot spreads across the Normal and Heroic layers, see the boss
tables), which also keeps the tier below the item-level-37 legendary
ceiling.

### Primary stat budgets at item level 35

From primaryStatBudget (STAT_PER_ILVL 0.7, epic quality mult 1.0, slot mults
in src/sim/item_budget.ts). These are exact numbers the budget sweep will
enforce:

| Slot | Mult | Budget |
|---|---|---|
| chest, mainhand (one-hand) | 1.0 | 25 |
| legs | 0.9 | 22 |
| helmet | 0.85 | 21 |
| shoulder, offhand (held) | 0.75 | 18 |
| gloves, waist | 0.7 | 17 |
| feet, neck | 0.65 | 16 |
| ring | 0.6 | 15 |
| two-hand weapon | 1.0 x 1.3 | 33 |

Weapon damage: weaponDpsBudget(35) = 17.2 dps for one-handers, times
TWOHAND_DPS_MULT for 19.8 dps on two-handers. Swing speeds follow class
conventions (fast dagger 1.8, one-hand 2.4 to 2.6, two-hand 3.4 to 3.6,
staves 3.2, bows 2.8, wands 1.5).

### Combat ratings ladder step

The heroic ladder is: five-man heroic armor one rating at 40; Heroic
Nythraxis raid armor 55 primary + 20 secondary, weapons 65 + 30 (constants in
heroic_loot.ts and heroic_variants.ts). Ignivar tier steps once more:

- IGNIVAR_ARMOR_PRIMARY_RATING = 60, IGNIVAR_SECONDARY_RATING = 25.
- IGNIVAR_WEAPON_PRIMARY_RATING = 70, weapon secondary 30.
- Healer-facing pieces never carry Hit (heals are not resisted); jewelry
  carries a single rating.

**Hit is scarce by policy on this tier.** Hit is the densest rating in the
game (10 rating per percent against 20 for crit and haste, no
above-level suppression), and the useful amounts are small: the melee
miss floor against an equal-level raid boss is 5 percent (50 rating), the
spell resist floor about 4 percent, and only +3 heroic content opens the
big 26 percent melee window (260 rating). A tier that showers Hit both
kills the stat as a choice and ships dead weight on mandatory pieces. So:

- Tier set pieces NEVER carry Hit. Their primary is crit or haste per the
  spec identity, with the other as secondary.
- Hit appears only on elective pieces: the waist off-set of each physical
  (tanking included) and spell-damage variant carries Hit 60 as its
  primary; the physical
  neck, the physical ring, and the spell-damage ring carry Hit 25 as
  their single jewelry rating; and three weapons carry Hit 30 as their
  secondary: the two one-hand physical weapons (Cinderfang Kris,
  Slagrender Cleaver) and the caster wand (Wand of Quenched Sparks).

**Hit acquisition guarantee.** Scarce must never mean starved: every role
covers its real window from guaranteed drops. The windows come from the
live formulas (melee miss 5 percent at equal level plus the 10 percent
dual-wield white penalty; spell hit 96 percent base, gear-cappable to
100):

| Role | Window vs the Normal raid | Elective sources | Reachable |
|---|---|---|---|
| Two-hand melee, tanks, hunters | 50 | waist 60; neck and ring 25 each; weapon 30 | one piece covers it |
| Dual-wielders (fury, rogues, enhancement), white swings | 150 | waist 60 + neck 25 + ring 25 + both weapons 30 | 170 |
| Damage casters | 40 | waist 60, or ring 25 + weapon 30 | one to two pieces |
| Healers | none (heals are not resisted) | none | n/a |

Every hit elective sits in a guaranteed sum-to-1 roll group (the necks,
waists and the two hit weapons in Ignivar's Normal-only ignivar_offset
partition, the rings in Varkhul's varkhul_offset), so hit is farmable,
never a lucky bonus drop. The one-item-per-five-raiders re-cut halved the
flow of every elective but kept each in a guaranteed group, with one
consequence stated plainly: those groups are NORMAL-only. The Heroic
exclusive partitions carry hit only on the six marquee weapons (30 each),
so a roster that raided Heroic alone would top out at 60 against the 130
melee and 110 spell caps. That is the intended shape, not a gap: Heroic
pays the exclusives, Normal pays the electives, the two difficulties hold
separate weekly locks, and a Heroic roster farms its cap from its Normal
lock the same week. Pinned per difficulty by the elective-lanes case in
tests/ignivar_loot.test.ts, so a re-cut that strands a lane on neither
table, or quietly re-seats one, re-decides this section.

Against +3 heroic content the windows are 260 melee and 250 spell. After
the ladder-wide diversification (below), one deliberate Hit piece
remains in each five-man heroic slot family: blending the tier's 170 of
electives with the surviving 40-hit chest, legs, or feet reaches the 260
melee window at the cost of two to three set pieces and their budget,
which is the intended deliberate chase. The dual-wield white window
against +3 (360) is explicitly not a target, matching the classic
reality that dual-wield whites never cap against bosses.

These are proposed constants on the existing curve, confirmed against the
static viability check in the tuning pass before merge.

### Two affix debuts

**Spell Damage (existing field, first authored use).** Damage-caster pieces
carry flat spellPower. Proposed per-slot values (off the primary budget, like
ratings): 14 on chest/legs/helmet, 10 on shoulder/gloves/waist, 8 on
feet/jewelry, 26 on staves, 16 on one-hand caster weapons, 10 on held
offhands and wands. For scale: SPELL_POWER_PER_INT is 0.5, so a full five-set
plus weapon adds roughly the spell power of 120 intellect, a meaningful but
not runaway step for level-20 kits.

**Healing Power (new affix).** The maintainer's brief separates "+ healing"
items from "+ spell damage" items, and classic itemization does the same:
healer gear boosts healing only, so healers cannot double-dip damage. The sim
needs one small seam:

- BaseItemDef gains healPower?: number.
- recalcPlayerStats sums it into a new Entity.healPower total (alongside the
  spellPower derivation).
- The heal paths (directHealBonus call sites in combat/effect_dispatch.ts and
  friends) consume spellPower + healPower where they consume spellPower
  today. Damage paths do not read healPower.
- Tooltip line, wire/inspect parity for both worlds, and a focused test
  land in the same change (this is a sim change, so it is test-first).
- Classic exchange rate: healing is budget-priced at about half spell damage,
  so healer pieces carry roughly 1.8x the numbers above: 25 on
  chest/legs/helmet, 18 on shoulder/gloves/waist, 14 on feet/jewelry, 45 on
  staves, 30 on one-hand healer weapons, 18 on held offhands.

Settled by the maintainer (2026-08-27): the real affix, with the classic
directionality stated as the contract: Spell Power adds to healing, but
Healing Power never adds to damage. The heal paths read spellPower plus
healPower; the damage paths read spellPower only.

### Armor values

Armor is off the stat budget. Values scale the existing heroic-tier epics up
about 12 percent (two item levels): mail chest 375, leather chest 210, cloth
chest 95, scaled per slot with the same proportions the existing tiers use.
Shields carry tank armor plus blockValue on the crownforged shield curve.

## Spec map: who wears what

Armor proficiency (src/sim/equipment_rules.ts): mail = warrior, paladin,
shaman; leather = druid, rogue, hunter; cloth = priest, mage, warlock. There
is no plate; "plate" in old comments means the Strength mail archetype.

The 10 armor variants map to the 27 specs (and 29 sets) like this:

| Variant | Specs (count) |
|---|---|
| Cloth spell damage | priest shadow (Vespers), mage fire (Pyromancy), mage frost (Cryomancy), warlock affliction (Hexcraft), warlock demonology (Necromancy), warlock destruction (Ruination) (6) |
| Cloth healing | priest discipline (Doctrine), priest holy (Benison), mage arcane (Chronomancy) (3) |
| Leather tanking | druid feral (Wildfang), the bear tank set (1) |
| Leather dps | rogue assassination (Knifework), rogue combat (Thuggery), rogue subtlety (Skulduggery), hunter beast_mastery (Packlord), hunter marksmanship (Coldsight), hunter survival (Fieldcraft), druid feral (Wildfang) cat set (7) |
| Leather spell damage | druid balance (Moongrove) (1) |
| Leather healing | druid restoration (Groveheart) (1) |
| Mail tanking | warrior prot (Ironguard), paladin protection (Faithwarden), shaman enhancement (Warspirit) off-tank set (3) |
| Mail dps | warrior arms (Battlecraft), warrior fury (Bloodrush), paladin retribution (Dawnreaver), shaman enhancement (Warspirit) (4) |
| Mail spell damage | shaman elemental (Thundercall) (1) |
| Mail healing | paladin holy (Sunmender), shaman restoration (Spiritmend) (2) |

Notes that are not the genre default and must not be "corrected": mage arcane
(Chronomancy) is a healer; druid feral (Wildfang) is the declared tank spec;
hunters are a leather class; enhancement, hunter, and feral itemize
Agility-led, not Strength-led (dev_kit_roles.ts weights).

Two specs carry two sets each, by maintainer decision: feral gets a cat
damage set (Wildfang Emberhide) and a bear tank set (Cinderbark Ward), and
enhancement gets its damage set (Warspirit Emberscale) and an off-tank set
(Stonehearth Bastion). That makes 29 sets across 27 specs, with tank
coverage in both leather and Agility mail.

## The 29 tier sets

### Structure

- Five pieces per set: helmet, shoulder, chest, gloves, legs.
- Breakpoints at 2 and 4 pieces (the classic five-piece convention): the
  fifth slot is a genuine choice between finishing the look and taking a
  strong off-set piece. The 2-piece is a flat stat line; the 4-piece is a
  proc or rating package with a set-specific flavor name.
- Every piece is epic, requiredLevel 20, soulbound, class-locked via
  requiredClass to its single class, and stat-shaped for its single spec.
- Set ids are new one-word theme slugs (below); piece ids are
  `<set_id>_<slot>`. Piece display names follow the armor-type noun table:
  cloth Hood/Mantle/Robe/Handwraps/Leggings, leather
  Cowl/Spaulders/Tunic/Grips/Breeches, mail
  Helm/Pauldrons/Hauberk/Gauntlets/Legguards.
- Set names and bonus text auto-mint their i18n keys from ITEM_SETS; piece
  names register in the items catalog like any item.

### Stat identities per variant

Primary budgets split by identity, then normalize to the exact slot budget:

- Cloth spell damage: int 2 : spi 1, Spell Damage, crit and haste ratings.
- Cloth healing: int 1 : spi 1, Healing Power, haste or crit rating.
- Leather tanking: sta 1.2 : agi 1, crit rating, extra armor line.
- Leather dps: agi 2 : sta 1, crit and haste ratings.
- Leather spell damage: int 2 : spi 1, Spell Damage, crit rating.
- Leather healing: int 1 : spi 1, Healing Power, haste rating.
- Mail tanking (Strength): sta 1.2 : str 1, crit rating, extra armor line,
  shields.
- Mail tanking (Agility, Stonehearth): sta 1.2 : agi 1, crit rating, extra
  armor line, shields.
- Mail dps (Strength): str 2 : sta 1, crit and haste ratings.
- Mail dps (Agility, Warspirit): agi 2 : sta 1, crit and haste ratings.
- Mail spell damage: int 2 : spi 1, Spell Damage, crit and haste ratings.
- Mail healing: int 1 : spi 1, Healing Power, crit or haste rating.

Set pieces carry only crit and haste by the Hit-scarcity policy in the
ratings section; Hit lives on the elective waist, jewelry, and weapon
pieces, which is also where tanks pick up their threat Hit.

AMENDED (2026-08-30, the hit rebalance): the lay-of-the-land Monte Carlo
study measured the original scattered Hit program shedding cap on tier
upgrade (the old lineage stack capped retribution and fury at the old 190
heroic cap; the tier's elective lanes topped out near 145, so upgrading
LOWERED hit and retribution measured a net DPS loss). Two-part fix by
maintainer direction: the above-level miss ramp lowered from
[0, 2.5, 14, 21] to [0, 2.5, 8, 14] (heroic caps now 130 melee / 110
spell), and the elective lanes widened to full coverage: EVERY waist
carries 60 Hit, EVERY ring 25, EVERY weapon its 30-point pair (each a
budget-neutral swap of the piece's minor rating). The guaranteed floor
(any waist + two rings + any weapon = 140) covers both caps for every
class; pinned by the cap-coverage describe in tests/ignivar_loot.test.ts.
The scarcity POLICY holds: set pieces still carry no Hit.

### The sets

UNDER REDESIGN (2026-08-28): the maintainer-directed adversarial review
(docs/prd/ignivar-set-bonus-review.md) verified all 58 bonuses below
against the live sim and refuted most of them; 7 survive as designed.
Do not implement from these tables until the rewrite lands; the review
doc carries the per-bonus verdicts and the author's checklist every
replacement must clear.

Settled by the maintainer (2026-08-27): every bonus hooks the spec's
UNDERLYING ENGINE (its rotation loop, resource bank, or signature
mechanic, as implemented by the spec's combat module), never raw stats.
The 2-piece bends one gear of the engine; the 4-piece changes how the
spec plays. Every bonus below names only mechanics that exist in the live
sim (the spec engines in src/sim/combat/ and their exported constants);
numbers are design targets for the tuning pass, with each 2-plus-4 pair
sized to be worth roughly five to eight percent of the spec's throughput,
at least matching the retired flat-stat package it replaces.

**Warrior (mail)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Slagbreaker Battlegear (slagbreaker) | arms, Battlecraft | Redhand empowers your next Maiming Strike by 30 percent per stack instead of 20. | Casting Redhand reduces Breachmaker's remaining cooldown by 3 sec. |
| Emberfury Harness (emberfury) | fury, Bloodrush | Your Enrage lasts 6 sec instead of 4. | Bloodletting always Enrages you, and its healing rises to 8 percent of your maximum health. |
| Forgewall Aegis (forgewall) | prot, Ironguard | Iron Resolve converts rage at 5 absorb per point instead of 4. | Casting Shieldcrack reduces Iron Resolve's remaining cooldown by 2 sec. |

**Paladin (mail)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Dawnforged Vestments (dawnforged) | holy, Sunmender | Beacon of Light copies 55 percent of your direct heals. Damage taken no longer delays your spellcasting. | Radiant Resonance's empowered Dawn's Embrace is instant. |
| Oathpyre Bastion (oathpyre) | protection, Faithwarden | Vowkeeper Strike's chance to arm Solar Reprisal rises to 30 percent, and blocking an attack arms it 40 percent of the time. | Consuming Solar Reprisal shields you for 6 percent of your maximum health for 10 sec. |
| Zealfire Warplate (zealfire) | retribution, Dawnreaver | Final Edict and Dawnfall cut each other's remaining cooldown by 3 sec instead of 2. | Hammer of Wrath cast under Dawn's Wrath strikes 40 percent harder, up from 20. |

**Hunter (leather)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Packlord's Emberhide (packlord_emberhide) | beast_mastery, Packlord | Pack Command's cooldown is reduced to 3 sec. | Pack Command's chance to reset Stampede's cooldown rises to 30 percent. |
| Coldsight Trackers (coldsight_trackers) | marksmanship, Coldsight | Measured Shot restores 5 additional Focus. | Long Draw critical strikes extend Cold Focus by 2 sec, up to 6 sec per window. |
| Slagsnare Trappings (slagsnare) | survival, Fieldcraft | Gutting Strike generates 20 Focus. | Woundrend that consumes 3 Hunting Momentum preserves them. Cannot occur more than once every 8 sec. |

**Rogue (leather)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Cinderfang Shroud (cinderfang) | assassination, Knifework | Venom Ritual's energy refund rises to 20 per builder. | Venom Dart's cooldown is reduced to 4 sec. |
| Smolderstrike Leathers (smolderstrike) | combat, Thuggery | Haymaker hits 20 percent harder. | Lights Out refunds 6 sec of Mirrored Blades' remaining cooldown. |
| Ashveil Garb (ashveil) | subtlety, Skulduggery | Lurker's Strike hits 25 percent harder. | Your Veiled Edge strike hits for triple, up from double. |

**Priest (cloth)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Creed of Embers Vestments (emberscreed) | discipline, Doctrine | Your Doctrine link converts 10 percent more of your Holy damage into healing. Damage taken no longer delays your spellcasting. | When your Psalm of Warding is fully consumed, your next Scouring Hymn within 10 sec is instant. Cannot occur more than once every 15 sec. |
| Benison Dawnweave (benison_dawnweave) | holy, Benison | Seraphic Vigil's rescue heals for 270, up from 180. Damage taken no longer delays your spellcasting. | When Seraphic Vigil triggers, its ally is also mended for 15 percent of their maximum health over 10 sec. |
| Vesperash Shroud (vesperash) | shadow, Vespers | Call Tithefiend's cooldown is reduced by 6 sec. Damage taken no longer delays your spellcasting. | Calling your Tithefiend resets Mindfracture's cooldown, and the fiend returns twice as much mana per hit. |

**Shaman (mail)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Stormkindled Regalia (stormkindled) | elemental, Thundercall | Unleash Weapon on Pyrebrand grants 3 Thunder. Damage taken no longer delays your spellcasting. | Earthen Jolt's bonus per Thunder rises to 30 percent. |
| Warspirit Emberscale (warspirit_emberscale) | enhancement, Warspirit | Ancestral Strike advances your cadence 3 steps. | Ancestral Strike hits 30 percent harder. |
| Stonehearth Bastion (stonehearth) | enhancement, Warspirit (off-tank) | While Stonebound, Stormcast Mending Waters costs no mana and heals 25 percent more. | While Stonebound, completing a cadence heals you for 3 percent of your maximum health. |
| Springmender Scale (springmender) | restoration, Spiritmend | Tidecall's cooldown is reduced by 4 sec. Damage taken no longer delays your spellcasting. | Cascading Mend reaches a fourth ally and harvests Mending Currents at 150 percent. |

**Mage (cloth)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Aetherweave Vestments (chronoweave) | arcane, Chronomancy | Temporal Echo converts 50 percent of your single-target Arcane damage into healing. Damage taken no longer delays your spellcasting. | Temporal Cascade's cooldown is reduced by 5 sec. |
| Pyroclast Regalia (pyroclast) | fire, Pyromancy | Scald always critically strikes targets at or below 50 percent health. Damage taken no longer delays your spellcasting. | Your Fire spells' critical strikes outside Phoenix Trance reduce its remaining cooldown by 2 sec. |
| Frostquench Weave (frostquench) | frost, Cryomancy | Rimelance critical strikes bank a second Icicle, up to the maximum of 5. Damage taken no longer delays your spellcasting. | Winterlash plants 3 Winter's Chill charges, up from 2. |

**Warlock (cloth)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Hexthread Shroud (hexthread) | affliction, Hexcraft | Needle of Fate grants 2 additional Condemnation. Damage taken no longer delays your spellcasting. | Passing Sentence refunds 10 Condemnation. |
| Gravebrand Regalia (gravebrand) | demonology, Necromancy | Reaping Command's cooldown is reduced by 2 sec. Damage taken no longer delays your spellcasting. | Reaping Command's unison strikes deal 25 percent more damage. |
| Ruincaller Vestments (ruincaller) | destruction, Ruination | Conflagrate holds 3 charges. Damage taken no longer delays your spellcasting. | Ruinbolt strikes 20 percent harder. |

**Druid (leather)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Moonscorch Raiment (moonscorch) | balance, Moongrove | Moonseed may extend Lunar Tempest twice per application, to a maximum of 12 sec. Damage taken no longer delays your spellcasting. | Moonsurge and Sunwake strike 25 percent harder. |
| Wildfang Emberhide (wildfang_emberhide) | feral, Wildfang (cat) | Redharvest restores 45 energy, up from 30. | Redharvest plants a fresh Flense on the target. |
| Cinderbark Ward (cinderbark) | feral, Wildfang (bear tank) | Sweeping Claws has a 30 percent chance to bank an additional Old Blood. | Marrowbreak hits 30 percent harder, and its emergency guard no longer replaces the strike. |
| Grovespring Raiment (grovespring) | restoration, Groveheart | Swiftmend consumes only your own Wildbloom or Second Bloom and heals 25 percent more. Damage taken no longer delays your spellcasting. | Overbloom harvests 75 percent of your remaining effects and banks 1 Verdance afterward. |

Implementation notes for the bonuses:

- **The seam**: SetBonusTier gains an optional TalentEffect payload
  (src/sim/content/talents.ts), folded into computeTalentModifiers beside
  the spec baselines. That surface already carries per-ability modifiers
  (dmgPct, costPct, cooldownPct, castPct, durationFlat, critPct,
  bonusCharges, addEffects), the global engine buckets, the ProcDef
  reactive triggers (castNth, spellCrit, shieldConsumed, hotExpired,
  bigHitTaken) with excludeSpecs gating, and the runtime numeric contract
  for bespoke hooks, so bonuses like "Redhand gains a third charge" or
  "Psalm of Warding fully consumed makes the next Scouring Hymn free" are
  data plus existing plumbing. Where a bonus bends a spec-module constant
  (a bank size, a refund, a window duration), the module reads the worn
  bonus through the same modifiers.selected pattern the choice rows use.
- Every damage caster and healer set's 2-piece ALSO grants full cast
  pushback immunity (castPushbackReduction 1), taking over the utility the
  incumbent caster sets give up in the retune (their 2-piece drops to 50
  percent). Pushback max-combines in the resolver, so wearing old and new
  together never exceeds immunity.
- Bonuses that add a visible proc or aura need their SET_PROC_FX_BY_ID
  color row (src/render/renderer.ts) and their tooltip text follows
  docs/design/tooltip-writing.md, resolved values included.
- Every referenced mechanic is pinned by the spec's own engine tests; each
  bonus lands test-first against the real engine constant it bends.

## Tokens and redemption

### The three sigil groups

Five slots times three class groups = 15 token items. The partition is
balanced-mixed (settled 2026-08-27): every sigil group contains exactly one
mail, one leather, and one cloth class, so any token that drops is
contested across the whole raid rather than inside one armor class:

| Sigil group | Classes |
|---|---|
| Sigil of the Anvil | warrior, druid, mage |
| Sigil of the Ember | paladin, hunter, priest |
| Sigil of the Tempest | shaman, rogue, warlock |

Token items: "Helm Sigil of the Anvil", "Mantle Sigil of the Ember", "Robe
Sigil of the Tempest", and so on for all 15 (slot nouns Helm, Mantle, Robe,
Grip, Legging). Ids follow `sigil_<group>_<slot>`. Each token is kind 'tool',
epic quality, soulbound, noDiscard, stackSize 20, requiredClass locked to its
three classes, exactly the heroic_mark pattern.

### Redemption

A new Crucible Quartermaster NPC stands in the Halls of the First Tempering
beside the raid entrance (id `crucible_quartermaster`). A new content module
(the ignivar vendor, mirroring src/sim/content/heroic_vendor.ts +
src/sim/instances/heroic_vendor.ts) lists all 145 set pieces, each priced at
exactly one token of the matching slot and group. The buy path validates the
buyer's class against the piece's requiredClass, so a priest holding a Helm
Sigil of the Ember sees and chooses among exactly three helms: Creed of
Embers, Benison Dawnweave, or Vesperash. A druid or shaman chooses among
four, because their hybrid spec carries both a damage and a tank set. This
is the per-spec choice moment, and it is deliberate: one token serves three
classes and each class then picks its spec and role.

The vendor purchase path debits one token by item id through the same
inventory seam the Heroic Quartermaster uses for marks. No new server
endpoint is needed; the existing vendor command path carries it in both
worlds.

## Off-set loot: every slot for every variant

The five tier slots cover helmet, shoulder, chest, gloves, legs per variant.
The remaining armor slots (waist, feet) get direct-drop epics per variant, so
all seven armor slots exist for all ten variants. Jewelry, held slots, and
weapons are class-open and split by role. All pieces are epic, item level 35,
budget-exact.

### Waist and feet (20 items)

One waist and one feet piece per variant. Names are placeholders to be
finalized during implementation; ids `crucible_<variant>_<slot>` style:

| Variant | Waist | Feet |
|---|---|---|
| Cloth spell damage | Cord of the Last Flame | Cindersoaked Slippers |
| Cloth healing | Springbinder Sash | Steps of Quiet Water |
| Leather tanking | Cinderbark Cinch | Ashenbark Treads |
| Leather dps | Slagstalker Belt | Ashrunner Boots |
| Leather spell damage | Moonscorch Waistwrap | Scorchgrove Striders |
| Leather healing | Grovetender Belt | Dewfall Moccasins |
| Mail tanking | Forgewall Girdle | Anvilstance Sabatons |
| Mail dps | Warforged Waistguard | Furnace March Greaves |
| Mail spell damage | Stormkindled Chain | Thundershock Treads |
| Mail healing | Tidebinder Links | Springwarden Sabatons |

Waist budget 17, feet 16, with the variant's stat identity, affix, and one
rating each.

### Jewelry (8 items)

Class-open (no armor type), one rating each, budget 16 neck / 15 ring:

| Role | Neck (Ignivar) | Ring (Varkhul) |
|---|---|---|
| Tank | Pendant of the First Tempering | Seal of the Forgewall |
| Physical dps | Ignivar's Ember Choker | Band of Marked Strikes |
| Spell damage | Locket of the Last Flame | Circle of Cinders |
| Healing | Heartspring Amulet | Loop of Quiet Springs |

Physical jewelry splits str/agi evenly so every melee, ranged, and tank spec
can use it; spell damage jewelry carries Spell Damage; healing jewelry
carries Healing Power.

### Shields and held offhands (4 items)

| Item | Slot | For |
|---|---|---|
| Bulwark of the Inner Crucible | offhand shield | mail tanks (warrior, paladin; shaman usable) |
| Ember Warden's Barrier | offhand shield | mail healers (paladin holy, shaman resto) |
| Orb of the Last Spring | held offhand | healers (Healing Power) |
| Cinder of the First Design | held offhand | damage casters (Spell Damage) |

Shields are ArmorItemDef with shield: true and blockValue; requiredClass
covers the shield-capable classes per role. Held offhands take the 0.75 held
slot budget (18 points).

### Weapons (9 items)

The Emberflight Longbow was pulled from the tier (maintainer decision
2026-08-28): this game has no ranged weapon slot, so a bow item could only
exist as a melee mainhand stat stick, and introducing real bows requires
the hunter ranged rework. The hunter ranged marquee returns with it; until
then hunters chase the Kris, the Cleaver, and the two-handers.

| Item | Type | Hand | For |
|---|---|---|---|
| Forgefather's Warhammer | mace | one-hand, slow (2.6) | enhancement, fury, arms, tank threat sets |
| Cinderfang Kris | dagger | one-hand, fast (1.8) | rogues, fast offhand builds |
| Slagrender Cleaver | axe | one-hand (2.4) | fury/enhancement offhand, arms |
| Anvilguard Blade | sword | one-hand (2.6), sta/hit tank identity | tanks |
| Heart of the End Greatblade | sword | two-hand (3.5) | arms, fury (Titan's Grip), retribution |
| Staff of the Last Spring | staff | two-hand (3.2), Healing Power | healers |
| Forgefire Spire | staff | two-hand (3.2), Spell Damage | damage casters |
| Springtouched Crozier | mace | one-hand (2.4), Healing Power | healers pairing a shield or orb |
| Wand of Quenched Sparks | wand | mainhand (1.5), Spell Damage | cloth casters |

Every weapon gets its WEAPON_TYPE_BY_ITEM row (weapon_skin_rules.ts) and its
variant art registration; Forgefather's Warhammer deliberately echoes the
Varkhul encounter prop.

## Boss loot tables: one tier, one item per five raiders

Implemented: both bosses ship these tables (dungeons.ts loot arrays plus
the HEROIC_BOSS_LOOT appends, pinned by tests/ignivar_loot.test.ts, which
also rolls them through the live rollLoot on both difficulties). The Inner
Crucible carries its own heroic tuning record (provisional multipliers
mirroring the arena's) because the wing inherits the raid claim's difficulty
from the arena, so without it a heroic run would reach a vanilla Varkhul
while still collecting his heroic-only append. Varkhul is therefore a
registered heroic finale boss and carries the shared raid heroic money base
like Ignivar.

### The cadence rule (re-cut 2026-09-02, maintainer-directed)

A boss kill pays ONE gear item per five raiders, on BOTH difficulties: two
items per kill on the 10-player raid. This is the settled Karazhan / WotLK
10-player standard (2 drops per boss for 10 players; vanilla 40-player
raids paid 2 to 3 per boss, tighter still), adopted to pace the tier over
months rather than weeks. The launch tables paid four items per Normal kill
and six to seven per Heroic kill, roughly double and triple that rate; with
the per-difficulty weekly locks a roster running both difficulties saw about
two items per player per week and finished its 5-piece sets in about five
weeks. Under the rule the same roster sees about 0.8 items per player per
week and finishes in about eleven.

Settled 2026-08-27 and unchanged: this raid has NO heroic item-level layer.
Heroic pays in ACCESS, never in count or numbers. Each kill's two slots are:

- **Slot one, both difficulties: the boss's sigil partition.** The two
  Normal sigil slots that boss used to pay every kill (mantle + grip on
  Ignivar, legging + helm on Varkhul) merged into one exclusive group, both
  axes balanced: 0.50 per slot, Anvil 0.34 / Ember 0.33 / Tempest 0.33.
- **Slot two, Normal: the boss's off-set partition**, authored
  `normalOnly` (LootEntry.normalOnly, gated by
  src/sim/loot/loot_difficulty_gate.ts). The old jewelry group keeps the
  half of the slot it used to own outright (0.50); the old off-set group
  splits the other half (waists or feet 0.3125, the smaller weapons or held
  offhands 0.1875). Weights are binary fractions so the partition sums to
  exactly 1.00 in floating point. That constraint moves the old 70:30
  armor-to-weapon split inside the half to 62.5:37.5, and the shift is
  deliberate, not a rounding accident: the three weapons and two held
  offhands are the most broadly wearable pieces in the slot (hit carriers
  usable across roles), while each of the ten waists or feet serves one
  archetype, so leaning the fewer shared pieces slightly up spreads the
  slot's value across more of the raid.
- **Slot two, Heroic: the boss's exclusive partition** (HEROIC_BOSS_LOOT).
  A heroic claim skips the Normal-only off-set group, draws nothing for it,
  and this group pays instead: the Robe sigil that finishes the 5-piece, the
  marquee weapons, and on Varkhul the shields with Emberward at its
  unchanged ABSOLUTE 3 percent per heroic kill. So every Heroic kill pays one
  item Normal can never drop, and Normal remains the only source of necks,
  waists, feet, rings, held offhands and the smaller weapons: a heroic
  roster still runs its Normal lock for those.

Consequences worth stating plainly: a Normal-only group can still finish
helmet, shoulder, gloves, and legs (the 4-piece bonus) since every one of
those sigils stays in a guaranteed Normal partition; the Robe and the
marquee weapons remain the Heroic chase; and the crafting reagent
(lastflame_core, one guaranteed plus a 50 percent second on both bosses)
rides OUTSIDE the cadence as a material, not gear. The hit program's
acquisition guarantee survives unchanged: every waist, ring and weapon
elective still sits in a guaranteed sum-to-1 group, at half the old flow.

Tables are authored as rollGroup entries (one rng draw per group, chances
summing to exactly 1.0) in the listed order. Draw order is parity-sensitive
from this re-cut on: entries append, never reorder, and future additions go
to the end of their group.

### Ignivar, Herald of the Last Flame

| Group | Difficulty | Entries | Chance each |
|---|---|---|---|
| copper | both | 150000 copper (heroic base on a heroic claim) | 1.0 |
| ignivar_sigils | both | Mantle Sigil of the Anvil / Ember / Tempest, Grip Sigil of the Anvil / Ember / Tempest | 0.17 / 0.17 / 0.16, 0.17 / 0.16 / 0.17 |
| ignivar_offset | Normal only | the 4 necks at 0.125 each, the 10 waist pieces at 0.03125 each, Cinderfang Kris / Slagrender Cleaver / Wand of Quenched Sparks at 0.0625 each | sums to 1.0 |
| ignivar_h_exclusive | Heroic only (HEROIC_BOSS_LOOT) | Robe Sigil of the Anvil / Ember / Tempest at 0.17 / 0.17 / 0.16, Forgefather's Warhammer / Anvilguard Blade / Springtouched Crozier at 0.17 / 0.17 / 0.16 | sums to 1.0 |

### Varkhul, Forgefather of the Last Flame

| Group | Difficulty | Entries | Chance each |
|---|---|---|---|
| copper | both | 200000 copper (heroic base on a heroic claim) | 1.0 |
| varkhul_sigils | both | Legging Sigil of the Anvil / Ember / Tempest, Helm Sigil of the Anvil / Ember / Tempest | 0.17 / 0.17 / 0.16, 0.17 / 0.16 / 0.17 |
| varkhul_offset | Normal only | the 10 feet pieces at 0.03125 each, both held offhands at 0.09375 each, the 4 rings at 0.125 each | sums to 1.0 |
| varkhul_h_exclusive | Heroic only (HEROIC_BOSS_LOOT) | Robe Sigil of the Anvil / Ember / Tempest at 0.12 / 0.12 / 0.11, Bulwark of the Inner Crucible 0.135, Ember Warden's Barrier 0.135, Varkhul's Emberward 0.03, Heart of the End Greatblade / Forgefire Spire / Staff of the Last Spring at 0.12 / 0.12 / 0.11 | sums to 1.0 |

## Future redistribution

More drop surfaces exist in the raid now (the promoted Warden minibosses
from #3684 ship with empty loot tables). The intended migration, so nothing
here paints us into a corner:

- Minibosses can take over slices of the off-set partitions first (waists,
  feet, necks, rings), then a sigil family each as the boss count grows; the
  two named bosses keep the prestige slots.
- Group names are owner-scoped, so moving an entry is a delete-from-one,
  append-to-other change; the parity suite re-mints for any rng
  reordering, which is expected and handled per
  content-adds-shift-every-hunted-seed.
- The cadence rule above is the invariant any redistribution keeps: one
  item per five raiders per kill on both difficulties, counted across the
  whole clear. A miniboss that gains a guaranteed group takes that share OUT
  of a named boss's partition; it never adds to the weekly total.

## Content obligations checklist

Every implementation slice carries its same-change obligations (root
CLAUDE.md, content-obligations-reviewer):

- **Item art**: one committed public/ui/items/<id>.webp per non-weapon item.
  The table adds 202 new item ids total (145 set pieces, 15 sigils, 20
  waist/feet, 8 jewelry, 4 held/shield, 10 weapons); the 192 non-weapon ids
  each need an icon, while the 10 weapons register through the weapon
  variant tables instead. Generated through the assets:items pipeline with
  provenance rows in mapping.json; ITEM_IMAGE_IDS auto-picks up non-weapon
  ids and the icon gate fails on any gap.
- **i18n**: every item id in ITEM_ENTITY_IDS with its English name at the
  matching index; set names/bonus text keys auto-mint; M16 non-Latin fills
  for wordy names in the same change; the Crucible Quartermaster in
  world_entity_i18n.ts.
- **Budget exactness**: every piece passes the item_level.test.ts sweep at
  its exact slot budget.
- **Weapon types**: WEAPON_TYPE_BY_ITEM rows for all 10 weapons.
- **Shipped ids golden**: shipped_item_ids golden grows append-only.
- **Deeds**: dgn_ignivar records (dungeonClears trigger) for the raid clear,
  cosmetic-only, per docs/design/deeds.md.
- **Reliquary**: pages for the conquerable unique loot per
  docs/design/reliquary.md (append-only registry).
- **Wiki**: npm run wiki:content regen committed (guide freshness gate).
- **Parity**: loot entries append-only; new rng draws re-mint hunted seeds
  where the suite requires.
- **Set procs**: SET_PROC_FX_BY_ID color rows for every new 4-piece proc.
- **IP name screen**: before the art wave mints, every set and item name
  is checked against the WoW item and set databases (the ip-pivot
  discipline); any collision renames while renames are still cheap.

The raid remains development-gated (the PRD keeps public Finder, Guide, and
lockout out of scope until the launch pass), so the loot lands behind the
same gate and the deeds/reliquary/finder launch obligations complete with
that pass.

## Implementation phases on this PR

Each phase is a reviewable commit (or small commit series) with its tests:

1. **This plan document.**
2. **Sim seams, test-first**: the healPower affix end to end (types, recalc,
   heal paths, tooltip, parity pin); IGNIVAR_RAID_LOOT_SOURCE_LEVEL
   registration in the item-level source index; token redemption vendor seam
   (content + instances modules mirroring the heroic vendor).
3. **Incumbent retune**: the lineage mechanism (ItemSet lineage id plus
   the aggregateSetBonuses cross-family count, a small sim change,
   test-first), the merged 2/4/6 bonus tables and constant changes from
   "Prerequisite: retune the incumbent set stack", the ladder-wide Hit
   program (tier-2 seed flips, the five-man heroic per-slot
   diversification, the vendor jewelry lane fix), their bonus-text and
   set-tooltip updates, and
   ordinary unit pins on the retuned lineage tables and constants.
4. **Sets**: the SetBonusTier TalentEffect payload seam (test-first, a
   small resolver change), then ITEM_SETS declarations for all 29
   families with their engine-hooking bonuses, each bonus landing beside
   a test against the spec-engine constant it bends; the 145 set-piece
   ItemDefs in a new src/sim/content/ignivar_loot.ts (data-as-code, large
   is correct); the 15 sigil tokens; vendor stock wiring.
5. **Off-set, weapons, jewelry, boss tables**: the 42 direct-drop items and
   both bosses' rollGroup tables (Normal plus heroic-only appends, re-cut
   after #3684); budget and progression tests green; the static viability
   check re-run against the final numbers.
6. **Art and i18n wave**: 192 icons via the pipeline, catalog names, M16
   fills, quartermaster entity names.
7. **Obligations closeout**: deeds, reliquary, wiki regen, set proc FX rows,
   qa-checklist + content-obligations-reviewer pass. (Landed 2026-08-30,
   ahead of the launch pass the gating section below anticipated: the raid's
   deeds and pages ship NOW but stay out of the public wiki behind the
   guideVisible gate in scripts/wiki/build_content.mjs until the rooms go
   guide-visible; the Varkhul legendary pages and the mechanic-specific
   encounter deeds remain launch-pass work.)
8. **Tuning pass**: re-run the static viability check against the final
   numbers, confirm the proposed rating/affix constants and the retune
   magnitudes, and stand up the post-release parse-service watch (top
   Nythraxis and Ignivar loadouts should migrate to the new sets; the
   audit recipe is in the Prerequisite section's evidence).

## Decisions (settled by the maintainer, 2026-08-27)

1. **Healing Power affix**: build the real healPower field, with the
   classic directionality as the contract: Spell Power adds to healing;
   Healing Power never adds to damage.
2. **Breakpoints**: 2/4 on the five-piece sets, the shape WoW settled on
   from TBC onward and never revisited.
3. **Token partition**: balanced-mixed. Anvil (warrior, druid, mage),
   Ember (paladin, hunter, priest), Tempest (shaman, rogue, warlock):
   every group exactly one mail, one leather, one cloth class.
4. **Difficulty**: no heroic item-level layer for this raid. One ilvl-35
   table spread across Normal and Heroic: Normal pays four sigil slots
   (the 4-piece bonus), Heroic adds the Robe sigil, the marquee weapons,
   and the shields. Tables re-cut after #3684's minibosses land.
5. **Set names**: approved, gated on the IP screen in the obligations
   checklist (no Blizzard-infringing names reach the art wave).
6. **Retune verification**: no simulation harness. Unit pins on the
   retuned constants, the static viability check re-run when numbers
   move, and post-release verification through the live parse service.
7. **Set bonuses hook the engine** (2026-08-27): every new-tier 2-piece
   and 4-piece bonus modifies the spec's underlying engine (rotation
   loop, resource bank, signature mechanic), never raw stats. The full
   catalog of 58 bonuses lives in the set tables above and in the item
   catalog; implementation rides the TalentEffect seam.

## Binding rules: the party trade window (maintainer directives, 2026-08-29)

Implemented alongside the soulbound rulings above:

- Every SOULBOUND item awarded from party boss loot (need/greed win,
  master-loot assignment, round-robin, or a shared direct pickup) is
  granted as an instanced copy carrying a 2 hour bind-on-pickup trade
  window (`src/sim/loot/bop_trade_window.ts`,
  `ItemInstancePayload.partyTrade`).
- Eligibility is the loot-candidate snapshot at the EXACT drop moment
  (the kill-time `lootRecipientIds` set), never the current roster:
  joining the party after the kill grants nothing, leaving it loses
  nothing. The window rides the copy through trades, so a recipient can
  pass it on within the same deadline, still only inside that snapshot.
  The snapshot stores names plus stable character ids; the trade gate
  prefers ids, so a rename neither strands a drop-mate nor lets a
  name-squatter in. When a mob has no kill-time snapshot at all, the
  award grants windowless rather than stamping a loot-time roster.
- The everyone-passed and winner-offline returns keep the rule: picking
  the item back up from the corpse's open slot grants the same window a
  roll win would (`interaction.ts` routes through the shared grant).
- A windowed grant never auto-equips (equipping would strip the window
  at the moment of the win); the player equips by hand, accepting the
  bind. A blocked offer tells the player why: "That can only be traded
  to players who shared its drop."
- Equipping the copy ends the window immediately and permanently
  (`items.ts equipmentPayloadFor` strips the payload on the bag-to-worn
  bridge). Mail, market, vendor, and guild bank stay hard-blocked by
  `def.soulbound`; the trade offer path is the one channel the window
  opens.
- The clock is `ctx.lockoutNowMs()` (the raid-lockout clock), so the
  deadline survives server restarts; the client counts down via the
  `partyTradeMsRemaining` IWorld facet member.
- Player-facing surfaces: a gold tooltip line under Soulbound with the
  remaining span, a "Binds when picked up" note on need/greed and
  master-loot prompts, and a confirm dialog on Take Loot when the
  visible loot contains a soulbound item.
- Vendor-bought tier gear (the Crucible Quartermaster) binds at purchase
  with NO window: the buyer chose the piece; there is no shared drop.

Pinned by `tests/bop_trade_window.test.ts`, `tests/bop_party_trade.test.ts`,
and the award describes in `tests/loot_roll.test.ts`.
