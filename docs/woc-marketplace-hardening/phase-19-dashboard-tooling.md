# Phase 19: Dashboard as an investigation tool

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
- Closes: the remaining dashboard mediums (CI, tests, audit vulns, investigation UX,
  data-truth fixes) and the custody-visibility PRD gap.
- review.md: Mediums "Dashboard is not yet an investigation tool" and "Dashboard
  dependency audit"; PRD gap "dashboard visibility of sales/strikes/custody".

## Goal

An operator can actually investigate a dispute: find the trade, follow its links, trust
every number, and see stuck custody, on a dashboard whose own CI proves its security
tests run.

## Findings context (verified 2026-08-11)

- No CI runs the PR's security tests; the 863-line trading view component is untested.
- `npm audit`: 11 vulnerabilities at review time (5 high, 5 moderate, 1 low), including
  an esbuild dev-server advisory and a yaml stack-overflow.
- No search, cross-links, or paging; `legsReconcile` does not reconcile;
  `p2pOutcome` mislabels dead trades; buy-now listings show a wrong price.
- The game side (phase 03) now exposes a stuck-custody monitor endpoint with no
  dashboard consumer yet.

## Deliverables

1. CI: a workflow runs `npm test`, `npm run check`, and `npm run build` on every push
   and PR; the security suites from phase 18 (and PR #13's own) run in it; a red gate
   blocks merge.
2. Tests for the trading view: decimals rendering, release validation, confirm flows,
   outcome labeling; plus fixes with tests for the data-truth bugs (`legsReconcile`
   reconciles the actual legs; `p2pOutcome` labels dead trades correctly; buy-now price
   displays the real price).
3. `npm audit` resolved: upgrade or patch every advisory; anything genuinely
   unresolvable is listed for Fernando with the exposure explained (his call to accept).
4. Investigation UX: search by reference, wallet, account, and listing; cross-links
   between listing, settlement, bond, and account views; paging on every unbounded
   list; a custody view consuming the game's stuck-custody monitor endpoint (unbooked
   claims, stuck delivering, closed-undisposed), so the "visible and stuck" story has a
   consumer.

## Out of scope

New service endpoints (if a view needs one, use what exists or note the gap in
progress.md deferrals); role model changes (phase 18 landed them).

## Validation

`npm test`, `npm run check`, `npm run build`, plus the CI workflow proven green on a
branch push (or `act`-style local run if pushing is not yet approved; note which).

## Reviewers

Generic security lens (the new views respect the phase 18 role gates; the custody view
is internal-only) and correctness lens, both for COVERAGE.

## Acceptance criteria

- [ ] CI workflow exists and runs the full check set including the security suites
- [ ] Trading view test suite covers decimals, validation, confirms, outcomes
- [ ] `npm audit` clean, or the accepted-risk list documented for Fernando
- [ ] Search, cross-links, and paging work; the three data-truth bugs fixed with tests
- [ ] The custody view renders seeded stuck rows from the monitor endpoint

## Wrap-up

Update progress.md and state.md (in the game worktree). Next file:
`docs/woc-marketplace-hardening/phase-19-qa.md`.
