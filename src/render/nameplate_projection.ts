import * as THREE from 'three';

export function isProjectedNameplateAnchorVisible(
  camera: THREE.PerspectiveCamera,
  worldPos: THREE.Vector3,
  cameraSpace: THREE.Vector3,
): boolean {
  cameraSpace.copy(worldPos).applyMatrix4(camera.matrixWorldInverse);
  return cameraSpace.z < -camera.near;
}
