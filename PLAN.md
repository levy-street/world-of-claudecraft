# feat(defi): $WOC LP liquidity layer (combined)

One combined branch for the whole LP flywheel, stacked on #799 (feat/woc-gamblefi-core:
flow_ledger + reward seasons + woc_escrow), targeting release/v0.22.0. It combines three
independently-reviewable layers (each was a separate fork PR: #3 vault, #4 fee-share,
#5 guardian):

1. LP staking vault (#3, foundation) - solana/programs/woc_lp_vault: non-custodial
   per-position LP vaults; init_pool/open_position/stake/extend_lock/unstake/close_position/
   set_paused. Monotone locks; unstake never gated. Server: pure veLP math, epoch runner
   reserving emissions THROUGH #799's flow_ledger (bounded by verified inflows, buy>sell),
   Postgres mirror, non-custodial tx builders.
2. LP fee-share + buyback drip (#4, stacks on 1) - distribution encoders on woc_escrow_client,
   LP fee keeper (fund_distribution settle, lp_fee_revenue inflow), buyback drip
   (WOC_LP_BUYBACK_DRIP_BPS, splitDrip capped 50%), lp_payouts distributor paying vested
   accruals (NO second ledger emit: the emission was reserved at accrual).
3. Liquidity Guardian flair (#5, stacks on 1 in parallel with 2) - cosmetic-only prestige
   ladder (wire key gt) extending the #473/#1105 holder-flair pipeline; 7d seasoning +
   veLP-lockstep ladder so it cannot be farm-and-dumped; shield badge/aura, card title,
   leaderboard prestige. The sim never reads it.

## Fail-closed
All token rails OFF by default: WOC_LP_STAKING_ENABLED / WOC_LP_FEE_SHARE_ENABLED unset ->
services null, server byte-identical. Emissions additionally need WOC_LP_EMISSION_RATE_BASE>0.
Half-configs throw at boot. No keys committed.

## Blockers (all external)
#799 must land upstream first; treasury/season keys + legal for the live rails; a real
Meteora/DEX pool LP mint + real fee-source addresses.
