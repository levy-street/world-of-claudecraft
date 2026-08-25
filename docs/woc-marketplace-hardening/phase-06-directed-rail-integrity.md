# Phase 06: Directed rail and self-deal integrity

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.37.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix. This file is the phase spec.

- Repo: game. Worktree `/Users/fernando/Documents/wocc-marketplace`, branch `feature/woc-marketplace`.
- Closes: H10, H12, H14, plus the createDirectedOffer guardBalance and directed
  non-payment mediums.
- review.md: H10, H12, H14, Mediums "createDirectedOffer skips the balance plausibility
  guard" and "Directed non-payment leaves the listing active".

## Goal

The directed p2p rail keeps every promise the public rail keeps: the buyer gets exactly
the item they agreed to, holds are bounded, non-payment has consequences, and neither
rail permits a same-wallet self-deal.

## Findings context (verified 2026-08-11; re-verify line numbers)

- H10 at `server/woc_market.ts:1016`: the seller supplies the item only at acceptance; it
  is validated for eligibility but never matched against what the buyer agreed to
  (bait-and-switch).
- H12 at `server/woc_market.ts:915, :1398`, `woc_market_db.ts:807`: a directed sale holds
  the item up to 12 hours instead of the 600s settlement window; a buyer who accepts and
  never pays is not struck; directed listings are exempt from the 12-listing cap
  (accomplice pair can lock unbounded escrow).
- H14: the bid path refuses `sellerWallet === wallet` but `claimBuyNowLock`
  (`woc_market_db.ts:1172`) checks only `seller_account <> buyer_account`: a second
  account on the same verified wallet can buy-now its own listing (wash trading).
- `createDirectedOffer` (`woc_market.ts:937`) skips `guardBalance`; directed non-payment
  leaves the listing active until seller cancel or duration end (denial of use).

## Deliverables

1. H10: the directed offer records the agreed item's identity (instance fingerprint) at
   offer time; acceptance escrows and validates THAT item; any mismatch refuses with a
   stable error code.
2. H12: the directed hold matches the settlement window (600s), not the listing duration;
   an accepting buyer who never pays receives a strike (same strike machinery as the
   public rail); directed listings count against the listing cap (or an explicit
   documented bound; do not leave them uncapped).
3. H14: `claimBuyNowLock` refuses a buyer whose verified wallet equals the seller's
   wallet, in the same atomic claim SQL; assert the equivalent guard on the directed
   accept path; real-SQL tests for both rails.
4. `createDirectedOffer` runs `guardBalance`; a directed settlement that expires unpaid
   auto-closes the listing and returns the item to the seller (no manual cancel needed).

Real-SQL tests per deliverable, failing on old behavior.

## Out of scope

Step-up auth on acceptDirectedOffer (phase 13); seller-side decline/cancel UI (phase 14;
this phase lands any missing server command it needs and notes it in state.md).

## Validation

`npx tsc --noEmit`; new suites + marketplace server suites against `npm run db:up`;
`npm run ci:changed`; commit, then `node scripts/gate_select.mjs`.

## Reviewers

`privacy-security-review`, `database-performance-reviewer` (cap and hold queries),
`test-coverage-auditor`. `qa-checklist` last.

## Acceptance criteria

- [ ] Bait-and-switch test: accepting with a different item (or a re-rolled instance of
      the same id) refuses
- [ ] Hold test: directed escrow releases at settlement-window expiry; strike recorded;
      listing auto-closes and the item returns
- [ ] Wallet-twin tests: same-wallet buy-now AND same-wallet directed accept both refuse
- [ ] Cap test: directed listings cannot exceed the documented bound
- [ ] guardBalance runs on directed offer creation, tested

## Wrap-up

Update progress.md and state.md (fingerprint semantics, strike policy, cap bound, any
new server command for phase 14). Next file:
`docs/woc-marketplace-hardening/phase-06-qa.md`.
