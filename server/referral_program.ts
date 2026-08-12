// Refer-a-friend program rules: the pure, host-agnostic core (docs/prd/refer-a-friend.md).
//
// This module owns the program's decisions as data-in, data-out functions a Vitest
// imports directly: the config surface (env keys with defaults, parsed once through
// loadReferralProgramConfig), referral-code generation and shape validation, the
// referrer eligibility gate, and the caps. No DB or HTTP import lives here; the SQL
// boundary is server/referrals_db.ts and the redemption shell is
// server/referral_redemption.ts.
//
// Config note: this is a domain feature-config getter (the sanctioned read-own-env
// shape, like server/discord.ts), not a Config field in server/http/config.ts. Keys
// are TRIMMED before parsing: for every knob here a whitespace-derived 0 would be
// fail-dangerous (0 disables a gate or a cap), so whitespace reads as unset and the
// default applies, while an explicit 0 stays a live value.

/** Everything the program reads from env, resolved once with defaults. */
export interface ReferralProgramConfig {
  /** Referrer account must be at least this many days old (0 disables the gate). */
  minAccountAgeDays: number;
  /** Referrer must own a character at this level or above (0 disables the gate). */
  minLevel: number;
  /** Most pending/active referrals one referrer can hold at once (0 disables the cap). */
  maxActiveReferrals: number;
  /** Completed referrals that count toward rewards inside one season window. */
  seasonReferralCap: number;
  /** Days in the rolling season window the cap counts over. */
  seasonDays: number;
  /** XP multiplier applied to both characters while the bond is active. */
  bondXpMultiplier: number;
  /** The referred character level at which the bond permanently ends. */
  bondEndLevel: number;
  /** Referred-character levels that fire a milestone (ascending). */
  milestoneLevels: readonly number[];
  /** Completed-referral counts that unlock a ladder tier (ascending). */
  tierThresholds: readonly number[];
  /** Summon-friend teleport cooldown in seconds. */
  summonCooldownSeconds: number;
}

export const DEFAULT_REFERRER_MIN_ACCOUNT_AGE_DAYS = 7;
export const DEFAULT_REFERRER_MIN_LEVEL = 20;
export const DEFAULT_MAX_ACTIVE_REFERRALS = 10;
export const DEFAULT_SEASON_REFERRAL_CAP = 5;
export const DEFAULT_REFERRAL_SEASON_DAYS = 90;
export const DEFAULT_BOND_XP_MULTIPLIER = 2;
export const DEFAULT_BOND_END_LEVEL = 20;
export const DEFAULT_REFERRAL_MILESTONE_LEVELS: readonly number[] = [10, 20];
export const DEFAULT_REFERRAL_TIER_THRESHOLDS: readonly number[] = [1, 3, 5];
export const DEFAULT_SUMMON_FRIEND_COOLDOWN_SECONDS = 1800;

// Trimmed numberOr: unset, whitespace, or garbage falls to the default; an
// explicit finite value (including 0) is honored.
function numberOr(value: string | undefined, fallback: number): number {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === '') return fallback;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : fallback;
}

// Comma-separated ascending positive integer list, else the default. A garbage
// entry rejects the whole value (a half-parsed ladder is worse than the default).
function numberListOr(value: string | undefined, fallback: readonly number[]): readonly number[] {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === '') return fallback;
  const parts = trimmed.split(',').map((p) => Number(p.trim()));
  if (parts.length === 0) return fallback;
  for (let i = 0; i < parts.length; i++) {
    const n = parts[i];
    if (!Number.isInteger(n) || n <= 0) return fallback;
    if (i > 0 && n <= parts[i - 1]) return fallback;
  }
  return parts;
}

/** Pure function of its env argument; never reads global process.env itself. */
export function loadReferralProgramConfig(env: NodeJS.ProcessEnv): ReferralProgramConfig {
  return Object.freeze({
    minAccountAgeDays: numberOr(
      env.REFERRER_MIN_ACCOUNT_AGE_DAYS,
      DEFAULT_REFERRER_MIN_ACCOUNT_AGE_DAYS,
    ),
    minLevel: numberOr(env.REFERRER_MIN_LEVEL, DEFAULT_REFERRER_MIN_LEVEL),
    maxActiveReferrals: numberOr(env.MAX_ACTIVE_REFERRALS, DEFAULT_MAX_ACTIVE_REFERRALS),
    seasonReferralCap: numberOr(env.SEASON_REFERRAL_CAP, DEFAULT_SEASON_REFERRAL_CAP),
    seasonDays: numberOr(env.REFERRAL_SEASON_DAYS, DEFAULT_REFERRAL_SEASON_DAYS),
    bondXpMultiplier: numberOr(env.BOND_XP_MULTIPLIER, DEFAULT_BOND_XP_MULTIPLIER),
    bondEndLevel: numberOr(env.BOND_END_LEVEL, DEFAULT_BOND_END_LEVEL),
    milestoneLevels: numberListOr(env.REFERRAL_MILESTONE_LEVELS, DEFAULT_REFERRAL_MILESTONE_LEVELS),
    tierThresholds: numberListOr(env.REFERRAL_TIER_THRESHOLDS, DEFAULT_REFERRAL_TIER_THRESHOLDS),
    summonCooldownSeconds: numberOr(
      env.SUMMON_FRIEND_COOLDOWN_SECONDS,
      DEFAULT_SUMMON_FRIEND_COOLDOWN_SECONDS,
    ),
  });
}

