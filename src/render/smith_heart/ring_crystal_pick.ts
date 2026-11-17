// The ring crystal's click volume: the body of the crystal ENTITY's view (gate_objects.ts).
// The crystal is drawn by the seal (heart_seal.ts), so its entity, the claim object the sim
// keeps pressable once all four veins burn (encounters/smith_heart/seal_crystal.ts), has no
// look of its own: an empty anchor carrying one invisible frustum as wide as the plinth, which
// the picker raycasts like a character's click capsule. A click on it is exactly a click on
// that entity (the same pick, the same range check and approach, the same authoritative press).
// One shared geometry and one shared material for the process, like the characters' proxies.

import * as THREE from 'three';
import { markSharedGeometry, markSharedMaterial } from '../shared_resource';
import { RING_CRYSTAL_CLICK } from './ring_crystal_core';

let geometry: THREE.CylinderGeometry | null = null;
let material: THREE.Material | null = null;

/** The crystal entity's view body: an empty group holding the hidden click frustum. */
export function buildRingCrystalClickBody(): THREE.Group {
  const C = RING_CRYSTAL_CLICK;
  geometry ??= markSharedGeometry(
    new THREE.CylinderGeometry(C.topR, C.baseR, C.height, 12).translate(0, C.height / 2, 0),
  );
  material ??= markSharedMaterial(new THREE.MeshBasicMaterial());
  const proxy = new THREE.Mesh(geometry, material);
  proxy.name = 'ringCrystalClick';
  // Hidden but raycast: three's raycaster ignores `visible`, so only the picker sees it.
  proxy.visible = false;
  const group = new THREE.Group();
  group.name = 'ringCrystalClickBody';
  group.add(proxy);
  return group;
}
