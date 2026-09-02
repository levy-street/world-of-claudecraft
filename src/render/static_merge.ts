// The static prop merge: the props view's build-time draw-call collapse.
//
// Every static prop mesh is baked into world space and merged per
// (material, attribute signature, x-half, z-band), so a village's hundreds of
// small boxes reach the GPU as a handful of draws. Lives beside props.ts
// rather than inside it because the merge is self-contained build-time
// geometry work with its own tests (tests/props_static_merge.test.ts), and
// props.ts is a coordinator this repo keeps from growing.
//
// The shadow half of the decision (and why castShadow is not in the key) is
// the pure static_merge_shadow_core.ts; this module is its Three.js consumer.

import * as THREE from 'three';
import {
  deinterleaveGeometry,
  mergeGeometries,
} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD_MIN_Z } from '../sim/data';
import { indexExactVertexTuples } from './exact_index_geometry';
import { GFX } from './gfx';
import {
  attachShadowRangeGate,
  planStaticMergeShadow,
  staticMergeAttributeSignature,
} from './static_merge_shadow_core';

/** Merge band depth in world units. Shallower without PBR: the low tier's
 *  cheaper materials make more, smaller bands the better cull trade. */
export const mergeBandDepth = (): number => (GFX.standardMaterials ? 180 : 90);

// Bake every static prop mesh into world space and merge per
// (material, attribute signature, z-band). Flames (animated) and
// InstancedMeshes survive untouched, as do the PointLights (not meshes). The
// merged meshes replace the originals on the same group; emptied sub-groups
// are left in place (they carry lights). Non-indexed procedural shapes receive
// exact tuple indices so they can share indexed glTF buckets without expanding
// either. castShadow is NOT part of the key: a bucket's casters and its
// non-casters share a material and therefore a program, so splitting them
// bought a second draw and a second uniform upload per bucket on exactly the
// tiers that pay for a shadow pass. They merge casters-first instead and the
// shadow pass is clipped to that prefix (static_merge_shadow_core.ts).
export function mergeStaticMeshes(group: THREE.Group, keep: Set<THREE.Object3D>): THREE.Mesh[] {
  group.updateMatrixWorld(true);
  interface Bucket {
    material: THREE.Material;
    geoms: THREE.BufferGeometry[];
    casts: boolean[];
  }
  const buckets = new Map<string, Bucket>();
  const merged: THREE.Mesh[] = [];
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || keep.has(mesh) || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
    const material = mesh.material as THREE.Material;
    const worldX = mesh.matrixWorld.elements[12];
    const worldZ = mesh.matrixWorld.elements[14];
    const band = Math.floor((worldZ - WORLD_MIN_Z) / mergeBandDepth());
    // Extracted geometries are shared across placements, so the bake must
    // never mutate them in place. Preserve source index reuse and normalize
    // procedural streams with byte-exact full-tuple indices.
    const geo = normalizedStaticGeometry(mesh.geometry);
    // x-halved like the instance batches above: world-wide merged bands
    // defeat shadow-frustum culling (their bounds always intersect it).
    const half = worldX < 0 ? 'w' : 'e';
    const key = `${material.uuid}:${staticMergeAttributeSignature(geo)}:${half}:${band}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material, geoms: [], casts: [] };
      buckets.set(key, bucket);
    }
    bucket.geoms.push(geo.applyMatrix4(mesh.matrixWorld));
    bucket.casts.push(mesh.castShadow);
    merged.push(mesh);
  });
  for (const mesh of merged) mesh.removeFromParent();
  const out: THREE.Mesh[] = [];
  for (const bucket of buckets.values()) {
    const plan = planStaticMergeShadow(
      bucket.geoms.map((g, i) => ({
        castShadow: bucket.casts[i],
        indexCount: g.getIndex()?.count ?? 0,
      })),
    );
    const geo = mergeGeometries(
      plan.order.map((i) => bucket.geoms[i]),
      false,
    );
    if (!geo) continue;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, bucket.material);
    mesh.castShadow = plan.castShadow;
    mesh.receiveShadow = true;
    if (plan.needsShadowRangeGate) attachShadowRangeGate(mesh, plan.casterIndexCount);
    group.add(mesh);
    out.push(mesh);
  }
  return out;
}

export function normalizedStaticGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const normalized = source.clone();
  deinterleaveGeometry(normalized);
  return normalized.index ? normalized : indexExactVertexTuples(normalized);
}
