import { VARKHUL_BOSS_ID } from '../ignivar_raid_ids';
import { IGNIVAR_BOSS_ID, MELEE_RANGE } from '../types';
import { feralMeleeReachBonus, type MeleeReachActor } from './feral_reach';

export const RAID_BOSS_PLAYER_MELEE_RANGE = 8;

interface AttackTarget {
  kind: string;
  templateId: string;
}

/** Gives player melee attacks room for the authored size of both raid bosses,
 *  then adds whatever extra reach the ATTACKER carries (combat/feral_reach.ts:
 *  a feral druid reaches one yard further with every melee attack). The
 *  attacker is optional so a caller that has no actor to offer keeps the old
 *  answer exactly; omitting it never changes a range. */
export function effectivePlayerAttackRange(
  target: AttackTarget,
  authoredRange: number,
  attacker?: MeleeReachActor | null,
): number {
  const baseRange = authoredRange > 0 ? authoredRange : MELEE_RANGE;
  const bonus = feralMeleeReachBonus(attacker, authoredRange);
  if (
    baseRange <= MELEE_RANGE &&
    target.kind === 'mob' &&
    (target.templateId === IGNIVAR_BOSS_ID || target.templateId === VARKHUL_BOSS_ID)
  ) {
    return RAID_BOSS_PLAYER_MELEE_RANGE + bonus;
  }
  return baseRange + bonus;
}
