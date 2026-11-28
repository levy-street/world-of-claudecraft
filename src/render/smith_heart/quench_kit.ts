// The Quench vein dressed with its Blender kit (phase 2H: quench_kit_plan_core.ts
// plans every piece; heart_kit.ts bakes and instances them): the basin's fire
// bowls and vents, the old ice heaped against its walls, the Singing Ice's
// crystal, the landings' standing stones, the low walls along every Quench walk
// over the void, the frozen falls on the vein's walls and the drifts of snow.
// Its painted rebuild (quench_env_plan_core.ts) stands its own pieces in the
// old ones' places once it has landed. Static: every matrix is written once at
// build.
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
import {
  ensureQuenchEnvKit,
  instanceQuenchEnv,
  quenchEnvHas,
  quenchEnvKitReady,
} from './quench_env_kit';
import { planQuenchEnvGreatFall, planQuenchEnvRing, quenchEnvSwap } from './quench_env_plan_core';
import { planQuenchKit, QUENCH_KIT_KINDS } from './quench_kit_plan_core';

/** The Quench's culling cell (yards): a landing, the Singing Ice, the basin. */
const QUENCH_CELL = 70;

/** Wait (capped) for the Quench kit and its painted rebuild before the interior is
 *  built. */
export function ensureQuenchKit(): Promise<void> {
  return Promise.all([ensureHeartKit(SMITH_HEART_QUENCH_KIT_URL), ensureQuenchEnvKit()]).then(
    () => undefined,
  );
}

/** Has the Quench kit landed? */
export function quenchKitReady(): boolean {
  return heartKitLoaded(SMITH_HEART_QUENCH_KIT_URL);
}

export { QUENCH_KIT_KINDS };

/** The Quench's kit dressing (instance-local), painted or old as `painted` says: the
 *  painted rebuild's pieces in the old pieces' places (quench_env_plan_core.ts), the
 *  rest of the old kit as it was. */
export function buildQuenchKit(lowGfx: boolean, painted = quenchEnvKitReady()): THREE.Group {
  if (!painted) {
    return instanceHeartKit(
      SMITH_HEART_QUENCH_KIT_URL,
      planQuenchKit(),
      lowGfx,
      'smithHeartQuenchKit',
      QUENCH_CELL,
    );
  }
  const { keep, swap } = quenchEnvSwap(planQuenchKit(), quenchEnvHas);
  const group = instanceHeartKit(
    SMITH_HEART_QUENCH_KIT_URL,
    keep,
    lowGfx,
    'smithHeartQuenchKit',
    QUENCH_CELL,
  );
  // The arena concept's new pieces too: the great frozen fall across the lake and the ring
  // of snow-capped bluffs round the basin.
  group.add(
    instanceQuenchEnv(
      [...swap, ...planQuenchEnvGreatFall(), ...planQuenchEnvRing()],
      lowGfx,
      'smithHeartQuenchEnv',
    ),
  );
  return group;
}

/** The kit dressing when it has landed; otherwise nothing yet, and the
 *  placeholders in `placeholders` give way to it the moment it lands. */
export function dressQuench(parent: THREE.Group, placeholders: THREE.Group, lowGfx: boolean): void {
  if (quenchKitReady()) {
    parent.add(buildQuenchKit(lowGfx));
    return;
  }
  // The late build keeps the look the interior was built with: paint that landed since
  // was never prepared behind the curtain (the warmers carry only what had landed).
  const painted = quenchEnvKitReady();
  upgradeWhenHeartKitLands(SMITH_HEART_QUENCH_KIT_URL, placeholders, () =>
    buildQuenchKit(lowGfx, painted),
  );
}
