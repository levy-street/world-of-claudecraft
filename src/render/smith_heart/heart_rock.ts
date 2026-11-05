// The Smith's Heart's mountain skinned with the rock kit (phase 2E:
// heart_rock_plan_core.ts plans every piece band by band; heart_kit.ts bakes
// and instances them). Static: every matrix is written once at build.
//
// Built only once the kit has landed; before that the loose crags at the
// mountain's foot (heart_props.ts buildHeartWalls) stand in, and this swaps
// in for them the moment it lands. The pieces are big and drawn by the
// hundred, so they bucket in wide culling cells (fewer draws), cast no
// shadow (far scenery; the sun's shadow on the walks is the floors' and the
// props'), and the bands past the second shed on the low tier.

import type * as THREE from 'three';
import { hammerEnvKitReady, instanceHammerEnv } from './hammer_env_kit';
import {
  fitHammerEnvLip,
  fitHammerEnvNeedle,
  fitHammerEnvRock,
  hammerEnvOwnsRock,
} from './hammer_env_plan_core';
import {
  ensureHeartKit,
  heartKitLoaded,
  instanceHeartKit,
  SMITH_HEART_ROCK_KIT_URL,
  upgradeWhenHeartKitLands,
} from './heart_kit';
import { planHeartHangs, planHeartRockLips, planHeartRockUnder } from './heart_rock_hang_core';
import { planHeartNeedles, planHeartRock } from './heart_rock_plan_core';

/** The rock's culling cell (yards). */
const ROCK_CELL = 200;

/** Wait (capped) for the rock kit before the interior is built. */
export function ensureHeartRockKit(): Promise<void> {
  return ensureHeartKit(SMITH_HEART_ROCK_KIT_URL);
}

/** Has the rock kit landed? */
export function heartRockKitReady(): boolean {
  return heartKitLoaded(SMITH_HEART_ROCK_KIT_URL);
}

/** The mountain's rock (instance-local). */
export function buildHeartRock(lowGfx: boolean): THREE.Group {
  // The Breath's high walks hang faces from brink to mist (the lips and
  // under-walls they replace left out); the hangs are the Breath's alone.
  const rock = [...planHeartRock(), ...planHeartRockUnder()];
  const hangs = planHeartHangs();
  const lips = planHeartRockLips();
  const needles = planHeartNeedles();
  // The Hammer vein's own rock is the painted kit's once it has landed.
  const painted = hammerEnvKitReady();
  const old = (p: { x: number; z: number }) => !painted || !hammerEnvOwnsRock(p);
  const group = instanceHeartKit(
    SMITH_HEART_ROCK_KIT_URL,
    [...rock.filter(old), ...hangs, ...lips.filter(old), ...needles.filter(old)],
    lowGfx,
    'smithHeartRock',
    ROCK_CELL,
    'rock',
  );
  if (painted) {
    group.add(
      instanceHammerEnv(
        [
          ...rock.filter(hammerEnvOwnsRock).map(fitHammerEnvRock),
          ...lips.filter(hammerEnvOwnsRock).map(fitHammerEnvLip),
          ...needles.filter(hammerEnvOwnsRock).map(fitHammerEnvNeedle),
        ],
        lowGfx,
        'smithHeartHammerEnvRock',
      ),
    );
  }
  return group;
}

/** The rock when its kit has landed (the crags then never draw); otherwise
 *  the crags, which give way to it the moment it lands. */
export function dressHeartMountain(
  parent: THREE.Group,
  buildCrags: () => THREE.Group,
  lowGfx: boolean,
): void {
  if (heartRockKitReady()) {
    parent.add(buildHeartRock(lowGfx));
    return;
  }
  const crags = buildCrags();
  parent.add(crags);
  upgradeWhenHeartKitLands(SMITH_HEART_ROCK_KIT_URL, crags, () => buildHeartRock(lowGfx));
}
