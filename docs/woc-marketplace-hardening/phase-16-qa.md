# Phase 16 QA: Server hot-path scale guards

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.39.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Dedicated QA session for phase 16. Canonical QA workflow in `implementation-plan.md`.
Repo: game, worktree `/Users/fernando/Documents/wocc-marketplace`.

## What was promised (audit every item)

Metered cached reads on the five GETs with correct scoping; bounded `/me`; a price cache
that does not cache failures and single-flights; a sweep that never camps the pool or
lock; tests for each.

## Phase-specific probes

- Cache correctness over speed: for each cached read, ask what mutation must BUST it
  (listing created/cancelled/settled, moderation action) and verify the bust exists;
  a stale-forever cache on a money surface is worse than no cache.
- Cache-key audit: viewer-scoped data (own bids, directed offers) must never share a
  key with public reads; probe with two sessions in a test.
- Rate limits must not starve the legitimate UI polling cadence (the 2s directed-offer
  poll phase 17 addresses): check the limiter values against the real client cadence.
- Sweep re-entrancy: with the lock released between batches, prove two sweep instances
  cannot double-process a batch (the advisory lock or a claimed-batch predicate must
  still exclude).
- Pool-hold assertion: the test must count held clients, not just pass functionally.

## Reviewers

`server-hot-path-reviewer`, `database-performance-reviewer`, `test-coverage-auditor`;
`qa-checklist` last.

## Exit

Verdict, counts, deferrals. Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-17-db-retention-indexes.md`.
