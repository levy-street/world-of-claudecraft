# Phase 19E QA (measurement: the fifth execution wave of the rulings gate)

VERDICT: **PASS-WITH-FINDINGS.** Four units, one commit each, zero
escalations, the pg-armed gate green at `31538b1bc0` (all 12 steps, full-suite
fallback). The qualifier is what a measurement wave's QA has to be: the numbers
moved the records, and the reviews then moved the numbers. Two of the four rows
returned a figure that contradicted their own text (D128's payoff does not
exist to measure; D062's supply side had sundering on the wrong side of the
ledger and a sink the census could not see), and the review round found that
BOTH D139 records had the celebration cadence premise wrong, that D062's tool
count was the wrong population, and that one of the wave's own thirty-five
Step 1 corrections had moved a correct address. Every ruling survives every
correction, because every ruled arm was the no-op or the route-out and the
corrections all made the case for it stronger. Thirty-five instruction defects,
four of them falsified premises that changed the work. Four arms went to the
maintainer in session, none guessed. LOCAL ONLY: no push, no PR, no teardown.

Scope: the four units of `phase-19e-measurement.md` (D062 D128 D138 D139), the
eleventh sync and its audit, the fresh domain reviews per unit, the reviewer
fix round, and the two fresh reads that followed it. Commit span
`62fdcec594..HEAD`. The measurements' harnesses and outputs are committed under
`docs/screenshots/masterwrought-phase-19e/` and re-run from the repo root.

## What makes this wave different, and how it went

The phase header says it: rows whose shape must be chosen on a number rather
than an argument, the bench first, the shape ruled on the figure it returns.
That ordering held in every unit, and in two of the four the figure did NOT
agree with the row that commissioned it:

- **D128's payoff does not exist to measure.** The row's own hypothesis was
  "real writes removed against per-element memory". A prototype of Option A
  was driven through the whole painter battery and two headless perf tours
  each way: exactly the three predicted pins go red and nothing else, the
  real painters' steady-state write set is byte-identical under both shapes,
  and the tour reads 1052/1072 desktop and 575/575 mobile before against
  1062/1079 and 585/589 after. Zero live writes removed today, because every
  one of the seven shipped collision sites was already fixed in Phase 18 and
  the AST guard holds the line; the price is +16 bytes per routed element.
  On that number the maintainer routed Option A out as the row's own reading
  says, and the record says why.
- **D139's "leading per-celebration cost" is real and small.** The scan the
  refusal never touched costs about 100 ns per non-home player, 471 us per
  celebration at the 5,000-player realm cap with 200 in-zone: about 20 times
  the stringify term the splice was weighed against, and 1 percent of ONE
  tick as a per-celebration spike, 8 us per second at the record's cadence.
  A rect test would cut it 12x at the price of membership semantics at the
  rect edges; a cached zoneId does no better on the walk. Ruled Option 1 on
  those figures, with a premise arm so the shape cannot silently change.
- **D062's measurement contradicted its own text in two places.** Sundering
  is not a shard supply (it mints sundered_essence and competes for the same
  raid epics), and the reagent-row census that the row calls "the demand
  side" cannot see the third shard sink, the tool-effect recharge. The read
  was re-derived with both corrected, and the number still says supply-limited
  rather than starved, so the outlier stands and D047 and D034 are answered by
  the same figure.
- **D138 stayed docs only**, as ruled, with the two eights kept apart in every
  one of its four homes; rider F was offered and not taken.

No escalation was needed: no measurement moved a balance number, and no
ruling rested on a false premise once the premises were corrected.

## STEP 0, the eleventh sync

`origin/release/v0.42.0` advanced six commits during 19D (the Crucible loot
re-cut to one gear item per five raiders per kill with `LootEntry.normalOnly`
and `src/sim/loot/loot_difficulty_gate.ts` as its one predicate, plus the
crab-summon message scope fix): 16 files, two new, ZERO conflicts, no
`patches/` or lockfile move (so no reinstall was owed), no content id minted
or renamed (the D175 golden equality arm stays fresh). Landed as merge
`2ebe95e731`, which carries the body the first stamp lacked: the audit's
critic caught a bare-title merge commit and it was amended before anything
was built on it.

