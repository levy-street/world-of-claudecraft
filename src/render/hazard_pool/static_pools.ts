// Static hazard pools for a built room (the Drowned Litany's Blackwater today):
// one mesh per sim zone, at the zone's exact radius (the organic edge only
// wanders outward), in the room group's own frame. One material per style per
// room, owned by the room: the interior resource sweep disposes it with the
// room (interior_resource_lifecycle.ts walks the group), and every material
// shares the one hazard pool program, which the room's gated attach links.

import * as THREE from 'three';
import type { HazardPoolStyle } from '../../world_api/dungeons';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { HAZARD_POOL_LOOKS } from './hazard_pool_core';
import {
  buildHazardPoolGeometry,
  createHazardPoolMaterial,
  type HazardPoolShape,
} from './hazard_pool_mesh';

/** One static pool: the sim zone's footprint plus the look to draw it with. */
export interface StaticHazardPool extends HazardPoolShape {
  style: HazardPoolStyle;
}

/** Add one mesh per pool to `group`; returns the meshes in input order. */
export function placeHazardPools(
  group: THREE.Object3D,
  pools: readonly StaticHazardPool[],
): THREE.Mesh[] {
  const materials = new Map<HazardPoolStyle, THREE.ShaderMaterial>();
  const meshes: THREE.Mesh[] = [];
  for (const pool of pools) {
    let mat = materials.get(pool.style);
    if (!mat) {
      mat = createHazardPoolMaterial(pool.style);
      materials.set(pool.style, mat);
    }
    const mesh = new THREE.Mesh(buildHazardPoolGeometry(pool), mat);
    mesh.name = `hazardPool_${pool.style}`;
    // A deep core paints over the shallow ring it sits in (encounter band:
    // a hazard paints over every player ground effect).
    mesh.renderOrder = floorVfxRenderOrder('encounter', HAZARD_POOL_LOOKS[pool.style].step);
    group.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}
