# Phase 10 QA: Chain verifier proves the burn

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/woc-rewards-service-pr31`; verify `pwd` and
`git branch --show-current` (must print `integration/woc-market-settlement`). Then
`git fetch origin` and merge `origin/master` so this session starts current. Packet
docs (progress.md, state.md) live in the game worktree
`/Users/fernando/Documents/wocc-marketplace`; commit doc updates there.

Dedicated QA session for phase 10. Canonical QA workflow in `implementation-plan.md`.
Repo: SERVICE, worktree `/Users/fernando/Documents/woc-rewards-service-pr31` (code in
`service/`); packet docs update in the game worktree.

## What was promised (audit every item)

Burn instruction (or supply-decrease) proof for the exact mint and amount; unexplained
credits rejected; commitment/timeout per ruling; the four hostile fixtures failing with
distinct reasons.

## Phase-specific probes

- Adversarial fixture hunt: think past the four shipped vectors. A burn of the right
  amount but wrong mint decimals; a burn split across two instructions; an inner
  instruction (CPI) burn the outer parse misses; a credit to the seller ABOVE the
  expected amount (fee-refund laundering); a transaction with two settlements batched.
  Each must fail or be provably out of scope; report what the verifier does for each.
- The amount comparison must be exact integer token units, not floating point, not
  cents-converted.
- Legitimate-pass regression: the correct-settlement fixture must reflect a REAL wallet
  transaction shape (ATA creation, compute budget instructions present), or the verifier
  will reject production traffic (the fail-closed failure mode: market halts).
- Confirm distinct machine-readable failure reasons surface to the ops rail.

## Reviewers

Generic security and correctness subagents; one fresh agent dedicated to inventing new
hostile fixtures (coverage, not filtering).

## Exit

Verdict, counts, deferrals. Update progress.md and state.md in the game worktree. Next
file: `docs/woc-marketplace-hardening/phase-11-oracle-health.md`.
