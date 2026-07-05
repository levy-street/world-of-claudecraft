# feat(defi): LP fee-share + buyback drip

Branch: feat/woc-lp-fee-share, stacked on feat/woc-lp-staking-vault (which
stacks on feat/woc-gamblefi-core, #799). Flag OFF, fail-closed, like branch 1.

## What this branch ships
Money IN (funding the LP mining season + its on-chain vault), money OUT
(paying the vested accrual book branch 1 writes). Same one flow ledger.

1. server/woc_escrow_client.ts: the previously omitted distribution encoders
   (open_distribution, fund_distribution, payout, close_distribution) with the
   distribution PDA helper, plus an ATA create-idempotent encoder so a payout
   can land for a wallet with no $WOC account yet. This branch is "the server
   caller" the omission comment waited for.
2. Fee-share intake, server/lp_fee_keeper.ts: a SECOND PayoutKeeper instance
   over the LP fee vault (accrues DEX trading-fee revenue in USDC): swap USDC
   to $WOC on Jupiter (same TWAP/slippage/crash-safe machine, unchanged), then
   settle by fund_distribution into the LP season's woc_escrow distribution
   vault (proper on-chain accounting, total_funded moves) and credit the flow
   ledger inflow lp_fee_revenue (idempotent on the settle sig).
   server/payout_db.ts gains a source filter (openBuybackBatches,
   lastSettleAt) so the marketplace keeper and the LP fee keeper never recover
   each other's batches; the marketplace wiring now passes its own source.
3. Buyback drip, in server/payout_keeper.ts production wiring: when
   WOC_LP_BUYBACK_DRIP_BPS > 0, every marketplace buyback settle splits:
   (amount - drip) burns or tops up exactly as before, drip goes by
   fund_distribution into the LP distribution vault; the post-settle hook
   credits lp_buyback_drip to the LP season under <sig>:lpdrip.
   Drip math is a pure function (splitDrip) so conservation is unit-tested.
4. Payout of vested accruals, server/lp_distributor.ts: keeper-style cycle
   over the branch-1 accrual book. Per claimant: claimable = vested - paid
   (allocated oldest-accrual-first), floored by WOC_LP_PAYOUT_MIN_BASE, capped
   per cycle; signs [create ATA idempotent, payout(season, amount)] with the
   distribution authority key; durable lp_payouts row (allocations JSONB)
   BEFORE broadcast; confirm by HTTP-polled signature; only a confirmed
   payout applies paid_base (guarded UPDATE, can never exceed the accrual).
   Stale broadcasting rows past the blockhash window are marked failed and
   the allocation retries fresh. NO second ledger emit: the emission was
   reserved at accrual time by branch 1; paying it out again through emit
   would double-count. The on-chain payout instruction independently bounds
   payments by the funded vault balance.
5. server/lp_fee_share_boot.ts + main.ts wiring + internal ops
   (/internal/woc/lp/payout force-cycle): WOC_LP_FEE_SHARE_ENABLED !== '1'
   returns null (rail dark); enabled-but-half-configured throws at boot.
   The distributor auto-opens the LP season distribution on first cycle.
6. flow_ledger.ts: inflow sources lp_fee_revenue + lp_buyback_drip.

## Env surface (all default-off / fail-closed)
- WOC_LP_FEE_SHARE_ENABLED=1 master flag; requires WOC_ESCROW_PROGRAM_ID,
  WOC_MINT, WOC_LP_SEASON_ID, WOC_LP_DISTRIBUTION_AUTHORITY_SECRET.
- Fee keeper additionally: WOC_LP_FEE_VAULT + WOC_LP_FEE_VAULT_SECRET (absent:
  fee intake stays dark, distributor can still pay from whatever is funded).
- WOC_LP_BUYBACK_DRIP_BPS (0 default = no drip; capped 5000) on the
  marketplace keeper, requires the escrow program + LP season when set.
- WOC_LP_PAYOUT_MIN_BASE (dust floor), WOC_LP_PAYOUT_MAX_PER_CYCLE,
  WOC_LP_PAYOUT_TICK_MS.

## Tests
- Encoder tests for the four distribution ixs + ATA idempotent (vs lib.rs).
- splitDrip pure conservation tests.
- lp_distributor.test.ts over fakes: allocation order, dust floor, cycle cap,
  crash recovery (confirmed / failed / stale-unknown), no double pay while
  broadcasting, paid guard, vault-balance clamp.
- Keeper coexistence: payout_db source filter (real-Pg integration) +
  fake-store unit proving marketplace recovery ignores lp_fee batches.
- Devnet (WOC_DEVNET_TEST=1): full distribution lifecycle on the deployed
  woc_escrow (open, fund, payout w/ ATA create) + a drip-split settle
  (burn + fund_distribution in one tx). Logged signatures.
