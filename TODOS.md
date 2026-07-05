# TODOs: feat/woc-lp-fee-share

- [x] Worktree stacked on feat/woc-lp-staking-vault
- [x] woc_escrow_client.ts distribution encoders + distributionPda + ATA idempotent ix
- [x] flow_ledger.ts: lp_fee_revenue + lp_buyback_drip inflows
- [x] payout_db.ts: source filter on openBuybackBatches/lastSettleAt (+ marketplace passes source)
- [x] payout_keeper.ts: drip split in signTerminal + drip credit in onSettled (pure splitDrip)
- [x] lp_fee_keeper.ts: LP fee vault keeper (fund_distribution settle, lp_fee_revenue credit)
- [x] lp_staking_db.ts: lp_payouts table + distributor methods (ownersWithOpenAccruals, payouts state machine, addPaid guard)
- [x] lp_distributor.ts: claim computation + allocation + durable payout machine
- [x] lp_fee_share_boot.ts + main.ts wiring + internal lp/payout ops
- [x] Unit tests (encoders, drip, distributor, keeper coexistence)
- [x] Real-Pg integration (lp_payouts + payout_db filter)
- [x] Devnet distribution lifecycle + drip-split settle w/ sigs
- [x] tsc parity + biome + regression run
- [ ] LARP check + prod readiness + score
- [ ] Commits
