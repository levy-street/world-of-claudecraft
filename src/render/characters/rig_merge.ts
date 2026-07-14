// Skinned-rig part merging: collapse the several body-part SkinnedMeshes a
// KayKit character ships into ONE SkinnedMesh per (material, parent, transform).
//
// Why the naive merge does not work
// ---------------------------------
// The GLBs are mesh-quantized: every primitive is stored with its own integer
// range, and the glTF pipeline bakes that primitive's dequantization transform
// into ITS OWN copy of the inverse bind matrices. So two parts of the same body,
// riding the same bones with the same material, still carry DIFFERENT
// `skeleton.boneInverses` and cannot share a skeleton as-authored. Merging them
// blind would skin the vertices against the wrong bind pose.
//
// The observation that makes the merge sound
// ------------------------------------------
// Those per-part inverses are not arbitrary: they differ from any chosen
// canonical part by ONE constant transform T, the same for every bone:
//
//     boneInverse_part[i] === boneInverse_canon[i] * T      (for all i)
//
// three skins a vertex as
//
//     out = bindInv * SUM_i w_i * (bone_i.matrixWorld * boneInverse[i]) * bind * p
//
// Substituting the law above (and with the parts' bind matrices equal, which is
// checked) the per-bone term factors out and the whole difference collapses to a
// single pre-transform of the vertex:
//
//     p' = bindInv_canon * T * bind_part * p
//
// So rebaking each part's positions/normals by that matrix makes it skin
// IDENTICALLY against the canonical part's skeleton, and the parts can then be
// merged into one geometry, one Skeleton, and one GPU bone texture.
//
// Payoff: a rig drops from ~9 skinned draws (each with its own skeleton update
// and bone-texture upload, in the main pass AND the shadow pass) to 1.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Bind matrices must match to this tolerance for two parts to be mergeable. */
export const BIND_EPS = 1e-3;
/**
 * Tolerance for the single-T law above. The inverses are float32 quantities that
 * survive a matrix inverse and a multiply, so the residual sits around 1e-7;
 * anything materially larger means genuinely different bind poses and the parts
 * MUST NOT share vertices.
 */
export const REBIND_EPS = 1e-4;

function matricesClose(a: THREE.Matrix4, b: THREE.Matrix4, eps: number): boolean {
  const ea = a.elements;
  const eb = b.elements;
  for (let i = 0; i < 16; i++) if (Math.abs(ea[i] - eb[i]) > eps) return false;
  return true;
}

/**
 * Solve for the single transform `T` with `partInverses[i] = canonInverses[i] * T`
 * for every bone, or `null` when no such T reproduces the part's bind data.
 *
 * T is derived from bone 0 and then VERIFIED against every remaining bone, so a
 * part whose bind pose genuinely differs per bone is rejected rather than merged
 * into a broken pose.
 */
export function solveRebindTransform(
  canonInverses: THREE.Matrix4[],
  partInverses: THREE.Matrix4[],
  eps = REBIND_EPS,
): THREE.Matrix4 | null {
  if (canonInverses.length === 0 || canonInverses.length !== partInverses.length) return null;
  const t = new THREE.Matrix4().copy(canonInverses[0]).invert().multiply(partInverses[0]);
  const probe = new THREE.Matrix4();
  for (let i = 0; i < canonInverses.length; i++) {
    probe.copy(canonInverses[i]).multiply(t);
    if (!matricesClose(probe, partInverses[i], eps)) return null;
  }
  return t;
}

/** The vertex pre-transform that rebakes `part` into `canon`'s bind space. */
export function rebakeMatrix(
  canonBindMatrix: THREE.Matrix4,
  partBindMatrix: THREE.Matrix4,
  t: THREE.Matrix4,
): THREE.Matrix4 {
  return new THREE.Matrix4().copy(canonBindMatrix).invert().multiply(t).multiply(partBindMatrix);
}

// Attributes carrying integer bone indices must stay integral; everything else
// is dequantized to float so parts with different source quantizations merge.
const INTEGER_ATTRIBUTES = new Set(['skinIndex']);

/**
 * Copy `geo` into plain, non-interleaved, dequantized attributes and pre-transform
 * its positions (and normals/tangents) by `m`, so the result skins correctly
 * against the canonical skeleton.
 *
 * Reading through `getX/getY/...` denormalizes quantized and interleaved sources,
 * which is what lets differently quantized parts share one buffer.
 */
