// Referral bonus engine (#475 referral program): a player referred via the
// unified referral link gets an XP + gold welcome boost on what they earn for
// their first 30 days, and their referrer earns a smaller commission of those
// same earnings. Both are MINTED server-side (never taken from anyone) and are
// bounded by real play, the 30-day window, and the existing bot detection.
//
// This module is PURE: it touches no DB, no clock, no sim. The server reads the
// referee's monotonic earned counters (counters.xpGained + counters.lootCopper),
// passes the deltas + window state here, and applies the returned grants via the
// sim's own grant methods. Keeping it pure makes the (fiddly) double-count math
// unit-testable and keeps the deterministic sim + the RL core untouched.

function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  const v = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(v) && v >= min && v <= max ? v : def;
}

// The referred player's first-N-days window. 30 days by default.
export const REFERRAL_BONUS_DAYS = clampInt(process.env.REFERRAL_BONUS_DAYS, 30, 0, 3650);
export const REFERRAL_BONUS_MS = REFERRAL_BONUS_DAYS * 24 * 60 * 60 * 1000;
// The referred player's welcome boost on their own earnings (bps). 1000 = 10%.
export const REFERRAL_REFEREE_BPS = clampInt(process.env.REFERRAL_REFEREE_BPS, 1000, 0, 10000);
// The referrer's commission on their referred players' earnings (bps). 500 = 5%.
export const REFERRAL_REFERRER_BPS = clampInt(process.env.REFERRAL_REFERRER_BPS, 500, 0, 10000);

export interface ReferralBonus {
  refereeXp: number; // welcome boost minted to the referred player
  refereeCopper: number;
  referrerXp: number; // commission accrued to the referrer
  referrerCopper: number;
}

const ZERO: ReferralBonus = { refereeXp: 0, refereeCopper: 0, referrerXp: 0, referrerCopper: 0 };

// The bonus for a chunk of fresh earnings. Outside the window, or with no new
// earnings, nothing. Integer math (XP + copper are whole units); a bps cut floors.
export function computeReferralBonus(deltaXp: number, deltaCopper: number, withinWindow: boolean): ReferralBonus {
  const dx = Math.max(0, Math.floor(deltaXp));
  const dc = Math.max(0, Math.floor(deltaCopper));
  if (!withinWindow || (dx === 0 && dc === 0)) return { ...ZERO };
  return {
    refereeXp: Math.floor((dx * REFERRAL_REFEREE_BPS) / 10000),
    refereeCopper: Math.floor((dc * REFERRAL_REFEREE_BPS) / 10000),
    referrerXp: Math.floor((dx * REFERRAL_REFERRER_BPS) / 10000),
    referrerCopper: Math.floor((dc * REFERRAL_REFERRER_BPS) / 10000),
  };
}

export interface ReferralReconcileInput {
  xpGained: number; // referee's current monotonic counters
  lootCopper: number;
  lastXpGained: number; // last reconciled checkpoint
  lastLootCopper: number;
  withinWindow: boolean;
}

export interface ReferralReconcileResult extends ReferralBonus {
  newLastXpGained: number; // checkpoint to persist after applying the grants
  newLastLootCopper: number;
  applied: boolean; // true when any bonus was produced (caller should persist + grant)
}

// Reconcile a referee's earnings since the last checkpoint into the bonuses to
// apply now. The referee XP boost is granted through the sim's grantXp (which
// re-increments xpGained), so the new XP checkpoint is advanced PAST the granted
// boost to avoid re-counting it next time. The referee copper boost is credited
// to the balance only (it does not touch lootCopper), so the copper checkpoint is
// just the current lootCopper. The referrer accrual never touches the referee.
export function reconcileReferral(i: ReferralReconcileInput): ReferralReconcileResult {
  const dx = Math.max(0, i.xpGained - i.lastXpGained);
  const dc = Math.max(0, i.lootCopper - i.lastLootCopper);
  const bonus = computeReferralBonus(dx, dc, i.withinWindow);
  const applied = bonus.refereeXp > 0 || bonus.refereeCopper > 0 || bonus.referrerXp > 0 || bonus.referrerCopper > 0;
  return {
    ...bonus,
    // even with the window closed (bonus all zero) we advance the checkpoint to
    // the current counters, so a player who crosses the 30-day line mid-session
    // doesn't get a giant retroactive delta if the window ever reopens.
    newLastXpGained: i.xpGained + bonus.refereeXp,
    newLastLootCopper: i.lootCopper,
    applied,
  };
}

// True if `referredAt` is within the bonus window as of `now` (both ms epochs).
export function withinReferralWindow(referredAtMs: number, nowMs: number): boolean {
  return REFERRAL_BONUS_MS > 0 && nowMs - referredAtMs < REFERRAL_BONUS_MS;
}
