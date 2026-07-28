import type * as THREE from 'three';

export function isProjectedNameplateAnchorVisible(
  camera: THREE.PerspectiveCamera,
  worldPos: THREE.Vector3,
  cameraSpace: THREE.Vector3,
): boolean {
  cameraSpace.copy(worldPos).applyMatrix4(camera.matrixWorldInverse);
  return cameraSpace.z < -camera.near;
}

/** True only for finite clip-space coordinates inside the actual viewport.
 * Admission uses this after the near-plane guard so offscreen views cannot
 * consume the ordinary nameplate budget. */
export function isNameplateNdcInViewport(x: number, y: number, z: number): boolean {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(z) &&
    x >= -1 &&
    x <= 1 &&
    y >= -1 &&
    y <= 1 &&
    z >= -1 &&
    z <= 1
  );
}

export function nameplateScreenTransform(screenX: number, screenY: number): string {
  return `translate3d(${screenX.toFixed(2)}px, ${screenY.toFixed(2)}px, 0) translate(-50%, -100%)`;
}
