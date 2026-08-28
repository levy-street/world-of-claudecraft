// The corpse beacon (src/render/corpse_beacon.ts): one mesh in the scene,
// shown over the corpse during the ghost run, hidden otherwise.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCorpseBeacon } from '../src/render/corpse_beacon';

describe('createCorpseBeacon', () => {
  it('adds one hidden ui3d pillar to the scene', () => {
    const scene = new THREE.Scene();
    const beacon = createCorpseBeacon(scene);
    expect(scene.children).toEqual([beacon.mesh]);
    expect(beacon.mesh.visible).toBe(false);
    expect(beacon.mesh.userData.renderCategory).toBe('ui3d');
    expect(beacon.mesh.renderOrder).toBe(2);
  });

  it('stands 7 above the corpse while there is one, and hides when the run ends', () => {
    const beacon = createCorpseBeacon(new THREE.Scene());
    beacon.sync({ x: 10, y: 2, z: -4 });
    expect(beacon.mesh.visible).toBe(true);
    expect(beacon.mesh.position.toArray()).toEqual([10, 9, -4]);
    beacon.sync(null);
    expect(beacon.mesh.visible).toBe(false);
    beacon.sync({ x: 1, y: 0, z: 1 });
    expect(beacon.mesh.visible).toBe(true);
    expect(beacon.mesh.position.toArray()).toEqual([1, 7, 1]);
  });
});
