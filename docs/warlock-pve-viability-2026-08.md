# Warlock PVE viability round (2026-08-23)

Owner directive: get all three warlock specs viable in PVE, converging on
about 200 DPS against heroic Nythraxis, using what live players actually
pick (gear, rotations, talents) as the measurement anchor.

## 1. What live players pick (parses.worldofclaudecraft.com, builds 0.36.0 to 0.39.3)

Boards: nythraxis_boss_arena, prod, all parses, DPS = damage done / fight
duration. The live landscape before this round, versus combat and fire live
heroic tops of 217 to 222:

| spec | difficulty | parses | top | p90 | median |
|---|---|---|---|---|---|
| affliction | normal | 45 | 183.8 | 167.5 | 147.0 |
| affliction | heroic | 45 | 169.5 | 159.4 | 130.9 |
| demonology | normal | 12 | 137.5 | 137.1 | 107.2 |
| demonology | heroic | 13 | 131.3 | 119.0 | 99.9 |
| destruction | normal | 13 | 148.8 | 125.5 | 85.0 |
| destruction | heroic | 12 | 132.8 | 88.7 | 83.6 |

Ideal gear (worn by nearly every ranked warlock, all three specs): Wraithfire
Regalia 4pc (heroic_soulflame_cowl, heroic_soulflame_mantle, soulflame_cord,
soulflame_gloves: the 4pc is the Soulblaze +40 spell power proc), Mournweave
3pc (necromancers_starshroud or heroic, necromancers_legwraps,
necromancers_soulsteps or heroic), zense_meridian, double
nielas_coldlight_band (hit) or double architects_cornerstone (haste),
heroic_wraithfire_orb offhand, and heroic_deathless_heartwood (legendary) or
scepter_of_the_deathless_court or lunar_tide_greatstaff mainhand.

Ideal talents: r20 wlk_r20_chaos_bolt (Unbroken Ritual) is universal across
all three specs in every studied parse; r14 splits shadow_mastery vs
amplify_curse; r17 splits across the utility options. Benched head to head,
the probe's existing rows (Ashen Focus + Unbroken Ritual) match or beat the
live picks on a stationary bench, so the fixture rows stayed.

Ideal rotations (from damage lines and hardcast timelines of the top
parses): affliction banks Condemnation near cap and spends Sentence
(23 to 33 casts a fight) between Needle of Fate hardcasts at 20 to 25 casts
per minute with 91 to 93% Condemnation uptime; demonology channels Essence
Reap as filler around a standing undead army, Ossuary Mark on cooldown, and
Soul Lance weaves; destruction runs Ruinbolt on 3 Wrack, Conflagrate on
cooldown, Burning Pact upkeep, and Gloom Bolt filler. All three match the
shape of the probe rotations in scripts/warlock_balance_probe.ts; the gap
was never rotation knowledge.

## 2. What was actually wrong

1. The probe's fixture kit (the pbe_boost "true-BiS caster kit") forfeited
   both caster set bonuses and most hit rating. Against the heroic profile
   it benched 21 to 33% under the kit the top live warlocks actually wear.
   Same defect class as the 2026-08 Warspirit fixture re-anchor.
2. The warlock probe only ever measured a zero-armor level-20 dummy. A
   level-22 heroic boss carries a 14% spell miss penalty (the
   ABOVE_LEVEL_MISS_PCT table) that hit gear must buy back, plus the real
   Nythraxis armor curve against pet melee, so the bands certified a fight
   that does not exist. The owned-class probe already modeled this;
   warlock's did not.
3. With both fixed, the real remaining power gap to the 200 heroic target
   was +6 to +9% per spec, not the 50%+ the raw parse medians suggested.

## 3. The change

- scripts/warlock_balance_probe.ts: WARLOCK_FULL_BIS_GEAR re-anchored to the
  live consensus kit; new WARLOCK_HEROIC_NYTHRAXIS_SCENARIO (level-22 target
  wearing the real Nythraxis armor curve including the heroic tuning's 1.2
  armorMultiplier, exactly as src/sim/instances/difficulty.ts scales the live
  heroic spawn) threaded through runWarlockBalanceProbe with the level-20
  dummy still the default.
- src/sim/content/spec_baselines.ts (the invisible hotfix-floor layer, the
  same knob surface the druid and rogue re-bands used):
  - affliction: global spellDmgPct 0.07
  - destruction: global spellDmgPct 0.10
  - demonology: global spellDmgPct 0.10 plus petDmgPct 0.15 (undead scale
    with neither spell knob)
  Sized from measured Monte Carlo slopes (about +0.8% DPS per 0.01
  spellDmgPct), not invented.
- Anchors: tests/warlock_anchor_*.test.ts now pin the 200 heroic contract
  (four-seed mean in [185, 220] at 120 s against the heroic scenario) plus
  the historical level-20 dummy as a drift tripwire;
  tests/warlock_five_minute_windows.test.ts re-minted and destruction added
  (it had no five-minute window at all).

## 4. Where the specs land (probe four-seed mean, 120 s, best real kit)

| spec | heroic Nythraxis (L22, 1.2x armor) | level-20 dummy | 300 s seed-42 |
|---|---|---|---|
| affliction | 204.8 (was 155.4 kit-corrected, 169.5 live top) | 208.8 | 206.0 |
| destruction | 207.0 (was 143.9) | 209.8 | 198.5 |
| demonology | 190.1 (was 135.0) | 228.3 | 179.2 |

24-seed confirmation at the heroic profile: affliction 202.3, destruction
202.8, demonology 199.3 (the pinned four seeds run a few points cold for
demonology; the wide-seed mean sits on the target). Demonology's level-20
dummy number runs hottest because undead neither miss a level-20 target nor
meet armor on the zero-armor shell; its heroic number is the contract.

Cross-class context: enhancement landed 212.7 heroic / 221 level-20 after
its 2026-08-23 softening round; combat was re-banded to its 200 band top;
live combat and fire heroic tops are 217 to 222. Warlock at about 200 heroic
sits at the table's top band without exceeding it.

Collateral, stated and accepted with the round: the shared damage multiplier
also reaches the flat-magnitude buff kinds, so Fiendhide's armor resolves
88/176 instead of 80/160 (pinned in tests/warlock_class_talents.test.ts).
Hard Bargain's health-to-mana conversion is deliberately EXCLUDED from the
floors (the scaleEffect lifeTap arm passes through untouched, pinned by the
Hard Bargain symmetry test), so the mana economy itself is unchanged: all
three specs still spend the pool by five minutes (end mana under 5% at
300 s) with starvation well inside the corridor. Two spec-locked tooltip
literals were updated to their floor-resolved values (Hex of Violence 16 to
17, Pyre Colossus impact 58-72 to 64-79).

## 5. Follow-ups deliberately out of scope

- server/pbe_boost.ts still ships the stale caster kit this round
  re-anchored away from; re-kitting boost accounts is a fleet decision
  (BOOST_KIT_VERSION bump).
- The bench-to-reality transfer levers from the Nythraxis decomposition
  (cast-on-the-move affordances, Sentence spend forgiveness at partial
  banks, pet leash QoL) remain the design fix for the parse MEDIANS; this
  round fixes the ceiling and the measurement. The parse tops already track
  the bench closely post-0.39 QoL (affliction top 169.5 vs a 169-ish
  kit-matched bench), so the raised ceiling is expected to transfer.
- PvP note: the same baselines apply in PvP (no separate PvE scaling
  layer), so warlock spell damage rises 7 to 10% and demonology pet damage
  15% there too; flagged for the next PvP balance review alongside the
  known WARFARE pets-bypass-defense issue.
