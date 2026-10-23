// The padded bounding sphere that lets three cull a skinned caster PER PASS.
//
// A rig's skinned meshes used to carry `frustumCulled = false`, because a
// SkinnedMesh's bind-pose sphere does not follow the animated pose and three
// would pop a visible rig out. The cost was that three never culled a rig at
// all, in either pass, so every rig inside the draw band paid a colour draw and
// a shadow draw every frame. This module buys the culling back by making the
// sphere honest instead: `character_cull_core.ts` derives a radius that
// contains the whole animated body from any point within one rig radius of the
// rig's centre, plus a margin for animation drift and a frame of movement, and
// three then tests it against the CAMERA frustum in projectObject and against
// the SHADOW CAMERA frustum in WebGLShadowMap.renderObject. Those are two
// different questions and that is the point: the renderer keeps a rig whose
// shadow reaches the view visible, and three draws only its shadow.
//
// WHERE the sphere sits is the half that is easy to get wrong. three places a
// mesh's sphere with the mesh's own matrixWorld, but a skinned vertex never
// passes through that matrix: the bones and the inverse binds place it (three's
// attached bind mode cancels the mesh node outright, as glTF specifies). So a
// point taken in GEOMETRY space, the bind-pose sphere's centre included, is on
// the body only when the mesh node happens to be an identity frame over the
// rig. It is not on the kit creature rigs: their mesh node hangs under the
// exporter's x100 unit node and their positions are quantized, with the
// dequantization folded into the inverse binds, so that centre came out tens
// of yards off the body and three culled the face, the eyes and the teeth off
// a mob standing in plain view (one sphere per primitive, each lost on its
// own). The radius only holds from a point within one rig radius of the rig's
// centre, so that premise is checked instead of assumed: a geometry centre
// that lands on the rig is kept exactly as it was (it is also three's sort
// centre for the part, and a rig that was right must not change), and one that
// does not is replaced by the rig's own centre, the point the entity cull
// uses, carried into the mesh's object space through the inverse of the node
// chain so that three's own multiply lands it on the body. That replacement is
// exact for the pose it is taken in and rides the pose wraps from then on; one
// taken while a wrap is off its rest (a swim rise, a prone pitch, a death
// sink) stays that far off the standing body, which is the slack the doubled
// radius exists to absorb.
//
// The sphere lives in the mesh's own object space, so the radius is divided by
// the accumulated scale up to the visual root. The group's live entity scale
// sits above that root and rides matrixWorld, so a resized rig needs no rework.
// three scales the sphere by the composed matrix's LARGEST axis, which is at
// most the product of the per-node largest axes and is strictly less once a
// rotation sits between two non-uniform ones. Dividing by the product of the
// per-node SMALLEST axes is therefore the arm that cannot under-pad; on the
// shipped rigs every node scale is uniform, so the two agree exactly.
// The sphere is always rebuilt from the geometry, the node chain and the rig
// height, never from the mesh's current one, so re-applying it after a
// material rebuild cannot compound.

import * as THREE from 'three';
import {
  characterRigCentreY,
  characterRigRadius,
  skinnedCullSphereRadius,
} from '../character_cull_core';
import { renderLayerDisabled } from '../render_dev_flags';

const chainScratch = new THREE.Matrix4();
const nodeScratch = new THREE.Matrix4();
const rigCentreScratch = new THREE.Vector3();
const probeScratch = new THREE.Vector3();

/**
 * Walk from `mesh` up to (not including) `root`: write the transform that
 * carries the mesh's object space into the root's frame to `toRoot`, and
 * return the accumulated (min-axis) scale along the way, or NaN when `root` is
 * not an ancestor at all (there is then no rig frame to measure anything in).
 *
 * Both are read off each node's own position/quaternion/scale rather than its
 * matrices: this runs while a visual is still being assembled, before any
 * local or world matrix has been refreshed.
 */
function chainToRoot(mesh: THREE.Object3D, root: THREE.Object3D, toRoot: THREE.Matrix4): number {
  toRoot.identity();
  let scale = 1;
  let node: THREE.Object3D | null = mesh;
  while (node !== null && node !== root) {
    const s = node.scale;
    scale *= Math.min(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
    toRoot.premultiply(nodeScratch.compose(node.position, node.quaternion, s));
    node = node.parent;
  }
  return node === root ? scale : Number.NaN;
}

/**
 * Let three frustum-cull this skinned caster, against a sphere big enough that
 * no pose can escape it. `height` is the rig's authored world height at unit
 * entity scale (`VisualDef.height`); `root` is the visual root the entity
 * scale is applied above, and the frame the rig stands in: its feet (or its
 * hover gap) at the origin.
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
  const radius = skinnedCullSphereRadius(height, chainToRoot(mesh, root, chainScratch));
  if (!Number.isFinite(radius)) {
    // A collapsed scale chain, or a root the mesh does not hang under: say the
    // exemption outright rather than store an infinite radius, whose
    // transformed sphere would fail open through a NaN. Either way there is no
    // rig frame left to place a centre in.
    mesh.frustumCulled = false;
    return;
  }
  const centre = source.center.clone();
  const rigCentre = rigCentreScratch.set(0, characterRigCentreY(height, 1), 0);
  const onRig =
    probeScratch.copy(centre).applyMatrix4(chainScratch).distanceTo(rigCentre) <=
    characterRigRadius(height, 1);
  // Off the rig: the mesh node is not the body's frame, so nothing in geometry
  // space says where the skin puts this part. Take the rig's own centre.
  if (!onRig) centre.copy(rigCentre).applyMatrix4(chainScratch.invert());
  mesh.boundingSphere = new THREE.Sphere(centre, radius);
  mesh.frustumCulled = true;
}
