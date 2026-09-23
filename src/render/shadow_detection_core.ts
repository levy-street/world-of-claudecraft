import type { WorldQuestProgress } from '../sim/types';

export const SHADOW_RING_SEGMENTS = 40;

export function shadowDetectionVisible(
  progress: WorldQuestProgress | undefined,
  dead: boolean,
): boolean {
  return !dead && progress?.state === 'active' && progress.shadow?.phase === 'cloaked';
}

/** Conform a circular strip to the actual ground without changing its gameplay radius.
 *  `startAngle` and `sweep` (radians, the sim's facing convention: x = sin, z = cos)
 *  turn the full ring into a lantern wedge; the defaults keep the whole circle. */
export function writeShadowRing(
  positions: Float32Array,
  x: number,
  z: number,
  inner: number,
  outer: number,
  groundAt: (x: number, z: number) => number,
  startAngle = 0,
  sweep = Math.PI * 2,
): void {
  for (let i = 0; i <= SHADOW_RING_SEGMENTS; i++) {
    const angle = startAngle + (i / SHADOW_RING_SEGMENTS) * sweep;
    for (let side = 0; side < 2; side++) {
      const radius = side === 0 ? inner : outer;
      const px = x + Math.sin(angle) * radius;
      const pz = z + Math.cos(angle) * radius;
      const offset = (i * 2 + side) * 3;
      positions[offset] = px;
      positions[offset + 1] = groundAt(px, pz) + 0.09;
      positions[offset + 2] = pz;
    }
  }
}
