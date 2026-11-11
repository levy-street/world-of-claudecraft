// The Heat vein dressed with its Blender kit (phase 2I: heat_kit_plan_core.ts
// plans every piece; heart_kit.ts bakes and instances them): the Hearth's
// mouth in the Forge's west wall, the altar-stone before it, the ember
// boulders, the column bundles at the Forge's corners, the wellspring at the
// Pour Channel's head and the channel itself with its spill, the clusters of
// fire crystal, the bridge's arch, the low walls along every Heat walk over
// the void, the seams of fire and the drifts of ash. Its painted rebuild
// (heat_env_plan_core.ts) stands its own pieces in the old ones' places once it
// has landed. Static: every matrix is written once at build.
//
// Built only once the kit has landed; before that the layout's placeholders
// stand in (heart_props.ts), and this swaps in for them the moment it lands.

import type * as THREE from 'three';
import {
  ensureHeartKit,
  heartKitLoaded,
  heartKitPiece,
  instanceHeartKit,
  SMITH_HEART_HEAT_KIT_URL,
  upgradeWhenHeartKitLands,
} from './heart_kit';
import { ensureHeatEnvKit, heatEnvHas, heatEnvKitReady, instanceHeatEnv } from './heat_env_kit';
import { heatEnvSwap, planHeatEnvRing } from './heat_env_plan_core';
import {
  HEARTH_CRYSTAL_PIECES,
  HEAT_KIT_KINDS,
  planHeatKit,
  warmHearthGlow,
} from './heat_kit_plan_core';

/** The Heat's culling cell (yards): the hall, the casting floor, the Forge. */
const HEAT_CELL = 70;

/** Wait (capped) for the Heat kit and its painted rebuild before the interior is
 *  built. */
export function ensureHeatKit(): Promise<void> {
  return Promise.all([ensureHeartKit(SMITH_HEART_HEAT_KIT_URL), ensureHeatEnvKit()]).then(
    () => undefined,
  );
}

/** Has the Heat kit landed? */
export function heatKitReady(): boolean {
  return heartKitLoaded(SMITH_HEART_HEAT_KIT_URL);
}

export { HEAT_KIT_KINDS };

const WARMED = 'heatHearthWarmed';
const _c: [number, number, number] = [0, 0, 0];

/** Warm the fire crystals' baked light to amber, once per baked piece (its
 *  vertex colours only: the shared glow material and its program are
 *  untouched). */
function warmHearthCrystals(): void {
  for (const name of HEARTH_CRYSTAL_PIECES) {
    const g = heartKitPiece(SMITH_HEART_HEAT_KIT_URL, name)?.glow;
    if (!g || g.userData[WARMED]) continue;
    const col = g.getAttribute('color');
    if (!col) continue;
    for (let i = 0; i < col.count; i++) {
      _c[0] = col.getX(i);
      _c[1] = col.getY(i);
      _c[2] = col.getZ(i);
      warmHearthGlow(_c);
      col.setXYZ(i, _c[0], _c[1], _c[2]);
    }
    col.needsUpdate = true;
    g.userData[WARMED] = true;
  }
}

/** The Heat's kit dressing (instance-local), painted or old as `painted` says: the
 *  painted rebuild's pieces in the old pieces' places (heat_env_plan_core.ts), the rest of
 *  the old kit as it was. */
export function buildHeatKit(lowGfx: boolean, painted = heatEnvKitReady()): THREE.Group {
  warmHearthCrystals();
  if (!painted) {
    return instanceHeartKit(
      SMITH_HEART_HEAT_KIT_URL,
      planHeatKit(),
      lowGfx,
      'smithHeartHeatKit',
      HEAT_CELL,
    );
  }
  const { keep, swap } = heatEnvSwap(planHeatKit(), heatEnvHas);
  const group = instanceHeartKit(
    SMITH_HEART_HEAT_KIT_URL,
    keep,
    lowGfx,
    'smithHeartHeatKit',
    HEAT_CELL,
  );
  // The arena concept's ring of basalt stacks round the hall too (its molten fall is a
  // band of the mountain's, heart_rock.ts).
  group.add(instanceHeatEnv(swap, lowGfx, 'smithHeartHeatEnv'));
  // The rings of basalt, drawn only from the Heat (heat_env_kit.ts `HeatEnvVariant`).
  group.add(instanceHeatEnv(planHeatEnvRing(), lowGfx, 'smithHeartHeatEnvRing', 'ring'));
  return group;
}

/** The kit dressing when it has landed; otherwise nothing yet, and the
 *  placeholders in `placeholders` give way to it the moment it lands. */
export function dressHeat(parent: THREE.Group, placeholders: THREE.Group, lowGfx: boolean): void {
  if (heatKitReady()) {
    parent.add(buildHeatKit(lowGfx));
    return;
  }
  // The late build keeps the look the interior was built with: paint that landed since
  // was never prepared behind the curtain (the warmers carry only what had landed).
  const painted = heatEnvKitReady();
  upgradeWhenHeartKitLands(SMITH_HEART_HEAT_KIT_URL, placeholders, () =>
    buildHeatKit(lowGfx, painted),
  );
}
