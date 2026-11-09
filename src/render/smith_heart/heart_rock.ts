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
import { breathEnvKitReady, instanceBreathEnv } from './breath_env_kit';
import { breathEnvOwnsRock, fitBreathEnvNeedle, fitBreathEnvRock } from './breath_env_plan_core';
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
import { planHeartGulfWalls } from './heart_rock_gulf_core';
import { planHeartHangs, planHeartRockLips, planHeartRockUnder } from './heart_rock_hang_core';
import { planHeartNeedles, planHeartRock } from './heart_rock_plan_core';
import { instanceQuenchEnv, quenchEnvKitReady } from './quench_env_kit';
import { fitQuenchEnvNeedle, fitQuenchEnvRock, quenchEnvOwnsRock } from './quench_env_plan_core';

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

/** The mountain's rock (instance-local). The Hammer vein's own rock is its painted kit's
 *  once that has landed (`painted`), and the Breath's and the Quench's bands and needles
 *  their own painted kits' (`breathPainted`, `quenchPainted`); the lips and the hung faces
 *  stay the rock kit's sculpts (the Breath's and the Quench's take their paintings on
 *  through the rock's material, heart_rock_cutaway.ts). */
export function buildHeartRock(
  lowGfx: boolean,
  painted = hammerEnvKitReady(),
  breathPainted = breathEnvKitReady(),
  quenchPainted = quenchEnvKitReady(),
): THREE.Group {
  // The Breath's high walks hang faces from brink to mist (the lips and
  // under-walls they replace left out); the hangs are the Breath's alone.
  // The Wind Bridge gulf's far walls are bands too (the weak-spots pass of 2026-11-04).
  const rock = [...planHeartRock(), ...planHeartRockUnder(), ...planHeartGulfWalls()];
  const hangs = planHeartHangs();
  const lips = planHeartRockLips();
  const needles = planHeartNeedles();
  const hammer = (p: { x: number; z: number }) => painted && hammerEnvOwnsRock(p);
  const breath = (p: { x: number; z: number }) => breathPainted && breathEnvOwnsRock(p);
  const quench = (p: { x: number; z: number }) => quenchPainted && quenchEnvOwnsRock(p);
  const old = (p: { x: number; z: number }) => !hammer(p) && !breath(p) && !quench(p);
  const group = instanceHeartKit(
    SMITH_HEART_ROCK_KIT_URL,
    [...rock.filter(old), ...hangs, ...lips.filter((p) => !hammer(p)), ...needles.filter(old)],
    lowGfx,
    'smithHeartRock',
    ROCK_CELL,
    'rock',
  );
  if (painted) {
    group.add(
      instanceHammerEnv(
        [
          ...rock.filter(hammer).map(fitHammerEnvRock),
          ...lips.filter(hammer).map(fitHammerEnvLip),
          ...needles.filter(hammer).map(fitHammerEnvNeedle),
        ],
        lowGfx,
        'smithHeartHammerEnvRock',
      ),
    );
  }
  if (breathPainted) {
    group.add(
      instanceBreathEnv(
        [
          ...rock.filter(breath).map(fitBreathEnvRock),
          ...needles.filter(breath).map(fitBreathEnvNeedle),
        ],
        lowGfx,
        'smithHeartBreathEnvRock',
      ),
    );
  }
  if (quenchPainted) {
    group.add(
      instanceQuenchEnv(
        [
          ...rock.filter(quench).map(fitQuenchEnvRock),
          ...needles.filter(quench).map(fitQuenchEnvNeedle),
        ],
        lowGfx,
        'smithHeartQuenchEnvRock',
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
  // The late build keeps the look the interior was built with (hammer_kit.ts's reason).
  const painted = hammerEnvKitReady();
  const breathPainted = breathEnvKitReady();
  const quenchPainted = quenchEnvKitReady();
  upgradeWhenHeartKitLands(SMITH_HEART_ROCK_KIT_URL, crags, () =>
    buildHeartRock(lowGfx, painted, breathPainted, quenchPainted),
  );
}
