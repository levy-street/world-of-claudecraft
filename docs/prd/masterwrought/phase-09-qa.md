# Phase 09 QA: verify the apex weapons, jewelry, and gadgets

### QA Starter Prompt
```
This is Phase 09 QA of the Masterwrought feature.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the Phase 09 pieces for dps-curve exactness, jewelry purity, station-seam
correctness, flag accuracy, and sweep completeness before the consumable phase.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 09 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), station/placement gotchas,
world_api parity gotchas.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (R2, R6, R12, R13, R14, power placement,
the resolved charm price), progress.md Phase 09 checklist, phase-09-apex-weapons-jewelry.md
(what was promised), git diff against the phase-start commit, src/sim/item_budget.ts,
src/sim/professions/mobile_station.ts, and every file the diff touched.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Correctness agent: every deliverable present (1H, Ridgebreaker, shield, necklace, two
rings, Gyrelens Array, Master's Field Forge, charm, Voidbound Grimoire); dps EQUALS
weaponDpsBudget with the TWOHAND multipliers; the forge respects station radius rules
and works party-wide in BOTH hosts; the gadget use is cosmetic only (R14 adversarial:
no combat-affecting field on any new def); charm sits one rung over the ladder at the
recorded price; jewelry is pure primary + stamina with ratings pinned to the named
heroic-vendor rows.
Flag agent: masterwrought: true on every phase 09 piece EXCEPT the field forge and the
charm; the R6 cap-interplay case is pinned (2H counts ONE; third flagged equip refused).
Test-decisiveness agent: the sweep covers EVERY phase 09 item (adversarial: diff the
defs against the test's list); each pin fails on a one-point drift; no
constant-self-comparison pins; negative cases per dimension.
Cleanup agent: no dead code, no unused imports, sim purity intact, any new sim module
behind SimContext with its own test, no rng outside Rng.
Dispatch per the Review Dispatch Matrix: architecture-reviewer, cross-platform-sync if
an IWorld/wire/SimEvent surface was added, plus qa-checklist (phase-completion gate).

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 09
validation set; separate fix commits with explicit paths. The fix round is itself
unreviewed code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 09 QA row), state.md drift, memory notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, handoff to
Phase 10. Follow-ups are CUT-or-fix decisions, never future-PR items.
```
