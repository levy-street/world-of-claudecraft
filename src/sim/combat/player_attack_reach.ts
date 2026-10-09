import { MOBS } from '../data';
import { VARKHUL_BOSS_ID } from '../ignivar_raid_ids';
import { IGNIVAR_BOSS_ID, MELEE_RANGE } from '../types';
import { feralMeleeReachBonus, type MeleeReachActor } from './feral_reach';

export const RAID_BOSS_PLAYER_MELEE_RANGE = 8;
/** The Buried Hoard bosses are big bodies too: their own swing reaches a player
 *  the player's could not reach back (playtest). */
export const HOARD_BOSS_PLAYER_MELEE_RANGE = 7;
/** A player's melee reaches a big body from this far past its bodyRadius. */
export const BODY_EDGE_MELEE_REACH = 3;

/** The melee reach a player has against a mob template that authors a
 *  bodyRadius (the towering dungeon bosses), or 0 when it authors none. */
export function bodyEdgeMeleeRange(templateId: string): number {
  const r = MOBS[templateId]?.bodyRadius;
  return r !== undefined && r > 0 ? r + BODY_EDGE_MELEE_REACH : 0;
}

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
  if (
    baseRange <= MELEE_RANGE &&
    target.kind === 'mob' &&
    target.templateId.startsWith('rift_boss_')
  ) {
    return HOARD_BOSS_PLAYER_MELEE_RANGE + bonus;
  }
  // A towering boss: melee reaches the edge of its body, not its pivot.
  if (baseRange <= MELEE_RANGE && target.kind === 'mob') {
    const edge = bodyEdgeMeleeRange(target.templateId);
    if (edge > baseRange) return edge + bonus;
  }
  return baseRange + bonus;
}
