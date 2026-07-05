# Findings: feat/woc-liquidity-guardian

## Incident: external worktree reset mid-branch
While building, this worktree's branch was reset by an external actor (reflog
17:12: "reset: moving to feat/woc-lp-fee-share"), wiping in-flight tracked
edits and rebasing the branch onto the fee-share branch. Recovery: mixed reset
back to the branch-1 head (per the task: branch 3 stacks on branch 1),
restored tracked files, removed fee-share leftovers, reapplied all edits. The
external actor's versions of the game.ts/online.ts/types.ts changes (identical
design, Promise.all refresh) and their catalog title values were kept.

## Cosmetic-only proof
- Entity.guardianTier is presentation state: the sim never reads it
  (tests/architecture.test.ts green; tests/parity/trace.ts excludes it like
  holderTier); tests/sim.test.ts determinism suite green (92/92).
- Rewards are titles, badges, aura, board prestige: no stat, drop, or economy
  effect anywhere.

## Anti farm-and-dump (vested cosmetic unlocks)
- 7d seasoning: guardianTierIndex returns 0 until stakedAt is a week old; the
  on-chain program RESETS stakedAt to 0 on full unstake (branch 1), so
  exit-and-reenter restarts the clock.
- Tier follows REMAINING lock (decays exactly like veLP reward weight;
  lockstep pinned by tests/guardian_tier.test.ts against VE_LP_TIERS).

## Gates and fail-closed posture
- guardianFlairConfigured() requires WOC_LP_STAKING_ENABLED=1 + program + mint:
  otherwise zero RPC, tier 0 everywhere, /api/woc/lp/guardian 404s.
- Reader fails closed (RPC error -> tier 0, cached, retry after TTL 2min).
- Leaderboard enrich reads only the DB mirror (no chain), only when configured.

## Test inventory (all green)
- guardian_tier.test.ts 7 (gates, boundaries, lockstep pin)
- lp_guardian.test.ts 5 (config gate, PDA addressing, cache, fail-closed, floor)
- guardian_broadcast.test.ts 4 (gt encode/omit/decode/coexists with ht)
- lp_guardian_db.integration.test.ts 3 (real Postgres join, pool scope, floor)
- Sweep: 231 tests green across guardian + holder + architecture + snapshots +
  S3 i18n guard + leaderboard + player card + branch-1 LP suites; sim
  determinism 92/92; tsc parity (0 new); biome warnings only.
- i18n M16: five non-Latin fills shipped for the new wordy keys; the
  completeness gate's remaining failures are PRE-EXISTING base-branch debt
  (hudChrome.wocSeason.*, from #799), unchanged by this branch.

## Deferred / limits
- No dedicated CSS for .np-guardian / .lb-guardian (they reuse np-tier sizing;
  an artist pass can restyle).
- The guardian badge on nameplates uses direct style writes like the existing
  setNameplateTier (render/ nameplates are outside the PainterHost regime).
- No live-devnet test here: the Position account layout is devnet-proven by
  branch 1; this branch's reader is exercised against stubbed RPC responses.
