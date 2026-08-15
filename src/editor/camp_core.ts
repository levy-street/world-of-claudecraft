// Pure camp-placement math for the map editor: the click-to-select hit test
// and the cap-aware decision for whether a click on empty ground should
// append a new spawn camp. No DOM, no Three, no i18n; Vitest drives it
// directly (tests/editor_camp_core.test.ts).

import type { CampDef } from '../sim/types';

/** A camp selects on click if the click lands within max(this floor, its own radius). */
export const CAMP_SELECT_RADIUS_FLOOR = 4;

/** The radius/count a freshly-placed camp starts with. */
export const CAMP_DEFAULT_RADIUS = 10;
export const CAMP_DEFAULT_COUNT = 3;

/** Index of the NEAREST camp whose select-radius contains (x, z), or -1. */
export function nearestCampIndex(camps: readonly CampDef[], x: number, z: number): number {
  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < camps.length; i++) {
    const c = camps[i];
    const dx = x - c.center.x;
    const dz = z - c.center.z;
    const d = Math.hypot(dx, dz);
    if (d <= Math.max(CAMP_SELECT_RADIUS_FLOOR, c.radius) && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/** A freshly-placed camp at (x, z), with the app's authored defaults. */
export function newCampAt(x: number, z: number, mobId: string): CampDef {
  return { mobId, center: { x, z }, radius: CAMP_DEFAULT_RADIUS, count: CAMP_DEFAULT_COUNT };
}

export type CampClickResult =
  | { kind: 'select'; index: number }
  | { kind: 'capped' }
  | { kind: 'add'; camp: CampDef };

/**
 * The full camp-tool click decision: select the nearest existing camp under
 * the cursor; otherwise, on empty ground, refuse a new camp once the
 * document already holds `cap` of them (the same cap-check-plus-toast
 * pattern terrainEdits/placements/blockers use in app.ts) or hand back a new
 * camp to append. The shared sanitizer (src/sim/map_doc.ts) truncates the
 * camps array at MAX_CAMPS on load, so an unchecked append here would
 * silently lose camps the author thought they had saved.
 */
export function resolveCampClick(
  camps: readonly CampDef[],
  x: number,
  z: number,
  mobId: string,
  cap: number,
): CampClickResult {
  const hit = nearestCampIndex(camps, x, z);
  if (hit >= 0) return { kind: 'select', index: hit };
  if (camps.length >= cap) return { kind: 'capped' };
  return { kind: 'add', camp: newCampAt(x, z, mobId) };
}
