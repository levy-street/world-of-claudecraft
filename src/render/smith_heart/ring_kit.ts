// The Ring dressed with its Blender kit (phase 2F: ring_kit_plan_core.ts plans
// every piece; heart_kit.ts bakes and instances them): the Ring's paving,
// curb, foot and channels, the Grand Stair's and the North Stair's treads and
// chutes, every stair's stringers and parapets, the Seal Dais, the standing
// stones, the cairns and the vein mouths. Static: every matrix is written
// once at build. The seal and the spires move or light, so heart_seal.ts
// draws them from the same kit.
//
// Built only once the kit has landed; before that the field draws the stairs'
// ramps and the layout's placeholders stand in (heart_props.ts), and this
// swaps in for them the moment it lands.

import type * as THREE from 'three';
import {
  ensureHeartKit,
  heartKitLoaded,
  instanceHeartKit,
  SMITH_HEART_RING_KIT_URL,
  upgradeWhenHeartKitLands,
} from './heart_kit';
import { planRingKit, RING_KIT_KINDS, RING_KIT_OMIT_TOPS } from './ring_kit_plan_core';

/** The Ring's culling cell (yards): the Ring is one place seen whole. */
const RING_CELL = 120;

/** Wait (capped) for the Ring kit before the interior is built. */
export function ensureRingKit(): Promise<void> {
  return ensureHeartKit(SMITH_HEART_RING_KIT_URL);
}

/** Has the Ring kit landed? */
export function ringKitReady(): boolean {
  return heartKitLoaded(SMITH_HEART_RING_KIT_URL);
}

export { RING_KIT_KINDS, RING_KIT_OMIT_TOPS };

/** The Ring's kit dressing (instance-local). */
export function buildRingKit(lowGfx: boolean): THREE.Group {
  return instanceHeartKit(
    SMITH_HEART_RING_KIT_URL,
    planRingKit(),
    lowGfx,
    'smithHeartRingKit',
    RING_CELL,
  );
}

/** The kit dressing when it has landed; otherwise nothing yet, and the
 *  placeholders in `placeholders` give way to it the moment it lands. */
export function dressRing(parent: THREE.Group, placeholders: THREE.Group, lowGfx: boolean): void {
  if (ringKitReady()) {
    parent.add(buildRingKit(lowGfx));
    return;
  }
  upgradeWhenHeartKitLands(SMITH_HEART_RING_KIT_URL, placeholders, () => buildRingKit(lowGfx));
}
