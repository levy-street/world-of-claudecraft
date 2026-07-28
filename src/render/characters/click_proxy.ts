import * as THREE from 'three';
import { pickProxyHeight } from './anim_state';

let geometry: THREE.CylinderGeometry | null = null;
let material: THREE.Material | null = null;

function sharedGeometry(): THREE.CylinderGeometry {
  if (!geometry) {
    geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
    geometry.translate(0, 0.5, 0);
  }
  return geometry;
}

function sharedMaterial(): THREE.Material {
  material ??= new THREE.MeshBasicMaterial();
  return material;
}

/** Stable player-view hitbox. It belongs to the shell rather than the rig, so
 * targeting survives batched/rig promotion without swapping click targets. */
export function createCharacterClickProxy(
  height: number,
  radius: number,
  dead: boolean,
): THREE.Mesh {
  const proxy = new THREE.Mesh(sharedGeometry(), sharedMaterial());
  proxy.visible = false;
  syncCharacterClickProxy(proxy, height, radius, dead);
  return proxy;
}

export function syncCharacterClickProxy(
  proxy: THREE.Mesh,
  height: number,
  radius: number,
  dead: boolean,
): void {
  proxy.scale.set(radius * 2, pickProxyHeight(height, radius, dead), radius * 2);
}
