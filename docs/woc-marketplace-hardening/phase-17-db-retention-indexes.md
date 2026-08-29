# Phase 17: Database retention, indexes, and deadlines

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.39.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix. This file is the phase spec.

- Repo: game. Worktree `/Users/fernando/Documents/wocc-marketplace`, branch `feature/woc-marketplace`.
- Closes: the DB scale mediums.
- review.md: Medium "DB scale".

## Goal

Every marketplace table has a retention story, every hot predicate has an index it can
actually use, and no lock wait is unbounded.

## Findings context (verified 2026-08-11)

- `directedOffersForAccount` is polled every 2 seconds per open trade window, cannot use
  its partial indexes (predicate shape mismatch), and seq-scans a never-pruned table.
- `woc_market_directed_offers` and `woc_market_custody_claims` grow forever with no
  retention.
- The `price_desc` browse sort and the FK-cascade columns are unindexed.
- The bid path has no `lock_timeout`.

## Deliverables

1. Fix the `directedOffersForAccount` query shape so its partial indexes apply; verify
   with `EXPLAIN` against the dev database and pin the plan class (index scan, not seq
   scan) in a test comment anchored to the query, not a brittle plan-text assert.
2. Retention sweeps for `woc_market_directed_offers` and `woc_market_custody_claims` on
   the existing retention seam (`server/CLAUDE.md` "Hot paths"): terminal rows age out
   on a documented window; rows the custody ledger still needs (unbooked claims, open
   disputes) are NEVER swept; the phase 03 monitor keeps seeing what it must.
3. Indexes for the `price_desc` browse sort and every FK-cascade column touched by
   marketplace deletes; additive idempotent DDL.
4. `lock_timeout` (and a statement deadline where missing) on the bid and buy-now paths
   so a stuck lock returns a stable retryable error instead of hanging a player request.

## Out of scope

Cached reads and limiters (phase 16); fake-vs-real test parity (phase 20).

## Validation

`npx tsc --noEmit`; real-SQL suites against `npm run db:up` including the EXPLAIN
verification and retention tests; `npm run ci:changed`; commit, then
`node scripts/gate_select.mjs`.

## Reviewers

`database-performance-reviewer` (the whole surface), `migration-safety` (DDL,
retention cannot break save/load or the custody ledger), `test-coverage-auditor`.
`qa-checklist` last.

## Acceptance criteria

- [ ] EXPLAIN shows index usage for `directedOffersForAccount` at realistic row counts
      (seed enough rows that Postgres would prefer the seq scan on the old shape)
- [ ] Retention tests: terminal rows swept after the window; unbooked claims and open
      disputes survive indefinitely
- [ ] New indexes exist after a double boot (idempotent)
- [ ] A held-lock test gets the retryable error within the deadline

## Wrap-up

Update progress.md and state.md (retention windows, deadline values). Next file:
`docs/woc-marketplace-hardening/phase-17-qa.md`.
