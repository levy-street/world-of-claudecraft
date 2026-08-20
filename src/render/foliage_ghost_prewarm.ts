// Boot-prewarm coverage for the foliage camera-OCCLUDER GHOSTS.
//
// A tree crossing the eye-to-camera segment zero-scales its instances and
// draws pooled stand-ins in their place (instanced_occluder_ghosts.ts,
// foliage.ts updateTreeHides). The stand-in is a plain THREE.Mesh wearing a
// bare `clone()` of the bucket material, so it is three or four cache-key
// dimensions away from the program the bucket draws with: not instanced, no
// `instanceColor`, `transparent`, and hookless (`clone()` drops the wind,
// instance-collapse, biome-haze and worn layers, whose composed
// `customProgramCacheKey` every live foliage material ends in). Nothing
// prewarmed it, and it is minted LAZILY on the first frame a trunk blocks the
// camera, so it linked inside a live frame: the measured Evergarden
// `Bark_NormalTree` 136 ms and `Leaves_NormalTree` 96 + 98 ms cold rows, all
// plain-Mesh draws under the `foliage` scene root at cacheKeyLength 262 (the
// hookless signature).
//
// The twin materials come from createInstancedGhostMaterial, the SAME call the
// live pool uses, because a reproduced recipe is exactly how the sibling
// occluder_ghost_prewarm.ts twins (cloneMaterialWithHooks + depthWrite true)
// fail to match these ghosts.
//
// Bounded by construction: one draw per distinct (source material, geometry),
// never one per tree. A world of thousands of hideable trees resolves to the
// handful of species bark/leaf sheets crossed with their variant geometries,
// and the pooled ghosts of two bucket meshes that share both land on one
// program anyway (three keys on the material's parameters, not its identity).

import type * as THREE from 'three';
import { type FoliageDrawPath, foliageAttributeList } from './foliage_prewarm_twins_core';
import { createInstancedGhostMaterial, ghostSourceMaterial } from './instanced_occluder_ghosts';

/** One ghost twin: the geometry and material to draw it with, plus the draw
 *  path that identifies its program. */
export interface FoliageGhostPrewarmDraw {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  path: FoliageDrawPath;
}

/**
 * The ghost twins for a set of hideable source meshes. `sources` may repeat
 * freely (callers walk a per-tree part list); the result carries one entry per
 * distinct (source material, geometry attribute set), each already shaped as
 * the plain-Mesh, uninstanced, shadowless draw the live ghost is.
 */
export function foliageGhostPrewarmDraws(
  sources: Iterable<THREE.InstancedMesh>,
): FoliageGhostPrewarmDraw[] {
  const seen = new Set<string>();
  const draws: FoliageGhostPrewarmDraw[] = [];
  for (const source of sources) {
    const src = ghostSourceMaterial(source);
    const attributes = foliageAttributeList(source.geometry.attributes);
    // Keyed on the SOURCE material, not the clone: every clone of one source
    // is a fresh uuid but the same program.
    const key = `${src.uuid}|${[...attributes].sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    draws.push({
      geometry: source.geometry,
      material: createInstancedGhostMaterial(src),
      path: {
        materialKey: `ghost:${src.uuid}`,
        attributes,
        instanced: false,
        instanceColor: false,
        castShadow: false,
        receiveShadow: false,
      },
    });
  }
  return draws;
}
