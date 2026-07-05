# Findings: $WOC LP liquidity layer (combined)

## Combined branch
feat/woc-lp-liquidity-layer = vault (#3) + fee-share (#4) + guardian (#5), stacked on the
current #799 head (fba96f767, on release/v0.22.0). 9 commits over #799. The only combine-time
conflict was an import-ordering merge in server/main.ts (both fee-share and guardian wire into
it); resolved additively. Zero conflict markers; tsc clean.

## Tests (combined branch, post-rebase onto v0.22.0)
- 271 unit/guard tests + 3 skipped green (veLP math incl. adversarial budget-bounding, epoch
  idempotency + concurrent-emit-vs-arena-spend, vesting/forfeit; distributor + drip conservation;
  guardian ladder/seasoning/lockstep + fail-closed reader + gt wire round-trip; the flow_ledger
  invariant; the architecture sim-purity guard; snapshots delta-key registry; S3 i18n guard;
  i18n_completeness now FULLY green - the inherited #799 wocSeason red was fixed upstream).
- 12 real-Postgres integration green (lp_payouts machine, buyback_batches source isolation,
  guardian leaderboard join).
- 92 sim determinism green (same seed same replay; the sim never reads guardianTier).

## Devnet (per-layer, signatures logged in the fork PR comments)
- Vault 5/5 lifecycle: stake 4wErDpDw... / add-stake 5aDbzwwv... / extend 5TdYbsFy... /
  unstake-after-expiry (early refused on-chain) 4SDpJn37... / close 5v5jHGDd... .
- Fee-share 5/5 distribution + drip: open 4NDm7zmB... / fund 2MTN8A8U... / payout+ATA-create
  (over-payout refused InsufficientPool) 2gDtTofS... / one-tx drip-split settle 383Vz7e9... /
  close 3GfiSXNR... .
- Guardian: cosmetic render evidence (screenshot) on the fork PR #5.

## Invariant + purity (the load-bearing checks)
- flow_ledger buy>sell: a concurrent arena payout draining season headroom mid-epoch forces
  budget_exceeded and voids the LP epoch; headroom never overdrawn (adversarial test).
- No second ledger emit at payout: the emission is reserved at accrual; payout is bounded
  independently by the accrual book (guarded paid_base) and the on-chain payout instruction.
- Sim purity: guardianTier is presentation-only; the architecture guard + parity trace exclude it.

## Reviewer checks (carried, not silently resolved)
- WOC_LP_MINT must be a REAL Meteora/DEX pool LP token (not yet wired to a live pool).
- Fee-intake source addresses (DEX pool + treasury feeds) are env placeholders.
- WOC_LP_GUARDIAN_MIN_STAKE_BASE (flair dust floor) is env-tuned per LP mint decimals.
- Leaderboard enrichment joins characters -> wallet_links.pubkey -> lp_positions.owner, i.e.
  it assumes the account's LINKED wallet is the staker; confirm no alt-wallet staking path.
