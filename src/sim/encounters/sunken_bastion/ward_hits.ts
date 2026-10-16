// The Sunken Bastion's hittable encounter bodies (the Turnkey's Iron Cage and
// Ossick's Drowned Anchor) are WARDS, the Nythraxis Bone Spike idiom: they take
// HITS, not damage. Their health pool is their points, so the bar reads as the
// hits left, and every damaging hit from a player or a player-owned pet lands a
// fixed number of points whatever it would have dealt (a poke, a crit, a DoT
// tick). Applied at the one damage funnel (combat/damage.ts dealDamage).
// Pure leaf: no rng, no host imports.

import type { Entity } from '../../types';
import { DROWNED_ANCHOR_ID, GAOL_CAGE_ID, TURNKEY_TUNING } from './ids';

/** Points a hit from `source` breaks off a Bastion ward `target`, or null when
 *  the hit is not a ward hit (not a ward, a dead ward, or a wild mob's hit). */
export function bastionWardHitPoints(
  source: Entity | null | undefined,
  target: Entity,
): number | null {
  if (!source || target.kind !== 'mob' || target.dead) return null;
  const helper = source.kind === 'player' || (source.kind === 'mob' && source.ownerId !== null);
  if (!helper) return null;
  if (target.templateId === GAOL_CAGE_ID) return TURNKEY_TUNING.helperPoints;
  if (target.templateId === DROWNED_ANCHOR_ID) return 1;
  return null;
}
