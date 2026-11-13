// The Breath vein dressed with its Blender kit (phase 2G: breath_kit_plan_core.ts
// plans every piece; heart_kit.ts bakes and instances them): the Cornice's
// lightning rods, wind-horns and channel stones, the Wind Bridge's arch and
// shelters, the low walls along every Breath walk over the void, the
// landings' standing stones and the plateau's inlays. Static: every matrix
// is written once at build.
//
// Built only once the kit has landed; before that the layout's placeholders
// stand in (heart_props.ts) and the field draws the bridge's own rock, and
// this swaps in for them the moment it lands.

import type * as THREE from 'three';
import {
  breathEnvHas,
  breathEnvKitReady,
  ensureBreathEnvKit,
  instanceBreathEnv,
} from './breath_env_kit';
import { breathEnvSwap } from './breath_env_plan_core';
import { BREATH_KIT_KINDS, planBreathKit } from './breath_kit_plan_core';
import {
  ensureHeartKit,
  heartKitLoaded,
  instanceHeartKit,
  SMITH_HEART_BREATH_KIT_URL,
  upgradeWhenHeartKitLands,
} from './heart_kit';

/** The Breath's culling cell (yards): the Cornice is one place seen whole. */
const BREATH_CELL = 100;

/** Wait (capped) for the Breath kit and its painted rebuild before the interior is built. */
export function ensureBreathKit(): Promise<void> {
  return Promise.all([ensureHeartKit(SMITH_HEART_BREATH_KIT_URL), ensureBreathEnvKit()]).then(
    () => undefined,
  );
}

/** Has the Breath kit landed? */
export function breathKitReady(): boolean {
  return heartKitLoaded(SMITH_HEART_BREATH_KIT_URL);
}

export { BREATH_KIT_KINDS };

/** The Breath's kit dressing (instance-local), painted or old as `painted` says: the
 *  painted rebuild's walls, shelters and standing stones in the old pieces' places
 *  (breath_env_plan_core.ts), the rest of the old kit as it was. */
export function buildBreathKit(lowGfx: boolean, painted = breathEnvKitReady()): THREE.Group {
  if (!painted) {
    return instanceHeartKit(
      SMITH_HEART_BREATH_KIT_URL,
      planBreathKit(),
      lowGfx,
      'smithHeartBreathKit',
      BREATH_CELL,
    );
  }
  const { keep, swap } = breathEnvSwap(planBreathKit(), breathEnvHas);
  const group = instanceHeartKit(
    SMITH_HEART_BREATH_KIT_URL,
    keep,
    lowGfx,
    'smithHeartBreathKit',
    BREATH_CELL,
  );
  group.add(instanceBreathEnv(swap, lowGfx, 'smithHeartBreathEnv'));
  return group;
}

/** The kit dressing when it has landed; otherwise nothing yet, and the
 *  placeholders in `placeholders` give way to it the moment it lands. */
export function dressBreath(parent: THREE.Group, placeholders: THREE.Group, lowGfx: boolean): void {
  if (breathKitReady()) {
    parent.add(buildBreathKit(lowGfx));
    return;
  }
  // The late build keeps the look the interior was built with: paint that landed since
  // was never prepared behind the curtain (the warmers carry only what had landed).
  const painted = breathEnvKitReady();
  upgradeWhenHeartKitLands(SMITH_HEART_BREATH_KIT_URL, placeholders, () =>
    buildBreathKit(lowGfx, painted),
  );
}