export function rebakeGeometry(geo: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(m);
  const v3 = new THREE.Vector3();

  for (const name of Object.keys(geo.attributes)) {
    const src = geo.attributes[name] as THREE.BufferAttribute;
    const count = src.count;
    const size = src.itemSize;

    if (INTEGER_ATTRIBUTES.has(name)) {
      const arr = new Uint16Array(count * size);
      for (let i = 0; i < count; i++)
        for (let c = 0; c < size; c++) arr[i * size + c] = src.getComponent(i, c);
      out.setAttribute(name, new THREE.BufferAttribute(arr, size));
      continue;
    }

    const arr = new Float32Array(count * size);
    if (name === 'position') {
      for (let i = 0; i < count; i++) {
        v3.set(src.getX(i), src.getY(i), src.getZ(i)).applyMatrix4(m);
        arr[i * 3] = v3.x;
        arr[i * 3 + 1] = v3.y;
        arr[i * 3 + 2] = v3.z;
      }
    } else if (name === 'normal') {
      for (let i = 0; i < count; i++) {
        v3.set(src.getX(i), src.getY(i), src.getZ(i)).applyMatrix3(normalMatrix).normalize();
        arr[i * 3] = v3.x;
        arr[i * 3 + 1] = v3.y;
        arr[i * 3 + 2] = v3.z;
      }
    } else if (name === 'tangent') {
      // vec4: xyz is a direction, w is the handedness sign and must survive intact
      for (let i = 0; i < count; i++) {
        v3.set(src.getX(i), src.getY(i), src.getZ(i)).transformDirection(m);
        arr[i * 4] = v3.x;
        arr[i * 4 + 1] = v3.y;
        arr[i * 4 + 2] = v3.z;
        arr[i * 4 + 3] = src.getW(i);
      }
    } else {
      for (let i = 0; i < count; i++)
        for (let c = 0; c < size; c++) arr[i * size + c] = src.getComponent(i, c);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }

  if (geo.index) {
    const src = geo.index;
    const arr = new Uint32Array(src.count);
    for (let i = 0; i < src.count; i++) arr[i] = src.getX(i);
    out.setIndex(new THREE.BufferAttribute(arr, 1));
  }
  return out;
}

/** Parts of one rig that ride the same bones, material, parent and local transform. */
function bucketKey(sm: THREE.SkinnedMesh): string {
  const bones = sm.skeleton.bones.map((b) => b.uuid).join(',');
  const mat = sm.material as THREE.Material;
  return `${bones}|${mat.uuid}|${sm.parent?.uuid}|${sm.matrix.elements.join(',')}`;
}

function sameAttributeSet(parts: THREE.SkinnedMesh[]): boolean {
  const names = new Set(parts.flatMap((p) => Object.keys(p.geometry.attributes)));
  return [...names].every((n) => parts.every((p) => p.geometry.getAttribute(n)));
}

/**
 * `rebakeGeometry` rebuilds positions/normals/tangents and carries nothing else,
 * so a part with morph targets would lose them SILENTLY (a blendshape simply
 * stops working, with no error). No shipped character GLB has any today, but the
 * contract of this module is that anything it cannot prove safe is left alone,
 * so refuse the merge rather than drop data.
 */
function hasMorphTargets(sm: THREE.SkinnedMesh): boolean {
  const morphs = sm.geometry.morphAttributes;
  return !!morphs && Object.keys(morphs).length > 0;
}

/**
 * Merge every mergeable group of skinned body parts under `root` in place.
 *
 * A part joins the merge only when it shares the canonical part's bone array,
 * material, parent and local transform, has the same attribute set, an equal
 * bind matrix, and bind data satisfying the single-T law. Anything else is left
 * untouched as its own SkinnedMesh, so a rig we cannot prove safe still renders
 * correctly (just without the saving).
 */
export function mergeSkinnedParts(root: THREE.Object3D): void {
  const groups = new Map<string, THREE.SkinnedMesh[]>();
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh || !sm.visible) return;
    if (Array.isArray(sm.material)) return; // never happens via GLTFLoader
    if (hasMorphTargets(sm)) return; // would be silently dropped by the rebake
    const key = bucketKey(sm);
    const bucket = groups.get(key);
    if (bucket) bucket.push(sm);
    else groups.set(key, [sm]);
  });

  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue;
    if (!sameAttributeSet(bucket)) continue;

    const canon = bucket[0];
    const canonInverses = canon.skeleton.boneInverses;

    // Rebake every part into the canonical bind space, dropping any part whose
    // bind data does not provably reduce to a single transform.
    const parts: THREE.SkinnedMesh[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    for (const part of bucket) {
      if (!matricesClose(canon.bindMatrix, part.bindMatrix, BIND_EPS)) continue;
      const t = solveRebindTransform(canonInverses, part.skeleton.boneInverses);
      if (!t) continue;
      geometries.push(
        rebakeGeometry(part.geometry, rebakeMatrix(canon.bindMatrix, part.bindMatrix, t)),
      );
      parts.push(part);
    }
    if (parts.length < 2) {
      for (const g of geometries) g.dispose();
      continue;
    }

    const geo = mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    if (!geo) continue;

    const merged = new THREE.SkinnedMesh(geo, canon.material);
    merged.name = `${canon.name}_bodymerged`;
    merged.position.copy(canon.position);
    merged.quaternion.copy(canon.quaternion);
    merged.scale.copy(canon.scale);
    merged.castShadow = canon.castShadow;
    merged.receiveShadow = canon.receiveShadow;
    // A skinned mesh's bind-pose bounds do not follow the animation, so the rig
    // owner decides culling (visual.ts turns it off); inherit, never re-decide.
    // Same rule for draw order and layers: the merged part stands in for the
    // canonical one, so it must present the same way to the renderer.
    merged.frustumCulled = canon.frustumCulled;
    merged.renderOrder = canon.renderOrder;
    merged.layers.mask = canon.layers.mask;
    merged.userData = { ...canon.userData };
    merged.bind(canon.skeleton, canon.bindMatrix);
    canon.parent?.add(merged);
    for (const p of parts) p.removeFromParent();
  }
}
