// Skinned-rig part merging: collapse the several body-part SkinnedMeshes a
// KayKit character ships into ONE SkinnedMesh per (material, world transform).
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
// Payoff: a rig drops from ~9 skinned draws (each with its own skeleton and
// palette upload when its pose advances) to 1 in both color and shadow. Three
// re-runs vertex skinning for each pass, but uploads a changed texture only once.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { morphTargetDictionaryOf, morphUnionPlan } from './morph_union_core';

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

/** The morph attribute kinds three reads off a geometry, in its own precedence
 *  order. `color` deltas are not geometry and are copied component-wise. */
export const MORPH_KINDS = ['position', 'normal', 'color'] as const;
export type MorphKind = (typeof MORPH_KINDS)[number];

/**
 * How a rebake lays out the OUTPUT morph target list.
 *
 * `names` is the output order; `sourceIndex[slot]` is the index of that target
 * in the part's OWN list, or -1 when this part does not carry it (the slot is
 * then written as an all-zero delta, which is the identity for a relative
 * morph and is what lets differently-targeted parts merge into one buffer).
 * Omit the plan entirely and a part keeps its own targets in their own order.
 */
export interface MorphRebakePlan {
  readonly names: readonly string[];
  readonly sourceIndex: readonly number[];
  /** The morph kinds (and their item sizes) the OUTPUT must carry: the union
   *  across the parts being merged, so every merged buffer has the same keys
   *  and the same target count, which is what `mergeGeometries` requires. */
  readonly kinds: readonly { readonly kind: MorphKind; readonly itemSize: number }[];
  /** The relativity of the MERGED buffer. A morph-free part carries three's
   *  default (`false`) and would otherwise make `mergeGeometries` refuse the
   *  whole bucket for disagreeing with the parts that do have targets. */
  readonly relative: boolean;
}

/** Rebake one morph target's delta buffer through `m`.
 *
 *  A RELATIVE target (every glTF morph target: GLTFLoader sets
 *  `morphTargetsRelative`) stores a displacement, so it takes the LINEAR part
 *  of the rebake and never its translation; an absolute one is a position and
 *  takes the whole matrix. Normal deltas take the normal matrix un-normalized:
 *  a delta's length is its own, and normalizing it would rewrite the blend. */
function rebakeMorphAttribute(
  src: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null | undefined,
  count: number,
  size: number,
  kind: MorphKind,
  relative: boolean,
  m: THREE.Matrix4,
  linear: THREE.Matrix3,
  normalMatrix: THREE.Matrix3,
): THREE.BufferAttribute {
  const arr = new Float32Array(count * size);
  if (!src) return new THREE.BufferAttribute(arr, size);
  const v3 = new THREE.Vector3();
  const n = Math.min(count, src.count);
  for (let i = 0; i < n; i++) {
    if (kind === 'color' || size < 3) {
      for (let c = 0; c < size; c++) arr[i * size + c] = src.getComponent(i, c);
      continue;
    }
    v3.set(src.getX(i), src.getY(i), src.getZ(i));
    if (kind === 'normal') v3.applyMatrix3(normalMatrix);
    else if (relative) v3.applyMatrix3(linear);
    else v3.applyMatrix4(m);
    arr[i * size] = v3.x;
    arr[i * size + 1] = v3.y;
    arr[i * size + 2] = v3.z;
    for (let c = 3; c < size; c++) arr[i * size + c] = src.getComponent(i, c);
  }
  return new THREE.BufferAttribute(arr, size);
}

/**
 * Copy `geo` into plain, non-interleaved, dequantized attributes and pre-transform
 * its positions (and normals/tangents/morph deltas) by `m`, so the result skins
 * correctly against the canonical skeleton.
 *
 * Reading through `getX/getY/...` denormalizes quantized and interleaved sources,
 * which is what lets differently quantized parts share one buffer.
 *
 * Morph targets are CARRIED, padded to `plan` when one is given. Dropping them
 * is silent (a blendshape simply stops working), and every body part of the
 * composed character library carries the face and body sliders, so a rebake
 * that lost them would freeze every slider on the parts it touched.
 */
export function rebakeGeometry(
  geo: THREE.BufferGeometry,
  m: THREE.Matrix4,
  plan?: MorphRebakePlan,
): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(m);
  const linear = new THREE.Matrix3().setFromMatrix4(m);
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

  const vertexCount = out.getAttribute('position')?.count ?? 0;
  const relative = plan ? plan.relative : geo.morphTargetsRelative;
  out.morphTargetsRelative = relative;
  // Absent stays absent without a plan: three defines USE_MORPHTARGETS on
  // PRESENCE, so minting an empty list would change the program key of a part
  // that has no blendshapes at all.
  const outputKinds = plan
    ? plan.kinds
    : MORPH_KINDS.filter((kind) => geo.morphAttributes[kind]).map((kind) => ({
        kind,
        itemSize: geo.morphAttributes[kind]?.[0]?.itemSize ?? 3,
      }));
  for (const { kind, itemSize } of outputKinds) {
    const list = geo.morphAttributes[kind];
    const slots = plan ? plan.sourceIndex : (list ?? []).map((_, i) => i);
    out.morphAttributes[kind] = slots.map((source) =>
      rebakeMorphAttribute(
        source >= 0 ? list?.[source] : null,
        vertexCount,
        itemSize,
        kind,
        relative,
        m,
        linear,
        normalMatrix,
      ),
    );
  }

  if (geo.index) {
    const src = geo.index;
    const arr = new Uint32Array(src.count);
    for (let i = 0; i < src.count; i++) arr[i] = src.getX(i);
    out.setIndex(new THREE.BufferAttribute(arr, 1));
  }
  return out;
}

