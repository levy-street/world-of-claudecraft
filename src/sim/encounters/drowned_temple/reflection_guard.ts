// The Tideglass Reflection's one rule (G22 mirror reflections, docs/design/
// dungeon-rework/drowned_temple.md 5.2): a Reflection takes NO damage from the
// player it mirrors (or that player's pet), and full damage from everyone
// else. Pure: combat/damage.ts dealDamage asks it before any mitigation, so
// every damage path (swings, spells, ticks, splashes) honours it.

import type { Entity } from '../../types';

/** Is this hit from the Reflection's own owner (or the owner's pet)? */
export function reflectionIgnoresHit(source: Entity | null, target: Entity): boolean {
  const owner = target.mirrorOwnerId;
  if (owner === undefined || !source) return false;
  return source.id === owner || source.ownerId === owner;
}