The release-merge audit ran as a nine-lane workflow: all six branch-owned
overlaps (`src/sim/CLAUDE.md`, `content/dungeons.ts`, `content/heroic_loot.ts`,
`types.ts`, `tests/dungeon_finder_view`, `tests/loot_roll`) read against both
parents, every hunk of both sides surviving; no legacy arm, endpoint, injected
helper re-bind or db-mock export list owed; i18n untouched. Two things it
found: (1) the re-cut moves a premise UNDER this wave, the Crucible gear-epic
inflow that feeds the shard supply and the sundering sink (per kill, the
disenchantable gear epics go from 2 to 1 on Normal and from about 4 / 3 to
0.65 / 0.50 on Heroic), so the D062 read is derived from the merged tables
and says so; (2) one branch-owned comment the release's mechanism made
conditionally false (the Nythraxis draw-order contract said "one draw per
rollGroup" unconditionally), amended as the sync rider `61fef0d42f`. Two
pre-existing release-side staleness nits (the finder's "final boss only"
comment, heroic_loot.ts's "TWO rollGroups each" header) belong upstream and
were not taken.

Validation at the merge: tsc clean, the symbol census RESULT PASS, the 21
release-touched and guard suites green (1170 passed, 3 expected fail).

## STEP 1: thirty-five instruction defects

Every row was verified against the merged tree before a byte moved, by a
four-lane verifier workflow with a 34-lane adversarial refutation pass and a
completeness critic; every correction is amended IN PLACE and dated in the
phase document, and the four source rows in `phase-19-rulings-gate.md` carry a
dated clause each. **35** (19A 16, 19B 51, 19C 11, 19D 71): 34 candidates, two
refuted (a blanket-reopen wording that was correct; a `git grep` count that
was right at its pinned commit), three added by the critic, one added by the
executor's own reads. The families are the same as every wave: stale
addresses (the D138 sources had drifted +66, +17 and a NON-UNIFORM +1287 to
+1324 because two Phase 19 blocks were inserted into the same record), five
line-wrapped quotes that grep 0 whole, wrong counts. The four that changed
the WORK:

- **D062: sundering is not a shard source.** `sundering.ts` grants
  `sundered_essence` only and admits raid gear epics, so it is a competing
  spend of the shard's input. The supply route is `resolveDisenchant` through
  `DISENCHANT_MATERIAL_BY_QUALITY`, which lives in `disenchant_reagents.ts`,
  a file the row's list omitted.
- **D062: a third shard sink the reagent-row census cannot see.** The
  tool-effect recharge prices `arcane_shard` at the epic and legendary rungs,
  35 epic tool defs exist, and `enchants.ts`'s own header already counts it.
- **D128: hud.ts sits AT its ceiling** (18716 / 18716), not "18728 with the
  file at 18708", so the implementation half owes extraction; and the ARM 2
  rationale rider had already landed on 2026-08-31.
- **D139: the suite record ALREADY carries the fourth tenant** and derives
  its realm rate from it; only the two state.md records lacked it, and what
  no record carried was the other tenants' cadence summed on top.

One premise defect is worth carrying past the wave: the D128 row prescribed a
headless swiftshader capture for a golden that was minted HEADED. The
headless mode agreed with the headed anchor to within two writes on its
first run but showed a 20-write run-to-run band; it can decide whether a
reduction exists and cannot re-mint the golden.

## The four rulings, and what the numbers did to them

- **D062** (`qr-19-disenchant-ratio-outlier`, the read in THE SINKS section of the
  Phase 11m ledger): the outlier is KEPT, on a number. Demand re-derived live
  (shard 12 consumers / 21 units, essence 41 / 86, dust 42 / 155, plus the
  tool-effect recharge as a repeating sink at two to five shards per epic-rung
  recharge that no reagent-row census can carry), supply traced to its one route
  (one shard per epic or legendary disenchant, one essence per rare, flat), the
  raid inflow after the eleventh sync stated as a lower bound beside the 179
  non-raid disenchantable epic-plus defs, and D047 and D034 answered by the same
  figure with dated pointers on their rows and records. No code.
- **D128** (`qr-19-single-slot-writer-slot-key`, at the guard test): Option A
  ROUTED OUT, the maintainer's call on the figures. The proof of zero is
  deductive (single-kind elements make the two predicates one) and the tour
  corroborates it; the price is about +8 bytes per routed element in the
  browser. The follow-up row carries the whole implementation-half obligation
  set; the prototype is committed as a patch.
- **D138** (`qr-19-qr-gray-row-wording-false`): docs only, A with C folded,
  rider F declined. Row 128 amended in place with the two eights kept apart,
  the brainstorm mirror aimed at the arbitrage, section 12.2's label renamed at
  four sites and five tokens, and the two historical specs given a dated note
  that the column they name was renamed (not option B: their premise sentence
  stands as history).
- **D139** (`qr-19-zone-celebration-fanout-shape`, two RULED lines): the splice
  refusal ratified as recorded; the scan MEASURED and ACCEPTED (Option 1) on the
  number, the bench a scratch harness committed as evidence, the suite pinning
  the walk shape, the zone count and the tenant set.

## Reviews

Fourteen fresh typed reviewers, none of them the implementer, the exact set each
row named (D062: content-obligations-reviewer, architecture-reviewer,
qa-checklist; D128: frontend-seam-reviewer, render-performance-reviewer,
test-coverage-auditor, gate-integrity-reviewer, qa-checklist; D138:
test-coverage-auditor, qa-checklist; D139: server-hot-path-reviewer,
architecture-reviewer, test-coverage-auditor, qa-checklist). ZERO blocking.
Thirteen of the fourteen were interrupted mid-review by a login expiry and
resumed with their context intact; every report landed. Every should-fix and
nit was applied in one fix round (`aa9c3d98be`), then a fresh reader read that
round (`056c784fec` applied its report), and a SECOND fresh reader read that
application (`31538b1bc0` applied its three should-fix items: the corrected tour
sentence had overshot again against the series now committed beside it). The findings that changed a RECORDED NUMBER, which is the honest content
of a measurement wave's QA:

1. **D139's cadence premise was wrong in BOTH records, and the wave had copied
   it.** The Phase 18 suite header derives the realm rate from gatherRareEvent
   as "the fan-out's highest-frequency producer". The hot-path reviewer read
   the code: gathering is bounded by a world resource (nodes on a respawn),
   while masterworkZone fires on every masterwork proc and is bounded only by
   how many players are crafting, so a hundred continuous crafters alone put
   sixty times the node line through the walk. The recorded 8 us per second was
   a floor presented as the rate. The verdict survives (about 350 us per second
   at the cap, 0.035 percent of a core), the header is amended in place, dated,
   and the RULED line now prices the craft-driven rate.
2. **D062's "35 epic tool defs" counted the wrong population.** Three reviewers
   independently re-derived it: only gather tools reach the recharge rung, and
   six are epic (five at tier 5, clockreel at tier 6); the other 29 are sigils,
   stations, plates and materials. The recharge is also priced under R47 at the
   higher of the owned tool's rung and the slot's latched ceiling, and a
   specialized original crafter pays two, so the band is two to five. Both
   corrections make the sink SMALLER than stated and the verdict stronger.
3. **D062's inflow was a raid-only lower bound sold as the supply.** The
   architecture reviewer split the 402 disenchantable epic-plus defs into 223
   raid-flagged and 179 not; every omitted source raises supply, which cuts
   against "supply-limited", and the read now says so. The recommended arm
   survives because it is the no-op.
4. **D128's tour deltas are frame-count-driven, not jitter.** The
   render-performance reviewer read the per-sample series: the first four
   samples are identical across all four runs and the bypass count is still
   climbing through the tail, so the "20-write band" was the wrong frame; at
   matched frame counts the shapes are byte-identical. The same reviewer showed
   the headless mode never reaches the steady state where the metric is the
   anchor the baseline defines, and that three of the four desktop captures sit
   at or above the committed anchor (one on UNMODIFIED code), so the record
   now says the artifacts must never feed ARM 3. The memory figure is a Node
   number; Chrome pays about half.
5. **A wave whose Step 1 corrected 35 addresses wrote one wrong one itself.**
   D128's correction (2) moved a correct pin address one line up; four
   reviewers caught it. The record now cites the pin by its test name, per the
   anchor rule, and says what happened.

The round also fixed two arithmetic slips in the D139 RULED line (ten
celebrations a second is 0.47 percent of the budget, not 1; the "27 ns / 103 ns"
sentence mixed a whole-walk figure with a standalone zoneAt figure), stated the
D139 figures as fixture-shaped with a 1.8x upper band for late-index zones,
named the MAX_PLAYERS_PER_REALM override as an unpinned axis and production
observability as absent, and committed every harness and output under
`docs/screenshots/masterwrought-phase-19e/` (joining the five CI cones), because
three reviewers said the same thing: a measurement that exists only as prose is
the shape that rotted the 11m 40 / 84 figure.

Refuted and not applied, with the reason recorded: the state.md draft-table
mirrors of the D062 and D128 rows (state.md's own header calls that table the
DRAFT the QA twin finalizes into the gate file, and the wave's precedent amends
the gate file only); the 2026-09-01 house-form date (every 19E unit carries the
execution date); the phase-19e-qa.md forward reference (this file).

## Validation

At the wave tip `31538b1bc0`, porcelain clean before and after.

- **`node scripts/gate_select.mjs`, pg-armed: PASS, all 12 steps, `GATE_EXIT=0`**
  (judged by the real `GATE_EXIT=` line, never the task's own exit code), run
  TWICE: at the first fresh-read tip `056c784fec` and again at the wave tip after
  the second fresh read's fixes. Mode `full` both times (the sync's broad change
  set against the release base); full-suite fallback **3670 test files
  passed / 1 skipped (3671)** and **54,533 passed / 9 expected fail / 28 skipped
  (54,570)**; browser regressions 38 files, 332 passed; typecheck, the env,
  server and bot builds and the client bundle all green. Porcelain clean after
  the run.
- **THE PG ARM IS PROVEN by contrast, not assumed**: `tests/account_wealth_db.pg.test.ts`
  reads 3 skipped with `TEST_DATABASE_URL` unset and 3 passed with it set, run
  both ways before the gate; `DATABASE_URL` deliberately NOT exported (a
  populated one defeats `characterization.test.ts`'s cold-cache degrade).
- **`npx tsc --noEmit`: EXIT 0** at every commit of the wave, including between
  unit commits (the integrator's whole-tree check).
- **Symbol census: `RESULT: PASS`, exit 0, captured WITHOUT a pipe**, at the sync
  merge, at the unit tips and at the fix-round tip.
- **`npm run ci:changed`: EXIT 0** at the fix-round tip and again after the LAST
  commit (a format pass is not a check pass).
- **Guard suites green** at every tip: architecture, monolith budget (hud.ts
  18716 against its 18716 ceiling, untouched), IWorld parity, the S3 i18n guard,
  the Hud drive registry, the perf budget, the three painter suites, the four
  fan-out suites, the census pin, the CI workflow pin (the new screenshot cone in
  all five blocks), the gate-select plan pins, the zone rollout, the masterwrought
  budget and the materials suite.
- **Every new pin mutated and watched fail ALONE**, reverted from a disk copy,
  never `git checkout`: the D139 premise arm against a rect test (the
  instanced-x assert and the count), against a bucket (the visits count), and
  against a prologue that skips the celebrant's zoneAt (the count); the
  tenant-set pin against a fifth tenant appended to attunement_events.ts. The
  zone-count pin is a premise literal on an exported constant, the class the
  suite already uses for the cadence constant, and is not mutation-proved.
- **Every measurement re-runs from the repo root** from the committed evidence
  under `docs/screenshots/masterwrought-phase-19e/`: the two censuses and the
  heap probe reproduce exactly, the two benches within a few percent.

### Drift: PREDICTED, then MEASURED, then attributed to the line

Predicted before the run, against the 19D close (3670 files; 54,515 passed / 9
expected fail / 28 skipped = 54,552 cases): files +1, cases +15, expected-fail
0, skipped 0, by running the release-touched suites at both revisions and the
wave's one changed suite:

| Source | Files | Cases |
|---|---|---|
| `crab_summon.test.ts` (sync) | 0 | +2 |
| `dungeon_finder_view.test.ts` (sync) | 0 | +2 |
| `ignivar_loot.test.ts` (sync) | 0 | +3 |
| `loot_roll.test.ts` (sync) | 0 | +4 |
| `loot_difficulty_gate.test.ts` (sync, new) | +1 | +3 |
| `zone_celebration_fanout_shape.test.ts` (D139, one arm) | 0 | +1 |
| **Predicted before the reviews** | **+1** | **+15** |

The review rounds then added four arms to the fan-out suite (a zone-count pin,
the direct-entry case, the tenant-set pin, and the prologue arm re-split), so
the prediction owed a re-derivation before the gate: the fan-out suite reads 8 cases at the 19D close and 12 at the wave tip, so the wave's share is +4 and the re-derived prediction is files +1, cases +18, expected-fail 0, skipped 0. MEASURED against the 19D close: **files +1 (3671), cases +18 (54,570), expected-fail 0 (9), skipped 0 (28)**, prediction-exact.

## CARRIED for the maintainer, not taken unilaterally

- **A production signal for the celebration scan.** Option 1 lands no code, so
  the accepted cost folds into the sim phase of `server/tick_profiler.ts` with
  no celebration counter or `PERF_TICK_LOG` token; its withdrawal condition
  cannot be seen on a live realm today. `mob_scan_tick_stats.ts` is the
  precedent shape.
- **The realm-cap axis is pinned to the code default.** `MAX_PLAYERS_PER_REALM`
  overrides it (0 disables), and the per-second scan cost is superlinear in
  realm size; a realm deployed above 5,000 invalidates the D139 figure with
  nothing going red.
- **ARM 3 never checks an artifact's `gpuMode`.** Self-limiting today (a
  headless artifact cannot clear `tourMinFrames`) and never armed by the gate
  or CI; one assertion in `loadArtifact` would make it explicit. Pre-existing.
- **Two stale code comments** met by the D062 read and not fixed in a docs-only
  unit: `enchants.ts`'s header undercounts the shard sinks (it omits the four
  Lucent rows) and calls the Lucent tier "rather than another shard sink"
  while the table bills four Lucent rows.
- **D047 and D034 have no units of their own.** Both are answered by the D062
  read under its ruling id, with dated pointers on their rows and both D034
  records; D034's accept is the arm its own row recommends under the umbrella
  ruling, not a ruling this wave made.
- **The state.md draft-table mirrors** of the D062 and D128 rows are
  unamended: that table is labelled the DRAFT the QA twin finalized into the
  gate file, and the wave's precedent amends the gate file only. Noted so a
  later reader does not take the draft's wording as live.
- **The headless capture cannot re-mint the golden.** The D128 row prescribed
  it; the record says so and the artifacts are marked never-for-ARM-3. A golden
  update, if the shape ever lands, is a headed `PERF_GPU=1` two-run capture.

## JUDGED, and not re-raised

- The four units, their rulings, and every reviewer and fresh-read finding are
  SETTLED. This document records them; it does not reopen them.
- The three items 19C carried, the three 19D carried and the four 19B carried
  remain the maintainer's and are out of this wave's scope. R5 stays FROZEN;
  no fill.
