// Static mesh merging for placed assets.
//
// A kit GLB arrives as many small nodes: a house is 26 sub-meshes over 8
// materials, a castle 150 over a dozen. Every node is a draw call (twice, with
// the sun's shadow pass), and on a real map the placed assets were ~55% of all
// draw submissions, measured at the Tidehold city on Ultra: 890 draws a
// frame, 480 of them placements, at ~2500 visible nodes. Sub-meshes that share
// a material and a vertex layout can be baked into ONE geometry in their
// template's root frame with no visible change, so the instance batches
// (placed_batches.templateSubs) and the per-copy clones (the interior-reveal
// buildings, placed_assets) draw them in one call.
//
// What is never merged, and why:
//   - a node whose material carries a shader patch (tree sway, ship motion):
//     those displace `transformed` in the NODE's frame, and baking the node
//     transform into the vertices would change the frame under the shader;
//   - a mesh with its own onBeforeRender (the fire puffs pose themselves);
//   - skinned meshes, morph targets, a limited drawRange, a multi-material
//     mesh (geometry groups cannot be split per instance);
//   - a MIRRORED node without an index buffer (the winding flip that keeps a
//     mirrored part front-facing is only cheap on indexed triangles).
// Interior-reveal buildings hide their storeys by GROUP visibility
// (render/interior_reveal.ts: G_H1/G_H2/G_H3), so a clone merges within each
// storey group separately; the groups survive, only their leaf meshes fuse.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { normalizeGeometryAttributesForMerge } from './geometry_merge';

const DEFAULT_ON_BEFORE_COMPILE = THREE.Material.prototype.onBeforeCompile;
const DEFAULT_ON_BEFORE_RENDER = THREE.Object3D.prototype.onBeforeRender;
const IDENTITY = new THREE.Matrix4();

/**
 * The merge group a mesh belongs to, or null when it must keep its own draw.
 * Two meshes with equal signatures can share one geometry and one draw call.
 */
export function mergeSignature(mesh: THREE.Mesh, material: THREE.Material): string | null {
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) return null;
  if (Array.isArray(mesh.material)) return null;
  const geometry = mesh.geometry;
  if (!geometry?.getAttribute('position')) return null;
  if (geometry.morphAttributes && Object.keys(geometry.morphAttributes).length > 0) return null;
  if (geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) return null;
  // A node-frame-bound shader patch (sway, ship motion) pins the node; the
  // per-instance fade patch (placed_fade.ts) is frame-agnostic and records
  // whether it wrapped such a patch, so read its verdict when it is present.
  const ud = material.userData as { wocFadePatched?: boolean; wocFrameBound?: boolean };
  if (ud.wocFrameBound === true) return null;
  if (!ud.wocFadePatched && material.onBeforeCompile !== DEFAULT_ON_BEFORE_COMPILE) return null;
  if (mesh.onBeforeRender !== DEFAULT_ON_BEFORE_RENDER) return null;
  const layout = Object.keys(geometry.attributes)
    .sort()
    .map((name) => `${name}:${geometry.getAttribute(name).itemSize}`)
    .join(',');
  return `${material.uuid}|${layout}|${geometry.index ? 'i' : 'n'}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${mesh.renderOrder}|${mesh.layers.mask}`;
}

/**
 * A float32 copy of `source` with `matrix` baked into its positions, normals
 * and tangents (quantized GLB attributes are widened first: a normalized
 * int16 position cannot hold a world coordinate). A mirrored matrix flips
 * the triangle winding so the part stays front-facing without the per-object
 * determinant check three does for a scene node; null for a mirrored
 * non-indexed part, which the caller then leaves unmerged.
 */
export function bakeGeometry(
  source: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
): THREE.BufferGeometry | null {
  const mirrored = matrix.determinant() < 0;
  if (mirrored && !source.index) return null;
  const geometry = source.clone();
  geometry.clearGroups();
  normalizeGeometryAttributesForMerge(geometry);
  if (!matrix.equals(IDENTITY)) geometry.applyMatrix4(matrix);
  if (mirrored && geometry.index) {
    const index = geometry.index.array;
    for (let i = 0; i + 2 < index.length; i += 3) {
      const t = index[i + 1];
      index[i + 1] = index[i + 2];
      index[i + 2] = t;
    }
    geometry.index.needsUpdate = true;
  }
  return geometry;
}

