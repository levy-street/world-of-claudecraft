# Marksmanship damage budget

## Scope and tuning

Base: `release/v0.45.0`, `55de7ffe926d781df7b2caee4314318c7ff730ac`.
Requested: raise Marksmanship total DPS by 25 to 35 percent while preserving Beast
Mastery and Survival. Most of the increase belongs to sustained ability damage;
the existing Fevered Draw follow-up gets a smaller execution reward.

- `OFFENSIVE_SPEC_TUNING.hunter.marksmanship.physical`: 0.10 to 0.63.
- Marksmanship baseline Long Draw damage bonus: 0.50 to 0.65.
- Marksmanship baseline Measured Shot damage bonus: add 0.05.
- Coldsight Read Long Draw multiplier: 1.50 to 1.60.
- Coldsight Read Fell Shot multiplier: 1.75 to 1.85.

The first three bonuses are additive components of the existing whole-hit
multiplier, not percentages of total DPS. They scale both authored damage and
Ranged Attack Power riders. Stats, costs, Focus gains, casts, cooldowns, talent
choices, auto-attacks and pet coefficients are unchanged. Only MM's entries
change; shared ability base damage and the legacy mastery buff bucket stay intact.
Read remains MM-only and retains its existing completion, reservation, interruption,
and respec rules. Changing gear or choosing a different talent row does not remove
the spec's baseline increase, but the exact total-DPS gain depends on damage mix.

## Paired measurements

`runMarksmanBalanceProbe` reuses `runOwnedClassDpsProbe` with the real Sim,
finite Focus, seeded hit/crit rolls, and owned pet damage included. Each run is
120 seconds against level-22 Nythraxis armor. Camps and unrelated NPCs are omitted
from both sides, while real terrain, collision, movement, casting and damage remain.
The three-target rotation actually casts Volley; each secondary target must take damage.

Five identical paired seeds: 29901 through 29905. There are 90 MM comparisons and
20 unchanged sibling controls. Every individual MM result is inside +25 to +35
percent (observed range +25.80 to +33.59 percent), not just each average.
All 20 BM/Survival result objects match exactly, including per-source damage,
casts, outcomes, resources, equipment and stats. MM's auto and pet damage,
cast counts, resource endpoints, combat outcomes and movement distances match too.

PBE uses the existing level-20 Nighttalon fixture. Coldsight 4pc uses a level-25
owner with the actual helmet, shoulder, chest and gloves equipped; other slots
retain the fixture equipment. The wolf is the harness's level-20 pet in both
profiles. These are controlled comparisons within each profile, not a direct
comparison of gear sets at the same level. Naked runs remain level 20.
Talent rows are empty, so these measurements are not an all-build or live-player
DPS guarantee. PvP burst, every gear configuration and live encounter mechanics
are not certified by a target-dummy fixture.

- `stationary`: normal Long Draw rotation.
- `moving`: two seconds of actual alternating strafing every twelve seconds,
  keeping the original cast priority and allowing real cast interruption.
- `mobile-read`: the same movement, spending each available Read on Fell Shot.
- `without-cold-focus`: Cold Focus is held unavailable; Fevered Draw and Read
  remain part of the rotation. This measures sustained power outside that cooldown.

Values below are five-seed means. Gain is the ratio of mean damage.

| Targets | Equipment | Rotation | Before DPS | After DPS | Gain |
| --- | --- | --- | ---: | ---: | ---: |
| 1 | pbe | stationary | 163.76 | 212.84 | 29.97% |
| 1 | pbe | moving | 148.43 | 191.01 | 28.68% |
| 1 | pbe | without-cold-focus | 155.50 | 201.22 | 29.40% |
| 1 | coldsight-4pc | stationary | 173.62 | 224.96 | 29.57% |
| 1 | coldsight-4pc | moving | 154.77 | 197.55 | 27.64% |
| 1 | coldsight-4pc | without-cold-focus | 166.80 | 215.92 | 29.45% |
| 1 | naked | stationary | 91.79 | 121.98 | 32.89% |
| 3 | pbe | stationary | 156.00 | 202.68 | 29.92% |
| 3 | pbe | moving | 149.98 | 191.39 | 27.61% |
| 3 | pbe | without-cold-focus | 157.53 | 203.63 | 29.26% |
| 3 | coldsight-4pc | stationary | 172.49 | 222.85 | 29.20% |
| 3 | coldsight-4pc | moving | 157.38 | 202.22 | 28.50% |
| 3 | coldsight-4pc | without-cold-focus | 172.44 | 222.87 | 29.25% |
| 3 | naked | stationary | 94.13 | 124.99 | 32.79% |
| 1 | pbe | mobile-read | 145.73 | 186.12 | 27.71% |
| 1 | coldsight-4pc | mobile-read | 151.38 | 191.87 | 26.75% |
| 3 | pbe | mobile-read | 148.39 | 188.88 | 27.28% |
| 3 | coldsight-4pc | mobile-read | 152.82 | 194.11 | 27.02% |

## Evidence and regression contract

`tests/fixtures/marksmanship_balance_baseline.json` contains the complete 110-row
pre-change receipts. They were captured with the same probe on the release source
before production edits; the mobile extension used an esbuild source overlay from
`git show HEAD:<path>` for the four changed sim files. The baseline source ref is
pinned by the test. Never regenerate this fixture from the candidate to make it pass.
The test independently pins all matrix keys, uniqueness and positive baseline damage.

