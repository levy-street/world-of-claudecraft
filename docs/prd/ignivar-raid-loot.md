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
2-piece bonuses. WARFARE families are untouched (already PvE-inert and
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
pieces, which pay only the 2-piece entry tier. The harness guard (below)
pins full-new above the full six-piece capstone and every blend.

After both moves the deep seven-piece collector pays roughly 25 attack
power plus the retuned Gravemight, 20 primary stats, 4 percent haste, 3
percent Hit, and a lighter bleed: one halved package where today there
are two. A full new kit answers with its own 2-piece and 4-piece, two
more item levels of budget over the heroic-33 copies, the 60/25 ratings
step, and for casters and healers the Spell Damage and Healing Power
affix debut (a five-piece caster set carries roughly 58 authored Spell
Damage the old stack simply does not have). The 6-piece capstone values
are the numbers the harness is most likely to shave further; exact
margins are measured, not asserted (below).

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
| Flat plus proc-average attack power (Strength case) | ~47 | ~68 | new ahead by ~20 |
| Spell Damage (caster case, affix debut included) | ~22 | ~108 | new ahead by ~86 |
| Healing Power (healer case) | 0 | ~143 | new ahead outright |

Conclusions:

- **Every archetype prefers the full new kit.** Melee margins are real but
  not insulting (on the order of five to eight percent of throughput,
  carried by the ratings step and the stronger bonus package, minus the
  old bleed). Casters and healers are decisively ahead through the affix
  debut. Tanks win on stamina budgets, armor, and the ward procs against
  an old capstone that pays them almost nothing defensive.
- **The old side above is the best case.** It assumes full heroic
  variants; the median raider's mix is weaker, so real margins are wider.
- **There is a one-swap valley, and it is accepted.** The first new piece
  breaks the old six-piece capstone before any new bonus exists, a small
  net loss until the second piece lands the new 2-piece tier. One swap
  deep is classic-normal, and the token flow (a sigil converts to a piece
  immediately) makes the two-piece threshold fast. No further softening
  of the old capstone is needed for this.
- **The melee margin leans on the 60/25 ratings step.** If that proposal
  is trimmed later, melee viability thins first; the harness must re-run
  whenever either side's numbers move.

### Guard

A new balance harness test (the warfare_balance_harness pattern) assembles
the best old-stack kit and the best new-tier kit per representative
archetype (Strength melee, Agility melee, damage caster, healer, tank) and
pins that the new kit wins on the harness metric by a real margin, in
absolute DPS and HPS. This test is the acceptance gate for both the retune
numbers and the new tier's bonus numbers, and it keeps the next tier from
recreating this problem silently.

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
normal at 35 is the new best pre-legendary tier; a later Heroic Ignivar pass
(out of scope here) would follow the heroic_variants.ts pattern upward.

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
- Distribution follows the established archetype rules: roughly half the
  physical pieces carry Hit as primary; healer-facing pieces never carry Hit
  (heals are not resisted); jewelry carries a single rating.

These are proposed constants on the existing curve, to be confirmed in the
tuning pass with the DPS study harness before merge.

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

If the maintainer prefers zero sim changes in the first slice, the fallback is
healer pieces carrying spellPower at the healer magnitudes; the healPower
seam is small enough that the plan of record is the real affix.

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

- Cloth spell damage: int 2 : spi 1, Spell Damage, crit or hit rating.
- Cloth healing: int 1 : spi 1, Healing Power, haste or crit rating.
- Leather tanking: sta 1.2 : agi 1, secondary rating hit, extra armor line.
- Leather dps: agi 2 : sta 1, crit and hit ratings.
- Leather spell damage: int 2 : spi 1, Spell Damage, crit rating.
- Leather healing: int 1 : spi 1, Healing Power, haste rating.
- Mail tanking (Strength): sta 1.2 : str 1, hit rating, extra armor line,
  shields.
- Mail tanking (Agility, Stonehearth): sta 1.2 : agi 1, hit rating, extra
  armor line, shields.
- Mail dps (Strength): str 2 : sta 1, crit and hit ratings.
- Mail dps (Agility, Warspirit): agi 2 : sta 1, crit and hit ratings.
- Mail spell damage: int 2 : spi 1, Spell Damage, hit rating.
- Mail healing: int 1 : spi 1, Healing Power, crit or haste rating.

### The sets

Bonus magnitudes below are the design targets; they ride shared per-tier
constants (like the existing SET_HASTE_3PC_RATING pattern) and get confirmed
in the tuning pass. Mechanical families keep the proven trigger surface:
weaponCrit, spellCrit, spellCast, kill.

**Warrior (mail)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Slagbreaker Battlegear (slagbreaker) | arms, Battlecraft | +40 attack power | Slagbreaker's Rend: weapon crits apply a stacking physical bleed (3 stacks, 8 per tick) plus +25 crit rating |
| Emberfury Harness (emberfury) | fury, Bloodrush | +40 attack power | Furnace Rush: weapon crits grant +50 attack power for 8 s (icd 10 s) |
| Forgewall Aegis (forgewall) | prot, Ironguard | +25 Stamina | Forgewall: weapon crits grant a 300 absorb shield for 10 s (icd 20 s) |

**Paladin (mail)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Dawnforged Vestments (dawnforged) | holy, Sunmender | +25 Healing Power | Dawnlight Grace: heal casts have a 6 percent chance to make the next cast free (icd 15 s) |
| Oathpyre Bastion (oathpyre) | protection, Faithwarden | +25 Stamina | Oathpyre Ward: weapon crits grant a 300 absorb shield for 10 s (icd 20 s) |
| Zealfire Warplate (zealfire) | retribution, Dawnreaver | +40 attack power | Zealfire: weapon crits grant +50 attack power for 8 s (icd 10 s) |

**Hunter (leather)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Packlord's Emberhide (packlord_emberhide) | beast_mastery, Packlord | +40 attack power | Pack Frenzy: weapon crits grant the pet +15 percent damage for 10 s (icd 12 s) |
| Coldsight Trackers (coldsight_trackers) | marksmanship, Coldsight | +40 attack power | Coldsight Focus: weapon crits grant +50 attack power for 8 s (icd 10 s) |
| Slagsnare Trappings (slagsnare) | survival, Fieldcraft | +40 attack power | Slagsnare: weapon crits apply a stacking physical bleed (3 stacks, 8 per tick) plus +25 crit rating |

**Rogue (leather)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Cinderfang Shroud (cinderfang) | assassination, Knifework | +40 attack power | Cinderfang Venom: weapon crits apply a stacking nature dot (3 stacks, 8 per tick) plus +25 crit rating |
| Smolderstrike Leathers (smolderstrike) | combat, Thuggery | +40 attack power | Smolderstrike: weapon crits grant +7.5 percent haste for 6 s (icd 15 s) |
| Ashveil Garb (ashveil) | subtlety, Skulduggery | +40 attack power | Ashveil: weapon crits grant +50 attack power for 8 s (icd 10 s) |

**Priest (cloth)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Creed of Embers Vestments (emberscreed) | discipline, Doctrine | +25 Healing Power | Ember Aegis: heal casts have a 6 percent chance to make the next cast free (icd 15 s) |
| Benison Dawnweave (benison_dawnweave) | holy, Benison | +25 Healing Power | Dawnweave Renewal: heal casts have an 8 percent chance to grant +10 percent healing done for 8 s (icd 15 s) |
| Vesperash Shroud (vesperash) | shadow, Vespers | +14 Spell Damage | Vesperash Whispers: spell crits grant +25 Spell Damage for 8 s (icd 10 s) |

**Shaman (mail)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Stormkindled Regalia (stormkindled) | elemental, Thundercall | +14 Spell Damage | Stormkindled Surge: spell crits grant +25 Spell Damage for 8 s (icd 10 s) |
| Warspirit Emberscale (warspirit_emberscale) | enhancement, Warspirit | +40 attack power | Emberscale Tempo: weapon crits grant +7.5 percent haste for 6 s (icd 15 s) |
| Stonehearth Bastion (stonehearth) | enhancement, Warspirit (off-tank) | +25 Stamina | Stonehearth Ward: weapon crits grant a 300 absorb shield for 10 s (icd 20 s) |
| Springmender Scale (springmender) | restoration, Spiritmend | +25 Healing Power | Springmender's Gift: heal casts have a 6 percent chance to make the next cast free (icd 15 s) |

**Mage (cloth)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Chronoweave Vestments (chronoweave) | arcane, Chronomancy | +25 Healing Power | Borrowed Time: heal casts have a 6 percent chance to make the next cast free (icd 15 s) |
| Pyroclast Regalia (pyroclast) | fire, Pyromancy | +14 Spell Damage | Pyroclast Fury: spell crits grant +25 Spell Damage for 8 s (icd 10 s) |
| Frostquench Weave (frostquench) | frost, Cryomancy | +14 Spell Damage | Frostquench Clarity: spell casts have a 4 percent chance to make the next cast free (icd 15 s) |

**Warlock (cloth)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Hexthread Shroud (hexthread) | affliction, Hexcraft | +14 Spell Damage | Hexthread Blight: spell crits apply a stacking shadow dot on the target (3 stacks, 8 per tick) |
| Gravebrand Regalia (gravebrand) | demonology, Necromancy | +14 Spell Damage | Gravebrand Pact: spell crits grant the pet +15 percent damage for 10 s (icd 12 s) |
| Ruincaller Vestments (ruincaller) | destruction, Ruination | +14 Spell Damage | Ruincaller's Focus: spell crits grant +25 Spell Damage for 8 s (icd 10 s) |

**Druid (leather)**

| Set | Spec | 2-piece | 4-piece |
|---|---|---|---|
| Moonscorch Raiment (moonscorch) | balance, Moongrove | +14 Spell Damage | Moonscorch Insight: spell crits grant +25 Spell Damage for 8 s (icd 10 s) |
| Wildfang Emberhide (wildfang_emberhide) | feral, Wildfang (cat) | +40 attack power | Wildfang Rend: weapon crits apply a stacking physical bleed (3 stacks, 8 per tick) plus +25 crit rating |
| Cinderbark Ward (cinderbark) | feral, Wildfang (bear tank) | +25 Stamina | Cinderbark: weapon crits grant +15 percent dodge for 6 s (icd 20 s) |
| Grovespring Raiment (grovespring) | restoration, Groveheart | +25 Healing Power | Grovespring Bloom: heal casts have an 8 percent chance to grant +10 percent healing done for 8 s (icd 15 s) |

Implementation notes for the bonuses:

- Every damage caster and healer set's 2-piece ALSO grants full cast
  pushback immunity (castPushbackReduction 1), taking over the utility the
  incumbent caster sets give up in the retune (their 2-piece drops to 50
  percent). Pushback max-combines in the resolver, so wearing old and new
  together never exceeds immunity.
- "Heal casts" use the existing spellCast trigger; the proc aura kinds all
  exist today (next_cast_free, buff_ap, buff_haste, buff_spelldmg,
  buff_healing_done, pet_damage_pct, absorb, dot).
- Every 4-piece proc needs a color row in SET_PROC_FX_BY_ID
  (src/render/renderer.ts) or it renders without its swirl.
- Tank and healer 4-pieces share mechanical families across classes on
  purpose: 29 fully bespoke mechanics is a tuning surface this phase cannot
  validate. Flavor names and stat identities differentiate; mechanics come
  from proven families (bleed/dot, attack power surge, haste surge, spell
  damage surge, free cast, absorb ward, dodge surge, pet surge, healing
  done). The Cinderbark dodge proc uses the existing buff_dodge aura kind
  (the WARFARE Thornguard precedent), giving the Agility tank avoidance
  where the mail tanks get absorb wards.

## Tokens and redemption

### The three sigil groups

Five slots times three class groups = 15 token items. The class partition
balances armor types and mirrors the proven three-way split for exactly these
nine classes:

| Sigil group | Classes |
|---|---|
| Sigil of the Anvil | warrior, priest, druid |
| Sigil of the Ember | paladin, rogue, shaman |
| Sigil of the Tempest | hunter, mage, warlock |

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
Sigil of the Anvil sees and chooses among exactly three helms: Creed of
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

### Weapons (10 items)

| Item | Type | Hand | For |
|---|---|---|---|
| Forgefather's Warhammer | mace | one-hand, slow (2.6) | enhancement, fury, arms, tank threat sets |
| Cinderfang Kris | dagger | one-hand, fast (1.8) | rogues, fast offhand builds |
| Slagrender Cleaver | axe | one-hand (2.4) | fury/enhancement offhand, arms |
| Anvilguard Blade | sword | one-hand (2.6), sta/hit tank identity | tanks |
| Heart of the End Greatblade | sword | two-hand (3.5) | arms, fury (Titan's Grip), retribution |
| Emberflight Longbow | bow | mainhand ranged (2.8) | hunters |
| Staff of the Last Spring | staff | two-hand (3.2), Healing Power | healers |
| Forgefire Spire | staff | two-hand (3.2), Spell Damage | damage casters |
| Springtouched Crozier | mace | one-hand (2.4), Healing Power | healers pairing a shield or orb |
| Wand of Quenched Sparks | wand | mainhand (1.5), Spell Damage | cloth casters |

Every weapon gets its WEAPON_TYPE_BY_ITEM row (weapon_skin_rules.ts) and its
variant art registration; Forgefather's Warhammer deliberately echoes the
Varkhul encounter prop.

## Boss loot tables

Both bosses currently ship loot: []. The table below is the complete drop
plan, authored as rollGroup entries (one rng draw per group, chances summing
to 1.0 for guaranteed groups) appended in the listed order. Draw order is
parity-sensitive: entries append, never reorder, and future additions go to
the end.

### Ignivar, Herald of the Last Flame

| Group | Entries | Chance each |
|---|---|---|
| copper | 150000 copper | 1.0 |
| ignivar_sigil_mantle | Mantle Sigil of the Anvil / Ember / Tempest | 1/3 each |
| ignivar_sigil_grip | Grip Sigil of the Anvil / Ember / Tempest | 1/3 each |
| ignivar_sigil_legging | Legging Sigil of the Anvil / Ember / Tempest | 1/3 each |
| ignivar_offset | the 10 waist pieces at 0.07 each, Cinderfang Kris 0.10, Slagrender Cleaver 0.10, Wand of Quenched Sparks 0.10 | sums to 1.0 |
| ignivar_jewelry | the 4 necks | 0.25 each |

Five guaranteed drops per kill: three tier tokens, one off-set piece or
weapon, one neck.

### Varkhul, Forgefather of the Last Flame

| Group | Entries | Chance each |
|---|---|---|
| copper | 200000 copper | 1.0 |
| varkhul_sigil_helm | Helm Sigil of the Anvil / Ember / Tempest | 1/3 each |
| varkhul_sigil_robe | Robe Sigil of the Anvil / Ember / Tempest | 1/3 each |
| varkhul_weapon | Forgefather's Warhammer 0.15, Anvilguard Blade 0.14, Heart of the End Greatblade 0.15, Emberflight Longbow 0.14, Staff of the Last Spring 0.14, Forgefire Spire 0.14, Springtouched Crozier 0.14 | sums to 1.0 |
| varkhul_offset | the 10 feet pieces at 0.07 each, both shields at 0.075 each, both held offhands at 0.075 each | sums to 1.0 |
| varkhul_rings | the 4 rings | 0.25 each |

Five guaranteed drops per kill: two tier tokens (the end boss owns the chest
and helm, the prestige slots), one weapon, one off-set piece, one ring.

A full clear pays five tokens, so a 10-player group completes 29 five-piece
sets over a long, classic-feeling campaign; later bosses accelerate this by
taking over token slots (below).

## Future redistribution

More bosses land in this content phase. The intended migration, so nothing
here paints us into a corner:

- Each new boss takes ownership of one token slot group (for example a third
  boss takes the Grip and Legging sigils from Ignivar and adds a new off-set
  group of its own).
- The weapon group splits across bosses by theme.
- Group names are boss-scoped (ignivar_*, varkhul_*), so moving an entry is
  a delete-from-one, append-to-other change; the parity suite re-mints for
  any rng reordering, which is expected and handled per
  content-adds-shift-every-hunted-seed.
- Drop cadence stays five guaranteed items per boss kill.

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
   "Prerequisite: retune the incumbent set stack", their bonus-text and
   set-tooltip updates, and the old-versus-new balance harness test
   (initially pinning the retuned lineage values; the new-kit comparison
   arm lands with phase 5).
4. **Sets**: ITEM_SETS declarations for all 29 families with the shared
   bonus-family constants; the 145 set-piece ItemDefs in a new
   src/sim/content/ignivar_loot.ts (data-as-code, large is correct); the 15
   sigil tokens; vendor stock wiring.
5. **Off-set, weapons, jewelry, boss tables**: the 42 direct-drop items and
   both bosses' rollGroup tables; budget and progression tests green; the
   harness test's old-versus-new comparison arm.
6. **Art and i18n wave**: 192 icons via the pipeline, catalog names, M16
   fills, quartermaster entity names.
7. **Obligations closeout**: deeds, reliquary, wiki regen, set proc FX rows,
   qa-checklist + content-obligations-reviewer pass.
8. **Tuning pass**: DPS/HPS harness comparison against the Nythraxis-tier
   baselines; confirm the proposed rating/affix constants and the retune
   magnitudes; adjust set proc numbers.

## Open questions for the maintainer

1. **Healing Power affix**: confirm the new healPower field (plan of record)
   over the spellPower-on-healer-gear fallback.
2. **Breakpoints**: 2/4 on five-piece sets (fifth slot as a choice) versus
   the house 2/3/4 pattern extended to 2/3/5. The plan assumes 2/4.
3. **Token partition**: Anvil (warrior, priest, druid), Ember (paladin,
   rogue, shaman), Tempest (hunter, mage, warlock). Any preferred regrouping
   is a rename-level change at this stage.
4. **Drop cadence**: five guaranteed items per boss kill (Nythraxis pays
   four plus a bonus group from its single boss). Confirm for a two-boss
   clear.
5. **Set names**: the 29 names above are proposals; vetoes are cheap until
   the art wave mints.
6. **Retune shape and magnitudes**: the incumbent restructure (each
   archetype's families merged into one 2/4/6 lineage ladder, throughput
   topped by the 6-piece capstone) and the halved values in "Prerequisite:
   retune the incumbent set stack" are design targets sized to turn the
   double stack into one sized package and put it under a full new kit;
   the harness test measures the real margin before any number ships.
