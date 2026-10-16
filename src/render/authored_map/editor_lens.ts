// Editor-only lens override, moved out of renderer.ts. The map editor keeps
// the one shared PerspectiveCamera object (many render subsystems retain it)
// but gives it a true orthographic projection matrix while it asks for one.

import type * as THREE from 'three';

/** Overwrite the camera's projection with an orthographic box `viewHeight`
 *  yards tall at the viewport's aspect (call after updateProjectionMatrix). */
export function applyOrthographicLens(
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  viewHeight: number,
): void {
  const halfH = Math.max(0.01, viewHeight / 2);
  const halfW = halfH * (width / Math.max(1, height));
  camera.projectionMatrix.makeOrthographic(-halfW, halfW, halfH, -halfH, camera.near, camera.far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

/** Raycaster projection matching an orthographic lens on a perspective
 *  camera. Raycaster.setFromCamera dispatches by camera class, so the editor's
 *  swapped projection needs the orthographic ray built by hand. */
export function setRaycasterFromOrthographicLens(
  raycaster: THREE.Raycaster,
  camera: THREE.PerspectiveCamera,
  coords: THREE.Vector2,
): void {
  raycaster.ray.origin
    .set(coords.x, coords.y, (camera.near + camera.far) / (camera.near - camera.far))
    .unproject(camera);
  raycaster.ray.direction.set(0, 0, -1).transformDirection(camera.matrixWorld);
  raycaster.camera = camera;
}
