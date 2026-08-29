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

/**
 * Material.copy deep-copies userData, so a clone() of a tagged shared material
 * silently INHERITS the shared flag and every disposal guard skips it forever.
 * A builder that clones a shared material into a view-owned or build-owned
 * variant (a recolor, a tinted grade, an occluder-fade wall clone) must strip
 * the tag so teardown actually frees the clone.
 */
export function markOwnedMaterial<T extends THREE.Material>(material: T): T {
  delete material.userData.sharedRendererResource;
  return material;
}

export interface UnsharedDisposeCounts {
  geometries: number;
  materials: number;
}

/**
 * Dispose every geometry/material under `root` that is NOT tagged shared, in
 * one traversal. This is the teardown half of the tagging contract above: the
 * per-view object disposal (renderer removeView) calls it, so a builder that
 * mints an untagged resource gets it freed with the scene nodes, and a builder
 * that shares one must tag it (or it will be freed out from under every other
 * consumer). Interior teardown does NOT come through here: a retired interior
 * is torn down by the interior resource registry
 * (interior_resource_lifecycle.ts), which also owns releasing InstancedMesh
 * per-build instance buffers.
 *
 * Mesh-scoped on purpose (`isMesh` only): Sprites/Points in view groups carry
 * renderer-owned singleton materials (the loot sparkle, badge sprites) and are
 * managed by their owners. Returns counts so leak-guard tests can assert
 * coverage.
 */
export function disposeUnsharedMeshResources(
  root: THREE.Object3D,
  opts: { geometries?: boolean; materials?: boolean },
): UnsharedDisposeCounts {
  const seenGeometries = new Set<THREE.BufferGeometry>();
  const seenMaterials = new Set<THREE.Material>();
  let geometries = 0;
  let materials = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (
      opts.geometries &&
      mesh.geometry &&
      !isSharedGeometry(mesh.geometry) &&
      !seenGeometries.has(mesh.geometry)
    ) {
      seenGeometries.add(mesh.geometry);
      mesh.geometry.dispose();
      geometries++;
    }
    if (opts.materials) {
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) {
        if (!material || isSharedMaterial(material) || seenMaterials.has(material)) continue;
        seenMaterials.add(material);
        material.dispose();
        materials++;
      }
    }
  });
  return { geometries, materials };
}
