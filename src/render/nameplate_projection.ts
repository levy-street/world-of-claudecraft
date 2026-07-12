import * as THREE from 'three';

export function isProjectedNameplateAnchorVisible(
  camera: THREE.PerspectiveCamera,
  worldPos: THREE.Vector3,
  cameraSpace: THREE.Vector3,
): boolean {
  cameraSpace.copy(worldPos).applyMatrix4(camera.matrixWorldInverse);
  return cameraSpace.z < -camera.near;
}

export function nameplateScreenTransform(screenX: number, screenY: number): string {
  return `translate3d(${screenX.toFixed(2)}px, ${screenY.toFixed(2)}px, 0) translate(-50%, -100%)`;
}
