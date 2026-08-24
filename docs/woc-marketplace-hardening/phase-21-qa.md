# Phase 21 QA: Devnet dry run

SESSION START (do this first in every fresh session): this session spans two
repos. cd into `/Users/fernando/Documents/woc-rewards-service-pr31` (branch must be
`integration/woc-market-settlement`), `git fetch origin`, merge `origin/master`. Then
in `/Users/fernando/Documents/wocc-marketplace` (branch must be
`feature/woc-marketplace`), `git fetch origin`, merge the newest `origin/release/**`
(currently `origin/release/v0.39.0`). Verify `pwd` and the branch before any command
in either repo.

Dedicated QA session for phase 21. Canonical QA workflow in `implementation-plan.md`.
Repos: SERVICE + game; packet docs in the game worktree.

## What was promised (audit every item)

The recorded devnet evidence: bond cycle with double-release balance asserts, full
settlement with proven burn, hostile-replay rejection, a complete evidence table, zero
committed secrets.

## Phase-specific probes

- Verify the evidence independently: resolve the recorded transaction signatures
  against the devnet cluster (a public explorer or RPC query) and confirm each does
  what the table claims (amounts, wallets, the burn instruction present); an
  unverifiable signature is a FAIL for that leg.
- Balance-assert arithmetic: recompute the before/after balances from the chain data,
  not the log lines.
- Secret sweep: `git log -p` over every commit this phase made in BOTH repos, grep for
  key material shapes (base58 blobs, JSON keypairs); also check the packet's devnet.md
  contains pubkeys only.
- Gap honesty: anything the dry run could not exercise (for example a leg that needs
  production config) must be listed explicitly in state.md, not silently skipped.

## Reviewers

Generic correctness lens on the evidence; security lens on the secret sweep.

## Exit

Verdict, counts, deferrals. Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-22-close-out.md`.
