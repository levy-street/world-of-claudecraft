# Phase 14 QA: verify the crafting UX beauty pass

### QA Starter Prompt
```
This is Phase 14 QA of the Masterwrought feature.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the crafting UX pass against the frontend contracts (buckets, write elision,
pure-core registration), i18n sink classification, mobile safe areas, and DESIGN.md
rollout compliance before the audit phases run.

STEP 0 - PRE-FLIGHT: git status clean (Phase 14 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), pure-core triple registration,
HUD/CSS traps, screenshot traps.

STEP 1 - LOAD CONTEXT (Explore agent): state.md, progress.md Phase 14 checklist,
phase-14-crafting-ux.md (what was promised), DESIGN.md rollout phases, git diff against
the phase-start commit, and every file the diff touched.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Correctness and design agent: every deliverable present (apex surfacing, Perfecting
panel, cap indicators, commission signaling + fee floor, undo copy, SFX, mobile); the
bind warning is unmissable BEFORE the first attempt (R2); ui copy claims (no-downgrade,
fee floor) match the actual sim/server behavior; DESIGN.md rollout-phase compliance
stated with evidence, not vibes.
Frontend-contract agent: every new view-core is DOM-free and registered in
UI_PURE_CORES; per-frame painters write-elide; cold windows honor the two cadence-free
contracts; tests/hud_perf_budget.test.ts sorts every new painter into a bucket; styles
respect the layer/token/mobile contract; no hud.ts or main.ts growth; reads go through
IWorld only.
i18n and mobile agent: every new string classified by render sink and keyed through
t() (labels, tooltips, placeholders, aria, toasts, validation); no concat or fallback
defaults; mobile safe areas and touch targets verified on the captured screenshots;
screenshots committed under docs/screenshots and referenced.
Test-decisiveness agent: view-core tests fail on regression (mutate mentally); no
constant-self-comparison pins; the fee-floor test has a negative case; the SFX cue rows
have their catalog entries.
Cleanup agent: no dead code, no unused imports or selectors, no stray drivers or
debugger/only leftovers.
Dispatch per the Review Dispatch Matrix: frontend-seam-reviewer, cross-platform-sync if
a facet member landed, architecture-reviewer if sim was touched, plus qa-checklist
(phase-completion gate).

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 14
validation set including hud_perf_budget and the screenshot script; separate fix commits
with explicit paths. The fix round is itself unreviewed code: have a fresh reviewer pass
over the fix diff.

STEP 4 - DOCS: progress.md (Phase 14 QA row), state.md drift, memory notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, handoff to
Phase 15. Follow-ups are CUT-or-fix decisions, never future-PR items.
```
