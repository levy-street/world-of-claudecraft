# Phase 09: The bond releaser (build it, crash-safe)

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/woc-rewards-service-pr31`; verify `pwd` and
`git branch --show-current` (must print `integration/woc-market-settlement`). Then
`git fetch origin` and merge `origin/master` so this session starts current. Packet
docs (progress.md, state.md) live in the game worktree
`/Users/fernando/Documents/wocc-marketplace`; commit doc updates there.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix. Ruling R2 is RESOLVED (Fernando, 2026-08-11): forfeited bonds follow
the PRD treasury+burn split. The R5 items this phase needs (SOL fee funding and monitor,
ATA rent on refund) are still open: propose defaults to Fernando at session start.

- Repo: SERVICE. Worktree `/Users/fernando/Documents/woc-rewards-service-pr31`, branch
  `integration/woc-market-settlement`. Code in `service/`.
- Closes: B3, the bond double-pay medium, the bond-cents ownership mediums.
- review.md: B3, Mediums "Bond release double-pay", "Service bond-quote trusts the
  caller's usdCents", "Bond size computed in the game", "Fee split diverges; forfeits
  skip the burn".

## Goal

A production bond releaser exists, releases exactly once under crash and concurrency,
and the service is the single owner of bond amounts and the fee/forfeit split.

## Findings context (verified 2026-08-11; re-verify line numbers)

- B3: `service/src/market/bootstrap.ts:299` parses `WOC_MARKET_ESCROW_JSON` only to check
  its pubkey, then discards it; `service/src/market/service.ts:470` resolves
  `overrides.releaser ?? dev?.releaser`; `solana_chain.ts` ships only a builder and
  verifier. In any non-dev deployment `refundBond` / `forfeitBond` return
  `release_not_wired` forever: bonds are charged and can never be returned.
- Double-pay at `service.ts:473`: release is read-check-act with a blind last-write-wins
  update and no CAS; crash-retry or concurrent refund+forfeit can pay one bond twice.
- `routes.ts:97` passes `body.usdCents` straight to `bondQuote` (the game owns the bond
  amount on the wire); the game clamps `bondCents` while the service uses pure bps ceil
  (drift); the dev economy computes the fee split two ways; forfeits route 100% to the
  treasury against the PRD's treasury+burn split.

## Deliverables

1. Build the releaser: parse `WOC_MARKET_ESCROW_JSON` into a signer and wire a real SPL
   transfer sender for escrow releases; production bootstrap constructs it
   all-or-nothing (escrow configured but releaser unbuildable refuses to boot);
   `release_not_wired` is unreachable in a correctly configured deployment.
2. Crash-safe, concurrent-safe protocol (the chain-wiring doc's spec): persist the
   release intent BEFORE broadcast; CAS the bond status into `releasing` before send (a
   loser of the CAS does nothing); on retry, probe the chain by reference/memo before
   any re-send; concurrent refund+forfeit resolves to exactly one payment. Tests
   simulate crash-after-persist, crash-after-broadcast, double-submit, and
   refund-vs-forfeit races (fake chain, deterministic).
3. Amount ownership: the service recomputes bond cents from its own `bondBps` policy and
   rejects a drifting caller `usdCents`; one clamp policy, service-owned, and the game
   informed via the quote response (game-side render-only change lands in phase 12 if
   needed; note it in state.md). Unify the fee-split computation to one code path.
4. Forfeit destination per the resolved R2 ruling: the PRD treasury+burn split, one
   code path shared with the settlement fee split. The R5 operational items (fee-payer
   SOL funding with a balance monitor hook, the ATA-rent-on-refund policy) implemented
   as ruled at session start and recorded in state.md.

## Out of scope

Burn verification (phase 10); devnet execution (phase 21; everything here runs against
the fake chain deterministically).

## Validation

In `service/`: `npm run build`, `npm test`; the release protocol suite covers every
crash point named above.

## Reviewers

Generic security lens (exactly-once money movement, signer handling, no secret logging)
and correctness lens (protocol states, CAS coverage), both for COVERAGE.

## Acceptance criteria

- [ ] Configured deployment builds a live releaser; misconfiguration refuses boot
- [ ] Release protocol tests: exactly one payment across crash-retry, double-submit,
      and refund-vs-forfeit races; probe-before-resend proven
- [ ] Service-recomputed bond cents; drifting caller amount rejected (tested); one fee
      split code path
- [ ] Forfeit split implemented per R2; R5 decisions recorded in state.md
- [ ] Escrow secret never logged, never serialized into errors

## Wrap-up

Update progress.md and state.md (protocol states, knob names, ruling outcomes). Next
file: `docs/woc-marketplace-hardening/phase-09-qa.md`.
