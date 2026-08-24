# Phase 11: Oracle health and honesty

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/woc-rewards-service-pr31`; verify `pwd` and
`git branch --show-current` (must print `integration/woc-market-settlement`). Then
`git fetch origin` and merge `origin/master` so this session starts current. Packet
docs (progress.md, state.md) live in the game worktree
`/Users/fernando/Documents/wocc-marketplace`; commit doc updates there.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix and ruling R3. This file is the phase spec. Ask Fernando for ruling R3
(venue posture) at session start.

- Repo: SERVICE. Worktree `/Users/fernando/Documents/woc-rewards-service-pr31`, branch
  `integration/woc-market-settlement`. Code in `service/`.
- Closes: H3 and the quote-freshness nuance.
- review.md: H3, "Minor Codex nuances" (polling-time freshness), PRD gap "a second real
  oracle venue (or revise the claim)".

## Goal

One oracle instance, honestly warm, honestly fresh, with a venue posture that matches
what the system actually does.

## Findings context (verified 2026-08-11; re-verify line numbers)

- H3 at `service/src/market/bootstrap.ts:340` and `:257`: the heartbeat warms a DIFFERENT
  oracle instance than the one that prices requests, so after quiet periods the price
  gate reports stale and players see false paused windows. The second venue (Pyth) has
  no $WOC feed, so the PRD's cross-venue deviation gate can never fire: in practice one
  venue runs.
- Quote freshness is keyed on polling time rather than venue publication time, so
  freshness looks better than it is.

## Deliverables

1. One shared oracle instance: the heartbeat warms exactly the instance that prices
   requests (constructor injection, no second construction site); test proves a
   heartbeat-warmed oracle prices a request without a stale window after a quiet period.
2. Venue posture per ruling R3: either wire a second REAL venue with a $WOC feed into
   the median/deviation gate, or adopt single-venue posture: remove the dead venue,
   tighten the staleness and deviation bounds to compensate, and update the PRD claim
   (the doc change lands with phase 07's cluster if already done; otherwise here).
3. Freshness keyed on venue publication time, not polling time; the staleness gate and
   the health surface both use it.
4. The health/ops surface reports the true venue count and per-venue freshness so the
   dashboard renders reality (phase 19 consumes it).

## Out of scope

Game-side price-cache behavior (phase 16); dashboard rendering (phase 19).

## Validation

In `service/`: `npm run build`, `npm test`, including a quiet-period warm test and a
publication-time staleness test.

## Reviewers

Generic correctness lens plus a security/ops lens (can the gate be gamed by a stalled
venue; does the health surface overstate freshness), both for COVERAGE.

## Acceptance criteria

- [ ] Exactly one oracle instance constructed in production wiring (asserted in a test
      or boot check); heartbeat and pricing share it
- [ ] Quiet-period test: no false stale/paused window after idle
- [ ] R3 posture implemented; no dead venue code path remains if single-venue
- [ ] Staleness uses publication time; health surface shows per-venue truth

## Wrap-up

Update progress.md and state.md (posture ruling outcome, bound values). Next file:
`docs/woc-marketplace-hardening/phase-11-qa.md`.
