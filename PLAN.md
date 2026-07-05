# feat(defi): Liquidity Guardian staker flair

Branch: feat/woc-liquidity-guardian, stacked on feat/woc-lp-staking-vault
(branch 1; parallel to the fee-share branch). COSMETIC ONLY, no gameplay power,
and rail-gated: every read is tier 0 and RPC-free unless the LP staking rail
(WOC_LP_STAKING_ENABLED + program + mint) is configured.

## What this branch ships
1. src/sim/guardian_tier.ts: pure shared ladder. Tier 1-5 (Wader, Tidewatcher,
   Currentkeeper, Stormwarden, Abyssguard) by REMAINING lock, in pinned
   LOCKSTEP with the veLP reward tiers; two anti farm-and-dump gates: a
   configurable stake dust floor and a 7-day SEASONING window (a fresh
   position shows nothing, so flash-stake-and-dump earns no flair).
2. server/lp_guardian.ts: cached per-wallet Position reader over the raw-RPC
   seam (mirrors woc_balance.ts), fail-closed to tier 0 on any failure.
3. Identity pipeline: Entity.guardianTier -> wire key gt (game.ts, riding the
   holder-tier refresh, one wallet lookup for both flairs) -> online.ts decode
   (extends the #473/#1105 pattern; no parallel flair system).
4. Nameplate (extends #1105): a SHIELD badge (visually distinct from the
   holder disc) + tier-coloured aura glow, cheap-diffed like the holder badge.
5. Player card (extends #473): a cosmetic TITLE line under the header
   subtitle in the rung's colour; guardian tier flows main.ts wallet refresh
   -> wallet_balance store -> hud card builder (verified linked wallet only).
6. Leaderboard prestige: LeaderboardEntry.guardianTier, enriched at cache
   refresh from ONE lp_positions-mirror JOIN (characters -> wallet_links ->
   mirror; zero chain reads; lp_guardian_db.ts), shield badge in the rows.
7. REST: GET /api/woc/lp/guardian?owner= (rate-limited, 404 while dark).
8. i18n: wallet.guardianTierTitle + 5x name/title keys, with the five
   non-Latin fills (M16) in the same change.