/**
 * Parts of one rig that ride the same bones, material, and world transform.
 *
 * GLTFLoader represents a multi-primitive mesh as one identity Group containing
 * one SkinnedMesh per primitive. Some rigs split body parts across several such
 * sibling Groups. Their parent UUIDs differ even though their meshes occupy the
 * exact same space, so world transform is the identity-relevant key.
 */
function bucketKey(sm: THREE.SkinnedMesh): string {
  const bones = sm.skeleton.bones.map((b) => b.uuid).join(',');
  const mat = sm.material as THREE.Material;
  return `${bones}|${mat.uuid}|${sm.matrixWorld.elements.join(',')}`;
}

function sameAttributeSet(parts: THREE.SkinnedMesh[]): boolean {
  const names = new Set(parts.flatMap((p) => Object.keys(p.geometry.attributes)));
  return [...names].every((n) => parts.every((p) => p.geometry.getAttribute(n)));
}

/**
 * A part's morph target NAMES, in its own index order, or null when they cannot
 * be named.
 *
 * A merged geometry carries ONE target list, and three drives a target by
 * index, so parts can only merge once every one of them is padded to the union
 * of their NAMES (`morph_union_core.ts`). A part whose dictionary does not
 * account for every target it carries cannot be placed on that list, and
 * merging it by position would move the wrong blendshape, silently: refuse the
 * whole bucket instead.
 */
function morphTargetNames(sm: THREE.SkinnedMesh): string[] | null {
  const morphs = sm.geometry.morphAttributes;
  const count = (morphs.position ?? morphs.normal ?? morphs.color)?.length ?? 0;
  if (count === 0) return [];
  const dict = sm.morphTargetDictionary;
  if (!dict) return null;
  const names = new Array<string | undefined>(count).fill(undefined);
  for (const [name, index] of Object.entries(dict)) {
    if (Number.isInteger(index) && index >= 0 && index < count) names[index] = name;
  }
  return names.every((name) => name !== undefined) ? (names as string[]) : null;
}

/** The morph kinds (and item sizes) the merged buffer must carry: the union
 *  over the bucket. Null when two parts disagree on an item size, which
 *  `mergeGeometries` cannot reconcile either. */
function morphKindUnion(parts: THREE.SkinnedMesh[]): MorphRebakePlan['kinds'] | null {
  const kinds: { kind: MorphKind; itemSize: number }[] = [];
  for (const kind of MORPH_KINDS) {
    let itemSize = 0;
    for (const part of parts) {
      const size = part.geometry.morphAttributes[kind]?.[0]?.itemSize;
      if (size === undefined) continue;
      if (itemSize === 0) itemSize = size;
      else if (itemSize !== size) return null;
    }
    if (itemSize > 0) kinds.push({ kind, itemSize });
  }
  return kinds;
}

/** Scene nodes addressed by the supplied Three animation clips. */
export function animatedNodeNames(clips: THREE.AnimationClip[]): Set<string> {
  const names = new Set<string>();
  for (const clip of clips) {
    for (const track of clip.tracks) {
      const nodeName = THREE.PropertyBinding.parseTrackName(track.name).nodeName;
      if (nodeName) names.add(nodeName);
    }
  }
  return names;
}

function parentBehaviorKey(
  mesh: THREE.SkinnedMesh,
  root: THREE.Object3D,
  animatedNames: ReadonlySet<string> | undefined,
): string {
  const parentId = mesh.parent?.uuid ?? mesh.uuid;
  // Without clip evidence, retain the original parent-local merge boundary.
  if (!animatedNames) return `parent:${parentId}`;
  if (mesh.name && animatedNames.has(mesh.name)) return `mesh:${mesh.uuid}`;
  let current = mesh.parent;
  let chainVisible = true;
  while (current && current !== root) {
    chainVisible &&= current.visible;
    // Meshes under one animated parent still move together and may merge.
    // Different parents must remain separate if either chain can diverge.
    if (current.name && animatedNames.has(current.name)) return `parent:${parentId}`;
    current = current.parent;
  }
  // Cross-parent merging is deliberately limited to sibling wrapper Groups.
  // That is the GLTFLoader multi-primitive shape this optimization proves.
  const grandparentId = mesh.parent?.parent?.uuid ?? root.uuid;
  return `static:${grandparentId}|visible:${chainVisible}`;
}

