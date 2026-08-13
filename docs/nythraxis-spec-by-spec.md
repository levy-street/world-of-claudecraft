# Nythraxis: every spec, its BiS build, its rotation, and what the numbers say

> **STALENESS (added 2026-08-09, review 3050):** measured at `94675f5a14`,
> before the nerf rounds and re-bands that followed; see the marker in
> `nythraxis-class-balance-monte-carlo.md`. Reproduce at any head with:
> `node_modules/.bin/tsx tmp/mc/gear_tiers.ts <class>/` for each of the nine
> classes (24 seeds x naked/fresh-20/BiS-epic over the reconciled
> `tmp/mc/builds_noLegendary_<class>_.json` builds; ~15 min wall for all nine
> in parallel). The full optimizer pipeline that CHOOSES gear and talents is
> `tmp/mc/run_rev4_simple_table.sh` and costs hours; re-measuring held builds
> is the everyday operation. NOTE: tmp/mc/ is deliberately untracked
> (gitignored scratch); the harness plus reconciled builds are archived in
> the maintainer replication bundle (woc-nythraxis-replication-20260807.zip)
> and live on the measurement machine.

Monte Carlo over all 28 class/spec/role combinations at level 20, best-in-slot,
against the real `nythraxis_scourge_of_thornpeak` template. 24 combat seeds per
spec per difficulty. Gear AND talents are chosen by measurement, not opinion: the
harness greedily swaps every equipment slot and all six talent rows and keeps
whatever actually performs best.

Normal is level 20 / 798 armor. Heroic is the `nythraxis_boss_arena` heroic
record: level 22, `armorMultiplier` 1.2, so 1,058 armor. "Execute" is a separate
30 s bench with the boss pinned at 15% health.

**Every rotation in this document was written against the engine source**, not
the tooltips, after an earlier pass using tooltips alone was found to be wrong
for six specs. Where a plausible engine-derived change measured WORSE, that is
recorded too: those are as informative as the wins.

---

## Reading these numbers

DPS is absolute, out of the real `src/sim` core, on one target, standing still.
No encounter mechanics, no raid buffs, no consumables. Treat it as the ceiling
and the ordering, not a live parse.

**GCD idle % is not a rotation-quality score.** For a proc-and-react spec
(Enhancement waiting on Stormcast, Frost on Fingers of Frost) or an energy spec
(all three Rogues), idle GCDs are the design.

**Resource economy** is reported per spec:
- **Avg held**: time-weighted mean resource as a percent of the pool.
- **Capped**: time sitting at maximum, i.e. regeneration thrown away.
- **Starved**: share of GCD-ready moments where NOTHING in the kit was
  affordable. This is resource-agnostic, so a rage-dry warrior and an OOM mage
  land on the same axis. It slightly UNDER-counts for specs whose costs move with
  auras (Stormcast halves a shock), never over-counts.
- **Dry at**: the first second that happened.

---

# The table at a glance

| Spec | 15s | 60s | 300s | Execute | Heroic 60s | Resource | Avg | Capped | Starved | Dry at |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| Assassination | 293 | **308** | 315 | 297 | 283 | energy | 66% | 4% | **0%** | 243s |
| Balance | 248 | **275** | 283 | 263 | 244 | mana | **98%** | 33% | **0%** | **never** |
| Fury | 307 | **258** | 252 | 278 | 228 | rage | 48% | 2% | 2% | never |
| Feral cat | 256 | **230** | 221 | 241 | 214 | energy | 25% | 0% | 2% | 52s |
| Retribution | **336** | **222** | 209 | 273 | 198 | mana | 86% | 2% | 0% | never |
| Enhancement | 226 | **220** | 169 | 224 | 205 | mana | 13% | 1% | 37% | 77s |
| Subtlety | 219 | **204** | 209 | 200 | 180 | energy | 17% | 0% | 40% | **4s** |
| Frost | 205 | **202** | 133 | 207 | 193 | mana | 22% | 0% | 44% | 137s |
| Combat | 222 | **201** | 201 | 211 | 183 | energy | 20% | 0% | 41% | **3s** |
| Beast Mastery | 256 | **196** | 90 | 208 | 179 | focus | 91% | **45%** | 0% | never |
| Arms | 234 | **195** | 187 | 208 | 166 | rage | 68% | 8% | 2% | never |
| Fire | 294 | **186** | 86 | **310** | 158 | mana | 16% | 0% | 26% | 112s |
| Shadow | 175 | **173** | 153 | 175 | 173 | mana | 35% | 0% | 65% | 245s |
| Survival | 157 | **163** | 87 | 161 | 121 | focus | 93% | **62%** | 0% | never |
| Affliction | 135 | **157** | 135 | 144 | 144 | mana | 27% | 0% | 38% | 227s |
| Elemental | 170 | **152** | 106 | 157 | 147 | mana | 28% | 1% | **80%** | 164s |
| Demonology | 154 | **151** | 97 | 157 | 137 | mana | 20% | 0% | **66%** | 138s |
| Marksmanship | 148 | **141** | **56** | 141 | 126 | focus | 48% | 1% | 12% | 13s |
| Destruction | 107 | **130** | 80 | 117 | 130 | mana | 19% | 1% | **93%** | 131s |

**Spread: 2.37x at 60 s** (308 to 130, median 196). **5.10x at 300 s** (319 to
63, median 175). The repo's own declared intent in
`tests/owned_class_balance_harness.test.ts` is roughly plus or minus 15%.

---

# Damage specs

## Assassination rogue (Knifework) - 308 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 293 | 297 | **308** | 313 | 315 | 297 | 283 |

**Economy:** energy, 66% average, 4% capped, **0% starved**, dry at 243s.
**Talents:** L14 Ceaseless Cuts.
**Gear:** Thronebane (mainhand), Mistcaller's Fang (offhand), Direfang Crown,
Swiftfang Talisman, Direfang Shoulderguards, Nightfang Harness, Direfang
Waistband, Nightfang Legguards, Direfang Grips, Nightfang Treads, Seal of the
Nine Oaths, Oath of the Round Table.

