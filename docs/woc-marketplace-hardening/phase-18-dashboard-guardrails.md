# Phase 18: Dashboard guardrails (authorization and operator correctness)

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/woc-rewards-dashboard-pr13`; verify `pwd` and
`git branch --show-current` (must print `integration/woc-market-trading`). Then
`git fetch origin` and merge `origin/master` so this session starts current. Packet
docs (progress.md, state.md) live in the game worktree
`/Users/fernando/Documents/wocc-marketplace`; commit doc updates there.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix. This file is the phase spec.

- Repo: DASHBOARD. Worktree `/Users/fernando/Documents/woc-rewards-dashboard-pr13`,
  branch `integration/woc-market-trading`. Validate with `npm test`, `npm run check`,
  `npm run build`.
- Closes: H1, H2, the validateReleaseRequest medium, and the operator-correctness
  mediums (confirm, treasury reset, actor ID, overview isolation).
- review.md: H1, H2, Mediums "validateReleaseRequest accepts settlement references",
  "Dashboard is not yet an investigation tool" (the correctness slice).

## Goal

An operator cannot be shown a wrong number, cannot fire a destructive action by
accident, and a non-privileged role cannot read player financial data.

## Findings context (verified 2026-08-11; re-verify line numbers)

- H1 at `src/pages/api/game/[...path].ts:43`: the game proxy has no role check; any
  signed-in operator (including external roles) reads seller wallet addresses and p2p
  payloads the policy layer declares internal-only. The authorization test never
  exercises a non-privileged role, so it ships green.
- H2 at `src/components/market_trading_view.ts:53`: 9 hardcoded token decimals vs the
  live mint's 6: every operator token figure is 1000x understated, feeding
  refund/forfeit decisions.
- `market_trading_view.ts:286`: `validateReleaseRequest` regex `/^WM[BS]_[0-9a-f]{32}$/`
  accepts `WMS_` settlement refs on the bond-only release path.
- Bond forfeit fires on one unconfirmed click; after a treasury forfeiture the treasury
  destination stays selected for the next operation; audit attribution logs a mutable
  username; one failed sub-fetch in the overview `Promise.all` blanks the whole panel
  including still-working game views.

## Deliverables

1. H1: role-gate the game proxy (internal-only roles per the PR's policy layer); the
   authz test suite exercises a NON-privileged role against every proxied route class
   and asserts 403.
2. H2: token decimals come from mint configuration (6 for the live mint), one source of
   truth; a rendered-figure test proves a known raw amount displays correctly; sweep for
   any other hardcoded decimal assumption.
3. Operation safety: `validateReleaseRequest` accepts `WMB_` only; bond forfeit requires
   an explicit typed confirmation; the destination selection resets after every
   operation; audit rows record the immutable actor ID (keep the username as display
   only).
4. Overview resilience: sub-fetches fail independently (no single `Promise.all` gate); a
   503 on one panel renders that panel's error state while the rest, including game
   views, still work.

## Out of scope

CI, dependency audit, search/paging/cross-links (phase 19).

## Validation

`npm test`, `npm run check`, `npm run build`; every deliverable tested, including the
non-privileged-role matrix.

## Reviewers

Generic security lens (role model, proxy surface, audit trail) and correctness lens
(decimals path, confirm flows), both for COVERAGE.

## Acceptance criteria

- [ ] Non-privileged role gets 403 on every internal-only proxied route (test matrix)
- [ ] A known raw token amount renders correctly against the 6-decimal mint; no
      hardcoded 9 remains (grep)
- [ ] `WMS_` ref refused on release; forfeit needs typed confirmation; destination
      resets; audit rows carry actor ID (each tested)
- [ ] Overview with one failing sub-fetch still renders every healthy panel

## Wrap-up

Update progress.md and state.md (in the game worktree; note the dashboard tip). Next
file: `docs/woc-marketplace-hardening/phase-18-qa.md`.
