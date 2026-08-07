# Phase 15 QA: verify the power-verification pass

### QA Starter Prompt
```
This is Phase 15 QA of the Masterwrought feature: verify the verification.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: independently confirm the R5 envelope verdict is reproducible, every audit claim
is backed by a pinned test or a recorded measurement, and any tuning-down fix went
through the sweeps, before the polish phase and the PR build on a proven envelope.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 15 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), mutation harness must prove
tests RAN, adversarial-verify notes (judge refuted claims yourself with the file OPEN).

STEP 1 - LOAD CONTEXT (Explore agent): state.md (R5, R14, Power placement),
progress.md Phase 15 checklist, phase-15-power-verification.md (what was promised),
docs/prd/masterwrought/power-verification.md, git diff against the phase-start commit,
docs/design/spell-balance-framework.md.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Reproducibility agent: recompute the envelope math from power-verification.md ALONE (no
peeking at the phase session's scratch); every input, formula step, and target present
in the doc; the recomputed verdict matches the recorded one; flag any unstated input or
unexplained constant as a FAIL of the doc.
Claim-audit agent: every claim in the doc and the phase report maps to a pinned test or
a recorded measurement; the budget-sweep enumeration is complete (independently
enumerate masterwrought-flagged defs and apex recipe outputs against
tests/masterwrought_budget.test.ts); rating and exclusivity pin coverage is complete;
no breach was resolved by widening the envelope, relaxing a pin, or editing a formula
(diff-check for it explicitly).
Test-decisiveness agent: the sweep and the touched pins fail on regression (mutate
mentally: would a one-point budget bump fail? a swapped rating allocation?); no
constant-self-comparison pins; the tuned-down values are formula-consistent.
Cleanup agent: content-only diff confirmed (no sim logic drift); no dead rows or
leftover audit scaffolding.
Dispatch per the Review Dispatch Matrix: the sim and frontend rows stay skipped (pure
data/test/docs); dispatch test-coverage-auditor over the pin set and qa-checklist
(phase-completion gate).

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the content matrix
and every touched pin file; separate fix commits with explicit paths. The fix round is
itself unreviewed code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 15 QA row), state.md drift (final numbers), memory
notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, the independently recomputed
envelope verdict, counts found and fixed, handoff to Phase 16. Follow-ups are
CUT-or-fix decisions, never future-PR items.
```
