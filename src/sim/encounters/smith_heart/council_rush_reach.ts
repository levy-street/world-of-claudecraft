// Mountain's Rush's reach, the pure rule (docs/design/raid/smith_heart.md
// section 7.1): the Guardian's line runs from its feet through the marked
// player and on to the Quarry's edge, wherever the two stand. The lane the
// raid sees and the path the sim runs both end where the floor ends (the
// pit's rim, the stair's foot), unless a pillar stops it first
// (council_rush.ts `landRush`).
//
// Pure over the authored field: no SimContext, no state, so the renderer
// (council_fx_core.ts `rushLane`) and the bots draw the same line the sim
// runs. Instance-local coordinates. Zero rng.

import { SMITH_HEART_FIELD } from '../../content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../../instances/authored_field';

/** The march's step and its cap (yards): the Quarry is about 92 by 80. */
const STEP = 0.5;
const MAX_REACH = 140;
/** How far inside the rim the Guardian's body stops (its feet never on the
 *  rim's worked edge). */
export const RUSH_EDGE_MARGIN = 1.5;

/** Is an instance-local spot on the Quarry's floor? */
function onFloor(lx: number, lz: number): boolean {
  return authoredFieldSurfaceAt(SMITH_HEART_FIELD, lx, lz)?.id === 'hammer_pit';
}

/** Yards from instance-local (lx, lz) along the unit heading (dirX, dirZ) to
 *  the Quarry's edge, less the body's margin (never below 0). A start off
 *  the floor reaches nowhere. */
export function rushReach(lx: number, lz: number, dirX: number, dirZ: number): number {
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-9 || !onFloor(lx, lz)) return 0;
  const ux = dirX / len;
  const uz = dirZ / len;
  let inside = 0;
  for (let d = STEP; d <= MAX_REACH; d += STEP) {
    if (!onFloor(lx + ux * d, lz + uz * d)) break;
    inside = d;
  }
  return Math.max(0, inside - RUSH_EDGE_MARGIN);
}
