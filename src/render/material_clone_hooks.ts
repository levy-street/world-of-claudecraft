// Material.clone() copies every declarative property AND userData, but it
// silently DROPS onBeforeCompile (Material.copy simply does not list it). Both
// halves of that matter, because three keys its program cache on
// Material.customProgramCacheKey(), whose default return value IS
// `this.onBeforeCompile.toString()`:
//
//   1. a bare clone renders WITHOUT the patches its source shipped with (the
//      character rim glow, the worn surface-detail layer), and
//   2. its cache key no longer matches the source's, so its first draw LINKS A
//      NEW PROGRAM instead of reusing the one the source already linked.
//
// (2) is the expensive half: cloning a rig's materials to tint them is a
// per-visual operation, so the link lands on the first frame that shows the
// effect. For the ability-VFX body glow that is the first hit on a mob rig, in
// the middle of a fight.
//
// Re-attaching the source's hooks in the source's ORDER restores both: the
// composed cache key comes out byte-identical, so three's acquireProgram
// returns the already-linked program.

import type * as THREE from 'three';
import { reattachBiomeHazeToClone } from './biome_haze_field';
import { addRimGlow, hasRimGlow } from './gfx';
import { reapplySurfaceDetailToClone } from './worn_stone';

/**
 * Re-attach to `clone` the onBeforeCompile layers `source` carried, in the
 * order the material factories apply them (rim glow first, zone haze next as
 * surfaceMat attaches it at creation, then surface detail: each later layer
 * chains the previous hook into its own cache key). Only layers the source
 * actually had are re-attached, so a clone never gains a patch its source
 * never carried, which would break program identity just as badly.
 */
export function reattachClonedMaterialHooks(source: THREE.Material, clone: THREE.Material): void {
  if (hasRimGlow(source)) addRimGlow(clone);
  reattachBiomeHazeToClone(source, clone);
  // Reads the JSON spec applySurfaceDetail records in userData, which clone()
  // did copy; a no-op for clones of undetailed materials.
  reapplySurfaceDetailToClone(clone);
}

/** clone() plus reattachClonedMaterialHooks: the program-preserving clone. */
export function cloneMaterialWithHooks<T extends THREE.Material>(source: T): T {
  const clone = source.clone() as T;
  reattachClonedMaterialHooks(source, clone);
  return clone;
}
