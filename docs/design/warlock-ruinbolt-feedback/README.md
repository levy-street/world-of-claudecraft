# Ruinbolt feedback study

Historical measurement record for the approved September 8 tuning, based on
`release/v0.42.0` at `57a2ced3bded6d01e33cf6f53fe354d1ae7e4d22`.

## Implemented behavior

- Gloom Bolt ranks 2 to 4 cast in 2 seconds before the Destruction passive
  (1.94 seconds after it); the initial 1.7-second rank remains unchanged.
  The whole hit, base plus Spell Power, is reduced by 20%. Explicit coefficients
  retain the previous Destruction rank scaling before that reduction.
- Ruinbolt casts in 2.3 seconds (1.61 with Desolation), preserves its previous
  base damage and Spell Power coefficient, and always critically strikes on a
  successful hit. It still costs 3 Wrack and can be resisted.
- Ruinbolt's Brand echo is marked critical and copies exactly 25% of landed
  damage on the same target or 50% on another. Critical damage is not multiplied
  again, and the echo cannot trigger another spell-critical proc or Ignition.
  Exact echoes also bypass a second Veil Mark damage reduction.
- Gloom Bolt's echo retains its previous non-critical metadata even when the
  originating Gloom Bolt critically strikes.
- The meter retains a named Ruinous Brand contribution. Its existing Other row
  is a presentation grouping of small contributions, not missing echo damage.

## Methodology and limits

`npx tsx scripts/warlock_feedback_matrix.ts tmp/warlock-feedback.json` repeats
84 scenarios using seeds 42 and 1337. Destruction runs at 30, 180 and 300 seconds,
with one or two targets and with or without Pyre Colossus. Affliction and
Demonology provide 180-second, single-target references.

The target is an inert level-22 boss with the heroic Nythraxis armor profile.
Unrelated world actors are removed in the study's explicit isolated mode;
ordinary historical anchor tests keep their original full-world behavior.
Both targets stay on the training-room center line so a side wall cannot
silently prevent the cross-target Brand. A regression requires an actual Brand
hit in the two-target scenario.

The `normal` label means the non-heroic counterparts of the legacy reference
kit wherever those exist; it still includes powerful named items. `heroic`
is the existing frozen warlock anchor kit. `crucible` replaces four armor slots
with Ruincaller for Destruction, Hexthread for Affliction and Gravebrand for
Demonology. These are fixed comparison fixtures, not optimized current BiS.
Every row records the exact equipment ids.

The before run uses a detached worktree at the release commit. Only
measurement-harness changes (isolation, second-target line of sight and
reference-spec set selection) were applied symmetrically to the release worktree
and the current runner. The summary below records the paired results; the
checked-in matrix script reproduces the current side of the study.

This is stationary combat without external healing, consumables or movement.
The two seeds are a small paired sample, not a confidence interval or proof of
all-class balance. `castsByAbility` counts cast-time spell starts, excluding
instant actions; `starvedPct` counts ready ticks on which the rotation could not
act, regardless of the cause. Same-seed repeatability and equipment overrides
are checked by `tests/warlock_feedback_probe.test.ts`.

## Single-target results with Pyre available

| Kit | Seconds | Before DPS | After DPS | Change | After ending mana |
|---|---:|---:|---:|---:|---:|
| normal | 30 | 217.8 | 222.4 | +2.1% | 84.6% |
| normal | 180 | 184.9 | 199.2 | +7.7% | 30.2% |
| normal | 300 | 181.3 | 180.6 | -0.4% | 1.3% |
| heroic | 30 | 225.5 | 253.4 | +12.4% | 83.5% |
| heroic | 180 | 209.6 | 228.6 | +9.1% | 30.7% |
| heroic | 300 | 209.2 | 201.0 | -3.9% | 1.3% |
| crucible | 30 | 230.2 | 250.3 | +8.7% | 85.5% |
| crucible | 180 | 222.2 | 227.8 | +2.5% | 30.0% |
| crucible | 300 | 210.8 | 203.3 | -3.6% | 0.5% |

The heroic three-minute mean rises from 209.6 to 228.6 DPS, about 9.1%.
At that duration the after references are 189.5 Affliction and 212.7 Demonology:
Destruction is about 20.6% and 7.5% ahead respectively in these fixtures.
The five-minute result is not a sustained buff: the faster rotation drains
resources sooner, with low ending mana and additional no-action ticks. This
harness has no healer to support indefinite Life Tap. No mana-cost or damage
compensation was silently added to force a favorable outcome.

## Verification

See the paired mechanic and probe suites, plus the validation notes below.
The unspecialized level-8+ Gloom Bolt edge uses the Destruction coefficient in
shared data, so its Spell Power contribution is 77.6% of its old unspecialized
value. Affliction and Demonology cannot cast Gloom Bolt; their kits are unchanged.

Validation commands and outcomes:

- The focused mechanic, probe, balance, tooltip, architecture, localization and
  meter run passed 311 tests and skipped 3.
- `node node_modules/vitest/vitest.mjs run tests/warlock_anchor_destruction.test.ts --maxWorkers=1`
  passed both 120-second anchor cases.
- `npx tsc --noEmit`: passed.
- `npm run ci:changed`: passed with non-blocking style warnings in the measurement harness.
- `node scripts/gate_select.mjs`: generation and changed-file checks passed; its
  first always-run floor stopped on two Windows baseline issues (`grep` is unavailable,
  and one path assertion expects POSIX separators).
- `npm run gate`: generation, i18n and manifest freshness, SFX validation, and
  malware scanning passed (`0 high`). The full repository suite was stopped after
  unrelated Windows/release-baseline failures appeared in battleground, SFX,
  symlink, asset and gate-infrastructure suites. This is not a green full-gate claim.

The release's full-world 120-second anchor measured 236.21875 heroic DPS and
252.82708333333335 dummy DPS after the change. Both exceeded their pre-change
release ceilings. The updated roughly five-percent corridors are 224 to 249 and 240 to 266,
with higher floors and the same seeds and economy checks. The existing five-minute
sanity corridor remains unchanged. A separate review accepted this re-anchor as
specific to the approved behavior change.

Final anchor rerun: `node node_modules/vitest/vitest.mjs run tests/warlock_anchor_destruction.test.ts --maxWorkers=1` passed both cases. Scoped Biome including the new files passed, and `git diff --check` was clean.
