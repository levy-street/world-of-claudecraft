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
import {
  ensureHeartKit,
  heartKitLoaded,
  instanceHeartKit,
  SMITH_HEART_ROCK_KIT_URL,
  upgradeWhenHeartKitLands,
} from './heart_kit';
import {
  planHeartLips,
  planHeartNeedles,
  planHeartRock,
  planHeartUnderCliffs,
} from './heart_rock_plan_core';

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
  return instanceHeartKit(
    SMITH_HEART_ROCK_KIT_URL,
    [...planHeartRock(), ...planHeartUnderCliffs(), ...planHeartLips(), ...planHeartNeedles()],
    lowGfx,
    'smithHeartRock',
    ROCK_CELL,
    'rock',
  );
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
