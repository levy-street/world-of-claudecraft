// Host-set scope for the procedural foliage build: the Studio's two module-
// state switches, moved out of foliage.ts (the setSwayDisabledAssets idiom:
// the host sets them, then builds or rebuilds the engine).
//
// - Far-placement mirrors: editable placements' far-sprite records
//   (foliage_far_placements_core.ts). Empty in the built-in world, which has
//   no placements, so the shipped build is unchanged.
// - Zone isolate bounds: the editor's isolate mode. Null everywhere but the
//   editor viewport, so the shipped build is unchanged.

import type { Decoration } from '../sim/world';

// Editable placements' far-sprite mirrors (foliage_far_placements_core.ts),
// set by the host before the foliage build; the setSwayDisabledAssets idiom.
let farPlacementDecos: Decoration[] = [];
export function setFoliageFarPlacements(decos: Decoration[]): void {
  farPlacementDecos = decos;
}
/** Whether this host runs placement far-sprites (game boots do; the editor
 *  viewport deliberately does not): placed_assets caps real foliage models
 *  at the sprite handoff ONLY when a sprite actually takes over. */
export function foliageFarPlacementsActive(): boolean {
  return farPlacementDecos.length > 0;
}

// ---- editor zone isolate ----------------------------------------------------
// Procedural foliage is generated ONCE for the whole world at engine build and
// bucketed into world-spanning bands, so nothing downstream can cull it to a
// zone: a bucket's bounding sphere is ~300 yd across and overlaps everything.
// The editor's isolate mode therefore cuts it where it is born. Module state
// on purpose, the same shape as setSwayDisabledAssets: the editor sets it and
// rebuilds the engine, the shipped game never touches it.
let foliageBounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

/** Editor-only: restrict generated trees, rocks and ground dressing to a world
 *  rect (null = the whole world). Takes effect at the next engine build. */
export function setFoliageBounds(
  rect: { minX: number; maxX: number; minZ: number; maxZ: number } | null,
): void {
  foliageBounds = rect ? { ...rect } : null;
}

export function outsideFoliageBounds(x: number, z: number): boolean {
  const b = foliageBounds;
  if (!b) return false;
  return x < b.minX || x >= b.maxX || z < b.minZ || z >= b.maxZ;
}

/** Append the far-placement mirrors inside the isolate bounds to `decos`.
 *  Editable placements' far mirrors ride the sprite lane only (the
 *  placement's own model is the near representation). Curation filters are
 *  deliberately skipped: a placement is the maker's explicit choice, wherever
 *  it stands. */
export function appendFarPlacementDecos(decos: Decoration[]): void {
  for (const d of farPlacementDecos) {
    if (!outsideFoliageBounds(d.x, d.z)) decos.push(d);
  }
}
