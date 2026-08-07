# Phase 13 QA: verify the orange promotion

### QA Starter Prompt
```
This is Phase 13 QA of the Masterwrought feature.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the orange promotion for R3 fidelity (prestige only), the naming moderation
surface, unique-equipped interplay, and append-only deeds before the UX phase dresses
it up.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 13 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), deeds authoring notes,
player-text i18n rules.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (R3, naming registry), progress.md
Phase 13 checklist, phase-13-orange-promotion.md (what was promised), git diff against
the phase-start commit, docs/design/deeds.md, and every file the diff touched.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Correctness agent: promotion reachable ONLY from the final Perfecting rank; the Deed of
Making is consumed exactly once; stats and effects identical before/after promotion (R3:
diff the instance, not the description); crafter signature retained; the promoted
instance is counted by BOTH the quality-derived isUniqueEquipped rule and the phase 01
Masterwrought sub-cap (no double-refusal bug, no bypass); celebration fires at
masterwork event family parity (zone + personal + Discord).
Naming and moderation agent: the name is validated and profanity-filtered SERVER-SIDE;
the client cannot inject an unmoderated name through any route (command, wire replay,
rename); operators can act on a bad name after the fact; the player-authored text never
passes through t() or lands in the i18n catalog, and tooltips render it safely in both
hosts.
Deeds agent: DEEDS entries and deedStats sites are append-only; Renown assignment
follows docs/design/deeds.md (zero Renown for anything luck-gated); cosmetic-only;
tests/deeds_content.test.ts pins would fail on a removed or mutated row.
Test-decisiveness agent: each pinned behavior fails on regression (mutate mentally:
would skipping the Deed consume fail a test? would a stat change slip through?); no
constant-self-comparison pins; negative cases per dimension (rank gate, Deed missing,
name rejected, sub-cap full).
Cleanup agent: no dead code, no unused imports, sim purity intact, masterwork.ts and
equipment_rules.ts contracts drift-free.
Dispatch per the Review Dispatch Matrix: architecture-reviewer, cross-platform-sync,
privacy-security-review, frontend-seam-reviewer, plus qa-checklist (phase-completion
gate).

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 13
validation set; separate fix commits with explicit paths. The fix round is itself
unreviewed code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 13 QA row), state.md drift, memory notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, handoff to
Phase 14. Follow-ups are CUT-or-fix decisions, never future-PR items.
```
