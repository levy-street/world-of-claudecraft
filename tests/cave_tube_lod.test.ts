// Cave tube distance culling (render/cave_tube_lod.ts): a mine under a
// mountain draws only while the camera is near it. SPACEY (Deepglass mines):
// "insure the performance stays good, the cave only renders when you're close".

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CAVE_TUBE_VIEW_FAR,
  footprintDistance,
  tubeVisible,
  updateCaveTubeVisibility,
} from '../src/render/cave_tube_lod';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

function tubeMesh(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  name: string,
): THREE.Mesh {
  // a world-space slab standing in for a tube: the bounds are what matter
  const geo = new THREE.BoxGeometry(maxX - minX, 4, maxZ - minZ);
  geo.translate((minX + maxX) / 2, 20, (minZ + maxZ) / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  mesh.name = name;
  return mesh;
}

describe('cave tube distance culling', () => {
  it('measures to the nearest point of the footprint, so a long gallery you stand in never culls', () => {
    const f = { minX: 0, maxX: 300, minZ: -4, maxZ: 4 };
    expect(footprintDistance(f, 150, 0)).toBe(0); // inside
    expect(footprintDistance(f, 150, 10)).toBe(6); // beside it
    expect(footprintDistance(f, -30, 0)).toBe(30); // off its near end
    expect(footprintDistance(f, 300 + 300, 0)).toBe(300); // far end, way off
    // standing at one end of a 300-yard gallery: still drawn
    expect(tubeVisible(f, -5, 0)).toBe(true);
    expect(tubeVisible(f, -(CAVE_TUBE_VIEW_FAR + 1), 0)).toBe(false);
  });

  it('keeps every mouth a camera can resolve backed by its tube', () => {
    // the detail terrain (which honours the mouth cut) reaches ~150 yd, so the
    // tube must still draw at least that far or the cut shows sky
    expect(CAVE_TUBE_VIEW_FAR).toBeGreaterThanOrEqual(150);
    expect(CAVE_TUBE_VIEW_FAR).toBeLessThanOrEqual(300);
  });

  it('hides the far tubes of a network and counts the drawn ones', () => {
    const group = new THREE.Group();
    group.add(tubeMesh(-80, -20, 890, 940, 'cave:south_adit'));
    group.add(tubeMesh(-30, 20, 940, 970, 'cave:cart_hall'));
    group.add(tubeMesh(-40, 10, 1030, 1120, 'cave:north_adit'));
    // camera on the south beach: the adit and the hall draw, the north exit does not
    expect(updateCaveTubeVisibility(group, -90, 880, 120)).toBe(2);
    expect(group.getObjectByName('cave:south_adit')?.visible).toBe(true);
    expect(group.getObjectByName('cave:north_adit')?.visible).toBe(false);
    // camera in the city, far away: nothing draws
    expect(updateCaveTubeVisibility(group, 0, 495, 240)).toBe(0);
    // camera inside the hall: everything within reach comes back
    expect(updateCaveTubeVisibility(group, 0, 955, 240)).toBe(3);
  });

  it('runs every frame from the renderer, before the cavity LOD tick', () => {
    const renderer = codeWithoutLineComments(
      readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
    );
    expect(renderer).toContain(
      'this.authoredLayers?.updateLod(this.camera.position.x, this.camera.position.z)',
    );
    const layers = codeWithoutLineComments(
      readFileSync(new URL('../src/render/authored_map/layers.ts', import.meta.url), 'utf8'),
    );
    expect(layers).toContain("import { updateCaveTubeVisibility } from '../cave_tube_lod'");
    const call = layers.indexOf('updateCaveTubeVisibility(this.caveGroup');
    const lod = layers.indexOf('updateCutCavityLod(');
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(lod);
  });
});
