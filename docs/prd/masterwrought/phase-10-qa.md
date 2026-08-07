# Phase 10 QA: verify the apex consumables and enchants

### QA Starter Prompt
```
This is Phase 10 QA of the Masterwrought feature.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the Phase 10 consumables and enchants for family exactness, increment
discipline, guard inertness, and decisive pins before the drop-wiring phase.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 10 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), aura/exclusivity gotchas.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (R7, R13, R14, the recorded aura-family
design, increments, and guard shape), progress.md Phase 10 checklist,
phase-10-apex-consumables.md (what was promised), git diff against the phase-start
commit, src/sim/combat/exclusive_aura.ts, src/sim/content/enchants.ts, and every file
the diff touched.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Correctness agent: every deliverable present; flasks persist through death, one active,
exclusive with the elixir pairs; foods well-fed exclusive; feast and cauldron
party-usable in BOTH hosts; every increment exactly one rung over the shipped baseline
(recompute independently); Lucent Reagent sourcing consistent with the phase 07 ledger;
enchant application rides the existing cast seam, not a bespoke path.
Stacking agent (adversarial): walk every scroll + flask + food + elixir combination
against the state.md family design; any combination that stacks where the design says
exclusive is a blocking finding; R7 swept (no movement-speed field on any new def);
R14 swept (no new proc effect anywhere).
Guard agent: Lucent Infusion is truly inert (no code path applies it to any current
item, in either host); the guard shape recorded in state.md matches the code phase 12
must flip.
Test-decisiveness agent: every consumable's family membership is pinned by name; each
pin fails on regression (mutate mentally: remove the exclusivity arm, shrink an
increment); no constant-self-comparison pins; negative cases per dimension.
Cleanup agent: no dead code, no unused imports, sim purity intact, masterwork.ts
untouched.
Dispatch per the Review Dispatch Matrix: architecture-reviewer, cross-platform-sync if
events/wire/matchers were added, plus qa-checklist (phase-completion gate).

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 10
validation set; separate fix commits with explicit paths. The fix round is itself
unreviewed code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 10 QA row), state.md drift, memory notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, handoff to
Phase 11. Follow-ups are CUT-or-fix decisions, never future-PR items.
```
