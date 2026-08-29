# Phase 08 QA: Service auth hardening

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/woc-rewards-service-pr31`; verify `pwd` and
`git branch --show-current` (must print `integration/woc-market-settlement`). Then
`git fetch origin` and merge `origin/master` so this session starts current. Packet
docs (progress.md, state.md) live in the game worktree
`/Users/fernando/Documents/wocc-marketplace`; commit doc updates there.

Dedicated QA session for phase 08. Canonical QA workflow in `implementation-plan.md`.
Repo: SERVICE, worktree `/Users/fernando/Documents/woc-rewards-service-pr31` (code in
`service/`); packet docs update in the game worktree.

## What was promised (audit every item)

Single early path normalization covering every gate; constant-time length-guarded secret
compares with deny-on-unset; fail-closed dev-chain and DATABASE_URL boot refusals; the
compose default fix; tests for all of it.

## Phase-specific probes

- Sweep the ENTIRE request pipeline for any remaining raw-URL comparison (grep for
  strict equality against url/pathname strings); one leftover gate is BLOCKING.
- Try bypass variants beyond the plain query string: trailing slash, duplicate slashes,
  percent-encoding, case, fragments; each must hit the same authorization tier.
  Normalization must happen before ALL tiers, not per-gate.
- Timing safety: comparison must not short-circuit on length; verify the length guard
  does not itself leak by early-returning differently for known-length secrets.
- Fail-closed tests must assert the REFUSAL, not just absence of the dev chain.
- Confirm no behavior change for legitimately authorized requests (existing suite green;
  413 tests at review time).

## Reviewers

Generic security and correctness subagents on the final diff (coverage, not filtering).

## Exit

Verdict, counts, deferrals. Update progress.md and state.md in the game worktree. Next
file: `docs/woc-marketplace-hardening/phase-09-bond-releaser.md`.
