# Phase 12 QA: verify the Perfecting stage

### QA Starter Prompt
```
This is Phase 12 QA of the Masterwrought feature. Phase 12 is the packet's highest-risk
phase; this audit is correspondingly the strictest.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the Perfecting implementation for R1/R2/R5 fidelity, server authority,
draw-order safety, persistence back-compat, and decisive tests before phase 13 builds
the orange promotion on top of it.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 12 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), parity scenario traps, JSONB
back-compat notes, deferred-write re-check.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (R1, R2, R5, R13, Power placement),
progress.md Phase 12 checklist, phase-12-perfecting.md (what was promised), git diff
against the phase-start commit, src/sim/professions/perfecting.ts and every file the
diff touched, plus src/sim/professions/masterwork.ts to confirm its diff is EMPTY.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Correctness agent: R1 fail-forward has NO path that harms or downgrades the piece;
binding fires when Perfecting BEGINS (the first attempt), never later (R2); materials
consumed on failure AND success; each eligibility gate (apex flag, crafter skill 125 per
R13, wearer-supplied materials) refusable and localized; the head-start hook grants
track progress, never a quality bump; the Lucent Infusion guard (phase 10) reads the
real Perfected state; the phase 01 cap and R3 sub-cap still count a Perfected piece.
Authority and wire agent: the client NEVER resolves an attempt (sweep ClientWorld for
any resolution path); sanitize strips everything server-private; wire fields sane for
interest-scoped snapshots; a pre-phase save payload loads with clean defaults.
Determinism agent: the crafting proc site still draws exactly once per successful craft
in the same order; every new draw goes through ctx.rng at the documented position; the
parity scenario would actually fail on a draw-order change (mutate mentally).
Test-decisiveness agent: delta exactness is formula-derived, never a
constant-self-comparison; each pinned behavior fails on regression; negative cases per
eligibility dimension; the round-trip test asserts values, not just absence of throw.
Cleanup agent: no dead code, no unused imports, sim purity intact, masterwork.ts and
isUniqueEquipped drift-free.
Dispatch per the Review Dispatch Matrix: architecture-reviewer, cross-platform-sync,
privacy-security-review, migration-safety, plus qa-checklist (phase-completion gate).

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 12
validation set including the wire suites and the parity scenario; separate fix commits
with explicit paths. The fix round is itself unreviewed code: have a fresh reviewer pass
over the fix diff.

STEP 4 - DOCS: progress.md (Phase 12 QA row), state.md drift (rank counts, the rng
position doc), memory notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, handoff to
Phase 13. Follow-ups are CUT-or-fix decisions, never future-PR items.
```
