import type * as THREE from 'three';

// Wide labels and emote bubbles may still intersect the viewport while their
// projected anchor is just outside it. Keep one bounded gutter, then reject the
// rest before the declutter sort and canvas pass.
export const NAMEPLATE_VIEWPORT_GUTTER_PX = 120;

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

export function isNameplateScreenAnchorVisible(
  screenX: number,
  screenY: number,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  const gutter = NAMEPLATE_VIEWPORT_GUTTER_PX;
  return (
    screenX >= -gutter &&
    screenX <= viewportWidth + gutter &&
    screenY >= -gutter &&
    screenY <= viewportHeight + gutter
  );
}
