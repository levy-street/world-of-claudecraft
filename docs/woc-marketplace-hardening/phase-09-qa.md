# Phase 09 QA: The bond releaser

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/woc-rewards-service-pr31`; verify `pwd` and
`git branch --show-current` (must print `integration/woc-market-settlement`). Then
`git fetch origin` and merge `origin/master` so this session starts current. Packet
docs (progress.md, state.md) live in the game worktree
`/Users/fernando/Documents/wocc-marketplace`; commit doc updates there.

Dedicated QA session for phase 09. Canonical QA workflow in `implementation-plan.md`.
Repo: SERVICE, worktree `/Users/fernando/Documents/woc-rewards-service-pr31` (code in
`service/`); packet docs update in the game worktree.

## What was promised (audit every item)

A wired production releaser with all-or-nothing boot; the persist/CAS/probe protocol
with exactly-once tests across all named races; service-owned bond cents and one fee
split path; the R2/R5 rulings implemented and recorded.

## Phase-specific probes

- Walk the protocol state machine on paper: for EVERY state, what happens on crash there
  and retry? Any state whose retry can re-broadcast without a probe is BLOCKING.
- The CAS must be a database conditional update whose affected-row count is CHECKED; a
  CAS whose result is ignored is the old bug in new clothes.
- Probe correctness: the probe must match by the idempotency reference/memo, not by
  amount+destination (two equal refunds to one wallet must not alias).
- Secret hygiene: grep the diff for the escrow key reaching logs, errors, or test
  fixtures with real-looking material.
- Amount ownership: send a drifted usdCents in a test; the refusal must be a stable
  error, not silent recompute (silent recompute hides game-side bugs).
- Confirm the game repo was NOT changed from this service session (repo isolation).

## Reviewers

Generic security and correctness subagents on the final diff; a third fresh agent walks
the crash matrix independently.

## Exit

Verdict, counts, deferrals. Update progress.md and state.md in the game worktree. Next
file: `docs/woc-marketplace-hardening/phase-10-chain-verifier.md`.
