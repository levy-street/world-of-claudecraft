# Findings: feat/woc-lp-fee-share

## Devnet lifecycle proof (5/5 green, WOC_DEVNET_TEST=1, 2026-07-05)
On the deployed woc_escrow Fn4LMsV7akGX9KXwYv4uh2v8nM2uqgaAxhKrsYYbZqcJ,
mock $WOC E6r4tqSuQ6VuCa9jpPZMqYHAj1x9GJaKaaXWxrfFsgFx:
- open_distribution: 5RtJabHXmWfbZCaZodQyuV4uQ7mFUavJgEPQFyZCHWytSivUrymKkTGyQEkYjXU8piuKz8yNJVUFC2v2cFVQChHT
- fund_distribution (50 WOC): 4EFmbZNz9FFbGJtfX4vk9LFgv1NFo2W3vRfQNrLCbXtvFVX2AMLBtRHLJ9N5b8tpBvzfP2oZU4Bt9woGoK9D1oUw
- payout (20 WOC to a wallet with NO token account, ATA created idempotently
  in the same tx; a 100 WOC over-payout refused by InsufficientPool):
  3idmvqJMqr3GCyu6oJ8B3yjCn7rvpaRFRnAxMGSNNNV5W1aFbpE5qZMdAVJpfbt3PDnyydCxKccypTukLFFQEZhz
- drip-split settle (ONE tx: burnChecked 7 WOC main + fund_distribution 3 WOC
  drip; supply fell exactly 7, vault rose exactly 3):
  mi8HudUU1VHeH3q6dqce2saszp8yJW3odfa7q3dNuLp59vhyjYGMFc3uPH5i1iP4QTjkVkrrdWK64kBCwVhhcDi
- close_distribution (dust + rent back): 4x2Yaw2b5bQtfdGi3WH6QbottVS6moM4VUkVwgFqUgc2ZL8LDBTMdAMRDBuM144UhkryFHiawgKKvAiAoSegWtLr
Devnet harness: drip vault /tmp/lp_drip_vault.json
(6gJEkR4jS2zrGrKo179bT6NaqXS6wTnq8vdvo6aGogFQ, 300 mock WOC); the mock mint
authority is ~/.config/solana/id.json (AsjVqmBt...).

## Design decisions
- NO ledger emit at payout time: the emission was reserved by the branch-1
  epoch accrual; the distributor only moves already-reserved value. Payments
  are still double-bounded: the accrual book (guarded paid_base) and the
  on-chain payout instruction (funded vault balance).
- The LP fee keeper settles by fund_distribution, not a raw transfer, so the
  on-chain total_funded ceiling moves with the money.
- Both keepers share buyback_batches under a source tag; openBuybackBatches /
  lastSettleAt are now source-scoped and the marketplace wiring passes
  'marketplace' explicitly, so neither keeper can recover the other's batches
  (proven in the Pg integration test).
- One settle can credit two seasons (top_up main + drip): the drip inflow uses
  the suffixed sig <settle>:lpdrip because tx_sig is UNIQUE ledger-wide.
- planClaim / vesting-forfeit race: an in-flight payout can never be
  invalidated by a racing unstake forfeit because forfeits only claw back the
  UNVESTED remainder and vesting is monotone; the confirmLpPayout row guard is
  defense in depth (proven at the SQL level in the integration test).
- Stale broadcasting payouts (past blockhash validity) are marked failed and
  retried fresh; an 'unknown' non-stale payout blocks that owner (no
  concurrent double pay), both fake-proven.

## Watch out / deferred
- Changing WOC_LP_BUYBACK_DRIP_BPS while a settle batch is in flight would make
  the recovery-time ledger credit split differ from the on-chain split of the
  original tx (both recomputed from env). Operational rule: only change drip
  bps with the keeper drained (no open batches).
- The Jupiter swap leg of the LP fee keeper is exercised by the existing
  PayoutKeeper unit suite (fakes), not on devnet (no Jupiter routes for mock
  mints); the on-chain settle leg IS devnet-proven above. Same posture as the
  shipped marketplace keeper.
- envPolicy() knobs (threshold/cadence/TWAP) are shared BUYBACK_* envs for both
  keepers; per-keeper knobs are a follow-up if their cadences must diverge.
- The distributor auto-opens the distribution with the authority as payer;
  first cycle on a fresh season costs the authority ~0.003 SOL rent.

## Test inventory (all passing)
- woc_escrow_distribution.test.ts (encoders vs lib.rs): 6
- lp_drip.test.ts (conservation, cap, rounding): 4
- lp_distributor.test.ts (planClaim + payout machine): 12
- lp_staking_db.integration.test.ts extended: lp_payouts machine, over-pay
  guard, failed release, keeper source isolation (9 total w/ branch-1 cases)
- lp_distribution.devnet.test.ts: 5 live
- Combined regression run: 153 tests green (all LP suites + flow_ledger,
  payout_keeper, arena_wager_service, arena_escrow, woc_escrow_client).
- tsc --noEmit: 0 errors. Biome ci on changed files: warnings only.
