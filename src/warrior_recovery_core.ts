import { ABILITIES } from './sim/data';
import type { SimEvent } from './sim/types';
export const WARRIOR_RECOVERY_SAMPLE = 'impact_warrior_blood_recovery';
export function isBloodlettingRecovery(event: Extract<SimEvent, { type: 'heal2' }>): boolean {
  return (
    !event.cueOnly &&
    event.sourceId === event.targetId &&
    (event.abilityId
      ? event.abilityId === 'bloodthirst'
      : event.ability === ABILITIES.bloodthirst.name)
  );
}
/** undefined leaves unrelated heals alone; null deliberately silences a
 * Bloodletting event with no effective health restored. */
export function warriorRecoveryAudio(
  event: Extract<SimEvent, { type: 'heal2' }>,
): string | null | undefined {
  if (!isBloodlettingRecovery(event)) return undefined;
  return Number.isFinite(event.amount) && event.amount > 0 ? WARRIOR_RECOVERY_SAMPLE : null;
}
