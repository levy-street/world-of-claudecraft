# Phase 01 QA: verify the Masterwrought equip cap

### QA Starter Prompt
```
This is Phase 01 QA of the Masterwrought feature.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the Phase 01 implementation for correctness, decisive tests, parity, and i18n
completeness before any content phase builds on the cap.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 01 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), world_api parity gotchas.

STEP 1 - LOAD CONTEXT (Explore agent): state.md, progress.md Phase 01 checklist,
phase-01-masterwrought-cap.md (what was promised), git diff against the phase-start
commit, src/sim/equipment_rules.ts and every file the diff touched.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Correctness agent: every deliverable present; refusal reachable from every equip route
(drag, command, swap, bank/mail/trade-sourced equips); over-cap legacy saves tolerated;
offline Sim and online ClientWorld behave identically; instance rolled.quality feeds the
sub-cap.
Test-decisiveness agent: each pinned behavior fails on regression (mutate mentally: would
removing the sub-cap arm fail a test?); no constant-self-comparison pins; negative cases
per dimension (cap, sub-cap, 2H, duplicates, legacy).
Cleanup agent: no dead code, no unused imports, sim-purity intact, no isUniqueEquipped
drift.
Dispatch per the Review Dispatch Matrix: architecture-reviewer + cross-platform-sync,
plus qa-checklist (phase-completion gate).

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 01
validation set; separate fix commits with explicit paths. The fix round is itself
unreviewed code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 01 QA row), state.md drift, memory notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, handoff to
Phase 02. Follow-ups are CUT-or-fix decisions, never future-PR items.
```
