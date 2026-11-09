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
import {
  buildHammerEnvFlames,
  ensureHammerEnvKit,
  hammerEnvHas,
  hammerEnvKitReady,
  instanceHammerEnv,
} from './hammer_env_kit';
import {
  hammerEnvSwap,
  planHammerEnvArena,
  planHammerEnvBraziers,
  planHammerEnvGallery,
  planHammerEnvStairs,
  planHammerEnvWalkLayer,
} from './hammer_env_plan_core';
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
  return Promise.all([ensureHeartKit(SMITH_HEART_HAMMER_KIT_URL), ensureHammerEnvKit()]).then(
    () => undefined,
  );
}

/** Has the Hammer kit landed? */
export function hammerKitReady(): boolean {
  return heartKitLoaded(SMITH_HEART_HAMMER_KIT_URL);
}

/** The prop kinds the Hammer kit draws in place of their placeholders. */
export { HAMMER_KIT_KINDS };

/** The vein's kit dressing (instance-local), painted or old as `painted` says. */
export function buildHammerKit(lowGfx: boolean, painted = hammerEnvKitReady()): THREE.Group {
  if (!painted) {
    return instanceHeartKit(
      SMITH_HEART_HAMMER_KIT_URL,
      planHammerKit(),
      lowGfx,
      'smithHeartHammerKit',
    );
  }
  // The painted rebuild: what a mechanic hangs on stays the old kit's.
  const { keep, swap } = hammerEnvSwap(planHammerKit(), hammerEnvHas);
  const group = instanceHeartKit(SMITH_HEART_HAMMER_KIT_URL, keep, lowGfx, 'smithHeartHammerKit');
  group.add(
    instanceHammerEnv(
      [
        ...swap,
        ...planHammerEnvArena(),
        ...planHammerEnvBraziers(),
        ...planHammerEnvGallery(),
        ...planHammerEnvStairs(),
        ...planHammerEnvWalkLayer(),
      ],
      lowGfx,
      'smithHeartHammerEnv',
    ),
  );
  const flames = buildHammerEnvFlames(lowGfx);
  if (flames) group.add(flames);
  return group;
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
  // The late build keeps the look the interior was built with: paint that landed since
  // was never prepared behind the curtain (the warmers carry only what had landed).
  const painted = hammerEnvKitReady();
  upgradeWhenHeartKitLands(SMITH_HEART_HAMMER_KIT_URL, placeholders, () =>
    buildHammerKit(lowGfx, painted),
  );
}
