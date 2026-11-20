import { SMITH_HEART_MOBS } from '../content/smith_heart';
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
/** Abilities this short (taunts, short strikes) reach a big body from its edge. */
export const SHORT_REACH = 10;

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
  // A short-reach ability (a taunt, an 8 yd strike) measures to the body's
  // edge too, or a tank standing where its melee lands could never Goad it
  // (the Guardian of the Heat from its wellspring's lip). Long-range spells
  // keep their authored range. Scoped to the Smith's Heart's bodies: the
  // older dungeons' towering bosses keep the reach they were tuned with.
  if (
    baseRange > MELEE_RANGE &&
    baseRange <= SHORT_REACH &&
    target.kind === 'mob' &&
    SMITH_HEART_MOBS[target.templateId] !== undefined
  ) {
    const r = MOBS[target.templateId]?.bodyRadius;
    if (r !== undefined && r > 0) return baseRange + r + bonus;
  }
  return baseRange + bonus;
}
