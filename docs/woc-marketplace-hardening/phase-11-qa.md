# Phase 11 QA: Oracle health and honesty

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/woc-rewards-service-pr31`; verify `pwd` and
`git branch --show-current` (must print `integration/woc-market-settlement`). Then
`git fetch origin` and merge `origin/master` so this session starts current. Packet
docs (progress.md, state.md) live in the game worktree
`/Users/fernando/Documents/wocc-marketplace`; commit doc updates there.

Dedicated QA session for phase 11. Canonical QA workflow in `implementation-plan.md`.
Repo: SERVICE, worktree `/Users/fernando/Documents/woc-rewards-service-pr31` (code in
`service/`); packet docs update in the game worktree.

## What was promised (audit every item)

Single shared oracle instance; quiet-period warmth; R3 posture implemented; publication
time freshness; truthful health surface.

## Phase-specific probes

- Grep for EVERY construction site of the oracle class; production wiring must have
  exactly one (test-only constructions are fine and must be clearly test-scoped).
- If single-venue was ruled: the deviation gate must not silently pass on one venue and
  claim cross-venue health; the seven machine-readable unhealthy reasons must still be
  reachable or explicitly retired; check each reason's trigger path.
- Clock discipline: publication-time staleness must handle venue clock skew (a future
  timestamp must not render negative staleness or eternal freshness).
- The TWAP window and deviation caps must still halt trading when the venue goes bad:
  re-run the existing halt tests; a lost halt path is BLOCKING.

## Reviewers

Generic correctness and ops lenses on the final diff.

## Exit

Verdict, counts, deferrals. Update progress.md and state.md in the game worktree. Next
file: `docs/woc-marketplace-hardening/phase-12-wire-completeness.md`.
