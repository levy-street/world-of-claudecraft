# Tank threat parity, v0.44: Oathward 40% to 100%, Recompense 80% to 110%

Owner request (Jamie, 2026-09-21): tanks were losing the boss to the top DPS in the
Crucible (Ignivar and Varkhul) and Nythraxis raids since the v0.42 DPS packages. This note records what the
live parses showed, what the harness said about the fix, and the two constants that moved.

## What was measured

The Parses service samples every boss's hate table once a second
(`server/parse/threat_sampler.ts`, since v0.37). All 789 raid boss fights on Ignivar, Varkhul and
Nythraxis for builds 0.42.x and 0.43.x were pulled with their per-fight event streams,
and for the 458 fights with a tank-spec main tank the tank's GENERATED threat was rebuilt
from its own events with the game formula (`src/sim/threat.ts` plus the ability tables).
The reconstruction matched the sampled table within 1 to 2%, which also showed taunts are
rare in these fights. A "genuine rip" below is a switch to a DPS whose table threat is at
least the tank's while the tank is still alive; Varkhul phase swaps, Bone Storm charges
and living-target fallbacks after a tank death are excluded.

Generated threat per second on kills, builds 0.42 to 0.43.2:

| | Ironguard warrior | Faithwarden paladin | top DPS in the same fights |
|---|---:|---:|---:|
| median | 330 | 234 | 190 |
| p95 / max | 466 / 518 | 318 / 373 | 290 / 365 |

- The v0.38 parity pass put the two within 7% of each other (harness 296 vs 276 on
  heroic). Live, the Faithwarden generates 234 against the warrior's 330, and its threat
  per point of damage is 2.5 against the warrior's 5.4.
- After the opener, the best DPS's threat crosses the melee switch line against a
  warrior's generated threat in 2% of kills; against a paladin in 16% (28% on 0.42, 9% on
  0.43), held only by Sacred Goad.
- Most genuine rips are openers: 145 on 0.42+, median at 25 s, half inside 30 s, by Fury
  warriors (65), Enhancement shamans (38) and Fire mages (29). Fire openers reach 500 to
  800 threat/s for the first 10 to 15 s; no flat multiplier covers that, and it is out of
  scope here.

Multiplier on tank threat that would have kept every DPS under the switch line (edge) or
under 90% of the tank (comfort) from 30 s onward, in 90% and 95% of kills:

| | edge p90 | edge p95 | comfort p90 | comfort p95 |
|---|---:|---:|---:|---:|
| warrior | 0.89 | 0.97 | 1.15 | 1.31 |
| paladin | 1.13 | 1.22 | 1.48 | 1.56 |

## The change

- `talents_classic.ts` Oathward `threatPct` 0.4 to 1.0 (holy threat mod 1.4 x 1.3 = 1.82
  becomes 2.0 x 1.3 = 2.6, physical 1.4 becomes 2.0; a 1.43x change). This puts the live
  median Faithwarden near 335 threat/s: level with today's warrior, and 87% of the warrior
  once Recompense moves too (about 385), up from 71%. It sits a little under the paladin's
  p90 comfort figure (1.48x) on purpose: the harness paladin already matched the warrior
  at baseline (see below), so 100% is the round value that closes the live gap without
  betting the whole band on one frame.
- `talents_warrior.ts` Recompense `threatPct` 0.8 to 1.1 (Guarded Stance 1.3 x 1.8 = 2.34
  becomes 1.3 x 2.1 = 2.73; a 1.17x change), the comfort margin at p90 against current
  max-tilt DPS.
- Ability multipliers, stance and Burning Oath constants, the bear and Stonebound are
  untouched.

## Harness check

`MATRIX_TANK_MC_RUNS=8 scripts/nythraxis_matrix.ts` on v0.43.2, both difficulties, 8 seeds
per tank, identical roster, baseline versus this change:

| tank | heroic threat/s | normal threat/s |
|---|---:|---:|
| Ironguard warrior | 344 to 406 (1.18x) | 397 to 460 (1.16x) |
| Faithwarden paladin | 370 to 516 (1.40x) | 400 to 584 (1.46x) |
| Wildfang bear (control) | 265 to 265 | 383 to 383 |
| Stonebound shaman (control) | 411 to 411 | 456 to 456 |

Tank death rates, pools and armor were unchanged within seed noise. Two caveats: the
harness raid never steps out of Grave Flame (added after the harness was last tuned), so
every run ends at 23 to 45 s and these are opener-window rates; and the harness paladin
already matched the warrior at baseline, unlike live, so on the harness frame Oathward 70
to 80% would be the parity point. Live is the anchor here because the harness's 25 s
window is exactly where Hallowed Wall and Holy Ground front-load paladin threat.

## Follow-ups (not in this change)

- Opener rips need an opener lead (Goad or Sacred Goad granting a lead above the top of
  the table for a few seconds, or a threat bonus in the first seconds of engagement), or
  DPS discipline.
- Bear parity: Primal Heart threat 45% to 75% lands within 5 to 7% of the buffed warrior
  on normal; the bear's heroic gap is survival (no damage-reduction layer), not threat.
- Teach the matrix harness to step out of Grave Flame so it produces sustained numbers.