export interface MergeSkinnedPartsOptions {
  /** An extra bucket dimension: two parts may only merge when this agrees.
   *
   *  The merged mesh gets ONE name of its own, so any fact a later pass reads
   *  off a part's node NAME has to be uniform inside a bucket or the merge
   *  silently changes what that pass does (the composed body's lipstick, jewel
   *  and band rules all read the name; `modular_name_facts_core.ts` owns them
   *  and supplies this key). Omit it and only material, bones, transform and
   *  parent behavior decide, as before. */
  partitionKey?: (mesh: THREE.SkinnedMesh) => string;
}

/**
 * Merge every mergeable group of skinned body parts under `root` in place.
 *
 * A part joins the merge only when it shares the canonical part's bone array,
 * material and world transform, has the same attribute set, an equal
 * bind matrix, static-equivalent parent behavior, nameable morph targets, and
 * bind data satisfying the single-T law. Anything else is left untouched as its
 * own SkinnedMesh, so a rig we cannot prove safe still renders correctly (just
 * without the saving).
 */
export function mergeSkinnedParts(
  root: THREE.Object3D,
  animatedNames?: ReadonlySet<string>,
  options?: MergeSkinnedPartsOptions,
): void {
  root.updateMatrixWorld(true);
  const groups = new Map<string, THREE.SkinnedMesh[]>();
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh || !sm.visible) return;
    if (Array.isArray(sm.material)) return; // never happens via GLTFLoader
    const partition = options?.partitionKey?.(sm) ?? '';
    const key = `${bucketKey(sm)}|${parentBehaviorKey(sm, root, animatedNames)}|${partition}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(sm);
    else groups.set(key, [sm]);
  });

  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue;
    if (!sameAttributeSet(bucket)) continue;

    const canon = bucket[0];
    const canonInverses = canon.skeleton.boneInverses;

    // Accept the parts whose bind data provably reduces to a single transform,
    // and name their morph targets, BEFORE any rebake: the union plan every
    // part is padded to is a property of the accepted set, not of one part.
    const parts: THREE.SkinnedMesh[] = [];
    const transforms: THREE.Matrix4[] = [];
    const targetNames: string[][] = [];
    let refusedMorphs = false;
    for (const part of bucket) {
      if (!matricesClose(canon.bindMatrix, part.bindMatrix, BIND_EPS)) continue;
      const t = solveRebindTransform(canonInverses, part.skeleton.boneInverses);
      if (!t) continue;
      const names = morphTargetNames(part);
      if (!names) {
        refusedMorphs = true;
        break;
      }
      parts.push(part);
      transforms.push(rebakeMatrix(canon.bindMatrix, part.bindMatrix, t));
      targetNames.push(names);
    }
    if (refusedMorphs || parts.length < 2) continue;

    // A merged buffer has one relativity flag; three's own merge refuses a
    // mismatch, and so does this, before any work is done.
    const morphed = parts.filter((_, i) => targetNames[i].length > 0);
    const relative = morphed[0]?.geometry.morphTargetsRelative ?? false;
    if (morphed.some((part) => part.geometry.morphTargetsRelative !== relative)) continue;
    const kinds = morphed.length > 0 ? morphKindUnion(parts) : [];
    if (!kinds) continue;
    const union = kinds.length > 0 ? morphUnionPlan(targetNames) : null;
    // With no plan every rebake keeps its own morph keys, and `mergeGeometries`
    // refuses a set that disagrees on them. A present-but-EMPTY list is the
    // only way to get here (a target list is what puts a kind in the union), and
    // it is not the same variant as an absent one, so it cannot be normalized
    // away: refuse here rather than let three log its own refusal.
    if (!union) {
      const keys = parts.map((part) => Object.keys(part.geometry.morphAttributes).sort().join(','));
      if (keys.some((k) => k !== keys[0])) continue;
    }

    const geometries = parts.map((part, i) =>
      rebakeGeometry(
        part.geometry,
        transforms[i],
        union
          ? { names: union.names, sourceIndex: union.sourceIndex[i], kinds, relative }
          : undefined,
      ),
    );
    // mergeGeometries checks morphTargetsRelative for consistency but never
    // carries it onto its output, so every rebaked input states it and the
    // merged geometry is told again below.
    const geo = mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    if (!geo) continue;
    if (morphed.length > 0) geo.morphTargetsRelative = relative;

    const merged = new THREE.SkinnedMesh(geo, canon.material);
    merged.name = `${canon.name}_bodymerged`;
    if (union && union.names.length > 0) {
      // The constructor's updateMorphTargets names targets off the ATTRIBUTES
      // (which carry none), so it would hand back a positional dictionary.
      merged.morphTargetDictionary = morphTargetDictionaryOf(union.names);
      merged.morphTargetInfluences = union.names.map(() => 0);
    }
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
