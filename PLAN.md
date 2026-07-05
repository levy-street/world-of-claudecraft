# feat(defi): Liquidity Guardian staker flair (branch 3)

Branch `feat/woc-liquidity-guardian`, stacked on `feat/woc-lp-fee-share` (branch 2)
-> `feat/woc-lp-staking-vault` (branch 1) -> `feat/woc-gamblefi-core` (#799).

## Thesis (utility, not price)
The LP staking vault (branch 1) locks liquidity; branch 3 gives that lock a VISIBLE,
EARNED social payoff so provision is a status people keep, not a yield they flip. A
cosmetic prestige ladder derived from staked LP position weight AND tenure. It never
touches gameplay power and extends the existing #473/#1105 holder-flair pipeline
(same Entity identity-field pattern, same nameplate painter, same refresh loop); it
does NOT add a parallel flair system.

## Anti farm-and-dump (the point)
A Guardian tier needs BOTH a live staked position (weight above the dust floor) AND a
minimum continuous TENURE (`GUARDIAN_SEASONING_SECONDS`, 7d: a position younger than
that shows no flair) plus a REMAINING-lock ladder in lockstep with the veLP reward
tiers. Flash-staking cannot mint the title (tenure), and unstaking drops it on the
next refresh (weight). Cosmetic-only, so zero pay-to-win even at Abyssguard.

## What ships (built + wired)
1. `src/sim/guardian_tier.ts` - PURE shared math: `GUARDIAN_TIER_DEFS` (remaining-lock
   ladder, veLP-lockstep), `GUARDIAN_SEASONING_SECONDS`, `guardianTierIndex(pos, now,
   minStake)`. No IO, no clock; identical on server and client.
2. `server/lp_guardian.ts` - `guardianInfoForPubkey(pubkey)`: reads the woc_lp_vault
   Position over the same raw-fetch RPC seam as holder flair, per-wallet cached,
   fail-closed to tier 0 when unconfigured or on any RPC error.
3. `server/lp_guardian_db.ts` - `guardianTiersForNames(names, pool, minStake, now)`:
   maps character names -> linked wallets -> the lp_positions mirror -> tiers in ONE
   query (zero chain reads); powers the leaderboard decoration.
4. `src/ui/guardian_flair.ts` - client presentation (shield badge data URL, aura
   filter, titles) over the shared core, sibling of `holder_tier.ts`.
5. `src/render/nameplate_painter.ts` - draws the Guardian aura + shield badge on the
   nameplate, gated on `guardianTier`.
6. WIRING (this branch's integration layer):
   - `Entity.guardianTier?` (`src/sim/types.ts`), a cosmetic identity field the sim
     never reads.
   - `server/game.ts`: encoded in `wireEntity` (terse `gt`, identity-rider like `ht`);
     the holder-tier refresh loop now does ONE wallet lookup and sets BOTH flairs.
   - `src/net/online.ts`: decodes `gt` -> `guardianTier` (defaults 0).
   - `server/main.ts`: the lifetime-XP leaderboard is enriched with guardian tiers.
   - `src/ui/i18n.catalog/index.ts`: `wallet.guardianTiers.*` names + titles.

## Fail-closed / invariants
- Rides `WOC_LP_STAKING_ENABLED`: unconfigured -> `guardianInfoForPubkey` returns
  tier 0 with NO RPC -> `guardianTier` never set -> `gt` never on the wire -> painter
  no-ops. No token movement, no keys, no on-chain program of its own.
- `guardianTier` is server-set cosmetic; `src/sim` never reads it (architecture.test
  sim-purity guard passes). No sim logic added -> determinism untouched. Wire lockstep
  covered by snapshots.test + the new guardian_broadcast.test.

## Known draft gate
- `i18n_completeness` M16: the new wordy guardian titles need their 5 non-Latin fills
  at release (same maintainer-fill step as the inherited #799 `wocSeason.*` keys).
  Documented; no logic defect.
