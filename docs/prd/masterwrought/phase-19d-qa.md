# Phase 19D QA (tooling and guards: the fourth execution wave of the rulings gate)

VERDICT: **PASS-WITH-FINDINGS.** Twelve units, one commit each, zero
escalations, the pg-armed gate green at `6afc7054b7` (all 12 steps, full-suite
fallback). The qualifier is the wave's own content: the load-bearing rule here
was that every change must fail TOWARD MORE tests, and THREE of the wave's own
changes failed it on first draft. The census Path column granted the exemption
to almost any malformed string, and still granted it to a traversal path after
the first fix; the compass extraction landed bare-named, outside every painter
gate and with no test, so an empty relabel body passed green; and D155's escape
walk gated with the reverse-walk convention while walking forward, waving a
7 yd wall through. None changed a shipped verdict, all three are fixed and
mutation-proved, and each was found by a different reader than the one who
wrote it. Seventy-one instruction defects, five of them falsified premises that
changed the work. Four arms went to the maintainer in session; D175's overrules
its source row's recommendation and says so. LOCAL ONLY: no push, no PR, no
teardown.

Scope: the twelve units of `phase-19d-tooling-and-guards.md` (D027 D029 D129
D130 D131 D132 D141 D152 D155 D164 D172 D175), their fresh domain reviews, the
reviewer fix round, and the fresh read of that round. Commit span
`d856b4af57..HEAD`.

## STEP 0, the sync check, and a thing that happened mid-wave

`origin/release/v0.42.0` (22e909839f) was ALREADY an ancestor of HEAD at phase
start, so no eleventh sync was owed and none was taken. It ADVANCED DURING the
wave: six commits (Crucible loot pacing, a crab-summon message scope fix), 16
files, none of which this wave touched, and no item id minted by any of them, so
the D175 golden is not stale against them. The eleventh sync belongs to 19E's
STEP 0, per the standing phase-start cadence. Recorded rather than absorbed,
because a reader comparing this wave's gate to the release tip should know the
gate ran against the pre-advance base.

## The wave's own rule, and how it went

A selection-semantics mistake in a gate silently skips tests repo-wide, so every
change had to fail TOWARD MORE tests. Two of the wave's own changes failed that
test on first draft, and they are the honest content of this QA:

1. **The census Path column granted exemptions it should refuse.** The check was
   "isCensusPath is FALSE", and that predicate is false for almost any string
   that is not a bare source path. A `file:line` anchor (this repo's own idiom,
   used in the very rows the wave added), `**bolded**`, `n/a`, `-` and any prose
   cell all bought the INFORMATIONAL verdict for a name that is genuinely GONE
   from merged, which is the exact failure the column was added to prevent. The
   gate-integrity reviewer reproduced it against the real module rather than by
   reading. The fix is a POSITIVE predicate (`isExcludedExtraPath`): a source
   extension under an actually-excluded prefix, checked at the parser AND again
   at the comparison.
2. **The compass extraction landed BARE-NAMED.** `compass_strip.ts` did raw
   per-frame style writes from the fast band while matching no painter-file
   pattern, no pure-core sweep and no module classification, so three gates
   missed it at once. It also had no test, which meant an empty
   `relabelCompassMarks` body passed every check in the repo, including the
   source-text pin that was supposed to hold the fix. Renamed
   `compass_strip_painter.ts`, registered in HOT_PAINTERS, routed through the
   elided writer facet, and given a suite that reds on that exact mutation.

And the heaviest should-fix was also the wave's own:

3. **D155's escape walk gated with the reverse-walk convention while walking
   forward.** It was copied from `reachesRoad`, which searches pad-to-road in
   REVERSE; `escapesPad` walks centre-outward, so the climb term and the drop
   term are swapped. Measured on synthetic ground: a 7 yd wall (slope 3.5,
   double the gate) ESCAPED, and a legal 4 yd hop down was REFUSED. Both
   orientations give zero failures over the live roster, so no verdict moved and
   nothing needed re-minting, but the arm had lost its discriminating power, and
   its own positive control (a +100 wall, a -100 pit) was too extreme to notice,
   which is how a swapped gate got certified. The control now drives the
   thresholds, and swapping the terms back reds it.

## STEP 1: seventy-one instruction defects

