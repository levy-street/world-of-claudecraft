# Findings: feat/woc-lp-staking-vault

## Base-branch decision (deviation worth knowing about)
The task said "base: release/v0.17.0 (where the economy core lives)" AND "route
through #799's flow_ledger". Those conflict: flow_ledger is NOT on
origin/release/v0.17.0; it lives on the #799 head (feat/woc-gamblefi-core,
local 412678e89, itself cut from the v0.17.0 fork point 7c353ba97 and labeled
"release/v0.17.0 rebase"). Branched off feat/woc-gamblefi-core, the same way
the other economy PRs stack. This PR must land after #799.

## Devnet facts
- woc_lp_vault program id: 9zSKCSDmcTBYc9VSyeDmSn55Hz2gNwS6JAtHGPQ1LRe6
  deploy sig: 4RuCHR2QYJDngSAmxuud2dE1rneN4kwQm1tDgfeNfQ9BZH3KMP2S3rcuXxSQu1cUsArzf66wXSnrUmtfZeh7wc1B
  upgrade authority: 3P9m... (WOC_ESCROW_UPGRADE_AUTHORITY), funder HBabiEx3 (22.8 SOL before deploy).
- Mock devnet LP mint (6 decimals): 4PuMWqSzfJxfWvMZFC4fQoFUjzLdob6791Cx2z68GyWF
  (mint authority = deployer keypair). Devnet staker keypair /tmp/lp_staker.json
  (Ca4VkJ7BReTrjnSi1438znwchuFMktefsd46VBHqPjMB), funded 0.05 SOL + 1000 LP.
- Build: RUSTUP_TOOLCHAIN=1.85.0 anchor build --no-idl from solana/ (worked with
  this worktree's committed Cargo.lock; the realm-escrow lock differs by hash
  but was not needed).

## Devnet lifecycle proof (5/5 green, WOC_DEVNET_TEST=1, 2026-07-05)
- stake (open_position + stake, 60s lock): 3fhFsqyaPFRwFv6d4VzoMYDd1H2227nhnnsoyBBBVQPpB3VqN86uN8yZvYubJP6bJi9jFMNDXJiX5VNKp2MgFpxL
- stakeMore (lock 0, monotone locked_until held): 5VTDz18Ny5yisQ3mEmMJKp5ZR8eLWik5M7RDFv7msXAsFrpmb4GPpGUbZCM8cWoJ6ZeJYnVrZfgyhPtYhjuxqtDn
- extend_lock (+90s, shorter re-lock refused): 3mWmPhG9NYSsNz9EfahPGcuXe3qNpxZysvfsoSKvbzb4i21KphCmDzSeA4fLFD8d6bkcsgM4BZp76uYBMuiWxCLX
- unstake (full, after expiry; early attempt refused on-chain): 4TyP6k6MveGrnYRizLiQkop5naX2LFsm9gNChREj9ztNzdvf1vq9VMfMUfQFaZMZQNZS7w9jFbPFBUz5i1yfEJ4H
- close_position (vault + position rent reclaimed): 2EgzGS4CG2wkDSiZf8AvHUSY155cCJGvnhKwwhoou4zfX5szNM3ATcA7Brr2eZSYAoC4d6MuH1X1AFgeHU4p4LiJ
- Note: confirmations poll getSignatureStatus over HTTP; conn.confirmTransaction
  resolves rpc-websockets' browser build under vitest and crashes on missing
  window (the arena devnet tests predate this dep resolution and would hit it
  too on a fresh install).

## Design decisions (why, for the reviewer)
- Reward payment is NOT in the program and NOT in this branch. The program only
  custodies LP principal (per-position PDA vaults). Accrual reserves headroom
  through FlowLedger.emit (source lp_emission, synthetic sig
  lp_epoch:<pool>:<epoch>); paying vested accruals is the stacked fee-share
  branch, via the existing distribution escrow. One emission system, ever.
- Forfeit ordering: addForfeit (book) BEFORE creditInflow (recycle). A crash
  between them under-credits headroom (conservative); the reverse order could
  let a full claim ride on top of a recycled credit (over-emission).
- Unstake works while paused; pause gates deposits/extensions only. Principal
  exit is never gated, including by the flag: the flag kills the SERVICE
  (accrual, routes), not the on-chain program.
- Weight decays with REMAINING lock (ve-style), floor 1x. Multiplier tiers:
  drift 1x / ripple 30d 1.5x / tide 90d 2x / undertow 180d 3x / maelstrom 360d 5x.
- lockedUntil is monotone on-chain (stake and extend_lock can only push later),
  so added deposits inherit the longest lock; devnet test pins this.
- Number(lockedUntil) in the mirror: unix seconds fit a double until year
  285e6; safe.

## Watch out (deferred / known limits)
- getProgramAccounts per epoch scales linearly with staker count; fine to tens
  of thousands. Past that, switch to event-driven mirroring.
- Unstake-then-restake INSIDE one epoch window is invisible to the mirror diff
  (chain snapshot only at epoch boundaries): a staker could dodge the forfeit
  by exiting and re-entering between two snapshots ONLY if they restake the
  same amount before the next epoch; their lock resets to whatever they chose,
  and their vested rewards were already theirs. The forfeit is a decay
  incentive, not a security boundary; the ledger invariant never depends on it.
- lp_positions.locked_until stored as BIGINT epoch seconds (not timestamptz):
  matches the on-chain i64 and avoids tz conversion drift.
- The internal /internal/woc/lp/epoch endpoint serializes bigints to strings in
  main.ts (EpochRunResult carries bigints; JSON.stringify would throw).
- woc_reward_pools table (flow_ledger_db) is unused by this branch, as it is
  by the base branch.

## Test inventory (all passing as of writing)
- tests/lp_vault_client.test.ts (encoders/decoders vs lib.rs): 17
- tests/lp_staking.test.ts (pure math + adversarial bounds): 19
- tests/lp_staking_service.test.ts (epoch runner w/ fakes: invariant,
  idempotency, crash recovery, concurrency, forfeits): 14
- tests/lp_staking_routes.test.ts (HTTP validation): 7
- tests/lp_staking_boot.test.ts (fail-closed gate): 4 (with pg mocked)
- tests/lp_vault.devnet.test.ts (live devnet, WOC_DEVNET_TEST=1): 5
- Regressions green: flow_ledger, payout_keeper, arena_wager_service,
  arena_escrow, woc_escrow_client (131 tests total in the combined run).
- tsc --noEmit: 177 errors, identical count to base branch (pre-existing
  uninstalled-optional-dep noise: svelte, vitest/browser, axe-core); zero in
  changed files. Biome ci on changed files: warnings only, no errors.
