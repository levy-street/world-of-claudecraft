# Phase 21: Devnet dry run (the acceptance-bar proof)

SESSION START (do this first in every fresh session): this session spans two
repos. cd into `/Users/fernando/Documents/woc-rewards-service-pr31` (branch must be
`integration/woc-market-settlement`), `git fetch origin`, merge `origin/master`. Then
in `/Users/fernando/Documents/wocc-marketplace` (branch must be
`feature/woc-marketplace`), `git fetch origin`, merge the newest `origin/release/**`
(currently `origin/release/v0.39.0`). Verify `pwd` and the branch before any command
in either repo.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix and the R5 ruling records from phases 09 and 10. This file is the
phase spec. RULING GATE: the devnet mint choice (R5) must be settled with Fernando
before setup.

- Repos: SERVICE (primary; worktree `/Users/fernando/Documents/woc-rewards-service-pr31`)
  plus the game server for the end-to-end legs (worktree
  `/Users/fernando/Documents/wocc-marketplace`).
- Closes: the acceptance-bar devnet items and the PRD-gap testnet dry run.
- review.md: Acceptance bar items 2 and the B3/B4 "confirm on devnet" notes.

## Goal

Prove the whole money path against a real cluster: the full bond cycle with a
double-release balance assert, a full settlement with the burn proven, and the hostile
shapes rejected, all recorded with transaction signatures.

## Safety rails (read before starting)

- DEVNET ONLY. No production or mainnet values anywhere; no secret committed to any
  repo; keys live in local env files that are gitignored (verify before writing them).
- Never set `ALLOW_DEV_COMMANDS=1` outside the local dev realm; nothing in this phase
  touches a production realm or the live database.

## Deliverables

1. Devnet environment: the ruled devnet mint; escrow, treasury, and burn-capable
   wallets; funded fee payer; documented setup steps (a `devnet.md` note in the packet
   dir, torn down with it; durable operator steps go into the phase 22 runbook).
2. Full bond cycle on devnet: quote, charge, confirm, then refund one bond and forfeit
   another; a SECOND release attempt on each asserts balances unchanged (the
   double-release balance assert from the acceptance bar) and the probe-not-resend path
   observed in logs.
3. Full settlement end to end: list an item on the dev realm, execute a directed and a
   public buy-now purchase, pay, verify (the burn instruction proven on-chain per phase
   10), deliver in-game; the fee split lands on the real wallets per policy.
4. Hostile replay: submit a burn-redirect-shaped transaction against the verifier on
   devnet; it must be rejected; record the rejection reason.
5. Record everything in state.md: cluster, mint, wallet pubkeys, every transaction
   signature, and the pass/fail per leg. Any gap found becomes a fix (small) or a
   progress.md deferral (large) before the phase closes.

## Out of scope

Load or performance testing; mainnet anything; production deploys.

## Validation

The recorded evidence IS the validation. Also: both repos' suites still green after any
fix this phase makes (`npm test` in `service/`; targeted vitest + `node
scripts/gate_select.mjs` in the game worktree if game code changed).

## Reviewers

Generic correctness lens over the evidence trail (does the record actually prove each
acceptance-bar item; are the balance asserts before/after correct), plus security lens
if any code changed.

## Acceptance criteria

- [ ] Bond cycle recorded: charge, refund, forfeit signatures; double-release attempts
      provably no-ops with balance asserts
- [ ] Settlement recorded: payment, verified burn, in-game delivery; split correct on
      real wallets
- [ ] Burn-redirect rejected on devnet with the phase 10 reason
- [ ] Zero secrets in any commit (verify with a diff sweep before committing)
- [ ] Evidence table in state.md complete

## Wrap-up

Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-21-qa.md`.
