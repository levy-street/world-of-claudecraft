import type * as THREE from 'three';

// Shared object-view resources: views must not own the materials/geometries they
// draw with, or interest churn leaks them (removeView only disposes per-view,
// non-shared geometry). Tagging a resource here marks it as renderer-owned and
// process-lifetime, so the per-view disposal guard skips it. The flag lives on
// `userData` so any subsystem that builds a shared resource (e.g. door_portal.ts)
// marks it the same way the renderer's disposal path reads it back.

export function markSharedGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
  geometry.userData.sharedRendererResource = true;
  return geometry;
}

export function markSharedMaterial<T extends THREE.Material>(material: T): T {
  material.userData.sharedRendererResource = true;
  return material;
}

export function isSharedGeometry(geometry: THREE.BufferGeometry): boolean {
  return geometry.userData.sharedRendererResource === true;
}

export function isSharedMaterial(material: THREE.Material): boolean {
  return material.userData.sharedRendererResource === true;
}

// Textures follow the same rule, and one case makes it load-bearing: the
// weapon-skin emissive derivation is memoized per (source map, emissive spec),
// so one derived texture pair is handed to every wearer of that skin. The
// first wearer's rig tearing down must not dispose it out from under the
// others (or under the next wearer), so the cache marks what it owns here and
// every dispose path asks before releasing.
export function markSharedTexture<T extends THREE.Texture>(texture: T): T {
  texture.userData.sharedRendererResource = true;
  return texture;
}

export function isSharedTexture(texture: THREE.Texture): boolean {
  return texture.userData.sharedRendererResource === true;
}
