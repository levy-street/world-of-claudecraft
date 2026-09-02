// ONE Skeleton, and so one GPU bone texture, per rig.
//
// The problem
// -----------
// `SkeletonUtils.clone` gives EVERY SkinnedMesh its own `Skeleton` (it calls
// `sourceMesh.skeleton.clone()` per mesh), and the parsed character GLBs make
// that unavoidable at load: the modular library ships 246 skins over ONE
// 23-joint list, because meshopt quantization bakes each primitive's own
// dequantization transform into ITS OWN inverse-bind matrices. So a composed
// body used to carry ~20 Skeletons, each flattening 23 matrices and uploading
// its own RGBA32F bone texture on every pose change, for one animated pose.
//
// The fix
// -------
// `rig_merge.ts` already proves the algebra that collapses those bind spaces
// (its header carries the proof): the per-part inverses differ from any chosen
// canonical part's by ONE constant transform T, so pre-transforming a part's
// vertices by `bind^-1 * T * bind` makes it skin IDENTICALLY against the
// canonical skeleton. `mergeSkinnedParts` uses that to fold parts into one
// draw, but only where a merge is provably safe; everything it leaves alone
// (in the composed library: every morph-carrying face and body part) kept its
// own Skeleton.
//
// This module applies the same rebind WITHOUT merging. Geometry stays per
// part, draw calls are unchanged, and the rig ends with one Skeleton, one
// palette flatten and one bone-texture upload per pose.
//
// Where the canonical part matters
// --------------------------------
// The canonical part is the one whose geometry is NOT rebaked, and some of the
// composed head's buffers are load-bearing identity elsewhere: the stubble and
// makeup decal cuts are cached per head-geometry uuid, and `modularHeadFor`
// promises that buffer is the parsed asset's own, shared by every variant. So
// callers that have such a part name it through `preferCanonical`; everyone
// else takes the first mesh and it does not matter which.
import * as THREE from 'three';
import { REBIND_EPS, rebakeGeometry, rebakeMatrix, solveRebindTransform } from './rig_merge';

export interface SharedSkeletonStats {
  /** Bone-array groups found under the root (a held prop on its own rig is one
   *  of its own and never shares). */
  groups: number;
  skeletonsBefore: number;
  skeletonsAfter: number;
  /** Meshes moved onto a shared Skeleton. */
  rebound: number;
  /** Of those, the ones whose geometry had to be pre-transformed. */
  rebaked: number;
  /** Meshes left on their own Skeleton because no single T explains their bind
   *  data (the same refusal `mergeSkinnedParts` makes, for the same reason). */
  refused: number;
}

export interface ShareRigSkeletonOptions {
  /** Picks the part whose bind space every other part is rebaked into, and so
   *  the one part whose GEOMETRY is left untouched. */
  preferCanonical?: (mesh: THREE.SkinnedMesh) => boolean;
}

/** A CHEAP bucket key for the bones a mesh rides.
 *
 *  Deliberately not an identity: joining every uuid built a 23-segment string
 *  per mesh per compose for a key that is read once. Length plus the first and
 *  last joint is enough to separate the rigs this walk ever sees (every skin of
 *  one asset lists the same joints in the same order, pinned by
 *  `tests/rig_merge_assets.test.ts`; a held prop is a different clone with
 *  different Bone objects), and a collision is CAUGHT rather than trusted:
 *  `sameBones` re-checks object identity before any rebind. */
function boneSetKey(mesh: THREE.SkinnedMesh): string {
  const bones = mesh.skeleton.bones;
  return `${bones.length}|${bones[0].uuid}|${bones[bones.length - 1].uuid}`;
}

/** The exact check the cheap key above does not make: same bone OBJECTS, in the
 *  same order. Allocation-free, and it is what makes the key safe to be loose. */
function sameBones(a: readonly THREE.Bone[], b: readonly THREE.Bone[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const IDENTITY_ELEMENTS = new THREE.Matrix4().elements.slice();

function isIdentity(m: THREE.Matrix4, eps = REBIND_EPS): boolean {
  const e = m.elements;
  for (let i = 0; i < 16; i++) if (Math.abs(e[i] - IDENTITY_ELEMENTS[i]) > eps) return false;
  return true;
}

/**
 * Put every skinned mesh under `root` that rides the same bones onto ONE
 * Skeleton, rebaking the geometry of the parts that need it.
 *
 * Idempotent and cheap on a re-run: a `SkeletonUtils` clone of an already
 * shared rig hands every mesh a Skeleton that SHARES the source's
 * `boneInverses` array (three's `Skeleton.clone()` passes the array by
 * reference), so the rebind is a pointer swap with no geometry work at all.
 * That is the case at every compose, and it is why the clone side is worth
 * running: the clone would otherwise re-split what the cached variant unified.
 */
export function shareRigSkeleton(
  root: THREE.Object3D,
  options?: ShareRigSkeletonOptions,
): SharedSkeletonStats {
  const stats: SharedSkeletonStats = {
    groups: 0,
    skeletonsBefore: 0,
    skeletonsAfter: 0,
    rebound: 0,
    rebaked: 0,
    refused: 0,
  };
  const groups = new Map<string, THREE.SkinnedMesh[]>();
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.skeleton || mesh.skeleton.bones.length === 0) return;
    const key = boneSetKey(mesh);
    const bucket = groups.get(key);
    if (bucket) bucket.push(mesh);
    else groups.set(key, [mesh]);
  });

  for (const meshes of groups.values()) {
    stats.groups++;
    const before = new Set(meshes.map((mesh) => mesh.skeleton));
    stats.skeletonsBefore += before.size;
    if (meshes.length < 2) {
      stats.skeletonsAfter += before.size;
      continue;
    }

    const preferred = options?.preferCanonical
      ? meshes.findIndex((mesh) => options.preferCanonical?.(mesh) === true)
      : -1;
    const canon = meshes[preferred >= 0 ? preferred : 0];
    const canonSkeleton = canon.skeleton;
    const canonInverses = canonSkeleton.boneInverses;

    for (const mesh of meshes) {
      if (mesh.skeleton === canonSkeleton) continue;
      // The cheap bucket key can pool two rigs that share a joint count and
      // their end joints; skinning against another rig's bones would be a
      // broken pose, so the exact check happens here.
      if (!sameBones(canonSkeleton.bones, mesh.skeleton.bones)) {
        stats.refused++;
        continue;
      }
      // Reference-equal inverses are the clone case: no algebra, no rebake.
      if (mesh.skeleton.boneInverses !== canonInverses) {
        const t = solveRebindTransform(canonInverses, mesh.skeleton.boneInverses);
        if (!t) {
          stats.refused++;
          continue;
        }
        // The part keeps its OWN bind matrix, so the pre-transform is taken in
        // that same space: `bind^-1 * T * bind`. (The merge path instead adopts
        // the canonical part's bind matrix, which is why it also has to check
        // the two are equal; nothing here needs them to be.)
        const rebake = rebakeMatrix(mesh.bindMatrix, mesh.bindMatrix, t);
        if (!isIdentity(rebake)) {
          mesh.geometry = rebakeGeometry(mesh.geometry, rebake);
          stats.rebaked++;
        }
      }
      mesh.bind(canonSkeleton, mesh.bindMatrix.clone());
      stats.rebound++;
    }
    const after = new Set(meshes.map((mesh) => mesh.skeleton));
    stats.skeletonsAfter += after.size;
  }
  return stats;
}
