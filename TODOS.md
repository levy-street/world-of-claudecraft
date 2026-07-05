# TODOS: feat/woc-liquidity-guardian

- [x] Reuse the shared holder-flair pipeline (no parallel flair system)
- [x] src/sim/guardian_tier.ts pure ladder + seasoning gate (veLP lockstep)
- [x] server/lp_guardian.ts RPC reader (fail-closed, cached)
- [x] server/lp_guardian_db.ts leaderboard decoration (one query, zero chain reads)
- [x] src/ui/guardian_flair.ts client presentation
- [x] src/render/nameplate_painter.ts aura + badge
- [x] Entity.guardianTier (cosmetic identity field)
- [x] game.ts wireEntity encode (gt) + folded refresh loop (one wallet lookup)
- [x] online.ts decode gt -> guardianTier
- [x] main.ts leaderboard enrichment
- [x] i18n wallet.guardianTiers.* names + titles
- [x] tests: guardian_tier, lp_guardian, guardian_broadcast (wire round-trip),
      lp_guardian_db.integration (real Postgres) all green; architecture + snapshots
      + bandwidth regressions green
- [x] tsc clean, biome clean on changed files
- [ ] M16 non-Latin fills for guardian titles (maintainer at release; same as #799)
