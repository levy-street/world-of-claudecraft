# Phase 10: Chain verifier proves the burn

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/woc-rewards-service-pr31`; verify `pwd` and
`git branch --show-current` (must print `integration/woc-market-settlement`). Then
`git fetch origin` and merge `origin/master` so this session starts current. Packet
docs (progress.md, state.md) live in the game worktree
`/Users/fernando/Documents/wocc-marketplace`; commit doc updates there.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix and ruling R5. This file is the phase spec. Propose the R5 defaults
this phase needs (verifier commitment level, confirming timeout) to Fernando at session
start.

- Repo: SERVICE. Worktree `/Users/fernando/Documents/woc-rewards-service-pr31`, branch
  `integration/woc-market-settlement`. Code in `service/`.
- Closes: B4.
- review.md: B4, PRD gap "verifier commitment level and confirming timeout".

## Goal

Settlement verification proves the transaction did exactly what the quote promised:
seller credit, treasury credit, a REAL burn of the expected amount, and nothing else.

## Findings context (verified 2026-08-11; re-verify line numbers)

- B4 at `service/src/market/solana_chain.ts:230`: verification checks the expected
  seller and treasury credits and the payer's TOTAL debit (which includes the claimed
  burn amount), but does not prove an actual SPL Token burn or supply decrease and does
  not reject an unexpected third-party credit. Because the total debit matches, the burn
  portion can be redirected to an attacker wallet while verification passes.

## Deliverables

1. Burn proof: the verifier validates an actual SPL Token burn instruction (or an
   equivalent verified supply decrease) for the expected mint and exact expected amount.
2. Credit whitelist: any credit in the settlement transaction that is not the expected
   seller or treasury credit (or a protocol-required rent/fee mechanic explicitly
   modeled) fails verification; the attacker-redirect shape is rejected.
3. Commitment level and confirming timeout set per the R5 ruling, applied consistently
   between the verifier and the polling path (this pairs with the game-side H15 bound
   from phase 04; note the agreed values in state.md for phase 21).
4. Fixture-based test vectors: a correct settlement passes; a burn-redirect variant, a
   short-burn variant, an extra-credit variant, and a wrong-mint variant each fail with
   distinct reasons. (Real devnet replay happens in phase 21.)

## Out of scope

Releaser changes (phase 09); oracle (phase 11); running anything against a live cluster
(phase 21).

## Validation

In `service/`: `npm run build`, `npm test`.

## Reviewers

Generic security lens (verification completeness against hostile transaction shapes) and
correctness lens, both for COVERAGE.

## Acceptance criteria

- [ ] Burn-redirect fixture fails; total-debit-matches is no longer sufficient
- [ ] Short burn, extra credit, and wrong mint each fail with distinct stable reasons
- [ ] Correct settlement (and legitimate rent/fee mechanics) still pass
- [ ] Commitment level and timeout recorded in state.md per ruling

## Wrap-up

Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-10-qa.md`.
