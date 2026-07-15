# Phase 1 QA: Verify the i18n aggregate degit

### QA Starter Prompt

```
This is Phase 1 QA of the Toolchain Modernization packet: Verify the degit of the i18n
aggregate artifacts.

Model: Opus 4.8, xhigh effort (reserve max for genuinely frontier problems), 1m context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: this phase gates a workflow-wide contributor-facing change; add ultracode to
run an adversarial-verify Workflow (each finding independently confirmed by a skeptic
agent before it counts).

Goal: audit Phase 1 for correctness, consumer completeness, freshness-signal
preservation, behavior preservation, and docs accuracy.

STEP 0 - PRE-FLIGHT:
- Work in the fix/degit-i18n-aggregates worktree; git status clean (Phase 1 committed,
  including the packet directory itself).
- Memory scan for i18n-artifact entries.

STEP 1 - LOAD CONTEXT (via an Explore agent, not directly):
- docs/toolchain-modernization/state.md, progress.md (Phase 1 checklist),
  phase-01-degit-i18n-aggregates.md (what was promised)
- The full Phase 1 diff (git diff against the phase-start commit)
- CLAUDE.md (root), src/ui/CLAUDE.md, scripts/CLAUDE.md
The agent should return: the deliverables list, all touched files, and any deviations.

STEP 2 - QA AUDIT (parallel agents, each prompted for COVERAGE not filtering; report
every issue including low-severity and uncertain ones; ranking happens later):

Correctness agent:
- Every acceptance criterion in the phase prompt independently re-verified (re-run the
  two-branch merge experiment yourself; re-run the staled-slice freshness check).
- The resolved i18n output is byte-identical across the change (regenerate on the base
  branch and on this branch from the same catalog state; diff the slices).
- The kept test blocks in tests/i18n_resolved_equivalence.test.ts still assert: slices
  tracked, regen byte-identical, perturbed determinism. The kept blocks in
  tests/i18n_status_registry.test.ts still assert all four: the counts cross-check, the
  perLocale tally, the universeHash re-derivation, and determinism.

Consumer-completeness agent:
- Adversarial WHOLE-REPO git grep for BOTH filenames and for "i18n:hash",
  "resolved.sha256", "status.summary": every hit is either updated, inside this
  packet's own files, or inside the historical program records (ip-refactor/,
  docs/api-pipeline/), which are deliberately left unedited; flag anything else.
- Verify the audit-summary CI step parses the real generated summary shape (run
  scripts/i18n_scan.mjs locally and feed the step's extraction logic).

Docs agent:
- Every doc/skill listed in the Phase 1 sweep reads correctly for a NEW contributor
  (the old regenerate-and-rebaseline instructions are gone everywhere; the reopened
  decisions are recorded with date and rationale in the i18n-scaling doc).

Multi-agent review dispatch: apply the Review Dispatch Matrix in
docs/toolchain-modernization/implementation-plan.md against the phase diff, plus
qa-checklist (phase completion). Resume any truncating agent with: "Stop reading more
files. Output the full report now. No more tool calls. Format: BLOCKING / SHOULD-FIX /
NICE-TO-HAVE / VERDICT."

STEP 3 - FIX: apply all BLOCKING and SHOULD-FIX items; re-run the Phase 1 validation
row from state.md plus npm run gate. Commit fixes with EXPLICIT paths.

STEP 4 - UPDATE DOCS + MEMORY: progress.md (Phase 1 QA complete; counts; deferrals),
state.md (drift found). Record memory notes if surprising rules surfaced.

STEP 5 - PACKET TEARDOWN: skip (not the final phase).

STEP 6 - FINAL RESPONSE FORMAT: QA verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL), counts
found and fixed, deferred items, one-line handoff for Phase 2.

STOPPING RULES:
- Stop and surface if any BLOCKING item cannot be fixed without changing phase scope
  (for example, a consumer of the sha256 file that genuinely needs a committed baseline).
```
