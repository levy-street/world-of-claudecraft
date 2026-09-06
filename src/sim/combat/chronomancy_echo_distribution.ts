// Pure allocation for Temporal Cascade's offensive emergency healing. The combat
// system supplies every living Echo from one Chronomancer, identifies which group
// Echoes fund the pool, and applies the returned bonus rates through the normal Echo
// heal path. No rng or mutable state.

export const GROUP_ECHO_EMERGENCY_HEALTH_THRESHOLD = 0.6;
export const GROUP_ECHO_EMERGENCY_BONUS_PER_MARK_MULT = 1;

export interface GroupEchoDistributionTarget {
  id: number;
  hp: number;
  maxHp: number;
  baseRate: number;
  contributesToPool: boolean;
}

/**
 * Build one bonus-rate pool equal to the summed base rate of every active group
 * Echo, then divide it among marked allies below 60 percent health. Missing-health
 * fractions provide the weights, so the lowest-health ally receives the largest
 * share without letting a tank's larger health pool dominate the allocation.
 */
export function allocateGroupEchoEmergencyBonusRates(
  targets: readonly GroupEchoDistributionTarget[],
): Map<number, number> {
  let poolRate = 0;
  let totalMissingFraction = 0;
  const eligible: { id: number; missingFraction: number }[] = [];

  for (const target of targets) {
    if (target.maxHp <= 0) continue;
    if (target.contributesToPool && target.baseRate > 0) {
      poolRate += target.baseRate * GROUP_ECHO_EMERGENCY_BONUS_PER_MARK_MULT;
    }
    const healthFraction = Math.max(0, Math.min(1, target.hp / target.maxHp));
    if (healthFraction >= GROUP_ECHO_EMERGENCY_HEALTH_THRESHOLD) continue;
    const missingFraction = 1 - healthFraction;
    totalMissingFraction += missingFraction;
    eligible.push({ id: target.id, missingFraction });
  }

  const bonusRates = new Map<number, number>();
  if (poolRate <= 0 || totalMissingFraction <= 0) return bonusRates;
  for (const target of eligible) {
    bonusRates.set(target.id, poolRate * (target.missingFraction / totalMissingFraction));
  }
  return bonusRates;
}
