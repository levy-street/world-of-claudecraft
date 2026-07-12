import * as THREE from 'three';

export function isProjectedNameplateAnchorVisible(
  camera: THREE.PerspectiveCamera,
  worldPos: THREE.Vector3,
  cameraSpace: THREE.Vector3,
): boolean {
  cameraSpace.copy(worldPos).applyMatrix4(camera.matrixWorldInverse);
  return cameraSpace.z < -camera.near;
}

// Order matters: scale sits BETWEEN the screen translate and the anchor
// translate. Combined with `transform-origin: 0 0` on .nameplate (hud.css), the
// plate's bottom-center anchor stays exactly at (screenX, screenY) while the
// plate shrinks toward it; with the default 50% 50% origin a scaled plate would
// drift off its anchor.
export function nameplateScreenTransform(screenX: number, screenY: number, scale: number): string {
  return `translate3d(${screenX.toFixed(2)}px, ${screenY.toFixed(2)}px, 0) scale(${scale.toFixed(3)}) translate(-50%, -100%)`;
}