/**
 * Fuse baked parts into one geometry. The parts are CPU-side copies from
 * bakeGeometry and are released here whatever the outcome; null when their
 * layouts turned out incompatible (the caller keeps the originals).
 */
export function mergeBaked(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const merged = parts.length > 0 ? mergeGeometries(parts, false) : null;
  for (const part of parts) part.dispose();
  if (!merged) return null;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** A bucket name matches exactly, or by prefix when it ends with `*`. */
function isBucket(bucketNames: readonly string[], name: string): boolean {
  for (const b of bucketNames) {
    if (b.endsWith('*') ? name.startsWith(b.slice(0, -1)) : name === b) return true;
  }
  return false;
}

export interface StaticMergeResult {
  /** The merged geometries, owned by the caller (dispose them with the model). */
  geometries: THREE.BufferGeometry[];
  meshesBefore: number;
  meshesAfter: number;
}

/**
 * Merge the leaf meshes of a static model subtree in place: every set of
 * meshes with one merge signature under the same bucket becomes one mesh
 * added to that bucket, and the sources leave the graph. A bucket is the
 * nearest ancestor whose name is in `bucketNames` (a storey group whose
 * visibility flips as a whole), else `root`. Transforms are read from the
 * subtree as it stands, so call this before the model is seated in the world
 * (root at identity) or the baked positions inherit the seat.
 */
export function mergeStaticMeshes(
  root: THREE.Object3D,
  bucketNames: readonly string[],
): StaticMergeResult {
  root.updateMatrixWorld(true);
  const buckets = new Map<THREE.Object3D, Map<string, THREE.Mesh[]>>();
  let meshesBefore = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshesBefore++;
    if (!mesh.visible || Array.isArray(mesh.material)) return;
    // A mesh that is itself a bucket (a G_MOV_* moving part exported as one
    // primitive: render/placed_movers.ts) keeps its own node and matrix.
    if (isBucket(bucketNames, mesh.name)) return;
    const signature = mergeSignature(mesh, mesh.material);
    if (signature === null) return;
    let bucket: THREE.Object3D = root;
    for (let p = mesh.parent; p && p !== root; p = p.parent) {
      if (isBucket(bucketNames, p.name)) {
        bucket = p;
        break;
      }
    }
    let groups = buckets.get(bucket);
    if (!groups) {
      groups = new Map();
      buckets.set(bucket, groups);
    }
    const group = groups.get(signature);
    if (group) group.push(mesh);
    else groups.set(signature, [mesh]);
  });
  const geometries: THREE.BufferGeometry[] = [];
  const inverse = new THREE.Matrix4();
  const relative = new THREE.Matrix4();
  for (const [bucket, groups] of buckets) {
    inverse.copy(bucket.matrixWorld).invert();
    for (const meshes of groups.values()) {
      if (meshes.length < 2) continue;
      const parts: THREE.BufferGeometry[] = [];
      for (const mesh of meshes) {
        relative.multiplyMatrices(inverse, mesh.matrixWorld);
        const baked = bakeGeometry(mesh.geometry, relative);
        if (!baked) break;
        parts.push(baked);
      }
      if (parts.length !== meshes.length) {
        for (const part of parts) part.dispose();
        continue;
      }
      const merged = mergeBaked(parts);
      if (!merged) continue;
      const first = meshes[0];
      const material = first.material as THREE.Material;
      const fused = new THREE.Mesh(merged, material);
      fused.name = `merged:${material.name || first.name}`;
      fused.castShadow = first.castShadow;
      fused.receiveShadow = first.receiveShadow;
      fused.renderOrder = first.renderOrder;
      fused.layers.mask = first.layers.mask;
      bucket.add(fused);
      for (const mesh of meshes) mesh.removeFromParent();
      geometries.push(merged);
    }
  }
  let meshesAfter = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshesAfter++;
  });
  return { geometries, meshesBefore, meshesAfter };
}
