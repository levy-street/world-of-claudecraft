// The Heat vein dressed with its Blender kit (phase 2I: heat_kit_plan_core.ts
// plans every piece; heart_kit.ts bakes and instances them): the Hearth's
// mouth in the Forge's west wall, the altar-stone before it, the ember
// boulders, the column bundles at the Forge's corners, the wellspring at the
// Pour Channel's head and the channel itself with its spill, the clusters of
// fire crystal, the bridge's arch, the low walls along every Heat walk over
// the void, the seams of fire and the drifts of ash. Static: every matrix is
// written once at build.
//
// Built only once the kit has landed; before that the layout's placeholders
// stand in (heart_props.ts), and this swaps in for them the moment it lands.

import type * as THREE from 'three';
import {
  ensureHeartKit,
  heartKitLoaded,
  instanceHeartKit,
  SMITH_HEART_HEAT_KIT_URL,
  upgradeWhenHeartKitLands,
} from './heart_kit';
import { HEAT_KIT_KINDS, planHeatKit } from './heat_kit_plan_core';

/** The Heat's culling cell (yards): the hall, the casting floor, the Forge. */
const HEAT_CELL = 70;

/** Wait (capped) for the Heat kit before the interior is built. */
export function ensureHeatKit(): Promise<void> {
  return ensureHeartKit(SMITH_HEART_HEAT_KIT_URL);
}

/** Has the Heat kit landed? */
export function heatKitReady(): boolean {
  return heartKitLoaded(SMITH_HEART_HEAT_KIT_URL);
}

export { HEAT_KIT_KINDS };

/** The Heat's kit dressing (instance-local). */
export function buildHeatKit(lowGfx: boolean): THREE.Group {
  return instanceHeartKit(
    SMITH_HEART_HEAT_KIT_URL,
    planHeatKit(),
    lowGfx,
    'smithHeartHeatKit',
    HEAT_CELL,
  );
}

/** The kit dressing when it has landed; otherwise nothing yet, and the
 *  placeholders in `placeholders` give way to it the moment it lands. */
export function dressHeat(parent: THREE.Group, placeholders: THREE.Group, lowGfx: boolean): void {
  if (heatKitReady()) {
    parent.add(buildHeatKit(lowGfx));
    return;
  }
  upgradeWhenHeartKitLands(SMITH_HEART_HEAT_KIT_URL, placeholders, () => buildHeatKit(lowGfx));
}
