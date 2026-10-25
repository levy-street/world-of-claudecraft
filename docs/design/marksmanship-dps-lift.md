# Marksmanship DPS lift

## Why

Players report that Marksmanship (Coldsight) does too little damage. The sim agrees.
On `release/v0.45.0` at `69a0e1e041`, Marksmanship trails Survival (Fieldcraft) by
8 to 15% in every measured profile, roughly ties Beast Mastery on the raid profile,
and is the weakest hunter on three targets, even though it is the hunter spec with
the most cast-time shots.

This deliberately goes past the "same +10% budget" the v0.42.0 proposal set for
Coldsight (`docs/design/class-balance-v042.md`). Under that budget Coldsight and
Fieldcraft landed level (157.8 and 157.5 DPS in
`docs/design/class-balance-v042-results.md`, a 180 second profile); on the current
release the 120 second profile below has Fieldcraft 23 DPS ahead.

## Change

One number: `OFFENSIVE_SPEC_TUNING.hunter.marksmanship.physical` in
`src/sim/spec_output_tuning.ts` goes from 0.10 to 0.50.

That table is the offense-only additive bonus folded into `talent_hit_mult.ts`'s
damage multiplier. It reaches Marksmanship's own damaging abilities (Long Draw,
Fevered Draw, Measured Shot, Volley and the rest of the physical bucket) and their
Ranged Attack Power riders. It does not reach auto attacks, the pet, buffs, heals,
stats, costs, cast times, cooldowns or any other spec. The spec card's Specialization
bonus line reads the same table, so it now says "Increases melee and ranged ability
damage by 50%" with no copy change.

Per ability, the whole-hit multiplier (base and Ranged Attack Power rider together)
becomes 1 + 0.12 mastery + the ability's own baseline + 0.50:

| Ability | Before | After | Change |
| --- | ---: | ---: | ---: |
| Shots with no ability baseline (Fevered Draw, Volley, ...) | 1.22 | 1.62 | +33% |
| Fell Shot (`arcane_shot`, baseline 0.24) | 1.46 | 1.86 | +27% |
| Long Draw (`aimed_shot`, baseline 0.50) | 1.72 | 2.12 | +23% |

Total DPS rises less than these because auto attacks and the pet do not move.
`tests/v042_offense_packets.test.ts` pins the Fell Shot 1.86 through a real cast at
zero and 800 Ranged Attack Power.

Supersedes the open #4266, which was cut against an older v0.45.0 base before the
Fieldcraft rework and hunter mobility pass landed, and changed five values where one
now does the job.

## Measurements

Before and after use the same working tree with only the value changed. Every run is
the real `Sim` with finite Focus and seeded rolls.

Owned-class profile (`averageOwnedClassDpsProbe` from
`scripts/owned_class_balance_probe.ts`): exact PBE fixtures, pet included, eight seeds
(4242 + i * 7919 for i = 0..7).

| Profile | Spec | Before | After | Change |
| --- | --- | ---: | ---: | ---: |
| Nythraxis level 22, 120 sec | Marksmanship | 158.46 | 187.47 | +18.31% |
| | Survival | 181.03 | 181.03 | 0 |
| | Beast Mastery | 156.62 | 156.62 | 0 |
| Nythraxis level 24, 120 sec | Marksmanship | 152.65 | 181.21 | +18.71% |
| | Survival | 177.08 | 177.08 | 0 |
| | Beast Mastery | 154.32 | 154.32 | 0 |
| Open field, 1 target, 60 sec | Marksmanship | 219.69 | 257.12 | +17.03% |
| | Survival | 240.05 | 240.05 | 0 |
| | Beast Mastery | 206.41 | 206.41 | 0 |
| Open field, 3 targets, 60 sec | Marksmanship | 224.57 | 273.94 | +21.98% |
| | Survival | 263.43 | 263.43 | 0 |
| | Beast Mastery | 243.17 | 243.17 | 0 |

After the change Marksmanship leads every hunter profile here. On the raid profile it
sits about 3.5% above Survival. On three targets it also passes Beast Mastery, the
spec meant to lead there (see Limits). For a rough class-wide reference,
`docs/design/class-balance-v042-results.md` puts Knifework, Thuggery, Necromancy and
Ruination near 190 to 220 DPS on the same boss, but at 180 seconds, 24 seeds and an
older base, so that comparison is indicative, not paired.

CI fixture (`averageHunterDps` from `scripts/hunter_dps_probe.ts`, 90 sec, level 20,
auto-equipped gear, no choice rows), the configuration `tests/hunter_dps_balance.test.ts`
runs:

| Seeds | Spec | Before | After |
| --- | --- | ---: | ---: |
| 29001 to 29005 | Marksmanship | 123.44 | 147.85 |
| | Survival | 116.76 | 116.76 |
| | Beast Mastery | 80.26 | 80.26 |
| 29001, 29002 | Marksmanship | 126.13 | 151.45 |
| | Survival | 115.96 | 115.96 |
| | Beast Mastery | 79.69 | 79.69 |

The three-target fixture values for Beast Mastery and Survival are unchanged too
(101.32/132.38 full, 101.40/132.85 diet); Marksmanship's fixture rotation is single
target, so its three-target value equals its single-target value.

## Test bands re-pinned

`tests/hunter_dps_balance.test.ts`, by the rule its own history uses: new actual
times the former ceiling (or floor) to actual margin. Ceilings round to the nearest
hundredth, floors round down. Both bounds are guards against MM outgrowing BM, so
moving them is the balance decision this PR asks the class owner to accept, not a
measurement refresh.

| Bound | Old | New actual | New |
| --- | ---: | ---: | ---: |
| MM/BM ceiling, full | 1.69 | 1.842050 | 1.91 |
| MM/BM ceiling, diet | 1.75 | 1.900516 | 1.97 |
| BM/next-best three-target floor, full | 0.80 | 0.685314 | 0.67 |
| BM/next-best three-target floor, diet | 0.72 | 0.669528 | 0.63 |

Pre-existing, not changed here: on the unmodified release the full-sweep (nightly)
configuration already reads SV/BM 1.4547 against its 1.43 ceiling and BM/next-best
0.7654 against its 0.80 floor. The second one is absorbed by the re-pin above; the
Survival ceiling is left for the class owner.

## Limits

These are fixed fixtures, not live-population parses. Talent rows, gear outside the
fixtures and movement-heavy fights are not certified.

PvP is not measured. The PvP damage multiplier has no per-spec damping, so Long
Draw burst rises 23%, and with a Coldsight Read stacked on it the multiplier on its
base goes from about 2.58 to 3.18. If that proves too much, the follow-up is a
PvP-scoped trim, not a smaller PvE number.

Beast Mastery's three-target lead, a design goal the balance test already flags as
unmet, is further from target after this change.
