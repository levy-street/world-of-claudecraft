// The ferry piers at the far berths (sim/ferry_piers.ts): the Moonrest pier
// off the Nightbloom's sunset shore and the Wyrmwatch pier with its bluff
// stair, drawn in New Eastbrook's harbor wood from the same deck rectangles
// world.ts groundHeight walks (render/eastbrook_harbor.ts buildHarborWood),
// so the planks underfoot are the planks on screen. Built once into the
// props root beside the scheduled ships (props.ts), linked by the world-entry
// compile with the rest of the props (the Eastbrook harbor's two programs);
// nothing here runs per frame. Each pier is its own group with its meshes
// re-centred on the pier, so the props static merge files each one in its
// own band and its bounds stay pier-sized (the two are a world apart).

import * as THREE from 'three';
import { FERRY_PIERS } from '../sim/ferry_piers';
import { buildHarborWood } from './eastbrook_harbor';

const centre = new THREE.Vector3();

export function buildFerryPiers(seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ferryPiers';
  FERRY_PIERS.forEach((decks, i) => {
    const pier = buildHarborWood(`ferryPier${i}`, decks, seed);
    for (const child of pier.children) {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) continue;
      mesh.geometry.computeBoundingBox();
      mesh.geometry.boundingBox?.getCenter(centre);
      mesh.geometry.translate(-centre.x, -centre.y, -centre.z);
      mesh.geometry.computeBoundingSphere();
      mesh.position.copy(centre);
    }
    group.add(pier);
  });
  return group;
}
