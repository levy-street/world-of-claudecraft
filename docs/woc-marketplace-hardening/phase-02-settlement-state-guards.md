# Phase 02: Settlement-aware listing state guards

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.37.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix. This file is the phase spec.

- Repo: game. Worktree `/Users/fernando/Documents/wocc-marketplace`, branch `feature/woc-marketplace`.
- Closes: B1, H9, the B2a index groundwork, and the UNIQUE(listing_id) sale invariant.
- review.md: B1, B2(a) index clause, H9, Medium "No UNIQUE(listing_id) invariant".

## Goal

Make the listing lifecycle settlement-aware so no cancel, suspend, reclaim, or concurrent
close can ever race a live payment into an item dupe, a double charge, or a stranded bond.

## Findings context (verified 2026-08-11; re-verify line numbers)

- B1: `server/woc_market_db.ts:1019` `cancelListingIfUnbid` guards only `status='active'`
  and open bids; a buy-now settlement lives in separate columns and never changes listing
  status, so a seller cancel (or `server/woc_market.ts:1537` `adminSuspendListing`)
  during offered/confirming/confirmed mails the item back while the chain settles and
  `deliverOne` mails the same snapshot to the buyer: dupe plus double credit.
- B2a groundwork: `delivered` is excluded from both the live-settlement partial unique
  index and `liveSettlementForListing`, so a delivered-but-not-closed listing is
  invisible to the liveness checks.
- H9: `server/woc_market.ts:1614` + `woc_market_db.ts:1158`: buy-now racing an auction
  close marks the standing bid `won` with no settlement created; the held bond never
  routes to refund.

## Deliverables

1. `cancelListingIfUnbid` and `adminSuspendListing` refuse (atomically, in SQL, not
   read-then-act) whenever the buy-now lock is claimed or a live settlement exists in ANY
   non-terminal state (offered, confirming, confirmed, delivering, delivered). Admin
   suspend against a live settlement takes a defined safe path: block with a clear error,
   or mark suspend-pending and apply it only after the settlement resolves. A refused
   cancel returns a stable error code the UI can render (English catalog key if new).
2. Include `delivered` in the live-settlement unique index and
   `liveSettlementForListing` (additive DDL: create the corrected index, drop the stale
   one, idempotent).
3. H9: resolve the buy-now vs auction-close race atomically: exactly one winner; the
   loser's bond enters the refund pipeline; no bid may sit `won` without a settlement.
4. Partial `UNIQUE(listing_id)` on the sales table (additive, idempotent DDL) so a second
   sale row for one listing fails closed at the database.

Every deliverable ships a REAL-SQL test (Postgres via `npm run db:up`, interleaved
transactions to simulate each race) that fails on the old behavior. Fake-db parity
updates are secondary, never the only coverage.

## Out of scope

Delivery finalization atomicity and the reconcile arm (phase 03); bond quote lifecycle
(phase 04); directed-rail rules (phase 06).

## Validation

`npx tsc --noEmit`; the new real-SQL suites plus the existing marketplace server suites;
`npm run ci:changed`; commit, then `node scripts/gate_select.mjs`.

## Reviewers

`privacy-security-review`, `migration-safety` (the index swap and new constraint),
`database-performance-reviewer` (index shape, lock behavior of the atomic guards),
`test-coverage-auditor` (the race tests are the deliverable). `qa-checklist` last.

## Acceptance criteria

- [ ] The B1 race test: cancel issued mid-confirming settlement either kills the
      settlement before payment or refuses; never both mail-back and delivery
- [ ] Suspend during a live settlement takes the defined safe path, tested
- [ ] A delivered-but-unclosed listing is refused by cancel/reclaim/re-auction paths
- [ ] H9 race test: one winner, loser bond refunded, no settlement-less `won` bid
- [ ] Duplicate sale insert for one listing fails at the constraint, tested
- [ ] All DDL additive and idempotent (re-boot applies cleanly twice)

## Wrap-up

Update progress.md and state.md (new error codes, index names, table constraints for
later phases). Next file: `docs/woc-marketplace-hardening/phase-02-qa.md`.
