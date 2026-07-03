// Pure blocker-wall math for the map editor: the erase hit test (nearest
// segment to a click point) and the point-to-segment distance it rides on.
// No DOM, no Three, no i18n; Vitest drives it directly
// (tests/editor_blocker_core.test.ts). The segment LENGTH rules (min length,
// max-length truncation) live in src/sim/map_doc.ts clampBlockerSegment, the
// one implementation the sanitizer and the editor drag preview share.

import type { BlockerDef } from '../sim/types';

/** Erase hit tests use this pick slack (yards) around a blocker line. */
export const BLOCKER_ERASE_THRESHOLD = 2;

/** Distance from point (x, z) to the segment (x1, z1)-(x2, z2). */
export function pointSegmentDistance(
  x: number,
  z: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-12) return Math.hypot(x - x1, z - z1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / len2));
  return Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t));
}

/**
 * Erase hit test for blocker walls: the index of the NEAREST blocker whose
 * segment passes within `threshold` yards of the click point, or -1.
 */
export function nearestBlockerIndex(
  blockers: readonly BlockerDef[],
  x: number,
  z: number,
  threshold: number = BLOCKER_ERASE_THRESHOLD,
): number {
  let best = -1;
  let bestD = threshold;
  for (let i = 0; i < blockers.length; i++) {
    const b = blockers[i];
    const d = pointSegmentDistance(x, z, b.x1, b.z1, b.x2, b.z2);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}
