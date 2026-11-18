// A frontal ward (the Guardian of the Breath's Squall Shieldbearer, the
// Islands of the Wind, docs/design/raid/smith_heart.md 7.2): a body wearing
// FRONT_WARD_AURA turns aside a share of every blow struck from inside its
// front arc. The aura is a quiet marker the encounter lays (kind
// `internal_cd`): `value` the share cut, `value2` the arc's half in degrees.
// Strike its back: the tank turns it away from the raid.
//
// Pure over the two bodies (no rng, no SimContext): combat/damage.ts calls it
// for every hit with a source, after the victim's vulnerabilities.

import type { Entity } from '../types';

/** The ward's aura id (encounters/smith_heart/breath_isle_ids.ts ISLE_AURAS.ward). */
export const FRONT_WARD_AURA = 'heart_breath_squall_ward';

/** Is `source` inside `target`'s front arc of `halfDeg` degrees? */
export function inFrontArc(target: Entity, source: Entity, halfDeg: number): boolean {
  const dx = source.pos.x - target.pos.x;
  const dz = source.pos.z - target.pos.z;
  if (dx * dx + dz * dz < 1e-6) return true;
  const to = Math.atan2(dx, dz);
  let off = Math.abs(to - target.facing) % (Math.PI * 2);
  if (off > Math.PI) off = Math.PI * 2 - off;
  return off <= (halfDeg * Math.PI) / 180;
}

/** `amount` after `target`'s frontal ward against a blow from `source`. */
export function frontWardAmount(target: Entity, source: Entity, amount: number): number {
  if (amount <= 0 || source === target) return amount;
  const a = target.auras.find((x) => x.id === FRONT_WARD_AURA);
  if (!a || a.value <= 0) return amount;
  if (!inFrontArc(target, source, a.value2 ?? 60)) return amount;
  return Math.round(amount * (1 - Math.min(1, a.value)));
}
