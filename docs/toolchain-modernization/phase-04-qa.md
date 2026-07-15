# Phase 4 QA: Verify the test sharding

### QA Starter Prompt

```
This is Phase 4 QA of the Toolchain Modernization packet: Verify the test-suite
sharding.

Model: Opus 4.8, xhigh effort (reserve max for genuinely frontier problems), 1m context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: optional.

Goal: audit Phase 4 for shard completeness, split fidelity of the vale_cup suite,
flakiness risk, and pin integrity.

STEP 0 - PRE-FLIGHT: feature/ci-test-sharding worktree; git status clean (packet
bootstrap: if docs/toolchain-modernization/ is absent, copy it from the main checkout).
Memory scan for CI entries.

STEP 1 - LOAD CONTEXT (via an Explore agent): state.md (D7), progress.md (Phase 4
measurements + shard times), phase-04-test-sharding.md, the full phase diff, the three
recorded CI runs (gh run view), CLAUDE.md (root), and tests/CLAUDE.md. Return:
deliverables, measurements, touched files.

STEP 2 - QA AUDIT (parallel agents; COVERAGE not filtering: report every issue
including low-severity and uncertain ones; ranking happens in a later step):

Acceptance agent:
- Re-verify EVERY Phase 4 acceptance criterion independently: re-derive the three run
  wall times from gh run view against the at-or-under-4-minutes target; confirm the
  OPEN-item-1 setup-bucket explanation exists in progress.md and is supported by the
  recorded measurement; confirm the release-gate verification happened (scratch
  release/** run green, or the deferral is recorded in progress.md).

Completeness agent:
- Independently re-verify shard completeness from the CI logs: per-shard file counts
  sum to a fresh post-split single-run count measured on this branch (NOT the pre-split
  count; the vale_cup split added files by design); grep the shard logs for the
  pretest-dependent suites (localization_fixes, guide, i18n_status_registry,
  i18n_resolved_equivalence) and confirm each ran green in whichever shard owns it.
- Confirm the browser-gate and lint jobs are untouched.

Split-fidelity agent:
- Diff the split vale_cup files against the original: every test present exactly once,
  no assertion changed, helpers moved not rewritten. Run the split files locally.
- Re-run the shard-assignment simulation with the new file set; confirm the heavy files
  no longer co-locate and the worst shard matches the recorded times.

Stability agent:
- Rerun one shard three times locally (npm test -- --shard=2/4); identical results each
  time (no order-dependent flakiness introduced).
- Verify the failure UX: force one test red in a scratch commit; confirm exactly one
  shard fails and its log names the file legibly; revert.
- Hand-re-derive every tests/ci_workflow.test.ts assertion from the final ci.yml.

Multi-agent review dispatch per the implementation-plan.md matrix, plus qa-checklist.
Standard truncation-resume message.

STEP 3 - FIX: apply BLOCKING and SHOULD-FIX; re-run validation + one more CI run;
commit with EXPLICIT paths.

STEP 4 - UPDATE DOCS + MEMORY: progress.md, state.md (lock the final shard design).

STEP 5 - PACKET TEARDOWN: skip (not the final phase).

STEP 6 - FINAL RESPONSE FORMAT: QA verdict, counts found/fixed, deferred items,
one-line handoff for Phase 5.

STOPPING RULES:
- Stop and surface any shard-only failure (isolation bug) rather than masking it.
```
