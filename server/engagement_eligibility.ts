// Pure eligibility check for the daily spin. The IO (reading the on-chain $WOC
// balance, the antibot verdict, the already-spun-today lookup) happens in the
// caller; this module just applies the rules in a fixed precedence so the logic
// is exhaustively unit-testable. The most fundamental failures are reported
// first (feature off -> no wallet -> unknown balance -> below gate -> antibot ->
// already claimed) so a player always sees the single most actionable reason.

export interface EligibilityInput {
  /** Whether a Solana wallet is linked to the account. */
  walletLinked: boolean;
  /** The wallet's $WOC balance in whole tokens, or null if the RPC read failed. */
  balanceWoc: number | null;
  /** Minimum whole-$WOC required to spin (CONFIG.spinMinWoc). */
  minWoc: number;
  /** Whether the request cleared the turnstile / antibot gate. */
  antibotPassed: boolean;
  /** Whether this account already claimed its spin for the current UTC day. */
  alreadySpunToday: boolean;
}

export type IneligibleReason =
  | 'spin_disabled'
  | 'no_wallet'
  | 'balance_unknown'
  | 'below_min'
  | 'antibot'
  | 'already_spun';

export interface EligibilityResult {
  ok: boolean;
  reason?: IneligibleReason;
}

const deny = (reason: IneligibleReason): EligibilityResult => ({ ok: false, reason });

/**
 * Decide whether `input` is allowed to claim the daily spin. `spinEnabled` is the
 * realm's master flag (CONFIG.spinEnabled). A null balance is treated as
 * ineligible (never as zero or as a pass): a failed RPC read must not silently
 * grant or deny on a guess -- the caller retries, the player sees `balance_unknown`.
 */
export function evaluateEligibility(input: EligibilityInput, spinEnabled: boolean): EligibilityResult {
  if (!spinEnabled) return deny('spin_disabled');
  if (!input.walletLinked) return deny('no_wallet');
  if (input.balanceWoc === null) return deny('balance_unknown');
  if (input.balanceWoc < input.minWoc) return deny('below_min');
  if (!input.antibotPassed) return deny('antibot');
  if (input.alreadySpunToday) return deny('already_spun');
  return { ok: true };
}
