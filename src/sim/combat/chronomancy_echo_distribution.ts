// Pure concentration maths for Temporal Cascade: both of the ways the ability aims
// its healing at the allies who need it most. `allocateGroupEchoEmergencyBonusRates`
// shares the offensive Echo reserve among low-health marks; `cascadeReliefMultiplier`
// scales the cast's own initial heal by how much health one ally is missing. The
// combat system supplies the health state and applies the results through the normal
// heal paths. No rng or mutable state.

import { TEMPORAL_CASCADE_RELIEF_MAX_BONUS } from '../content/chronomancy_tuning';

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

/**
 * Scale Temporal Cascade's initial heal by the fraction of health the ally is
 * missing: a full-health ally takes the authored roll unchanged (multiplier 1) and
 * an ally at death's door takes `1 + maxBonus` times it, sliding linearly between.
 *
 * This is what lets one button serve both of Cascade's jobs without them competing.
 * Cast as preparation on a healthy group it heals exactly what it always did and the
 * marks are the point; cast into a group that is already low it answers as a real
 * area heal. It also means the extra healing can never be overheal, because it only
 * exists in proportion to health that is actually missing.
 *
 * Draws no rng and reads no clock, so every host resolves the same multiplier.
 */
export function cascadeReliefMultiplier(
  hp: number,
  maxHp: number,
  maxBonus: number = TEMPORAL_CASCADE_RELIEF_MAX_BONUS,
): number {
  if (!(maxHp > 0) || !Number.isFinite(hp)) return 1;
  const healthFraction = Math.max(0, Math.min(1, hp / maxHp));
  return 1 + Math.max(0, maxBonus) * (1 - healthFraction);
}
