// The Guardian of the Heat's Rolling Cinder is a WARD (docs/design/raid/
// smith_heart.md section 7.4; the Nythraxis Bone Spike and the Sunken
// Bastion's cage idiom): a player's or a pet's hit lands exactly one point
// whatever it would have dealt (it cannot be killed, only struck back), and
// the encounter reads that point lost as the hit that knocks it back
// (heat_cinders.ts). Applied at the one damage funnel (combat/damage.ts
// dealDamage). Pure leaf: no rng, no host imports.

import type { Entity } from '../../types';
import { HEAT_MOBS } from './heat_ids';

/** Points a hit from `source` lands on a rolling cinder `target`, or null
 *  when `target` is not a living cinder. Only a player's or a pet's
 *  `direct` hit lands its point: a damage-over-time tick, a reflect, a
 *  sourceless or a wild mob's hit lands nothing, so only a real strike
 *  knocks it back and nothing can wear it down. */
export function heatCinderHitPoints(
  source: Entity | null | undefined,
  target: Entity,
  direct: boolean,
): number | null {
  if (target.kind !== 'mob' || target.dead) return null;
  if (target.templateId !== HEAT_MOBS.cinder) return null;
  const helper =
    !!source && (source.kind === 'player' || (source.kind === 'mob' && source.ownerId !== null));
  return helper && direct ? 1 : 0;
}
