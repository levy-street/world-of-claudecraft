# Phase 18 QA: verify the perfection sweep

The verify twin of `phase-18-perfection-sweep.md`. It re-derives every claim the build
made, hunts what the build missed, and takes the frozen stamp. It ends by handing the
Phase 19 decision table to the maintainer, complete.

### Starter Prompt
```
STANDING DELIVERY RULE (unchanged): NO push, NO PR, NO teardown. LOCAL ONLY.
This is the Phase 18 QA of the Masterwrought feature: the verify twin of the perfection
sweep. Model: xhigh effort. ULTRACODE: yes (the audit lanes and the per-finding
adversarial verification run as Workflows; typed reviewers via the Agent tool).

WORKTREE GUARD (FIRST): run pwd. If not in /Users/fernando/Documents/wocc-masterwrought,
switch NOW with EnterWorktree (path: /Users/fernando/Documents/wocc-masterwrought). If it
refuses, STOP.

STEP 0 - PRE-FLIGHT: git status clean at the Phase 18 close; the newest origin/release/**
re-resolved by version sort and merged with the release-merge-audit if it moved (riders:
Eastbrook re-mint on a renderer.ts touch; the ARM 3 clean capture if still owed). Memory
scan as in Phase 18.

STEP 1 - LOAD CONTEXT (Explore agents): the Phase 18 ledger in state.md (the derived
inventory, the three buckets, every unit record, its JUDGED list, the Phase 19 table
draft); the Phase 18 commit range; the build's own kill table if it recorded one.

STEP 2 - RE-DERIVE, INDEPENDENTLY, every build claim (parallel lanes, COVERAGE prompts):
- The inventory: re-sweep the ledgers YOURSELF and diff your bucket lists against the
  build's. Any bucket-A item the build did not close and did not carry with a reason is
  a FAIL; any bucket-B item missing from the Phase 19 table draft is a FAIL.
- The render unit: the farm_patches producer is PREPARED end to end: run the offline
  farm tour (plant, stage-advance, wet-band flip, feast) with ?perf and read
  perfStats().gpuPrep: zero live-program events attributable to the farm surfaces; the
  stand-in row and its test case exist if a gate landed; the retained twins are never
  disposed while installed; the shadow arm links the depth twin at gate time. Dispatch
  render-performance-reviewer fresh.
- The server units: the serialize-once family builds ONCE per pass (prove byte-identity
  with the pinned tests), the limiter is attached and pinned, the mst resolver allocates
  nothing per tick (prove with the alloc probe idiom or a counted arm), the two offline
  writers are fenced with real-Postgres arms (TEST_DATABASE_URL set, db:up first), the
  scorer fix and the trade-layer fix each carry a failing-before arm. Dispatch
  server-hot-path-reviewer, database-performance-reviewer, migration-safety,
  privacy-security-review fresh.
- The frontend units: the modal painters are inside the painter gate's sweep (prove by
  making one of them violate the cold contract in a throwaway worktree and watching the
  gate red), the rail tile and keybind ride HUD_FRAME_SPECS with the keyboard path, the
  tone hexes are gone (grep count zero, tokens declared), the admin screenshot is
  committed and cone-rowed. Dispatch frontend-seam-reviewer fresh; run the browser suite.
- Tests and tooling: the mobile E2E scripts run green against the live layout (not
  merely re-recorded); the druid harness re-pin reproduces from the committed harness;
  the census fanout-helper adoption leaves RESULT PASS with the union-only pin list
  shrunk and the mutation guard re-run for the emits class; the ci_workflow extractor
  guard reds on a blank-line-split sixth block.
- Content and wiki: the reworded craft-gain rows read from the live constants (chain
  them to the constants the Phase 16 way); wiki:content and wiki:seed both zero-diff
  after regen; the "11e decision 6" label is gone everywhere.
- The mutation guard over the phase's OWN new pins: one throwaway worktree per mutating
  lane; every new decisive assertion killed at least once; prove tests RAN.

STEP 3 - FIX ROUNDS: every finding applied (blocking, should-fix, nits), each round read
by a fresh reviewer, qa-checklist LAST. Judged refusals need a reason and a qr-18-REOPEN
re-judgement (the maintainer re-opened the class; refusing again is a maintainer-visible
act, recorded as such).

STEP 4 - THE FREEZE: node scripts/gate_select.mjs on the committed tree; the full
npm run gate in the background (TEST_DATABASE_URL set, DATABASE_URL never exported
wholesale; detached wrapper, TIP first, EXIT last; judged by exit code AND printed FAIL
markers); then the frozen bounded stamp (npm test -- --maxWorkers=8, database vars
unset, porcelain clean both sides, zero vitest processes before launch) with the drift
PREDICTED before the run and attributed one-to-one against the Phase 17 stamp at
1c265abfa6 (3342/29 files, 50414/2/453 (50869)); node scripts/merge_audit/
symbol_census.mjs RESULT PASS at the final tip.

STEP 5 - DOCS + HANDOFF: progress.md Phase 18 QA row; the Phase 18 QA ledger in state.md
(verdict, kill table, judged list, the frozen stamp); the Phase 19 decision table
FINALIZED (every open maintainer decision in the packet, one row each: the question, the
options, a price per option, a recommendation, the authority row it closes) and written
into phase-19-rulings-gate.md's table section so the Phase 19 session opens on it.

STOPPING RULES: a bucket-A item left open without a carried reason; any red gate step; a
contradiction with a ratified row (escalate); NO push, NO PR, NO teardown.

REPORT: verdict, the re-derived inventory diff, per-lane evidence, the fix rounds, the
drift-attributed frozen stamp, the finalized Phase 19 decision table, and NEXT = Phase 19
(phase-19-rulings-gate.md, FRESH session, the maintainer answers the table in-session).
```
