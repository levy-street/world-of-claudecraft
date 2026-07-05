# FINDINGS: feat/woc-liquidity-guardian

## What is real and how verified
- Cosmetic flair end to end: pure ladder (src/sim/guardian_tier.ts) + server RPC
  reader (server/lp_guardian.ts) + wire (Entity.guardianTier, gt encode/decode) +
  nameplate render (nameplate_painter.ts) + leaderboard decoration (lp_guardian_db).
- Verified: 119 tests green across guardian_tier / lp_guardian / guardian_broadcast
  (wire round-trip: gt encodes on snap.self, decodes to guardianTier, omitted -> 0,
  rides alongside ht) / architecture (sim purity: guardianTier not read by src/sim) /
  snapshots + bandwidth (wire lockstep) / lp_guardian_db.integration (real Postgres,
  floor + wrong-pool + tier boundaries). tsc clean, biome clean.

## No on-chain program of its own
Branch 3 adds NO Solana program. It READS branch 1's woc_lp_vault Position accounts
(via the same solanaRpc seam holder flair uses) and the lp_positions mirror. So there
is no branch-3 devnet deploy or signatures: the on-chain surface is branch 1's,
already devnet-proven there.

## Fail-closed proof
guardianFlairConfigured() = false unless WOC_LP_STAKING_ENABLED=1 AND the program id
and LP mint are valid addresses. Off -> guardianInfoForPubkey returns {tier:0} with
NO RPC issued -> guardianTier never set -> gt never on the wire -> painter no-ops.
Server runs byte-identically to before when the LP layer is off.

## Cosmetic-only proof
guardianTier is an Entity identity field set ONLY by the server; the sim never reads
it (architecture.test.ts sim-purity scan passes). No gameplay system consults it.

## Known blocked / assumptions a reviewer must check
- M16 i18n: the wordy guardian titles need 5 non-Latin fills at release (maintainer),
  same deferred step as the inherited #799 wocSeason keys. The only red gate; not a
  logic defect.
- WOC_LP_GUARDIAN_MIN_STAKE_BASE (flair dust floor) is pool-specific and env-tuned;
  default 1 base unit. A reviewer should set it to a sensible floor for the real LP
  mint decimals so a dust position does not earn Wader.
- The leaderboard enrichment assumes wallet_links.pubkey matches the vault Position
  owner (the account's linked Solana wallet is the staker). True for the intended
  flow; a reviewer should confirm no alt-wallet staking path breaks that assumption.
- Seasoning is 7d and the ladder is veLP-lockstep by REMAINING lock; both are design
  choices a reviewer may want to tune before enabling.
