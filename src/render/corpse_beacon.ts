// The corpse beacon: a soft light pillar over the local player's body while
// their spirit runs back to it (the ghost run). Built once, on the first
// ghost run of the session, then repositioned or hidden per frame.

import * as THREE from 'three';
import { setRenderCategory } from './renderer_diagnostics';
import { corpseBeaconMaterialOptions } from './vfx_basic_materials';

export interface CorpseBeacon {
  readonly mesh: THREE.Mesh;
  /** Show the pillar over the corpse, or hide it when there is none. */
  sync(corpse: { x: number; y: number; z: number } | null): void;
}

export function createCorpseBeacon(scene: THREE.Object3D): CorpseBeacon {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 14, 8, 1, true),
    new THREE.MeshBasicMaterial(corpseBeaconMaterialOptions()),
  );
  mesh.renderOrder = 2;
  mesh.visible = false;
  setRenderCategory(mesh, 'ui3d');
  scene.add(mesh);
  return {
    mesh,
    sync(corpse) {
      if (!corpse) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      mesh.position.set(corpse.x, corpse.y + 7, corpse.z);
    },
  };
}
