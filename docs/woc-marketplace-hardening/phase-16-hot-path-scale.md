# Phase 16: Server hot-path scale guards

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.39.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix. This file is the phase spec.

- Repo: game. Worktree `/Users/fernando/Documents/wocc-marketplace`, branch `feature/woc-marketplace`.
- Closes: H11.
- review.md: H11.

## Goal

The marketplace cannot take down the realm: every hot read is metered and cached, the
pool cannot be starved, and the sweep cannot camp a connection and lock for an hour.

## Findings context (verified 2026-08-11; re-verify line numbers)

- `server/woc_market_routes.ts:819-862`: five hot GET routes carry no rate limit and no
  cached read (the policy exists in the codebase, unmounted here).
- `/me` fans out six parallel queries into a 10-client pool per request.
- `server/woc_market_proxy.ts:217`: the price cache stores FAILURES for the full TTL
  with no single-flight, so one bad refresh blanks prices for everyone until expiry.
- `server/woc_market_sweep.ts:50-88`: the sweep holds a pool connection plus the
  advisory lock across up to ~50 minutes of chain calls.

## Deliverables

1. The five hot GETs get rate limits and cached reads on the existing seams
   (`server/CLAUDE.md` "Hot paths": cached reads with single-flight and moderation
   busts; viewer-identical reads build once). Cache keys respect realm scoping and
   anti-enumeration (no cross-viewer leak of party-only data).
2. `/me` is bounded: combine or sequence the six queries (build-once readout seam); a
   request cannot hold multiple pool clients concurrently.
3. Price cache: failures are cached briefly or not at all (distinct failure TTL),
   refresh is single-flight, and a stale-while-revalidate read keeps prices rendering
   during a slow refresh (within the oracle staleness policy).
4. Sweep: chain calls run WITHOUT holding a pool connection; the advisory lock is held
   per bounded batch with progress persisted between batches; a duration watchdog logs
   overruns (feeds the phase 03 monitor surface).

Each with a test (rate-limit refusal, cache hit/bust, single-flight, pool-hold bound,
batch release).

## Out of scope

Database indexes and retention (phase 17); service-side oracle behavior (phase 11).

## Validation

`npx tsc --noEmit`; new suites + marketplace suites; `npm run ci:changed`; commit, then
`node scripts/gate_select.mjs`.

## Reviewers

`server-hot-path-reviewer` (the phase's whole surface), `database-performance-reviewer`
(pool behavior), `privacy-security-review` (cache-key scoping), `test-coverage-auditor`.
`qa-checklist` last.

## Acceptance criteria

- [ ] All five GETs metered and cached; burst test proves the limiter and the cache
- [ ] `/me` holds at most one pool client at a time (asserted in a test)
- [ ] A failed price refresh does not blank prices for the failure's TTL; single-flight
      proven under concurrent readers
- [ ] Sweep never holds a pool connection across a chain call; lock released between
      batches; watchdog fires in a test

## Wrap-up

Update progress.md and state.md (cache TTLs, limiter values). Next file:
`docs/woc-marketplace-hardening/phase-16-qa.md`.
