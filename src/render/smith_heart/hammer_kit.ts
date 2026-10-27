// The Hammer vein dressed with its Blender kit (hammer_kit_plan_core.ts plans
// every piece; heart_kit.ts bakes and instances them): the colossi, the
// columns and their sockets, the cut blocks, the derrick, the scaffold, the
// hoists, the quarry's worked faces and lips, the Cleft's gate, the rough
// statues, the geodes, the collapse spot's overhang, the Slab's frame and
// the Balcony's lookouts. Static: every matrix is written once at build.
//
// Built only once the kit has landed; before that the layout's placeholders
// stand in (heart_props.ts) and this swaps in for them the moment it lands.

import type * as THREE from 'three';
import { HAMMER_KIT_KINDS, planHammerKit } from './hammer_kit_plan_core';
import {
  ensureHeartKit,
  heartKitLoaded,
  instanceHeartKit,
  SMITH_HEART_HAMMER_KIT_URL,
  upgradeWhenHeartKitLands,
} from './heart_kit';

/** Wait (capped) for the Hammer kit before the interior is built. */
export function ensureHammerKit(): Promise<void> {
  return ensureHeartKit(SMITH_HEART_HAMMER_KIT_URL);
}

/** Has the Hammer kit landed? */
export function hammerKitReady(): boolean {
  return heartKitLoaded(SMITH_HEART_HAMMER_KIT_URL);
}

/** The prop kinds the Hammer kit draws in place of their placeholders. */
export { HAMMER_KIT_KINDS };

/** The vein's kit dressing (instance-local). */
export function buildHammerKit(lowGfx: boolean): THREE.Group {
  return instanceHeartKit(
    SMITH_HEART_HAMMER_KIT_URL,
    planHammerKit(),
    lowGfx,
    'smithHeartHammerKit',
  );
}

/** The kit dressing when it has landed; otherwise nothing yet, and the
 *  placeholders in `placeholders` give way to it the moment it lands. */
export function dressHammerVein(
  parent: THREE.Group,
  placeholders: THREE.Group,
  lowGfx: boolean,
): void {
  if (hammerKitReady()) {
    parent.add(buildHammerKit(lowGfx));
    return;
  }
  upgradeWhenHeartKitLands(SMITH_HEART_HAMMER_KIT_URL, placeholders, () => buildHammerKit(lowGfx));
}