let memoizedConfig: ReferralProgramConfig | null = null;

/** The process-wide config, read from process.env once on first use. */
export function referralProgramConfig(): ReferralProgramConfig {
  if (memoizedConfig === null) memoizedConfig = loadReferralProgramConfig(process.env);
  return memoizedConfig;
}

/** Reset the memo so a test can vary env (test-only). */
export function resetReferralProgramConfigForTests(): void {
  memoizedConfig = null;
}

// ── Referral codes ─────────────────────────────────────────────────────────
// Codes share the ?ref= channel with player-card slugs, so they must fit the
// client's slug shape (/^[a-z0-9][a-z0-9-]{0,63}$/ in src/main.ts). The alphabet
// drops the confusable characters (0/o, 1/l/i) so a code survives being read
// aloud; 8 characters over 31 symbols is ~8.5e11 combinations, so mint-time
// collisions are retried, never worked around.
export const REFERRAL_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const REFERRAL_CODE_LENGTH = 8;

/** Generate one candidate code; rng is injected ((): number in [0,1)) for tests. */
export function generateReferralCode(rng: () => number): string {
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += REFERRAL_CODE_ALPHABET[Math.floor(rng() * REFERRAL_CODE_ALPHABET.length)];
  }
  return code;
}

/** The exact shape a stored code has (a strict subset of the card-slug shape). */
export function isValidReferralCodeShape(value: string): boolean {
  if (value.length !== REFERRAL_CODE_LENGTH) return false;
  for (const ch of value) {
    if (!REFERRAL_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

// ── Referrer eligibility ───────────────────────────────────────────────────

/** The account facts the eligibility gate reads (one SQL round trip). */
export interface ReferrerFacts {
  accountAgeDays: number;
  maxCharacterLevel: number;
  /** Referrals currently pending or active (the live cap denominator). */
  activeReferrals: number;
  /** Referrals completed inside the current season window. */
  completedThisSeason: number;
}

export type ReferrerIneligibleReason = 'account_too_new' | 'level_too_low';

export interface ReferrerEligibility {
  eligible: boolean;
  reasons: ReferrerIneligibleReason[];
}

/** May this account hold a referral code at all? */
export function referrerEligibility(
  facts: Pick<ReferrerFacts, 'accountAgeDays' | 'maxCharacterLevel'>,
  cfg: ReferralProgramConfig,
): ReferrerEligibility {
  const reasons: ReferrerIneligibleReason[] = [];
  if (cfg.minAccountAgeDays > 0 && facts.accountAgeDays < cfg.minAccountAgeDays) {
    reasons.push('account_too_new');
  }
  if (cfg.minLevel > 0 && facts.maxCharacterLevel < cfg.minLevel) {
    reasons.push('level_too_low');
  }
  return { eligible: reasons.length === 0, reasons };
}

/** May this referrer's code accept ANOTHER redemption right now? */
export function canAcceptRedemption(activeReferrals: number, cfg: ReferralProgramConfig): boolean {
  if (cfg.maxActiveReferrals <= 0) return true;
  return activeReferrals < cfg.maxActiveReferrals;
}

/**
 * Does a NEWLY completed referral still count toward the reward ladder this
 * season? Past the cap a completion still records (the graph stays truthful)
 * but grants nothing, which is the diminishing-to-zero arm the PRD asks for.
 */
export function completionCountsForRewards(
  completedThisSeason: number,
  cfg: ReferralProgramConfig,
): boolean {
  if (cfg.seasonReferralCap <= 0) return true;
  return completedThisSeason < cfg.seasonReferralCap;
}

/** The highest ladder tier (1-based index into tierThresholds) a count unlocks; 0 = none. */
export function ladderTierForCount(completedCount: number, cfg: ReferralProgramConfig): number {
  let tier = 0;
  for (let i = 0; i < cfg.tierThresholds.length; i++) {
    if (completedCount >= cfg.tierThresholds[i]) tier = i + 1;
  }
  return tier;
}