Every row was verified against the tree before a byte moved; every correction is
amended IN PLACE and dated in the phase document. **71** (19A 16, 19B 51, 19C
11). Six pipe-flattened anchors, nine stale addresses and two line-wrapped
quotes are the recurring families. The five that changed the WORK are the ones
worth carrying:

- **D131's "four genuinely exposed" rigs.** The tree has 31 markerless seeders,
  and the `?gfx=` immunity the ruled carve-out rests on is false for the rigs
  that most need the seed: `forcedTierFromSearch` forces the RENDERER tier only,
  and `perf_baseline.mjs` and `load_probe.mjs` say so in their own comments.
- **D172's "LEAVE IT, generated" shard-weight row** reds a committed pin.
- **D152's prescribed status cell** credited the Phase 5 QA; the re-judgement is
  the Phase 4 QA's, and that sentence was headed verbatim into a permanent
  record.
- **D141's `crucible_professions.ts`** is 32 lines with a second export, not 27.
- **D029's "record only, no code"** missed the guard comment still calling the
  split an open call.

D129 additionally UNDER-PRICED its own row twice over: 46 compared repaint memos
rather than "about two dozen", and the registry's row types could not express a
per-signature list at all, so the gate's schema moved with the ruling.

## The seven i18n defects, and what they say about the exemption

Classifying all 46 hud.ts memos found seven live defects, each confirmed against
source: the rest badge tooltip, the target live region, the compass heading AND
its rose labels, the Loot Settings window, the pet action bar, and the mail
indicator's aria-label and title. The rest badge is the one worth reading twice:
`#pf-rest` carries a static `data-i18n-title`, so the shell pass did not merely
leave a stale string, it actively re-stamped "Resting" over a live "Eating" on
every switch. The review round then found the same element's `aria-label` was
never written at all, so a screen reader was told the wrong state for the whole
meal; that is fixed with the title, from one resolved string, in one function.

## Four arms went to the maintainer, none guessed

D175's arm (the ONE row in the wave whose executed arm is not its source row's
recommendation, ruled in session and recorded as an overrule rather than a
restatement), D131's scope, D130's doc half, D141's two maintainer-named pin
shapes, and the golden equality arm added at the review round.

## Reviews

Seven fresh typed reviewers, none of them the implementer:
gate-integrity-reviewer, test-coverage-auditor, frontend-seam-reviewer,
cross-platform-sync, architecture-reviewer, content-obligations-reviewer,
privacy-security-review. Two blocking, both above. Every finding applied,
blocking, should-fix and nit alike, in one fix round (`ff7f2f24e1`), then a
fresh read of that round.

Findings worth carrying past the packet, beyond the three above:
- The `--prune-missing` entry arm earned its keep the moment it existed: it
  caught that a SMALL table can be emptied without ever reaching the drop bound,
  and that `carriedDefects` is blind to it by construction (an emptied table is
  self-consistent). An absolute empty-table refusal was the fix.
- `DEPLOY.md`'s "exactly ONE reachable throw" was a hud.ts-scoped measurement
  generalized to the whole bundle. Three more of the same shape live in the loot
  window and the disenchant view, and one of them is the very "sibling
  loot-window throw" the old caveat named. The retirement still stands (all are
  WS-fed, behind the handshake); the runbook was stating a false fact as its
  evidence.
- The runbook's two rolling-deploy bullets had been corrected ASYMMETRICALLY, so
  an operator read a list of live symptoms next to a sentence saying those
  symptoms cannot happen. Both are now scoped to epoch-CHANGING deploys, where
  the real event is every stale tab hard-disconnected and needing a reload.

## Validation

At the wave tip `6afc7054b7`, porcelain clean before and after.

- **`node scripts/gate_select.mjs`, pg-armed: PASS, all 12 steps, `GATE_EXIT=0`.**
  Judged by the real `GATE_EXIT=` line, never the task's own exit code (the
  runner's trailing echo makes that meaningless). Full-suite fallback:
  **3669 test files passed / 1 skipped (3670)** and **54,515 passed / 9 expected
  fail / 28 skipped (54,552)**.
- **THE FIRST GATE RUN WAS RED**, and the failure is the wave's real lesson about
  scope. `tests/hud_update_drive.test.ts` pins `Hud.update()`'s drive list BY
  CALL NAME, and the review round's rest-badge extraction changed what that
  method calls. Every per-unit suite was green through it, because none of them
  reads that registry. Fixed by moving the row (same band, same edge-latch gate),
  then a sweep of every suite referencing any symbol or file the round touched,
  rather than trusting the scoped runs a second time.
