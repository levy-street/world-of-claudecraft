// The per-frame pass over the placed-GLB-asset view (authored placements:
// the editor, playtest and every Studio map), moved out of renderer.ts. The
// built-in world builds no placed-asset view, so the renderer never calls it
// there.

import type * as THREE from 'three';
import { sfx } from '../../game/sfx';
import type { PlacedAssetsView } from '../placed_assets';
import { PLACED_MOVER_SFX } from '../placed_movers';

export interface PlacedFrame {
  /** The local player's feet. */
  player: { x: number; y: number; z: number };
  camera: THREE.Vector3;
  dt: number;
  /** The shared detail horizon terrain, water and decals cull against. */
  cullFar: number;
  /** The maker's placed-asset view distance. */
  viewDistance: number;
  /** The scene fog's far, or null when there is no fog. */
  fogFar: number | null;
}

/** Run the frame's placed-asset work. True when the parked sun-shadow map went
 *  stale (an interior reveal flipped, or a mover swung). */
export function updatePlacedAssetsFrame(view: PlacedAssetsView, f: PlacedFrame): boolean {
  let shadowsStale = false;
  // Interior reveal (placed buildings): hides roofs/upper storeys around the
  // player; a flip stales the parked sun-shadow map.
  if (view.updateInteriorReveal(f.player.x, f.player.y, f.player.z, f.camera.x, f.camera.z)) {
    shadowsStale = true;
  }
  // Moving parts of placed buildings (the bank's vault door): a swing
  // stales the parked shadow map, and each stage of it has its sound.
  const moved = view.updateMovers(f.dt);
  if (moved.changed) shadowsStale = true;
  for (const c of moved.cues) sfx.playAt(PLACED_MOVER_SFX[c.cue], c.x, c.y, c.z, { gain: 1.1 });
  // Placed-asset distance cull: far placements release their batch slots /
  // hide (LOD_RANGE_ASSETS, tightened by the maker's view distance and the
  // fog), budgeted per frame inside. This call was dropped in a merge and
  // every placement drew at EVERY distance, on a 9k-placement document
  // that was most of the frame.
  view.updateLod(
    f.camera.x,
    f.camera.z,
    f.cullFar,
    f.viewDistance,
    // The SPRITE tier gets its own far. The cull far is the shared detail
    // horizon that terrain, water and decals all cull against, and on a vista
    // tier it is capped at MAX_OUTDOOR_FOG_FAR (850), measured at 700 here,
    // which is what actually pinned the sprites. Lifting that cap would extend
    // terrain and water too and cost frames everywhere for nothing. A sprite is
    // one instanced draw for the whole map, so it can safely run to the fog
    // wall on its own.
    f.fogFar ?? f.cullFar,
  );
  // Residency streaming (dormant unless the view was built with
  // streamAround): a no-op call otherwise.
  view.streamResidency(f.player.x, f.player.z);
  return shadowsStale;
}
