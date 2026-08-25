# Phase 15: The beautify pass (marketplace UI and UX)

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.39.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix. This file is the phase spec.

- Repo: game. Worktree `/Users/fernando/Documents/wocc-marketplace`, branch `feature/woc-marketplace`.
- Closes: the beautify bar (a stated packet goal from Fernando: the marketplace is a
  HUGE part of the game and must look like a beautiful MMORPG window), and the
  stale-screenshot item inside H13.
- review.md: strengths item 9 (the bar to keep), H13 (stale TOTP screenshots).

## Goal

The marketplace looks and feels like the best surface in the game: a proper classic
MMORPG window family, fully conformant with DESIGN.md, where nothing truncates, every
number and time is formatted, every image reads clearly, and the whole surface holds up
on desktop and mobile.

## Context

The review rates the player UI well built (real pure-core/painter split, ARIA 1.2
combobox, honest degraded states, thoughtful mobile CSS). Phases 12 to 14 landed the
behavior fixes. This phase is presentation only, and it is deep, not a touch-up. Of the
sixteen committed captures under `docs/screenshots/woc-market/`, the ten that predate
the step-up (nine desktop plus `after-mobile-browse.png`) must be re-taken, four of them
still showing the retired TOTP field; the six 14-QA mobile captures are TOTP-free and
are re-taken anyway wherever this pass changes their faces.

## Deliverables

1. DESIGN.md conformance audit and fixes across every marketplace surface (browse,
   listing detail, bid/buy-now, directed offer and trade panel, activity, wallet /
   paused / degraded states, the step-up prompt from phase 13): window-family framing,
   spacing rhythm and padding on the design tokens (no ad-hoc pixel values), alignment
   grids, hierarchy, iconography, hover/focus states, scrollbar and list styling
   consistent with the HUD family. Produce the audit as a checklist first, then apply
   every item (or defer with a reason in progress.md).
2. Content robustness, checked at the extremes, not the happy path:
   - Text never truncates silently: long item names, long seller names, stacked
     suffixes, and the wordiest locale-sized strings either wrap by design or ellipsize
     WITH a tooltip carrying the full text.
   - Numbers, money, dates, times, and percents ALL go through `formatNumber` /
     `formatMoney` / `formatDateTime` / `Intl` (grep-verified: zero `toFixed`, zero
     string-concatenated symbols or units in the market UI); auction countdowns and
     "time ago" rows use the HUD's relative-time conventions and never jump widths.
   - Item icons and images render crisply at HUD scale (correct resolution, no
     stretching, readable rarity framing); empty and placeholder art is deliberate,
     never a broken square.
   - Zero-state, one-item, and max-page-size lists all lay out correctly; loading
     states reserve space (no layout jumps).
3. Tooltip quality: every market tooltip follows `docs/design/tooltip-writing.md` (use
   the `write-game-tooltips` skill for any text change); fee and bond tooltips show
   resolved values.
4. Mobile: phone-width layouts, safe areas, touch targets, the landscape-only in-game
   rule; verify with the mobile screenshot scripts.
5. Fresh before/after screenshot set, desktop AND mobile, at the LOWEST graphics preset
   (standing memory rule), committed under `docs/screenshots/woc-market/` (the ONE
   marketplace capture directory: it is the slug the five CI sparse-cone blocks in
   `.github/workflows/ci.yml` and `tests/ci_workflow.test.ts` already list, and both
   rigs default to it; a new slug would need those cones extended in the same change),
   every stale TOTP-bearing capture deleted, referenced from the eventual PR body
   (`pr-screenshots` skill owns the recipe). Include at least one long-name /
   large-number stress capture per surface, not just pristine data.

## Out of scope

Behavior changes of any kind (a behavior bug found here goes to progress.md deferrals);
non-marketplace HUD surfaces (a shared token fix that improves both is fine; a
refactor of another window is not).

## Validation

`npx tsc --noEmit`; the styles/HUD suites the Explore agent identifies plus
`npx vitest run tests/monolith_budget.test.ts` (hud.ts must not regrow: after the third
v0.39.0 sync it sits at exactly 19069, zero headroom, like sim.ts 12527, main.ts 11493,
renderer.ts 13744 and server/game.ts 10807);
`npm run ci:changed`; the screenshot scripts; commit, then `node scripts/gate_select.mjs`.

## Reviewers

`frontend-seam-reviewer` (styles layer/token contract, painter thinness, fairness:
purely cosmetic changes only). `qa-checklist` last.

## Acceptance criteria

- [x] The DESIGN.md audit checklist exists with every item applied or deferred with
      reason (`phase-15-design-audit.md`, sections A to K)
- [x] Stress content (longest names, largest numbers, zero states) renders correctly on
      every surface; the grep for raw formatting is clean (`tests/usd_text.test.ts`
      widened to catch a glued ticker, `tests/woc_tokens_text.test.ts` scans every
      caller)
- [x] Every market tooltip passes the tooltip-writing bar (audit section I; the
      figures are pinned to the server constants AND to the five fills)
- [x] Mobile captures show correct safe-area and touch layout, measured rather
      than eyeballed (152 floor checks per market pass, 116 header-clearance
      assertions, the split at 440/440 with zero overlap). The insets themselves
      cannot be proven headless, which the CSS says outright and the QA session
      still owes on a real notched device
- [x] Fresh screenshot set committed at lowest preset, stress captures included, zero
      TOTP-bearing captures remain (79 shots in `docs/screenshots/woc-market/`)
- [x] Zero behavior diffs in the rendering, with three deliberate exceptions
      recorded in progress.md (the fee preview's request cadence, the busy-label
      sequencing, and the token spelling unified at two digits)

## Wrap-up

Update progress.md and state.md (screenshot paths for the PR body). Next file:
`docs/woc-marketplace-hardening/phase-15-qa.md` (its verdict includes Fernando's
sign-off on the screenshot set).
