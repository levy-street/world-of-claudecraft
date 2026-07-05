// Central config for the daily-engagement loop: the holder spinner, pack
// ripping, and daily tasks. One source of truth for the feature flags, the
// holder gate, the per-realm pay-to-win policy, and the on-chain prize-vault
// parameters. Mirrors woc_config.ts (human-authored env -> validated values) and
// is the only place these env vars are read. Server-only; no SQL, no client
// import.
//
// Parsing is a pure function of an env-like object, so the whole surface is
// unit-testable without mutating the global process.env. The module also binds a
// production singleton (CONFIG) from process.env for normal server use.

/**
 * Per-realm pay-to-win posture for pack contents (see
 * docs/prd/woc/daily-engagement-gacha.md section 7.A). Selected per realm
 * process by PACK_POWER_POLICY, defaulting to the invariant-safe `cosmetic`.
 *   cosmetic - transmog + lateral sidegrades + QoL; real power is mode-scoped.
 *   seasonal - vertical power granted, but only on a non-canonical season realm.
 *   open     - vertical power in the persistent world (degen realm only).
 */
export type PackPowerPolicy = 'cosmetic' | 'seasonal' | 'open';

export const PACK_POWER_POLICIES: readonly PackPowerPolicy[] = ['cosmetic', 'seasonal', 'open'] as const;

/** A power level a pack reward can require; ordered least to most permissive. */
export const POLICY_RANK: Readonly<Record<PackPowerPolicy, number>> = { cosmetic: 0, seasonal: 1, open: 2 };

/** 1 SOL in lamports. */
export const LAMPORTS_PER_SOL = 1_000_000_000n;

export interface EngagementConfig {
  /** Master gate for the daily spinner (off by default, like BUYBACK_ENABLED). */
  spinEnabled: boolean;
  /** Master gate for pack ripping. */
  packsEnabled: boolean;
  /** Minimum whole-$WOC a linked wallet must hold to claim the daily spin. */
  spinMinWoc: number;
  /** Realm pay-to-win posture for pack contents. */
  packPowerPolicy: PackPowerPolicy;
  /** Base58 program id of the deployed woc_spin_vault Anchor program ('' if unset). */
  spinVaultProgramId: string;
  /**
   * Base58 secret of the settler/keeper that signs payout instructions. Holds
   * settle authority only -- the program pins the winner, caps the amount, and
   * replay-guards each spin -- so it never custodies player funds. Store via KMS;
   * never commit. Empty in dev keeps the settler unavailable so settle paths
   * refuse rather than use a bogus key (mirrors BUYBACK_KEEPER_SECRET).
   */
  spinSettlerSecret: string;
  /**
   * Hard per-spin payout ceiling (lamports). The on-chain program enforces its
   * own max_payout; this is the server-side mirror so a misconfigured prize
   * table can never request more than the cap. Default 0.1 SOL.
   */
  spinMaxPayoutLamports: bigint;
  /**
   * Soft daily treasury budget for spin payouts (lamports). Feeds the EV guard
   * and the live odds adapter so the faucet cannot outrun its funding. Default
   * 5 SOL/day.
   */
  spinDailyBudgetLamports: bigint;
}

type Env = Record<string, string | undefined>;

/** Validate + derive the engagement config from an env-like object (pure). */
export function parseEngagementConfig(env: Env): EngagementConfig {
  return {
    spinEnabled: boolEnv(env.SPIN_ENABLED, false),
    packsEnabled: boolEnv(env.PACKS_ENABLED, false),
    spinMinWoc: numEnv(env.SPIN_MIN_WOC, 1000),
    packPowerPolicy: enumEnv(env.PACK_POWER_POLICY, PACK_POWER_POLICIES, 'cosmetic'),
    spinVaultProgramId: (env.SPIN_VAULT_PROGRAM_ID ?? '').trim(),
    spinSettlerSecret: (env.SPIN_SETTLER_SECRET ?? '').trim(),
    spinMaxPayoutLamports: bigintEnv(env.SPIN_MAX_PAYOUT_LAMPORTS, 100_000_000n),
    spinDailyBudgetLamports: bigintEnv(env.SPIN_DAILY_BUDGET_LAMPORTS, 5_000_000_000n),
  };
}

/**
 * True once the spinner can actually settle on-chain (flag on + program id +
 * settler secret all present). Read-only status routes do not require this; only
 * the on-chain settle path does. Pure -- takes the config so it is testable.
 */
export function spinSettleReady(cfg: EngagementConfig): boolean {
  return cfg.spinEnabled && cfg.spinVaultProgramId.length > 0 && cfg.spinSettlerSecret.length > 0;
}

/** Whether a reward gated at `required` policy is grantable under `realm` policy. */
export function policyPermits(realm: PackPowerPolicy, required: PackPowerPolicy): boolean {
  return POLICY_RANK[realm] >= POLICY_RANK[required];
}

/** Convert a human SOL amount to integer lamports (rounded to nearest lamport). */
export function solToLamports(sol: number): bigint {
  if (!Number.isFinite(sol) || sol < 0) return 0n;
  return BigInt(Math.round(sol * Number(LAMPORTS_PER_SOL)));
}

// The production singleton, bound once from the real environment.
export const CONFIG: EngagementConfig = parseEngagementConfig(process.env);

function boolEnv(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined) return dflt;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

function numEnv(v: string | undefined, dflt: number): number {
  if (v === undefined) return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

function enumEnv<T extends string>(v: string | undefined, allowed: readonly T[], dflt: T): T {
  if (v === undefined) return dflt;
  const t = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(t) ? (t as T) : dflt;
}

// BigInt(str) throws on non-numeric input; the digit guard makes the conversion
// total without a try/catch (this is input validation, not a defensive fallback).
function bigintEnv(v: string | undefined, dflt: bigint): bigint {
  if (v === undefined) return dflt;
  const t = v.trim();
  return /^[0-9]+$/.test(t) ? BigInt(t) : dflt;
}