- **`npx tsc --noEmit`: EXIT 0**, no diagnostics.
- **Symbol census: `RESULT: PASS`, exit 0, captured WITHOUT a pipe.** The five
  golden_composition names now print as INFO rather than as "GONE from merged",
  which is the defect D130 exists to fix, exercised end to end on every run.
- **`npm run ci:changed`: EXIT 0**, after the LAST commit. It was RED once
  mid-wave, on format diffs in the fifteen capture-rig seeds the marker edit
  pushed past the line bound; reflowed by the formatter over the wave's touched
  files only.
- **THE PG ARM IS PROVEN, not assumed.** `tests/account_wealth_db.pg.test.ts`
  reads 3 SKIPPED with `TEST_DATABASE_URL` unset and 3 PASSED with it set, run
  both ways against the same runner. `DATABASE_URL` is deliberately NOT exported:
  a populated one defeats `characterization.test.ts`'s cold-cache degrade, which
  cost 19C a false red.
- **Guard suites green**: architecture, monolith budget (hud.ts 18716 against a
  ceiling LOWERED 18728 to 18716), IWorld parity, the S3 i18n guard, painter
  host, hud perf budget, and the language fan-out registry and its behavioral
  twin.
- **Every new pin mutated and watched fail ALONE**, reverted from a disk copy,
  never `git checkout`: D155's control and roster arm, D131's marker strip and
  its reader and predicate, D130's filter, its defect arm, its parser and the
  traversal normalization, D141's carve-out entry, D172's two prune arithmetic
  halves, D129's memo clear, its sentinel, its compass relabel and its
  double-classification, and D175's golden equality arm.

### Drift: PREDICTED, then MEASURED, then attributed to the line

Predicted before the run: test files net 0, cases +10, expected-fail -2.
Measured against the 19C close (3669 files, 54,519 cases, 11 expected fail):
**files +1, cases +33, expected-fail -2.**

The case prediction was LOW by 23, and the reason is worth recording: it counted
`it()` DECLARATIONS (+27 net), and declarations are not cases where a suite
expands them. Attributed exactly, by running the wave's own changed files at
both revisions:

| Source | Cases |
|---|---|
| `capture_graphics_seed.test.ts` (new) | +5 |
| `compass_strip_painter.test.ts` (new) | +4 |
| `ci_shard_weight_carry.test.ts` | +11 |
| `merge_audit_symbol_census.test.ts` | +6 |
| `hud_perf_budget.test.ts` (two painters registered, per-painter arms) | +6 |
| `masterwrought_budget.test.ts` | +2 |
| `placement_integrity.test.ts` | +2 |
| `language_fanout_registry.test.ts` | +1 |
| `stale_client_rollout.test.ts` (deleted) | -4 |
| **Total** | **+33** |

Which is the measured figure exactly, with nothing left over. Expected-fail -2 is
D141's two dev-bis flips. Files +1 is two new suites less one deleted.

## CARRIED for the maintainer, not taken unilaterally

- **The golden equality arm couples this branch to upstream content.** The single
  id the D175 re-mint added, `reins_rickshaw_mount`, is RELEASE-owned: its def
  lives on main and on release/v0.42.0 and is absent from the golden on both. So
  the re-mint closed an UPSTREAM gap from a feature branch, and the equality arm
  now means a release sync that brings a new id owes the re-mint in that merge.
  Ruled in session with that cost stated; one line to relax.
- **D141 leaves seven expected-fail pins standing, under TWO owners.** Five
  belong to the masterwrought R5 re-measure row; the two apex twin rows
  (forgefold_legguards, spiritweld_girdle) belong to the twin-complement row and
  have an arm independent of any re-measure. Neither is this wave's.
- **The heroic-boss-loot id set now has no change-detector.** D172's frozen
  snapshot was also the only pin on that set. Nothing gated on it, so no security
  or economy work is lost, but a reviewer who relied on that tripwire should know
  it is gone.
- **The pad-DELTA gate stays unarmed.** The packet holds two measurements and no
  sanctioned ceiling, so its bound is still the maintainer's; D155 armed the
  number-free half instead.

## JUDGED, and not re-raised

- The twelve units, their rulings, and every reviewer and fresh-read finding are
  SETTLED. This document records them; it does not reopen them.
- The three items 19C carried and the four 19B carried remain the maintainer's
  and are out of this wave's scope.
