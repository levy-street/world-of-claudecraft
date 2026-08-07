# Phase 11 QA: verify the pattern drops and vendors

### QA Starter Prompt
```
This is Phase 11 QA of the Masterwrought feature.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the Phase 11 wiring for draw-order safety, referential completeness,
reachability, and market coverage before the Perfecting stage builds on a complete
acquisition loop.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 11 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), loot draw-order and parity
golden gotchas.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (R8, R9, the recorded rates, prices,
and market seam), progress.md Phase 11 checklist, phase-11-pattern-drops.md (what was
promised), git diff against the phase-start commit, src/sim/loot/loot_roll.ts, the
touched loot tables and src/sim/content/heroic_vendor.ts, and every file the diff
touched.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Draw-order agent (adversarial): every loot change is a pure append (diff each table:
no insert mid-list, no reorder, no rollGroup membership change for a pre-existing
entry); the parity suite is green and no golden changed except by append.
Reachability agent: every apex recipe from phases 08/09/10 has its R8 channel live
(the hosting raid boss, rift pool, or quartermaster row exists in shipped content);
every pattern teaches an existing recipe; no orphan either direction; patterns are
tradable and bind on learn; NO new daily gate was added (R9 stays cores-only).
Market agent: patterns and the new materials surface in market browse and search in
BOTH hosts; any facet member added is implemented in both worlds with the parity pin
updated in the same change; prices and rates in state.md match the code.
Test-decisiveness agent: the referential test fails when a pattern or a channel row is
deleted (mutate mentally, both directions); no constant-self-comparison pins; the
draw-order proof is decisive, not a smoke run.
Cleanup agent: no dead code, no unused imports, sim purity intact, server authority
for vendor purchases unchanged.
Dispatch per the Review Dispatch Matrix: architecture-reviewer, cross-platform-sync,
privacy-security-review (server surface), frontend-seam-reviewer (market ui), plus
qa-checklist (phase-completion gate).

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 11
validation set; separate fix commits with explicit paths. The fix round is itself
unreviewed code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 11 QA row), state.md drift, memory notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, handoff to
Phase 12. Follow-ups are CUT-or-fix decisions, never future-PR items.
```
