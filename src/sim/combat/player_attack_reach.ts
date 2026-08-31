import { VARKHUL_BOSS_ID } from '../ignivar_raid_ids';
import { IGNIVAR_BOSS_ID, MELEE_RANGE } from '../types';

export const RAID_BOSS_PLAYER_MELEE_RANGE = 8;

interface AttackTarget {
  kind: string;
  templateId: string;
}

/** Gives player melee attacks room for the authored size of both raid bosses. */
export function effectivePlayerAttackRange(target: AttackTarget, authoredRange: number): number {
  const baseRange = authoredRange > 0 ? authoredRange : MELEE_RANGE;
  if (
    baseRange <= MELEE_RANGE &&
    target.kind === 'mob' &&
    (target.templateId === IGNIVAR_BOSS_ID || target.templateId === VARKHUL_BOSS_ID)
  ) {
    return RAID_BOSS_PLAYER_MELEE_RANGE;
  }
  return baseRange;
}
