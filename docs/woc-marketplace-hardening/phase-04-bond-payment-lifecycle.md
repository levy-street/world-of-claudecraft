# Phase 04: Bond and payment lifecycle

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.37.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix. This file is the phase spec.

- Repo: game. Worktree `/Users/fernando/Documents/wocc-marketplace`, branch `feature/woc-marketplace`.
- Closes: H4 (payment-loss cluster), H15 (unbounded confirming), and the anti-snipe
  unpaid-bid medium.
- review.md: H4, H15, Medium "Anti-snipe extends on unpaid pending bids".

## Goal

No paid or broadcast payment can ever become untraceable, unclaimed, or eternally
pending: every payment has a ledger trace and a bounded resolution.

## Findings context (verified 2026-08-11; re-verify line numbers)

- H4 (anchors are symbols, not line numbers; the 03 rounds moved the file): the
  `confirmBond` intake in `server/woc_market.ts` checks quote expiry BEFORE the
  signature is recorded (a near-expiry broadcast payment is refused with no ledger
  trace); `refreshBondQuote` overwrites the reference of a paid, awaiting-finality bond;
  the open-bid cancellation (the CASE UPDATE inside `finalizeDeliveredSettlement`,
  `server/woc_market_db.ts`; the old `cancelOpenBidsForListing` helper is gone since 03)
  can drop paid-but-undecided bonds out of the polling set.
- H15: `overdueSettlements` (`server/woc_market_db.ts`) selects only `offered` and
  `failed`; a settlement stuck in `confirming` is polled forever, the escrowed item held
  indefinitely.
- Anti-snipe: `insertPendingBid`'s `extendEndsToMs` arm (`server/woc_market_db.ts`)
  extends the auction end at bid placement, before the bond confirms; multi-account
  griefers with distinct wallets can burn the 30-minute extension cap without ever
  paying.

## Deliverables

1. Signature-first intake: record the submitted signature in the ledger BEFORE any
   expiry refusal; a payment broadcast near expiry lands in a tracked state that the
   poller resolves (complete if it settles within policy, else routed to refund). No
   refusal path may discard a known signature.
2. `refreshBondQuote` CAS: a bond that is paid or awaiting finality keeps its reference;
   refresh applies only to unpaid quotes, enforced atomically.
3. Open-bid cancellation keeps every paid-but-undecided bond in the polling set until it
   reaches refund or forfeit; cancellation never orphans a bond. Since 03 that
   cancellation lives inside `finalizeDeliveredSettlement`'s CASE UPDATE (the standalone
   `cancelOpenBidsForListing` helper no longer exists); the suspend-expiry CTE and the
   demote paths are the other writers to audit.
4. H15: bound the `confirming` age: `overdueSettlements` includes `confirming` past a
   configurable bound; past the bound the settlement enters a defined resolution state
   the ops surface can act on (works with the phase 03 monitor and the phase 09/21
   service-side release tooling). Document the operator semantics in the endpoint.
5. Anti-snipe: only bids with bond progress (paid or confirming) extend the auction end;
   keep the protection for in-flight confirmations; cap behavior unchanged.

Real-SQL tests per deliverable, each failing on the old behavior.

## Out of scope

Service-side release/refund execution (phase 09); quote wire shape (phase 12).

## Validation

`npx tsc --noEmit`; new suites + marketplace server suites against `npm run db:up`;
`npm run ci:changed`; commit, then `node scripts/gate_select.mjs`.

## Reviewers

`privacy-security-review`, `database-performance-reviewer` (polling-set growth, new
predicates), `test-coverage-auditor`. `qa-checklist` last.

## Acceptance criteria

- [ ] Near-expiry broadcast test: signature recorded, payment resolves to completion or
      refund, never silent loss
- [ ] Refresh test: paid/awaiting bond reference survives a refresh attempt
- [ ] Cancel test: a paid-undecided bond still reaches refund after listing cancellation
- [ ] Confirming-age test: an over-bound confirming settlement surfaces as overdue with
      a defined resolution state
- [ ] Anti-snipe test: an unpaid pending bid no longer extends the end; a paid one does

## Wrap-up

Update progress.md and state.md (the confirming bound knob name and default; resolution
state semantics for phases 09, 19, 21). Next file:
`docs/woc-marketplace-hardening/phase-04-qa.md`.
