// Teardown for the rideable-mount visual an EntityView owns.
//
// The renderer tears this exact state down in three places (a live mount swap,
// a dismount, and whole-view disposal), and every copy has to drop the same
// pieces in the same order: the mount-owned FX controller first, then the
// CharacterVisual out of the view group, then the key that the per-frame diff
// reads. A missed line in any one copy leaks a controller or strands a rig in
// the scene, which is why this is one function rather than a fourth copy.
//
// Kept out of renderer.ts per the monolith ratchet (root CLAUDE.md): the
// coordinator calls it, it owns no renderer state of its own.

import type * as THREE from 'three';
import type { CharacterVisual } from './characters/visual';
import type { GoblinRocketSledFx } from './goblin_rocket_sled_fx';
import type { VehicleSuspensionRig } from './vehicle_suspension_fx';

/** The EntityView slice this teardown touches: a caller-owned view record. */
export interface MountVisualHost {
  group: THREE.Object3D;
  mountVisual: CharacterVisual | null;
  mountVisualKey: string;
  goblinRocketSledFx: GoblinRocketSledFx | null;
  mountSuspension: VehicleSuspensionRig | null | undefined;
}

/** Disposes the mount FX controller alone, leaving the rig in place.
 *
 *  Whole-view disposal takes this arm: the CharacterVisual it would otherwise
 *  remove is torn down by the view's own disposal path a few lines later, so
 *  removing it here would be a double dispose. */
export function releaseMountFx(view: MountVisualHost): void {
  view.goblinRocketSledFx?.dispose();
  view.goblinRocketSledFx = null;
}

/** Drops the mount FX controller, the mount rig, and the diffed key.
 *
 *  Safe when no mount is present, so a caller does not have to null-check
 *  first: a live swap runs this before deciding whether the replacement is
 *  even loadable yet. */
export function releaseMountVisual(view: MountVisualHost): void {
  releaseMountFx(view);
  if (view.mountVisual) {
    view.group.remove(view.mountVisual.root);
    view.mountVisual.dispose();
    view.mountVisual = null;
  }
  view.mountVisualKey = '';
  // The suspension rig caches Object3D references INTO the rig that just went
  // away, so it has to die with it. Back to `undefined` (not probed) rather
  // than `null` (probed, has none), or the next mount never gets one.
  view.mountSuspension = undefined;
}
