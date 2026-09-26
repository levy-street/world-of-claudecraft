# Choirmend cooldown (12 sec)

Study behind the `cooldown: 12` on `prayer_of_healing` (Choirmend, the holy priest group
heal in `src/sim/content/talent_abilities_v2_a.ts`). Measured 2026-09-24 against live
Parses data (builds 0.43 to 0.44) and the real `Sim` via
`scripts/choirmend_cooldown_montecarlo.ts`.

## Why a cooldown, and why 12

Choirmend shipped with no cooldown. On live raid boss kills (151 holy priest parses):

| Measure | Median |
|---|---|
| Choirmend share of a holy priest's effective healing | 67% (a quarter of priests above 86%) |
| Choirmend casts per minute | 8.3 (time between casts 3.3 sec, its cast time) |
| Choirmend overheal | 79% |
| Effective healing per Choirmend cast | 746 (1,196 for priests casting it under 5 times a minute, 649 above 11) |
| Effective healing per Solemn Prayer cast | 453, flat across cast frequency |
| Holy priest HPS vs the other healers | priest 154, holy paladin 123, resto druid 98, resto shaman 89 |

The closest ability in the game is the holy paladin's Radiant Chorus: the same 30 yd group
heal, 2 sec cast, 12 sec cooldown, and a smaller heal per cast. Choirmend on 12 sec keeps the
two healer specs on the same footing; a shorter cooldown leaves Choirmend ahead on both heal
size and availability. The other group heals (Choir of Deliverance 180 sec, Gladesong 300 sec)
are once-a-fight buttons, not fillers, so they are not the reference.

## Monte Carlo (real Sim)

Level 20 best-in-slot holy priest with the most common live raid build (Veil Unbound,
Shattered Psalm, Lingering Dread, Measured Faith, Martyr's Aegis, Second Verse). Rotation:
Choirmend whenever off cooldown, otherwise Solemn Prayer on the lowest-health target. Two
arenas: the five Eastbrook Healing Training Ground dummies (the priest at the test spot in
`tests/healing_training.test.ts`, whose 30 yd ring also includes Drillmaster Hale and the two
hub practice dummies at full health) and ten wounded level 20 allies as a raid-sized bench.
8 runs of 180 sec per row; the world seed is pinned and only the dice vary. The raid-sized
bench was run only for the shipped value and the candidate, since the dummies arena already
showed that 8 to 15 sec land within a few percent of each other.

| Cooldown | Dummies raw HPS | Dummies effective HPS | Raid-10 raw HPS | Choirmend/min | Solemn/min |
|---|---:|---:|---:|---:|---:|
| 0 (before) | 1,068 | 848 | 1,718 | 16.0 | 0 |
| 8 | 626 | 563 | not run | 4.7 | 17.3 |
| 12 | 563 | 518 | 708 | 3.3 | 19.0 |
| 15 | 511 | 478 | not run | 2.7 | 19.7 |

Mana is neutral: Choirmend costs 145 per 3 sec cast and Solemn Prayer 91 per 2 sec, so both
rotations burn about 2,800 mana per minute at full cast uptime against about 800 regen, and the
3,579 pool lasts about 105 sec either way. Live priests cast 58% of the time, which is why they
finish 156 sec fights with mana today, and that does not change.

## Projection onto live parses

Each live priest keeps the Choirmend casts that fit a 12 sec spacing; every freed 3 sec cast
window becomes 1.5 Solemn Prayers at that priest's own live effective healing per Solemn cast.

| Holy priest effective HPS on raid boss kills | p25 | p50 | p75 | p90 |
|---|---:|---:|---:|---:|
| Live before the change | 114 | 154 | 193 | 229 |
| 12 sec, Solemn at live effectiveness | 117 | 152 | 179 | 206 |
| 12 sec, Solemn half as effective | 90 | 118 | 143 | 169 |
| 12 sec, no filler | 57 | 82 | 118 | 146 |

The sim halves raw throughput but the boards barely move at the median, because live
Choirmend wastes 79% of its healing while Solemn Prayer lands 453 in two thirds of the cast
time. The change lands on the top quarter (the priests spamming it hardest lose 7 to 10%) and
moves Choirmend from 71% to 27% of holy healing (casts per fight 20 to 7). Even the
pessimistic row keeps holy priest level with holy paladin, so no compensating buff ships with
the cooldown.

## Release follow-up

The player wiki seed (`mediawiki/seed/pages.xml`, built by `scripts/mediawiki/build_seed.mjs`)
prints each ability's cooldown and is only held byte-fresh at the release tier
(`tests/mediawiki_seed_freshness.test.ts`), so the release that carries this change regenerates
it with `npm run wiki:seed`.

## Reproducing

- Sim: `npx tsx scripts/choirmend_cooldown_montecarlo.ts --runs 8 --seconds 180 --cooldowns 0,12 --arena dummies`
  (also `--arena raid10`); about 90 sec per run, report in `tmp/choirmend_mc/`.
- Live: `GET /api/fights?surface=raid&segment=boss` on the Parses site, then `/api/fights/{id}`
  for participants and `/api/fights/{id}/events?source=<entityId>` for `castStart` and `heal2`
  lines (amount, overheal, ability name).
