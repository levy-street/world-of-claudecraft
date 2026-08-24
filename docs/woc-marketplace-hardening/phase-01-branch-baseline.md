# Phase 01: Branch baseline (merge re-review, hud extraction, green gate)

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.37.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Follow the shared workflow in `implementation-plan.md` first (pre-flight, sync, memory
scan, orchestration, commit rules, review dispatch); `state.md` has the validation
matrix. This file is the phase spec.

- Repo: game. Worktree `/Users/fernando/Documents/wocc-marketplace`, branch `feature/woc-marketplace`.
- Closes: H7 (monolith gate red), plus the review's two still-owed merge items.
- review.md: H7, "Integration state" paragraph, Recommended sequence item 5.

## Goal

Give every later phase a trusted, fully green base: semantically re-review the release
merge's auto-merged coordinators, extract the p2p offer state machine off `hud.ts`, and
record a green `node scripts/gate_select.mjs` baseline.

## Findings context (verified 2026-08-11; re-verify before editing, code may have moved)

- Merge `a52da32c89` (release/v0.37.0 into the branch) auto-merged five coordinators that
  were never semantically re-reviewed: `src/ui/hud.ts`, `src/sim/sim.ts`,
  `server/game.ts`, `src/net/online.ts`, `src/world_api.ts` (plus its facet files).
- H7: the ~590-line p2p offer state machine landed on the `Hud` coordinator (around
  `src/ui/hud.ts:18809`); `tests/monolith_budget.test.ts` is RED (20005 > 19600).

## Deliverables

1. Semantic merge re-review: fan out one read-only subagent per coordinator (five in
   parallel) to check both parents' intents survived the auto-merge (marketplace members
   AND release-side changes; look for dropped hunks, duplicated logic, dead branches).
   Fix any drift test-first. Record a per-file verdict (clean or fixed) in progress.md.
2. Extract the p2p offer state machine into `src/ui/hud/woc_trade/` behind an `index.ts`
   barrel: a pure DOM-free view-core plus a thin painter on the `PainterHost` seam, per
   `src/ui/hud/CLAUDE.md`. This is a MOVE, not a rewrite: behavior byte-identical, the
   `extract-and-test` skill owns the recipe. Add view-core unit tests for the offer state
   transitions (they do not exist today).
3. `tests/monolith_budget.test.ts` green, and the `hud.ts` ceiling LOWERED to the
   post-extraction size (never leave headroom to regrow).
4. Commit, then run the full `node scripts/gate_select.mjs`; make it green (this also
   discharges the review's owed full-gate run) and record the result in state.md.

## Out of scope

- Any behavior change to the offer flow (the dead decline control, honesty fixes: phase
  14). Any other extraction off `hud.ts` beyond the p2p controller.

## Validation

`npx tsc --noEmit`; `npx vitest run tests/monolith_budget.test.ts` plus the new view-core
test file and the existing hud/marketplace UI suites the Explore agent identifies;
`npm run ci:changed`; after committing, `node scripts/gate_select.mjs`.

## Reviewers

`frontend-seam-reviewer` (the extraction), `qa-checklist` (phase completion). Add
`architecture-reviewer` only if the re-review changes `src/sim/` files, and
`cross-platform-sync` only if it changes wire or `IWorld` surfaces.

## Acceptance criteria

- [ ] Five per-coordinator re-review verdicts recorded; any drift fixed with a test
- [ ] `src/ui/hud/woc_trade/` exists (view-core + painter + barrel) with unit tests;
      `hud.ts` keeps only a thin composition call
- [ ] Monolith test green with a lowered `hud.ts` ceiling
- [ ] `node scripts/gate_select.mjs` green on the committed tip, recorded in state.md
- [ ] No player-visible behavior change

## Wrap-up

Update progress.md (status, phase-start commit) and state.md (ledger entry, new module
path, lowered ceiling value). Final response ends by naming the next file:
`docs/woc-marketplace-hardening/phase-01-qa.md`.
