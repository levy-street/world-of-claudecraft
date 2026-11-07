// The Quench vein dressed with its Blender kit (phase 2H: quench_kit_plan_core.ts
// plans every piece; heart_kit.ts bakes and instances them): the basin's fire
// bowls and vents, the old ice heaped against its walls, the Smith's blades
// sunk in the Frozen Lake, the Singing Ice's blades and cracks, the landings'
// standing stones, the low walls along every Quench walk over the void, the
// frozen falls on the vein's walls and the drifts of snow. Static: every
// matrix is written once at build.
//
// Built only once the kit has landed; before that the layout's placeholders
// stand in (heart_props.ts), and this swaps in for them the moment it lands.

import type * as THREE from 'three';
import {
  ensureHeartKit,
  heartKitLoaded,
  instanceHeartKit,
  SMITH_HEART_QUENCH_KIT_URL,
  upgradeWhenHeartKitLands,
} from './heart_kit';
import { planQuenchKit, QUENCH_KIT_KINDS } from './quench_kit_plan_core';

/** The Quench's culling cell (yards): a landing, the Singing Ice, the basin. */
const QUENCH_CELL = 70;

/** Wait (capped) for the Quench kit before the interior is built. */
export function ensureQuenchKit(): Promise<void> {
  return ensureHeartKit(SMITH_HEART_QUENCH_KIT_URL);
}

/** Has the Quench kit landed? */
export function quenchKitReady(): boolean {
  return heartKitLoaded(SMITH_HEART_QUENCH_KIT_URL);
}

export { QUENCH_KIT_KINDS };

/** The Quench's kit dressing (instance-local). */
export function buildQuenchKit(lowGfx: boolean): THREE.Group {
  return instanceHeartKit(
    SMITH_HEART_QUENCH_KIT_URL,
    planQuenchKit(),
    lowGfx,
    'smithHeartQuenchKit',
    QUENCH_CELL,
  );
}

/** The kit dressing when it has landed; otherwise nothing yet, and the
 *  placeholders in `placeholders` give way to it the moment it lands. */
export function dressQuench(parent: THREE.Group, placeholders: THREE.Group, lowGfx: boolean): void {
  if (quenchKitReady()) {
    parent.add(buildQuenchKit(lowGfx));
    return;
  }
  upgradeWhenHeartKitLands(SMITH_HEART_QUENCH_KIT_URL, placeholders, () => buildQuenchKit(lowGfx));
}