**Rotation**
1. `adrenaline_rush` when energy-starved
2. `slice_and_dice` (Cutthroat Tempo) if down at 2+ combo points
3. `cold_blood` (Killer's Calm) at 4+ combo points
4. `eviscerate` the moment the Venom Ritual hits 6 stages (becomes Venomrend)
5. `eviscerate` at 5 combo points
6. `rupture` if missing at 5 combo points
7. `backstab` if wielding a dagger and behind, else `venom_dart`,
   then `sinister_strike` (Wicked Slash)

**Damage:** Wicked Slash 36%, Auto Attack 35%, Venomrend 18%, Second Shadow 3%.

**Findings.** The best spec in the game at every window past 15 seconds, still
climbing at five minutes (293 to 315), and **the only rogue with a working
energy economy: 0% starved against 40-41% for its two siblings**. That is the
Venom Ritual's 15-energy-per-stage refund, and it is the single biggest
difference between the three rogues.

The optimizer puts Thronebane in the mainhand, which **disables Backstab
entirely** (it requires a dagger), and the spec still wins by 33 DPS. The Venom
Ritual builds off Wicked Slash too, so the dagger fantasy is currently optional.

## Balance druid (Moongrove) - 275 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 248 | 263 | **275** | 280 | 283 | 263 | 244 |

**Economy:** mana, **98% average, 33% capped, 0% starved, never dry.**
**Talents:** L14 Highmoon Tithe, L20 Wild Apex.
**Gear:** Heartwood of the Deathless Crown, Wraithfire Cowl, Zense Meridian,
Wraithfire Mantle, Mournweave Starshroud, Wraithfire Cord, Mournweave Legwraps,
Wraithfire Gloves, Mournweave Soulsteps, The Architect's Cornerstone, Sutil's
Gambit.

**Rotation**
1. `moonfire` (Lunar Tempest) when missing or under 3 s
2. At 3 Moontide: `moonseed` (becomes Moonsurge), or `starfire` (Sunwake) if low
3. `moonseed` whenever off cooldown
4. `wrath` (Wildbolt) filler

**Damage:** Wildbolt 46%, Moonsurge 42%, Lunar Tempest 6%, Moonseed 4%.

**Findings.** **The only caster in the game with a solved mana problem.** It
holds 98% of its pool, spends a third of the fight capped, and never starves,
because Highmoon Tithe refunds 15% of the pool on every Moontide payoff. That is
exactly why it retains 103% of its 60 s DPS at five minutes while Fire mage keeps
46%. It is the model the other mana specs should be measured against.

Only 3% from legendaries, so its position is earned by the kit.

## Fury warrior (Bloodrush) - 258 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 307 | 272 | **258** | 247 | 252 | 278 | 228 |

Sustain-specced it reaches **288 at 300 s**.

**Economy:** rage, 48% average, 2% capped, 2% starved, never dry, 26% of the
fight below a quarter pool.
**Talents:** L14 Combat Mastery.
**Gear:** Thronebane, Gravewyrm Cleaver (offhand), Bonewrought Dreadhelm, Zense
Meridian, Bonewrought Warspaulders, Morthen's Cryptforged Hauberk, Bonewrought
Girdle, Deathless Warguard Legmail, Bonewrought Gauntlets, Dreamroot Boots, The
Unbroken Circle, Oath of the Round Table.

**Rotation**
1. `berserker_stance` and `battle_shout` before the pull
2. `recklessness`, then `emboldening_roar` on cooldown
3. `red_harvest` at 80+ rage
4. `bloodthirst` (Bloodletting), 12 rage back
5. `raging_gale` (Twinstrike), 2 charges
6. `whirlwind` (Bladed Gyre), then `execute` under 20%

**Damage:** Auto Attack 43%, Red Harvest 24%, Twinstrike 19%, Bloodletting 6%.

**Findings.** Enormous opener and a healthy rage economy that never runs dry. 43%
white damage is why Thronebane is worth **+27%** to it. The sustain search found
a build worth +14% at five minutes with 19 gear swaps, the largest gear delta in
the study, which suggests Fury's gear scaling is under-explored rather than that
its rotation is wrong.

## Feral cat druid (Wildfang) - 230 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 256 | 241 | **230** | 223 | 221 | 241 | 214 |

**Economy:** energy, 25% average, 0% capped, 2% starved, dry at 52s, 40% of the
fight below a quarter pool.
**Talents:** L14 Blooddrunk, L20 Quickening.
**Gear:** Maul of the Scourged Wilds, Direfang Crown, Medallion of Endless
Profit, Direfang Shoulderguards, Nightfang Harness, Direfang Waistband,
Nightfang Legguards, Nightfang Talongrips, Dreamroot Boots, Seal of the Nine
Oaths, Oath of the Round Table.

**Rotation**
1. `cat_form` before the pull, `tigers_fury` (Wolfsblood) on cooldown
2. `ferocious_bite` (Redharvest) at 3 Old Blood with any combo points
3. `rip` at 5 combo points if missing
4. `rake` (Flense) if missing
5. `ferocious_bite` at 5 combo points, else `claw` (Rendclaw)

**Damage:** Auto Attack 41%, Redharvest 28%, Flense 17%, Rendclaw 14%.

**Findings.** Stable, no legendary dependence, 96% retention.

**A rejected engine hypothesis.** `druidEngineOnBleedTick` shows that with
Blooddrunk taken, every Rake and Rip TICK adds an Old Blood stage, so the bleeds
are the engine and not just damage. Protecting Rip uptime by gating the payoff
behind 3 combo points therefore looks correct. **It measured 12.5% WORSE.** A
rake-first reorder measured identical. Detonating early at 1 combo point is
right, and Rip genuinely never fires under the optimal loop.

## Retribution paladin (Dawnreaver) - 222 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| **336** | 261 | **222** | 205 | 209 | 273 | 198 |

**Economy:** mana, 86% average, 2% capped, 0% starved, never dry.
**Talents:** L14 Zeal, L17 Sanctified Fervor, L20 Dawn Echo.
**Gear:** Deathless Greatblade, Wraithfire Cowl, Medallion of Endless Profit,
Bonewrought Warspaulders, Morthen's Cryptforged Hauberk, Bonewrought Girdle,
Deathless Warguard Legmail, Bonewrought Gauntlets, Tideworn Warboots, Seal of
the Nine Oaths, Oath of the Round Table.

**Rotation**
1. `dawn_devotion` and `retribution_aura` before the pull
2. `avenging_wrath` on cooldown (off GCD, +20% damage, doubles Devotion)
3. `divine_ascension` at 20 Devotion with no charges left
4. `sun_gods_verdict` on cooldown
5. `hammer_of_wrath` whenever enabled (Ascension, Wrath, or a Dawn's Wrath proc)
6. `valkyrs_calling`
7. `final_edict`, then `dawnfall` (they cut each other's cooldown by 2 s via
   Dawn Rhythm, so alternating them is the loop)
8. `hammer_of_grace` (free, 70 mana back), then `consecration` (Holy Ground)

**Damage:** Auto Attack 28%, Hammer of Wrath 19%, Final Edict 18%, Holy Ground
11%, Hammer of Grace 9%.

**Findings.** **The hardest opener in the game at 336 DPS over 15 seconds**, and
the sharpest fall-off of any non-mana spec (336 to 222 by one minute) as Avenging
Wrath and a full Devotion bank are spent and do not return for two minutes. As a
design shape that is coherent, and it is the best burst answer for a phase check.

Zero legendary dependence, 94% retention, and a completely healthy mana economy
(Hammer of Grace pays for the rotation). Its 23% idle is real: with no free
filler beyond Consecration on a 12 s cooldown it runs out of buttons.

## Enhancement shaman (Warspirit) - 220 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 226 | 224 | **220** | 190 | 169 | 224 | 205 |

**Economy:** mana, **13% average, 37% starved, dry at 77s, 82% of the fight
below a quarter pool.**
**Talents:** L14 Imbue Mastery, L20 Echoing Elements.
**Gear:** **Thronebane in BOTH hands**, Direfang Crown, Medallion of Endless
Profit, Direfang Shoulderguards, Morthen's Cryptforged Hauberk, Gravescale
Girdle, Lunar Choir Leggings, Gravewyrm Claws, Tideworn Warboots, Seal of the
Nine Oaths, Oath of the Round Table.

**Rotation**
1. `galeheart_weapon` before the pull (this is the whole spec)
2. `primal_exaltation` on cooldown
3. `lightning_bolt` (Arc Bolt) **the instant Stormcast is armed** (free, instant,
   half price)
4. `stormstrike` (Ancestral Strike), which advances the cadence by TWO steps
5. `flame_shock` if missing, else `earth_shock`

**Damage:** Auto Attack 47%, **Galeheart Echo 27%**, Arc Bolt 16%, Ancestral
Strike 7%.

**Findings.** The clearest proc spec in the game: every 3 weapon hits fills the
cadence, which arms Stormcast and fires two Galeheart Echoes at 50% weapon
damage. Its 58% idle is the design, not a defect.

**A rejected engine hypothesis.** `tryProcStormsurge` returns early unless
Stormstrike is already on cooldown, so striking BEFORE consuming Stormcast
should protect the 25% reset. **It measured 1.6% worse**: the free instant
half-price bolt is worth more than the reset chance.

Its real problem is mana: **it holds 13% of its pool and spends 82% of the fight
below a quarter**, running dry at 77 s and bleeding from 220 to 169. A shaman
meleeing on a mana bar is the structural issue, not the rotation.

## Subtlety rogue (Skulduggery) - 204 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 219 | 200 | **204** | 204 | 209 | 200 | 180 |

Sustain-specced it reaches **235 at 300 s**, the best sustain gain of any rogue.

**Economy:** energy, 17% average, **40% starved, dry at 4s**, 69% below a
quarter pool.
**Talents:** L14 Venom Dividend, L20 Grave Brand.
**Gear:** **Thronebane in BOTH hands**, Direfang Crown, Yumi's Keepsake Locket,
Direfang Shoulderguards, Nightfang Harness, Direfang Waistband, Nightfang
Legguards, Nightfang Talongrips, Dreamroot Boots, Sutil's Gambit, Fleetblood
Band.

**Rotation**
1. `deadly_poison` before the pull, `adrenaline_rush` when starved
2. `slice_and_dice` if down at 2+ combo points
3. **At 3 Gloam stages: `garrote` or `cheap_shot`** - a full bank makes the
   stealth openers castable IN THE OPEN and FOR FREE, and detonates the bank
4. `eviscerate` at 5 combo points, `rupture` if missing
5. `hemorrhage` (Red Ribbon) builder, the cheapest in the class at 35 energy

**Damage:** Auto Attack 64%, Red Ribbon 27%, Throat Wire 4%.

**Findings.** Spending the Gloam bank is worth **+3.9% in execute** and was
completely absent from the first pass: every 2nd Red Ribbon banks a stage and a
full bank was simply left sitting. Even so, 64% of its damage is white and it
carries the largest legendary dependence in the study.

Starved from **4 seconds in** and 40% starved thereafter, which is the energy
design shared with Combat.

## Frost mage (Cryomancy) - 202 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 205 | 207 | **202** | 200 | 133 | 207 | 193 |

**Economy:** mana, 22% average, 44% starved, dry at 137s.
**Talents:** class default build. The search found no improvement on any row.
**Gear:** Scepter of the Deathless Court, Wraithfire Cowl, Zense Meridian,
Wraithfire Mantle, Shroud of the Gravewyrm, Wraithfire Cord, Mournweave
Legwraps, Wraithfire Gloves, Mournweave Soulsteps, Niela's Coldlight Band, Ashen
Focus Ring.

**Rotation**
1. `arcane_intellect`, `frost_armor`, `summon_water_elemental` before the pull
2. `icy_veins`, then `frozen_orb` on cooldown
3. `flurry` (Winterlash) whenever Brain Freeze is up (instant, no cooldown)
4. **`ice_lance` on Fingers of Frost or Winter's Chill, BEFORE Glacial Spike** -
   only Ice Lance can spend a Winter's Chill charge, the charges last 5 s, and a
   frozen-counting Ice Lance is 3x damage plus Shatter's +50% crit
5. `glacial_spike` at 5 Icicles, else `frostbolt` (Rimelance)

**Damage:** Ice Lance 41%, Winterlash 18%, Rimelance 15%, Glacial Spike 12%.

**Findings.** Spending the freeze charges before committing to a 2.7 s Glacial
Spike is worth +1.9%. Its 39% idle is Fingers of Frost and Brain Freeze gating,
not a rotation gap. Flat to 120 s and then a mana cliff to 133.

The class default talent build is already optimal, which is either good row
design or a sign the rows are insufficiently differentiated.

## Combat rogue (Thuggery) - 201 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 222 | 211 | **201** | 201 | 201 | 211 | 183 |

**Economy:** energy, 20% average, **41% starved, dry at 3s**, 71% below a
quarter pool.
**Talents:** L14 Ceaseless Cuts.
**Gear:** **Thronebane in BOTH hands**, Direfang Crown, Swiftfang Talisman,
Direfang Shoulderguards, Nightfang Harness, Direfang Waistband, Nightfang
Legguards, Nightfang Talongrips, Dreamroot Boots, Sutil's Gambit, Seal of the
Nine Oaths.

**Rotation**
1. `deadly_poison` before the pull
2. `adrenaline_rush`, then `blade_flurry` (Mirrored Blades) on cooldown
3. `slice_and_dice` if down at 2+ combo points
4. `eviscerate` at **4+** combo points to open the 8 s Redline window
5. `eviscerate` at 5 combo points (becomes Knockout Blow inside Redline)
6. `sinister_strike` (becomes Body Blow inside Redline, adds a pip)

**Damage:** **Auto Attack 67%**, Wicked Slash 13%, Body Blow 10%.

**Findings.** **A rejected engine hypothesis worth recording.** Redline is a
fixed 8 s window that never extends, and the engine comment states plainly that
"a window that expires forfeits the Knockout entirely". Body Blow costs 38 energy
at ~10/s, so 5 combo points are unreachable inside 8 seconds: the study forfeits
**17 of 18 Knockouts**. Cashing out early at max pips or against the clock
therefore looks obviously correct.

**It measured 2.2% worse.** With dual Thronebane, 67% of Thuggery's damage is
white, so Body Blow uptime is worth more than the Knockout it buys. The mechanic
is real; the conclusion was not. Its ranking is an item ranking: strip Thronebane
and it falls to 156.

## Beast Mastery hunter (Packlord) - 196 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 256 | 208 | **196** | 185 | 90 | 208 | 179 |

**Economy:** focus, **91% average, 45% CAPPED, 0% starved, never dry.**
**Talents:** class default build.
**Gear:** Direfang Greatblade, Direfang Crown, Swiftfang Talisman, Direfang
Shoulderguards, Nightfang Harness, Direfang Waistband, Nightfang Legguards,
Nightfang Talongrips, Bonechill Striders, Sutil's Gambit, Fleetblood Band.
**Pet: Ridge Stalker** (the best legal tame, +14% over the starter Forest Wolf).

**Rotation**
1. `aspect_of_the_hawk`, tame the pet before the pull
2. `stampede` at 3 Ferocity stacks (it SNAPSHOTS the Ferocity multiplier, so
   firing it below 3 permanently weakens every beast it summons)
3. `pack_command` when it has become Unleash Beast
4. `bestial_wrath` (Howling Rage)
5. `arcane_shot` (Fell Shot) at 75+ focus, then `pack_command`, then `arcane_shot`

**Damage:** **Stampede 33%**, Auto Shot 31%, Auto Attack 21%, Fell Shot 9%.
**61% of all damage comes from the pet.**

**Findings.** The pet is the spec, and a tamed pet re-derives its stats from its
TEMPLATE at the owner's level, so the beast choice is a build decision. Ridge
Stalker is worth +14% over the Forest Wolf the shipped probe still uses.

**Its focus is meaningless: 45% of the fight is spent capped and it never
starves once.** The spec generates far more than it can spend and is purely
GCD-limited. Then it falls off a cliff anyway, 196 to 90, which is NOT a resource
problem: it is the Stampede and Ferocity cooldown cycle thinning out.

## Arms warrior (Battlecraft) - 195 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 234 | 208 | **195** | 189 | 187 | 208 | 166 |

**Economy:** rage, 68% average, 8% capped, 2% starved, never dry.
**Talents:** L14 Battle Rhythm, L20 Bladestorm.
**Gear:** Deathless Greatblade (two-hander), Bonewrought Dreadhelm, Medallion of
Endless Profit, Bonewrought Warspaulders, Morthen's Cryptforged Hauberk,
Bonewrought Girdle, Deathless Warguard Legmail, Bonewrought Gauntlets, Tideworn
Warboots, Seal of the Nine Oaths, Oath of the Round Table.

**Rotation**
1. `battle_stance` and `battle_shout` before the pull
2. `bloodrage` (Blood Toll) under 40 rage
3. `recklessness`, then `breachmaker` on cooldown (+20% of your own damage, 8 s)
4. `mortal_strike` (Maiming Strike) at 30+ rage
5. `overpower` (Brute Swing), 2 charges, cannot be dodged
6. `slam` (Redhand), free and generates 8 rage
7. `cleave` (Reaping Arc) above 70 rage as the dump, `execute` under 20%

**Damage:** Auto Attack 34%, Redhand 27%, Maiming Strike 20%, Brute Swing 7%.

**Findings.** **The healthiest economy in the study and the reference for what a
working resource looks like:** 68% average rage, only 8% capped, 2% starved, and
it spends just 4% of the fight below a quarter pool. 1% idle, 96% retention, zero
legendary dependence.

Loses more to heroic armor than most (195 to 166, 15%) because a third of its
damage is white.

## Fire mage (Pyromancy) - 186 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 294 | 209 | **186** | 150 | 86 | **310** | 158 |

**Economy:** mana, 16% average, 26% starved, dry at 112s, 78% below a quarter.
**Talents:** class default build.
**Gear:** Scepter of the Deathless Court, Wraithfire Cowl, Zense Meridian,
Wraithfire Mantle, Mournweave Starshroud, Wraithfire Cord, Mournweave Legwraps,
Wraithfire Gloves, Mournweave Soulsteps, Niela's Coldlight Band, Ashen Focus
Ring.

**Rotation**
1. `arcane_intellect` before the pull
2. `combustion` (Phoenix Trance) on cooldown, off GCD. It makes every Fire spell
   crit AND instantly completes the recharging Fire Blast charge, so it is meant
   to chain Hot Streaks
3. `pyroblast` (Pyrelance) **only** on a Hot Streak; the hard cast is 6 s and is
   never correct
4. `fire_blast` (Cinderfall) on cooldown - it ALWAYS crits and builds Hot Streak,
   so two in a row are a guaranteed free Pyrelance
5. `meteor`, then `power_echo`
6. **`scorch` (Scald) whenever the target is at or below 30% health** - it always
   crits there, chaining Hot Streaks through the whole execute phase
7. **`scorch` rather than re-casting `fireball` while the Fireball DoT rides** -
   the filler was clipping its own DoT

**Damage:** Cinderfall 24%, Ignite 19%, **Scald 18%**, Pyrelance 18%, Cinderbolt
17%.

**Findings.** **The two biggest rotation corrections in the study landed here.**
Scorch's always-crit window below 30% health was worth **+52% in execute** (212
to 322 on the fixed build), and not clipping the Fireball DoT is worth +7.7% at
120 s and +5.9% at 300 s. Scald is now 18% of its damage and was previously zero.

Its shape is the most extreme in the game: **310 DPS in execute against 86 at
five minutes.** Out of mana at 112 s and 78% of the fight below a quarter pool.

**This cannot be specced out of.** `mag_r20_evocation` exists on the level 20 row
("Aetherwell: channel to restore mana"), and re-running the entire build search
against a 180-second objective **still refuses it** in favour of Rune of Power's
+10% damage aura. Speccing for sustain makes Fire mage worse, 86 to 88 at best.
The mana capstone loses its own row, so no build fixes this.

## Shadow priest (Vespers) - 173 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 175 | 175 | **173** | 174 | 153 | 175 | **173** |

**Economy:** mana, 35% average, 65% starved, dry at 245s.
**Talents:** L20 Incarnate Spirit. Sustain-specced it also takes L14 Meditation
and reaches 175 at 300 s.
**Gear:** Lunar Tide Greatstaff, Wraithfire Cowl, Zense Meridian, Wraithfire
Mantle, Mournweave Starshroud, Wraithfire Cord, Mournweave Legwraps, Wraithfire
Gloves, Mournweave Soulsteps, Niela's Coldlight Band, The Architect's
Cornerstone.

**Rotation**
1. `shadowform` before the pull, `power_infusion` (Anointing) on cooldown
2. `summon_tithefiend` at 5 Gloomtithe stacks (it gains +25% damage and +10%
   scaling when summoned at max stacks, so summoning early is a real loss)
3. `shadow_word_pain` (Dirge of Decay) when missing or under 3 s
4. `mind_blast` (Mindfracture) on cooldown
5. `mind_flay` (Litany of Woe) filler

**Damage:** Litany of Woe 38%, **Tithefiend Strike 27%**, Mindfracture 17%,
Dirge of Decay 16%.

**Findings.** **The most consistent spec in the study by a wide margin**
(standard deviation 3 at 60 s against a roster average near 10) and **identical
DPS on normal and heroic to the decimal**. That is not a bug: its damage is
channel ticks, a DoT and pet strikes, and `isSpellResisted` is rolled once per
cast at projectile impact, never per DoT tick.

It also has a real answer to the mana cliff and takes it: the 180 s search picks
Meditation (+7.4%) and Incarnate Spirit (+17.4%). It is the template for what
Fire mage and Marksmanship are missing.

Clipping Mind Flay with Mind Blast is **correct** and worth 27%: a variant that
protects the channel reads 128 against 174.

## Survival hunter (Fieldcraft) - 163 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 157 | 161 | **163** | 153 | 87 | 161 | 121 |

Sustain-specced it reaches **114 at 300 s**, the biggest sustain gain in the
study at +32%.

**Economy:** focus, **93% average, 62% CAPPED, 0% starved, never dry.**
**Talents:** L20 Fang Chorus.
**Gear:** Bonewrought Greatsword, Direfang Crown, Swiftfang Talisman, Direfang
Shoulderguards, Nightfang Harness, Direfang Waistband, Nightfang Legguards,
Direfang Grips, Nightfang Treads, Sutil's Gambit, The Architect's Cornerstone.
**Pet: Ridge Stalker.**

**Rotation** (an in-and-out melee loop, not a ranged one)
1. `aspect_of_the_hawk`, tame before the pull, stand at ~12 yards
2. `bloodtrail_assault` on cooldown
3. With no Bloodhook Wound up: `bloodhook` if 8+ yards away (it charges you back
   into melee), otherwise `trailbreak` (leap 12 yards back to arm Re-entry)
4. `shrapnel_charge` while the wound rides
5. `mongoose_bite` (Woundrend) at 3 Hunting Momentum or when the wound is expiring
6. `raptor_strike` (Gutting Strike) filler, free and restores 15 focus

**Damage:** Auto Attack 49%, Woundrend 17%, Bloodhook Wound 8%, Gutting Strike
8%, Shrapnel Charge 7%.

**Findings.** **Getting the leap loop wrong costs 85% of this spec's damage.** An
early version that fired Trailbreak without the distance check stranded the
hunter out of melee and read **24.7 DPS at 99% idle**. The spec is unusually
punishing about positioning.

**Its focus is completely inert: 62% of the fight capped, never starved once.**
Gutting Strike is free AND refunds 15 focus, so the resource has no function at
all. Whatever Fieldcraft is balanced around, it is not focus.

Loses the most of any hunter to heroic armor (163 to 121, 26%) because half its
damage is white.

## Affliction warlock (Hexcraft) - 157 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 135 | 144 | **157** | 149 | 135 | 144 | 144 |

**Economy:** mana, 27% average, 38% starved, dry at 227s.
**Talents:** L5 Pact Deepened.
**Gear:** Scepter of the Deathless Court and the Wraithfire / Mournweave caster
set, The Architect's Cornerstone, Niela's Coldlight Band.
**Pet: Doomguard** (+11% over the Imp).

**Rotation**
1. `demon_skin` and the Doomguard before the pull
2. `life_tap` (Hard Bargain) under 25% mana
3. Keep all four rolling: `corruption` (Blackrot), `curse_of_agony` (Hex of
   Anguish), `siphon_life` (Veinleech), `immolate` (Burning Pact)
4. `shadowburn` (Duskfire), `chaos_bolt` (Ruinbolt), then `shadow_bolt` filler

**Damage:** the flattest profile in the game, nothing above 19%: Gloom Bolt 19%,
Auto Attack 19%, Burning Pact 13%, Blackrot 12%, Ruinbolt 11%, Hex of Anguish
10%, Veinleech 9%.

**Findings.** The best of the three warlocks and **the only one whose mana works**
(27% average, dry only at 227 s) because Life Tap is a genuine engine when there
are enough DoTs to fill the GCDs it costs. Its 42 Life Taps per fight are the
most of any spec.

Drain Life as a filler measured **10% worse**, so the Shadow Bolt filler is right.

## Elemental shaman (Thundercall) - 152 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 170 | 157 | **152** | 147 | 106 | 157 | 147 |

**Economy:** mana, 28% average, **80% starved**, dry at 164s.
**Talents:** L14 Flow State, L20 Living Weapon.
**Gear:** Stormcaller's Focus, Pearlward Aegis (offhand), Wraithfire Cowl, Zense
Meridian, Wraithfire Mantle, Mournweave Starshroud, Wraithfire Cord, Mournweave
Legwraps, Wyrmchoir Handwraps, Mournweave Soulsteps, The Architect's
Cornerstone, Zyzz's Deathless Signet.

**Rotation**
1. `flametongue_weapon` and `lightning_shield` before the pull
2. **`earth_shock` (Earthen Jolt) the instant Thunder hits 5** - charges CAP at
   5, and `thundercallDamageMultiplier` returns 1 below the cap, so the vent only
   pays at exactly 5 (2.25x, or 2.81x inside Primal Mastery) and every Arc Bolt
   landed at a full bank is wasted
3. **Never overlap Primal Exaltation and Primal Mastery.**
   `thundercallOnArcBoltImpact` reads them as an OR, not a sum
   (`accelerated ? 2 : 1`), so running them together throws away a whole 12 s
   doubling window. Spread they give 24 s of doubled generation per two minutes;
   stacked they give 12 s
4. `lightning_bolt` (Arc Bolt) filler

**Damage:** Arc Bolt 77%, Earthen Jolt 23%. Only two sources.

**Findings.** **The spec the whole research pass turned on.** The accelerator
overlap was worth **+11.8% at 300 s** and is invisible in the tooltips: it is one
`||` in the engine. Venting at the cap rather than early is worth a further 2.3%.

Talents matter more here than anywhere else: on class default rows it reads
**96 DPS**, optimized 152, a **+56%** swing. Any bench leaving Elemental on
defaults is measuring something else entirely.

**80% starved and only two damage sources** for 100% of its output. It is the
most one-note spec in the game and the second most resource-broken.

## Demonology warlock (Pactbound) - 151 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 154 | 157 | **151** | 137 | 97 | 157 | 137 |

**Economy:** mana, 20% average, **66% starved**, dry at 138s.
**Talents:** L5 Pact Deepened, L20 Hexstorm.
**Pet: Doomguard** (+14% over the Imp, the largest pet delta of the three).

**Rotation:** as Affliction, plus `metamorphosis` (Dread Aspect) on cooldown
(+20% spell damage, +20% cast speed, +50% pet damage).

**Damage:** Auto Attack 28%, Gloom Bolt 26%, Burning Pact 14%, Hex of Anguish
13%, Blackrot 12%. **28% from the pet.**

**Findings.** The weakest identity of the three warlocks. It is meant to be the
pet spec but its pet share (28%) is barely above Destruction's (31%), and
Metamorphosis fires **twice in five minutes** on its 180 s cooldown. It sits
between its two siblings on every window without doing anything either of them
does not.

## Marksmanship hunter (Coldsight) - 141 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 148 | 141 | **141** | 136 | **56** | 141 | 126 |

**Economy:** focus, 48% average, 12% starved, dry at 13s.
**Talents:** L14 Trapcraft, L17 Shell and Fang, L20 Fang Chorus.
**Gear:** Direfang Greatblade and the Direfang / Nightfang agility set, Sutil's
Gambit, Fleetblood Band. **Pet: Ridge Stalker.**

**Rotation**
1. `aspect_of_the_hawk`, tame before the pull
2. `cold_focus` on cooldown. It is a throughput window, not a filler: Aimed Shot
   costs 25% less and casts 30% faster, and Measured Shot's focus return rises
   to 30
3. `rapid_fire` (Fevered Draw)
4. **`serpent_sting` (Venom Barb) maintained** - simply absent from the first
   pass, worth +6.1%
5. `aimed_shot` (Long Draw), else `measured_shot`

**Damage:** Auto Shot 31%, Long Draw 19%, Auto Attack 18%, Fevered Draw 11%,
Measured Shot 8%, **Venom Barb 6%**.

**Findings.** **The worst spec in the game over a long fight: 56 DPS at five
minutes from 141 at one.** 40% retention, the lowest in the study.

**Marksmanship cannot spec out of this.** Every level 20 option (Overdraw, Chain
Reaction, Fang Chorus) is a damage talent; there is **no focus-restoration talent
anywhere on the hunter tree**. Re-running the whole build search against a
180-second objective moved it from 56 to 56. This needs a kit change, not a
number change.

Note the odd shape: only 12% starved and 48% average focus, yet it still
collapses. The focus is not empty, it is arriving too slowly to matter.

## Destruction warlock (Ruination) - 130 DPS at 60s

| 15s | 30s | 60s | 120s | 300s | Execute | Heroic 60s |
|---:|---:|---:|---:|---:|---:|---:|
| 107 | 117 | **130** | 119 | 80 | 117 | **130** |

Sustain-specced it reaches 95 at 300 s.

**Economy:** mana, 19% average, **93% starved** (the worst in the game), dry at
131s.
**Talents:** L5 Pact Deepened.
**Gear:** Heartwood of the Deathless Crown, Wraithfire Cowl, Yumi's Keepsake
Locket, Wraithfire Mantle, Shroud of the Gravewyrm, Wraithfire Cord, Lunar Choir
Leggings, Wraithfire Gloves, Shadowpulse Slippers, Niela's Coldlight Band, The
Architect's Cornerstone. **Pet: Doomguard.**

**Rotation**
1. `demon_skin` and the Doomguard before the pull, `life_tap` under 25% mana
2. `conflagrate` whenever Immolate rides and it is off cooldown (it CONSUMES the
   Immolate)
3. `immolate` (Burning Pact) to re-apply
4. `chaos_bolt`, `shadowburn`, `curse_of_agony`, `corruption`, `shadow_bolt`

**Damage:** Auto Attack 31%, **Burning Pact 27%**, Conflagrate 16%, Ruinbolt 10%.

**Findings.** **The lowest DPS in the game at 60 seconds, the lowest opener at
107, and the most resource-broken spec in the study: it cannot afford anything on
93% of its ready GCDs.**

The Immolate/Conflagrate loop is self-cannibalising: 46 Immolate casts to support
30 Conflagrates means roughly a third of its cast time re-applying a DoT it then
deletes. Delaying Conflagrate to a late Immolate is worth +2.9% and dropping it
entirely is worth +1.0%, so the signature ability is close to DPS-neutral.

The one thing it owns: **complete immunity to the heroic level step** (130 on
both difficulties), because its damage is DoT ticks, pet damage and white swings,
none of which roll spell resist.

---

# Healers

Every healer faced an identical pattern: a boss swing on the tank every 2.6 s
plus a raid-wide pulse worth 10% of each member's own pool every 15 s, roughly
**136 incoming DTPS** on normal and **243** on heroic, over 180 seconds with a
tank and three others to keep alive.

| Healer | HPS | Absorb/s | Total/s | Covers | Overheal | Deaths | Avg mana | Starved | Dry at |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Restoration shaman | 121 | 0 | **121** | 89% | 22% | **1.3** | 48% | 38% | 174s |
| Restoration druid | 106 | 0 | **106** | 78% | 16% | 12.9 | 35% | **15%** | 157s |
| Holy paladin | 87 | 0 | **87** | 63% | 38% | 21.3 | 34% | 44% | 125s |
| Discipline priest | 43 | 35 | **79** | 58% | 24% | 21.4 | 19% | **74%** | **67s** |
| Holy priest | 73 | 0 | **73** | 54% | 39% | 24.0 | 21% | 50% | 75s |
| Arcane mage | 45 | 0 | **45** | 34% | 22% | 39.3 | 20% | 28% | 86s |

Heroic: shaman 150, druid 115, paladin 93, holy priest 91, disc 89, arcane 45,
all against **243 incoming**. No single healer covers heroic; two is the floor.

## Restoration shaman (Spiritmend) - 121/s

**Talents:** L17 Wayfarer Grace, L20 Living Weapon.
**Rotation:** `lifespring_weapon` before the pull, `primal_exaltation` on
cooldown, `chain_heal` when allies carry Mending Current and 2+ are hurt,
`tidecall` under 55%, `healing_wave` (Mending Waters) under 90%, `lightning_bolt`
with anything spare.
**Healing:** Mending Waters 81%, Mending Current 12%, Tidecall 4%.

**Findings.** **The only healer that works**: it both sustains its pool (dry at
174 s against 67-125 for everyone else) and holds the group (1.3 deaths against
12.9 to 39.3). It covers 89% of incoming single-handed.

**A rejected engine hypothesis.** Healing Wave deposits 50% of its heal (Tidecall
100%) into a Mending Current pool, and **Chain Heal consumes that pool at 1.25x**
- the spec's entire payoff. The study's gate meant Chain Heal never fired once.
Firing it as soon as one target is banked raised throughput 2.1% but raised
deaths from 1.8 to 3.8. In a five-person bench where only the tank takes real
damage, an AoE heal loses to direct healing. In a real raid with spread damage it
would not, so **this is the one healer number most likely to be understated**.

## Restoration druid (Groveheart) - 106/s

**Talents:** L14 Seedspread, L20 Quickening.
**Rotation:** `innervate` under 40% mana, `swiftmend` (Overbloom) at 5 Verdance,
`healing_touch` (Wildmend) under 40%, `rejuvenation` (Wildbloom) on anyone
missing it, `regrowth` (Second Bloom) on the lowest under 85%, `wrath` spare.
**Healing:** Wildmend 49%, Wildbloom 31%, Second Bloom 10%, Overbloom 9%.

**Findings.** Second best and **by far the most mana-efficient: only 15% starved
against 38-74% for everyone else**, and the lowest overheal at 16%. A clean
second-place healer with no structural problem beyond the shared mana ceiling.

## Holy paladin (Sunmender) - 87/s

**Talents:** L14 Divine Purpose, L20 Dawn Echo.
**Rotation:** `sacred_form`, `grace_devotion`, `devotion_ward` before the pull,
then `avenging_wrath`, `divine_ascension` at 20 Devotion, `beacon_of_light` on
the tank, `radiant_chorus` at 3+ injured, `dawns_embrace` under 40%,
`solar_invocation` and `holy_light` under 85%, then `hammer_of_grace` and
`mercy_lance` on the boss to bank Devotion and mana.
**Healing:** Mending Light 60%, Solar Invocation 30%, Hammer of Grace 6%.

**Findings.** The only healer that meaningfully damages while healing (61 DPS
against 1-22 for the others), which is its identity working. But 38% overheal is
the second worst and it covers only 63%.

**Dawn's Embrace never fires.** Radiant Chorus healing 2+ allies grants Radiant
Resonance, which makes Dawn's Embrace cost half and cast in 1.5 s. Rewriting the
loop to cash that in measured **identically** (0.0%), so the chain is either not
triggering or not worth its GCD. Worth a designer look.

## Discipline priest (Doctrine) - 79/s

**Talents:** L8 Shattered Psalm, L14 Measured Faith, L17 Martyr's Aegis.
**Rotation:** `power_infusion`, keep `power_word_shield` (Psalm of Warding) on
the tank, `scouring_mercy` or `flash_heal` under 45%, `heal` under 80%, shield
the lowest, `renew`, then `smite` (Scouring Hymn) as the Atonement engine.
**Healing:** Urgent Prayer 31%, Solemn Prayer 28%, Shattered Psalm 17%.

**Findings.** The only healer whose throughput is meaningfully absorb-based (35
of its 79). **The worst mana economy of any spec in the study: 74% starved, dry
at 67 s, holding 19% of its pool.**

**A rejected engine hypothesis.** `DOCTRINE_CONVERSION` is 0.3, so 30% of Smite
damage becomes healing on the linked ally, which suggests a smite-heavy loop.
Measured **4% worse**: direct healing beats Atonement at this gear level.

## Holy priest (Benison) - 73/s

**Talents:** L14 Measured Faith.
**Rotation:** `seraphic_vigil` on the tank (it consumes when they drop below 35%,
one vigil at a time), `choir_of_deliverance` and `prayer_of_healing` at 3+
injured, `flash_heal` under 35%, `heal` under 90%, `renew`, then `smite`.
**Healing:** Solemn Prayer 52%, Seraphic Vigil 24%, Urgent Prayer 21%.

**Findings.** **The worst dedicated healer: 73/s covering 54% of incoming, 39%
overheal (the worst in the study), dry at 75 s.** Both priest specs sit at the
bottom and both run dry in about a minute, which points at the priest mana pool
rather than at either spec's kit.

## Arcane mage (Chronomancy) - 45/s

**Talents:** class default build.
**Rotation**
1. `perfect_moment` on cooldown (4 free Arcane Charges, and for 10 s Aether Darts
   does not consume them)
2. **`temporal_cascade` for the GROUP echo.** The individual Temporal Echo is
   ONE MARK AT A TIME - re-casting MOVES it - so echoing each ally in turn just
   thrashes a single aura
3. `temporal_echo` parked on the tank, refreshed only when it drops
4. `temporal_rewind` under 30%, `temporal_mend` under 45%
5. **`arcane_missiles` (Aether Darts) at 4 charges** - it SPENDS them and fires
   5 missiles instead of 3 at max
6. `arcane_surge` to build charges (+30% damage each, cost doubles each)

**Healing:** Temporal Mend 43%, Temporal Echo 41%, Temporal Cascade 12%.

**Findings.** **The single largest correction in the study: +28%** (41 to 53 on
the fixed build, 45 after re-optimization) purely from understanding that the
individual echo is one mark and that Aether Darts is the spender. The first pass
never cast Aether Darts at all.

Even corrected it is **the worst healer by a distance, covering 34% of incoming
with 39.3 deaths.** It heals THROUGH arcane damage, so its 22 DPS is doing double
duty, but the conversion is not enough. As a primary healer it does not function.

---

# Tanks

Unhealed, against boss melee only. No Gravebreaker, no adds. Health is re-pinned
each tick so the window always completes; "survival" is the pool divided by
measured intake.

| Tank | Pool | Armor | DTPS | Survival | Biggest hit | Avoided | Blocked | Threat/s | DPS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Ironguard warrior | 2632 | 3007 | **112** | **23.6s** | 875 (33%) | 27% | 5% | 173 | 64 |
| Faithwarden paladin | 2318 | 3122 | 136 | 17.2s | 860 (37%) | 16% | **50%** | **620** | 123 |
| Wildfang bear | 1957 | **4507** | 196 | 10.0s | 794 (41%) | 17% | 0% | 158 | 70 |
| Stonebound shaman | **1733** | 3657 | 201 | 8.7s | 1252 (72%) | 13% | 0% | 187 | 97 |

Heroic: warrior 179 DTPS / 14.9 s, paladin 249 / 9.4 s, bear 325 / 6.1 s,
**Stonebound 399 / 4.4 s with a max hit of 2433 against a 1733 pool: 140%, a
literal one-shot.**

## Protection warrior (Ironguard)

**Talents:** L14 Battle Rhythm.
**Gear:** Thronebane, Bonewrought Bulwark, Bonewrought Dreadhelm, Yumi's Keepsake
Locket, Bonewrought Warspaulders, Morthen's Cryptforged Hauberk, Bonewrought
Girdle, Tidewoven Trousers, Sanctum Prowler's Grips, Barrowlord Sabatons, Oath of
the Round Table, Sutil's Gambit.
**Rotation:** `defensive_stance` and `battle_shout` before the pull, then
`bloodrage`, `raised_guard`, `iron_resolve`, `shield_slam`, `revenge`,
`thunder_clap`, `sunder_armor`, `faultline`.

**Findings.** **The best tank by a wide margin, and the reason is one ability.**
Raised Guard costs 15 rage, stores **2 charges on a 12-second recharge**, and
grants **50% physical damage reduction for 6 seconds**. Two charges covering six
seconds each on a twelve second cycle is continuous uptime: the warrior holds a
permanent halving of physical damage.

Its weakness is threat: 173 TPS against the paladin's 620.

## Protection paladin (Faithwarden)

**Talents:** L8 Recurring Grace, L14 Sacred Reserve.
**Rotation:** `righteous_fury`, `devotion_ward`, `dawn_devotion` before the pull,
then `divine_ascension` at 20 Devotion, `holy_shield`, `bastion_rite`,
`avenging_wrath`, `vowkeeper_strike`, `sunward_disc`, `bastion_sweep`,
`consecration`, `hammer_of_grace`.

**Findings.** **Blocks 50% of all incoming swings and still takes 21% more damage
per second than the warrior**, because Bastion Rite's 20% on a 10-second cooldown
cannot compete with a permanent 50%.

Generates **3.6x the warrior's threat** (620 against 173) off nearly double the
damage plus Righteous Fury's +60% on holy damage. The two are unequal on two
different axes in opposite directions, so they are not interchangeable.

## Feral bear (Wildfang)

**Talents:** L8 Ironhide Reflex, L17 Lifesap.
**Rotation:** `mark_of_the_wild` and `bear_form` before the pull, then `barkskin`,
`frenzied_regeneration`, `enrage`, `demoralizing_roar`, `faerie_fire`, `swipe`,
`maul`.

**Findings.** **The bear carries the most armor in the game (4507, 50% more than
the warrior) and has among the least survival (10.0 s against 23.6 s).**

It has no active mitigation. Barkskin grants **+150 armor on a 60-second
cooldown**, worth roughly 1% damage reduction against a pool already above 4,500.
It is the only tank besides Stonebound with no block and no percentage reduction.
Re-running the entire build search with Barkskin explicitly in its rotation so
the optimizer could pick a defensive row instead **scored identically (12.6 both
times)**. This is the kit, not the loop.

## Stonebound off-tank (Warspirit)

**Talents:** L8 Warded Elements, L14 Ward Cycle, L20 Living Weapon.
**Gear:** Thronebane, Bonewrought Bulwark, Bonewrought Dreadhelm, Yumi's Keepsake
Locket, Bonewrought Warspaulders, Morthen's Cryptforged Hauberk, Gravescale
Girdle, Deathless Warguard Legmail, Sanctum Prowler's Grips, Barrowlord Sabatons,
Oath of the Round Table, Sutil's Gambit.
**Rotation:** `rockbiter_weapon` and `lightning_shield` before the pull, then
`stormstrike`, `lightning_bolt` on Stormcast, `earth_shock`, `primal_exaltation`.

**The kit.** `rockbiter_weapon` grants **+30% armor, 10% flat damage reduction**
(15% with Imbue Mastery) and **DOUBLE threat**. **Earthen Jolt becomes a 3-second
forced-target taunt.** **Thunder Ward** (lightning_shield, no cooldown) adds a
further 10% reduction for 3 s. With Living Weapon, each consumed Stormcast adds
an absorb worth **8% of maximum health**.

**Findings.** A genuine fourth tank on normal: 201 DTPS and 8.7 s survival puts
it alongside the bear, with **the highest tank damage in the game (97 DPS)** and
better threat than the bear (187 against 158).

**Thunder Ward is a trap.** Spamming it measured **worse** than never re-casting
it (186 against 181 DTPS) and cost a quarter of the threat (172 against 225 TPS),
because 10% DR for 3 s at 25-40 mana is more than a shaman's pool can pay. The
tooltip reads like an active mitigation button; the mana bar says otherwise.

**It is not heroic-viable.** At 399 DTPS it survives 4.4 seconds, and its largest
observed hit is **140% of its own health pool** - a literal one-shot. Threat also
collapses from 187 to 23 TPS because it is dead or starved before it can build
any. The smallest pool in the game (1733, 66% of the warrior's) is the binding
constraint.

---

# Cross-cutting findings

1. **Thronebane is an item bug and it is the top of the DPS table.**
   `kingsbane_last_oath` carries 21.4 weapon dps against a 19.1 two-hander
   ceiling, has **no `hand` field** so it is offhand-legal, and both the normal
   and heroic variants exist so the pair is farmable. Worth +22 to +36% to
   exactly the five dual-wield specs (all three Rogues, Fury, Enhancement).
   Four classes cannot use it at all. The v0.30.0 fix (mainhand lock AND a weapon
   re-band, measured as insufficient separately) never reached this branch.

2. **The spread is 2.37x at 60 seconds and 5.10x at five minutes**, against a
   declared intent of roughly plus or minus 15%. The epic-only control is still
   2.11x, so the item is a real problem but not the reason the roster is wide.

3. **Resource design fails in two opposite directions, and both are broken.**
   - **Overflow:** Survival hunter spends **62% of the fight at capped focus**
     and never starves; Beast Mastery 45%. Their filler is free and refunds
     focus, so the resource does nothing.
   - **Starvation:** Destruction warlock cannot afford anything on **93% of its
     ready GCDs**; Elemental 80%; Demonology 66%; Discipline priest 74%.
   - **Healthy:** Arms warrior (68% held, 8% capped, 2% starved) and Balance
     druid (98% held, never dry) are the two reference points.

4. **The sustain cliff is a different gap per class.** Shadow priest HAS a mana
   answer and takes it. Fire mage HAS Evocation and the optimizer rejects it even
   over a three-minute fight. Marksmanship has **no focus talent anywhere on its
   tree**. Only the first is a tuning problem.

5. **The heroic level step only taxes direct casts.** `isSpellResisted` rolls
   once per cast at projectile impact (`casting_lifecycle.ts:2071`) and never per
   DoT tick, so heroic costs Balance druid 11% and Shadow priest and Destruction
   warlock literally nothing.

6. **Only one healer holds a group**, and both priests run dry in about a minute.

7. **The warrior holds permanent 50% physical reduction**; the bear and the
   Stonebound shaman have no percentage mitigation at all.

## What the spread costs a raid

Nythraxis is a 10-player encounter with a 60,000 pool on normal and 192,000 on
heroic. With 1 tank, 2 healers and 7 DPS:

| Comp | Normal kill | Heroic kill |
|---|---:|---:|
| Best 7 DPS | 33s | **118s** |
| Median 7 | 41s | 148s |
| Worst 7 | 51s | **180s** |

Comp choice swings the heroic kill by 62 seconds, which compounds with the healer
finding: at 180 seconds, healers who run dry at 67 to 125 seconds spend most of
the fight out of mana.

## Suggested order of work

1. **Thronebane.** `hand: 'mainhand'` plus a weapon re-band to at or under 19.1.
   Cheap, retroactive (item ids resolve on load, no migration), and it removes
   the largest single distortion in the table.
2. **The two broken resource designs.** Destruction/Elemental/Demonology cannot
   press buttons; Survival/Beast Mastery have a resource that does nothing.
   Neither is a damage-tuning problem.
3. **The sustain cliff**, as two separate fixes: make `mag_r20_evocation` worth
   its row, and give the hunter tree a focus-restoration option at all.
4. **Bear and Stonebound mitigation.** Barkskin needs to be a percentage
   reduction to function at endgame armor; Stonebound needs either a larger pool
   or cheaper Thunder Ward to be heroic-viable.
5. **Tank threat.** A 3.6x gap means one tank cannot hold a pull the other can.
6. **Chronomancy.** It is corrected and still the worst healer by a distance.

## Confidence and known limits

Every rotation was written against the engine source. Six specs had real errors
found that way (Fire mage, Chronomancy, Elemental, Subtlety, Frost, Marksmanship)
worth between +1.2% and +52%.

Four plausible engine-derived changes measured WORSE and were reverted, which is
the more useful half of the exercise: Feral druid's bleed-protection (-12.5%),
Combat rogue's Knockout cash-out (-2.2%), Enhancement's Stormsurge ordering
(-1.6%), and Discipline priest's Atonement-heavy loop (-4.0%). Reading the engine
tells you the mechanic; only measurement tells you the priority.

Known soft spots, disclosed: Feral cat never applies Rip under the optimal loop;
Restoration shaman's Chain Heal payoff is unused and is probably understated in a
five-person bench; Holy paladin's Dawn's Embrace never fires; and the healer and
tank loops are hand-authored rather than ported from a shipped probe, so they
carry more rotation risk than the damage specs.
