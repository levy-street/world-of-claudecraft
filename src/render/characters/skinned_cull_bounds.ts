// The padded bounding sphere that lets three cull a skinned caster PER PASS.
//
// A rig's skinned meshes used to carry `frustumCulled = false`, because a
// SkinnedMesh's bind-pose sphere does not follow the animated pose and three
// would pop a visible rig out. The cost was that three never culled a rig at
// all, in either pass, so every rig inside the draw band paid a colour draw and
// a shadow draw every frame. This module buys the culling back by making the
// sphere honest instead: `character_cull_core.ts` derives a radius that
// contains the whole animated body from whatever point the bind-pose sphere is
// centred on, plus a margin for animation drift and a frame of movement, and
// three then tests it against the CAMERA frustum in projectObject and against
// the SHADOW CAMERA frustum in WebGLShadowMap.renderObject. Those are two
// different questions and that is the point: the renderer keeps a rig whose
// shadow reaches the view visible, and three draws only its shadow.
//
// The sphere lives in the mesh's own object space, so the radius is divided by
// the accumulated scale up to the visual root. The group's live entity scale
// sits above that root and rides matrixWorld, so a resized rig needs no rework.
// three scales the sphere by the composed matrix's LARGEST axis, which is at
// most the product of the per-node largest axes and is strictly less once a
// rotation sits between two non-uniform ones. Dividing by the product of the
// per-node SMALLEST axes is therefore the arm that cannot under-pad; on the
// shipped rigs every node scale is uniform, so the two agree exactly.
// The radius is always rebuilt from the GEOMETRY sphere, never from the mesh's
// current one, so re-applying it after a material rebuild cannot compound.
//
// The CENTRE is the posed body's when prepareVisual measured one. A quantized
// skinned GLB (gltfpack/meshopt) keeps its positions in a packed space whose
// dequantization lives in the inverse bind matrices, so the geometry sphere's
// centre is NOT where the skinned vertices land: the frog rig's eye and spot
// primitives sat about 20 times their real offset from the root, their padded
// spheres floated far above the body and three culled them (the Spore Toad and
// the Mirefen murlocs drew with empty eye sockets and holes in the arms).
// prepareVisual already skins every vertex of a posed throwaway to measure the
// body, so it notes each geometry's posed centre here at no extra cost.

import * as THREE from 'three';
import { skinnedCullSphereRadius } from '../character_cull_core';
import { renderLayerDisabled } from '../render_dev_flags';

/** Posed centres (mesh object space), keyed by the shared geometry. */
const posedCentres = new WeakMap<THREE.BufferGeometry, THREE.Vector3>();

/** Remember where a skinned geometry's vertices really land (mesh object
 *  space, the posed body's box centre): prepareVisual notes it once per key. */
export function notePosedCullCentre(geometry: THREE.BufferGeometry, centre: THREE.Vector3): void {
  if (Number.isFinite(centre.x) && Number.isFinite(centre.y) && Number.isFinite(centre.z))
    posedCentres.set(geometry, centre.clone());
}

/** The posed box centre of a skinned mesh in its own object space, from its
 *  CURRENT bone matrices (the caller has posed it and updated the skeleton). */
export function measurePosedCullCentre(mesh: THREE.SkinnedMesh): THREE.Vector3 | null {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos || pos.count === 0) return null;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, v);
    box.expandByPoint(v);
  }
  return box.getCenter(new THREE.Vector3());
}

/** Accumulated (min-axis) scale from `mesh`'s object space up to `root`. */
function scaleToRoot(mesh: THREE.Object3D, root: THREE.Object3D): number {
  let scale = 1;
  let node: THREE.Object3D | null = mesh;
  while (node !== null && node !== root) {
    const s = node.scale;
    scale *= Math.min(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
    node = node.parent;
  }
  return scale;
}

/**
 * Let three frustum-cull this skinned caster, against a sphere big enough that
 * no pose can escape it. `height` is the rig's authored world height at unit
 * entity scale (`VisualDef.height`); `root` is the visual root the entity
 * scale is applied above.
 */
export function applySkinnedCullBounds(
  mesh: THREE.SkinnedMesh,
  root: THREE.Object3D,
  height: number,
): void {
  const geometry = mesh.geometry;
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  const source = renderLayerDisabled('charcull') ? null : geometry.boundingSphere;
  if (source === null) {
    // ?charcull=off, so the A/B arm really is the old submission. The null is
    // also the defensive answer to a geometry with no bounds to centre on:
    // three's computeBoundingSphere always assigns one, but a rig must never
    // vanish for want of a sphere if that ever stops being true.
    mesh.frustumCulled = false;
    return;
  }
  const radius = skinnedCullSphereRadius(height, scaleToRoot(mesh, root));
  if (!Number.isFinite(radius)) {
    // A collapsed scale chain: say the exemption outright rather than store an
    // infinite radius, whose transformed sphere would fail open through a NaN.
    mesh.frustumCulled = false;
    return;
  }
  const centre = posedCentres.get(geometry) ?? source.center;
  mesh.boundingSphere = new THREE.Sphere(centre.clone(), radius);
  mesh.frustumCulled = true;
}