Run the candidate receipts with:

```sh
MM_PROBE_SEEDS=29901,29902,29903,29904,29905 pnpm exec tsx scripts/marksmanship_balance_probe.ts
WOC_FULL_BALANCE_SWEEP=1 pnpm exec vitest run tests/marksmanship_damage_budget.test.ts --maxWorkers=1
```

The default test mode keeps the first two seeds (44 combat cases); the full mode
runs all five (110 cases). Both also check matrix completeness. BM/SV compare whole
objects. MM checks literal 1.25 to 1.35 total-damage bounds, retained non-damage
state, and actual movement/AoE/Fell Shot use, rather than trusting the coefficient.

Before production edits, the new Read expectations failed in five tests while
42 existing cases passed. The first 0.60 offensive-floor candidate failed the
new budget test for the moving four-piece case at +24.82 percent. Raising the
floor to 0.63 brought it into the target band. The complete-hit integration test
also checks both Read choices at zero and 300 Ranged Attack Power; aura and English
ability-description checks compare the displayed bonuses to the live mechanic.

## Additional controls

The legacy full-world hunter fixture was measured before and after with five
seeds (29001-29005), both target counts and all three specs: MM gained
32.66-33.78 percent; all 20 sibling receipts were identical. Full/diet single-target
MM:BM ratios changed from 1.598718/1.617748 to 2.130362/2.151268. Three-target
BM:MM changed from 0.826900/0.822686 to 0.620542/0.618658. The existing regression
bounds retain their former relative margins, rounded outward: MM:BM ceilings
2.26/2.33 and BM:next-best floors 0.60/0.58. Survival bounds are unchanged. All full/diet inequalities pass when evaluated
against these measured candidate receipts.

A further paired talent experiment used two seeds, both target counts and all
three specs with Predator's Pace, Beastguard, Double Hush, Efficient Rhythm and
Apex Instinct, plus either Overdraw or Fang Chorus. The eight MM comparisons
were +28.21-32.93 percent; the 16 sibling result objects matched exactly. This
adds build coverage without claiming every talent combination was measured.

## Visual evidence

Before/after captures use the repository's `ability-tooltip` target with a
level-20 Marksmanship hunter, empty talent rows, the lowest graphics preset and
a 30 FPS cap. The before client is a scratch checkout of the exact release base;
the after client is this working tree. Both use the real offline spellbook hover
and held-touch tooltip, on desktop and mobile landscape. Local Chrome uses Metal
rather than software rasterization to avoid contention during verification.

The screenshots show Fevered Draw, which describes both Read spenders in one view.
Background world-model preload warnings and absent local API presence endpoints
are unrelated to the tooltip change; the captures do not certify world rendering.

## Localization handoff

English descriptions and generated English variants are updated. The live Read
aura derives its numbers from combat constants in every locale. Per the existing-key
reword policy in `docs/i18n-scaling/translation-workflow.md`, the maintainer locale
pass must refresh these three existing keys before a localized release:

- `entities.abilities.aimed_shot.description`
- `entities.abilities.rapid_fire.description`
- `entities.abilities.arcane_shot.specNote_marksmanship`

Generation does not mark existing translated strings stale. For example, the
French Fell Shot note still describes the previous 75 percent. This contributor
change does not edit locale overlays or claim they have been refreshed.

## Verification status

- Final affected tests: 217 cases passed across six files, including all 110
  paired combat receipts plus matrix completeness. Five files passed together;
  the 15-case integration suite passed on rerun after correcting its new RAP
  fixture to assign power after aura application recalculates derived stats.
- Earlier core hunter, set-bonus and architecture checks also passed.
- TypeScript, admin Svelte checks, headless/environment, server, bot and client
  builds passed. Committed-diff Biome and whitespace checks passed.
- Final browser verification passed: all 521 tests across 64 files, using the
  standard Chromium configuration. Unrelated screenshots regenerated by those
  tests were preserved outside the checkout and restored to their prior content.
- The canonical gate's generation/freshness, manifests and malware checks passed.
  The completed two-worker full-suite run covered 4,938 files: 4,894 passed,
  five failed and 39 skipped. It reported 70,612 passing tests, 13 timeout
  failures, two expected failures and 576 skipped tests. The only failures were
  in unchanged Ignivar, fishing, Varkhul, gathering-placement and necromancy
  suites. All 13 passed a single-worker rerun with the normal configured
  timeouts (five files, 123.51 seconds). No repository timeout was changed.
  The original gate exited 1 at Vitest and is not claimed green; its subsequent
  browser, typecheck and build steps were verified separately as recorded above.
- CI lane registration tests passed in the completed full run, including the
  selective-lane case that timed out in an earlier loaded-machine attempt.
- An earlier full-gate attempt was stopped under heavy machine load; its harvest
  timeout also reproduced with the unchanged release simulation overlaid.
- Simulation, test coverage and frontend reviewers found no remaining scoped
  blockers after their findings were addressed.

Local review verdict: **READY WITH NOTES**. All scoped checks passed and every
full-suite failure passed its normal-timeout rerun. The initial full-gate timeout
exit remains recorded rather than relabeled as a green gate.

[PR #4266](https://github.com/levy-street/world-of-claudecraft/pull/4266) targets the
current release branch. Merge remains blocked until a maintainer approves the
fork workflow, CI passes and maintainer review is complete. The three existing-key
locale updates above remain a maintainer handoff before localized release, as
permitted by the translation workflow.
