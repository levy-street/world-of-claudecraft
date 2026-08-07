# Phase 06 QA: verify the inscription base catalog

### QA Starter Prompt
```
This is Phase 06 QA of the Masterwrought feature.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the Phase 06 catalog before the intermediates (phase 07), the apex tome
(phase 09), and the consumable phases build on it. Audit emphasis (the phase's QA focus):
the exclusivity pin is decisive (scroll + elixir of the same family never both apply);
tome budgets formula-derived.

STEP 0 - PRE-FLIGHT: git status clean (Phase 06 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), exclusive-aura/consumable
stacking gotchas, content pin gotchas.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (R10, R14 + corollary, R15, the recorded
station decision), progress.md Phase 06 checklist, phase-06-inscription-base.md (what was
promised), git diff against the phase-start commit, src/sim/exclusive_aura.ts and every
file the diff touched.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Exclusivity agent: for EVERY new scroll, confirm its declared family matches a real
elixir family and that the pin is decisive: scroll then elixir AND elixir then scroll,
same family, never both auras active; mutate mentally (would removing one scroll's family
membership fail a test?); confirm no scroll bypasses the consumable seam with its own
application path; exclusive_aura.ts's contract is unchanged.
Budget agent: recompute a sample of tome budgets from primaryStatBudget at the
recipe-derived ilvl and confirm EXACT equality; scroll magnitudes sit at the same band as
their family's elixir rung (alternative source, never an upgrade); the recipe_economy
exception list is still EMPTY.
Coverage agent: every recipe has resolvable inputs, a trainer row with a tier-table fee,
an icon row, and a web-verified English name; wiki regenerated and fresh; new ids
append-only against the frozen-id golden; NO glyph or ability-modifier surface anywhere
in the diff.
Cleanup agent: no dead code, sim purity intact, S3 matcher present for any refusal line,
station wiring matches the recorded state.md decision.
Dispatch per the Review Dispatch Matrix: architecture-reviewer + frontend-seam-reviewer,
plus qa-checklist (phase-completion gate).

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 06
validation set; separate fix commits with explicit paths. The fix round is itself
unreviewed code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 06 QA row), state.md drift, memory notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, handoff to
Phase 07. Follow-ups are CUT-or-fix decisions, never future-PR items.
```
