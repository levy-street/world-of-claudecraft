# Phase 03: Delivery finalization exactly-once

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.37.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix. This file is the phase spec.

- Repo: game. Worktree `/Users/fernando/Documents/wocc-marketplace`, branch `feature/woc-marketplace`.
- Closes: B2a, B2b, B2c, and the stuck-custody monitor medium.
- review.md: B2, Medium "Stuck custody has no monitor".

## Goal

Make delivery finalization exactly-once under every crash and throw: the failure
direction is always "visible and stuck", never duplicated, never destroyed, and stuck
states have a consumer that surfaces them.

## Findings context (verified 2026-08-11; re-verify line numbers)

- `server/woc_market.ts:1799 / :1839 / :1886 / :1906`: deliver, transition('delivered'),
  insertSale, closeListing, markItemDisposed, bond refund run as separately committed
  statements.
- B2a: a crash after `delivered` but before `closeListing` leaves the listing reopenable;
  the reclaim arm re-auctions or returns an already-delivered item (phase 02 made the
  liveness checks see `delivered`; this phase completes the forward path).
- B2b: `handToBuyer` mails a second copy when the character save merely throws (for
  example pool exhaustion) while the live in-memory grant persists on the next autosave.
- B2c: `bookCustodyOnce` treats ANY existing claim row as booked without reading
  `booked_at`; a kill between the claim insert and the durable mail write completes the
  settlement with the item destroyed (buyer paid, nothing delivered).
- Nothing reads the `booked_at IS NULL` index; no metric or endpoint surfaces stuck
  `delivering` settlements or closed-undisposed listings.

## Deliverables

1. Finalization is transactional where it is all database work: `delivered` transition,
   `insertSale`, `closeListing`, `markItemDisposed` commit together (one transaction) or,
   where a non-database step sits between, a reconcile arm drives any partially
   finalized settlement FORWARD to completion (never back to reopen). The sweep re-run
   converges to exactly-once for every crash point.
2. B2b: `handToBuyer` distinguishes a lease-fence rejection (another writer owns the
   character: abort, no mail) from a transient save throw (retry the SAME custody ref,
   idempotently: at most one mail ever exists per custody ref, enforced in SQL).
3. B2c: `bookCustodyOnce` consults `booked_at`; an unbooked claim resumes the durable
   write instead of being adopted as complete. A kill at any point between claim insert
   and mail write leaves a resumable, visible state.
4. Stuck-custody monitor: a module that reads unbooked claims (`booked_at IS NULL`),
   stuck `delivering` settlements, and closed-undisposed listings; exposed as an
   internal-secret-gated ops `RouteDef` endpoint (registered in `server/http/registry.ts`,
   never inline) plus a periodic log metric. Phase 19 gives it a dashboard view.

Every crash point gets a REAL-SQL test: kill between each adjacent pair of steps, re-run
the sweep, assert exactly one delivery, one sale row, listing closed, item disposed once.

## Out of scope

Bond quote lifecycle (phase 04); the dashboard view of the monitor (phase 19); listing
state guards (done in phase 02).

## Validation

`npx tsc --noEmit`; the new crash-point suites plus existing marketplace server suites
against `npm run db:up`; `npm run ci:changed`; commit, then `node scripts/gate_select.mjs`.

## Reviewers

`privacy-security-review`, `migration-safety` (any DDL), `database-performance-reviewer`
(transaction scope, sweep cost), `server-hot-path-reviewer` (the monitor is a new
recurring read; it must use the cached-read seam), `test-coverage-auditor`.
`qa-checklist` last.

## Acceptance criteria

- [ ] Crash-point matrix test: every interleaving converges to exactly-once delivery
- [ ] Save-throw test: a throwing save never produces a second mail; lease fence aborts
- [ ] Unbooked-claim test: kill before mail write, sweep resumes and delivers exactly once
- [ ] Monitor endpoint returns the three stuck classes; a seeded stuck row appears
- [ ] The monitor uses the cached-read seam and adds no per-tick work

## Wrap-up

Update progress.md and state.md (monitor endpoint path + shape for phase 19; reconcile
semantics for phase 21). Next file: `docs/woc-marketplace-hardening/phase-03-qa.md`.
