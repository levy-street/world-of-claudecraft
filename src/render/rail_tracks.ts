// Spline railways (WorldContent.rails): one double-sided mesh per rail line,
// built from rail_tracks_core.ts and seated on the carve floor it runs over.
import * as THREE from 'three';
import { getActiveWorldContent } from '../sim/data';
import { cavitySheetAt } from '../sim/ground_sheets';
import { terrainHeight } from '../sim/world';
import { buildRailMesh } from './rail_tracks_core';

export const RAIL_GROUP_NAME = 'rail-tracks';

let railMaterial: THREE.MeshStandardMaterial | null = null;
function material(): THREE.MeshStandardMaterial {
  if (!railMaterial) {
    railMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.25,
      // winding-agnostic: the sweep is thin and seen from every side
      side: THREE.DoubleSide,
    });
    railMaterial.name = 'rail-tracks';
  }
  return railMaterial;
}

/** Build every rail line of the active world. Static: nothing here moves. */
export function buildRailTracks(seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = RAIL_GROUP_NAME;
  group.matrixAutoUpdate = false;
  const content = getActiveWorldContent();
  const rails = content.rails;
  if (!rails || rails.length === 0) return group;
  const floorAt = (x: number, z: number, y: number): number | null => {
    const surface = terrainHeight(x, z, seed);
    const sheet = cavitySheetAt(content.holes, content.holePatches, x, z, surface, y);
    if (sheet) return sheet.floor;
    // in the open (a cutting, a yard under the sky) the track rides the ground
    return Math.abs(surface - y) < 3 ? surface : null;
  };
  rails.forEach((line, i) => {
    const arrays = buildRailMesh(line.points, { gauge: line.gauge, floorAt });
    if (!arrays) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(arrays.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material());
    mesh.name = `rail-line-${i}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  });
  return group;
}

export function disposeRailTracks(group: THREE.Group): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry.dispose();
  });
  group.clear();
}
