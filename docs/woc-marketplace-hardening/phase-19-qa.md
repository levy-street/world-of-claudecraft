# Phase 19 QA: Dashboard as an investigation tool

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/woc-rewards-dashboard-pr13`; verify `pwd` and
`git branch --show-current` (must print `integration/woc-market-trading`). Then
`git fetch origin` and merge `origin/master` so this session starts current. Packet
docs (progress.md, state.md) live in the game worktree
`/Users/fernando/Documents/wocc-marketplace`; commit doc updates there.

Dedicated QA session for phase 19. Canonical QA workflow in `implementation-plan.md`.
Repo: DASHBOARD, worktree `/Users/fernando/Documents/woc-rewards-dashboard-pr13`;
packet docs update in the game worktree.

## What was promised (audit every item)

A CI workflow running the full check set; trading-view tests plus the three data-truth
fixes; a resolved (or explicitly accepted) dependency audit; search, cross-links,
paging, and the custody view.

## Phase-specific probes

- CI honesty: the workflow must FAIL on a seeded test failure (prove it locally by
  breaking a test and running the workflow steps); a workflow that runs but cannot go
  red is decoration.
- `legsReconcile`: check the reconciliation against the service's real leg semantics
  (seller, treasury, burn from phases 09/10); reconciling to the OLD two-way split
  would pass its own test and still be wrong.
- Audit resolution: re-run `npm audit` fresh; upgrades must not break `npm run build`
  (esbuild/astro coupling); confirm no dependency was force-resolved into a version the
  lockfile does not actually install.
- The custody view must render the three stuck classes and handle the game endpoint
  being down (error state, not blank; the phase 18 overview-resilience pattern).
- Paging: check the query actually limits server-side, not client-side slice of an
  unbounded fetch.

## Reviewers

Generic security and correctness subagents on the final diff.

## Exit

Verdict, counts, deferrals. Update progress.md and state.md in the game worktree. Next
file: `docs/woc-marketplace-hardening/phase-20-real-sql-coverage.md`.
