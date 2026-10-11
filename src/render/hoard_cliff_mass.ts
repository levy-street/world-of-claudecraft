// The continuous cliff body of a Buried Hoard room, as ONE mesh and one draw.
// Shape, painted light and chunking come from hoard_cliff_mass_core.ts; this
// adapter only uploads them and answers the chase camera.
//
// Cutaway: the wall rocks are hidden per instance when they stand between the
// camera and the player (hoard_cavern_cutaway.ts). A single mesh cannot hide
// part of itself by visibility, so the body keeps an index buffer over its flat
// triangles and, only when the set of obstructing chunks CHANGES, rewrites that
// index compacted to the visible chunks. Steady frames cost one bounds test per
// chunk and nothing else.
//
// It wears the shared unlit valley material (vertex colours), so it adds no
// shader program, and it is a child of the valley group, so the valley's
// compile gate covers it like everything else in the room.

import * as THREE from 'three';
import { hoardCavernSceneryVisible } from './hoard_cavern_core';
import { buildHoardCliffMass, type CliffMassChunk } from './hoard_cliff_mass_core';
import type { HoardValleyPlan } from './hoard_valley_core';

export interface HoardCliffMassView {
  mesh: THREE.Mesh;
  updateCamera(camera: THREE.Vector3, target: THREE.Vector3, origin: THREE.Vector3): void;
  dispose(): void;
}

export function buildHoardCliffMassView(
  plan: HoardValleyPlan,
  material: THREE.Material,
): HoardCliffMassView {
  const mass = buildHoardCliffMass({
    polygon: plan.outline,
    seed: plan.seed,
    revealZ: plan.revealZ,
    cliff: plan.zone.cliff,
    cliffLight: plan.zone.cliffLight,
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mass.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(mass.colors, 3));
  const vertexCount = mass.positions.length / 3;
  const index = new THREE.BufferAttribute(new Uint32Array(vertexCount), 1);
  for (let i = 0; i < vertexCount; i++) index.setX(i, i);
  index.setUsage(THREE.DynamicDrawUsage);
  geometry.setIndex(index);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'HoardValleyCliffMass';
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const bounds = mass.chunks.map(
    (chunk: CliffMassChunk) =>
      new THREE.Box3(new THREE.Vector3(...chunk.min), new THREE.Vector3(...chunk.max)),
  );
  const shown = mass.chunks.map(() => true);

  return {
    mesh,
    updateCamera(camera, target, origin) {
      let changed = false;
      for (let c = 0; c < bounds.length; c++) {
        const visible = hoardCavernSceneryVisible(camera, target, origin, bounds[c]);
        if (visible === shown[c]) continue;
        shown[c] = visible;
        changed = true;
      }
      if (!changed) return;
      let cursor = 0;
      for (let c = 0; c < mass.chunks.length; c++) {
        if (!shown[c]) continue;
        const chunk = mass.chunks[c];
        for (let v = 0; v < chunk.count; v++) index.setX(cursor++, chunk.start + v);
      }
      index.needsUpdate = true;
      geometry.setDrawRange(0, cursor);
    },
    dispose() {
      geometry.dispose();
    },
  };
}
