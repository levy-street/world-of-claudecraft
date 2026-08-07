# Phase 02 QA: verify pattern items and recipe learning

### QA Starter Prompt
```
This is Phase 02 QA of the Masterwrought feature.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the Phase 02 implementation for correctness, decisive tests, parity, and i18n
completeness before Phase 11 hangs every apex pattern on this machinery. Audit emphasis
(the phase's QA focus): the learn path draws no rng; pattern items respect the frozen-id
golden; S3 matcher coverage for every refusal line.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 02 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), frozen-id golden gotchas, i18n
matcher entries.

STEP 1 - LOAD CONTEXT (Explore agent): state.md, progress.md Phase 02 checklist,
phase-02-pattern-items.md (what was promised), git diff against the phase-start commit,
src/sim/professions/crafting.ts and every file the diff touched.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Correctness agent: every deliverable present; the three gates (profession, tier,
already-known) each refuse from every use route; a refusal never consumes; success
consumes exactly one item and learns exactly once (no double-learn on repeated commands);
offline Sim and online ClientWorld behave identically; patterns are market-listable.
Rng-and-golden agent: walk the learn path end to end and confirm ZERO rng draws; confirm
any shipped id added is append-only against the frozen-id golden and the golden test file
itself is untouched-green.
Test-decisiveness agent: each pinned behavior fails on regression (mutate mentally: would
dropping the tier gate fail a test? would consuming on refusal fail one?); no
constant-self-comparison pins; a negative case per gate; S3 matcher coverage for EVERY
refusal line (the guard actually exercises each).
Cleanup agent: no dead code, no unused imports, sim purity intact, the use-dispatch seam
was extended, not forked.
Dispatch per the Review Dispatch Matrix: architecture-reviewer + cross-platform-sync,
plus qa-checklist (phase-completion gate).

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 02
validation set; separate fix commits with explicit paths. The fix round is itself
unreviewed code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 02 QA row), state.md drift, memory notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, handoff to
Phase 03. Follow-ups are CUT-or-fix decisions, never future-PR items.
```
