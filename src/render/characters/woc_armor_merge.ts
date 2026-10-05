// The three.js half of the merged WOC armor (woc_armor_merge_core.ts owns the batching
// and the cache identity): fold the armor meshes a character DRAWS into ONE skinned
// mesh per file material, bound to the body's own skeleton, so a kit costs a draw per
// material in the colour pass and one in the shadow pass instead of one per part.
//
// The parts stay the source of truth. The dressing (woc_armor_dressing.ts) still
// attaches the files and the visual still shows and hides the part nodes exactly as
// before; this module only builds a stand-in for whatever is drawn right now and takes
// those parts out of the render lists while it stands (`layers.mask = 0`: three tests
// layers in both passes, and nothing that reads a part's `visible` flag is told
// otherwise). Anything that changes the drawn armor (an item, the helm, a tier
// landing) drops the stand-in, the parts draw again on that frame, and a new one is
// built for the new kit.
//
// A merged mesh draws with the FILE material its parts share, so the host's own
// material pass derives for it the very tier material (and program) it derived for a
// skinned part, and every later sweep (a skin, an effect, the shadow flags) treats it
// as one more armor mesh.
//
// The bind, worked out from woc_armor_bind.ts and three's skinning chunks. A skinned
// part draws
//
//     world = SUM_i w_i * bone_i * inverse_i * bind * p
//
// (attached bind mode: three recomputes bindMatrixInverse from the mesh's own world
// matrix, which then cancels), and its normal by the SAME blend: the skin matrix
// itself, never its inverse transpose. prepareWocArmor already rebakes every part of a
// file into the base rig's bind space and instantiateWocArmor binds each to the
// character's one shared Skeleton with the rig's bind matrix, so the skinned parts of a
// model share a skeleton, its inverses and a bind matrix: their vertices are copied as
// stored, bit for bit, and the merged mesh skins them from the inputs the part did. A
// part that does differ (another Skeleton over the same bones, other inverses, another
// bind matrix) is converted the way rig_merge.ts proves: its inverses must be the
// rig's times ONE transform T on every bone it is weighted to, and then
//
//     p' = bind^-1 * T * bind_part * p
//
// with its normal and tangent taken through that matrix's linear part, as three would
// have skinned them. A part with no such T keeps drawing by itself.
//
// A rigid part draws `world = bone * M * p` (M: its wrapper's and node's transforms,
// which carry the pack's dequantization) and its normal by the inverse transpose of
// that. As vertices weighted 1.0 to that bone:
//
//     p' = (inverse_bone * bind)^-1 * M * p
//     n' = A^-1 * M^-T * n          (A: the linear part of inverse_bone * bind)
//
// which lands every vertex where the rigid part sits, whatever the pose (to float
// rounding: a rigid mesh and a skinned one run different vertex programs, so those
// vertices can agree no closer). The normal is exact while the bone's chain is
// rotations and uniform scales (the skin matrix and its inverse transpose then agree):
// true of the bones the shipped rigid parts ride (the head and the shoulder bones carry
// no scale tracks; the library's quantized rotations are unit to about 1e-5, and that
// is all the two differ by, tests/woc_armor_merge_assets.test.ts), checked when a
// stand-in is planned, and a part on a chain that fails it keeps drawing by itself. A
// mirrored rigid part (a left shoulder is its right one under a negative scale) has its
// winding flipped, as three flips the front face for such a mesh.
//
// What is never folded: a blended, depth-free or several-material mesh (its draw
// order matters), one with morph targets or an attribute a merged buffer does not
// carry, and a rigid part whose material reads the raw vertex position (the
// object-space worn detail, worn_stone.ts: a rigid part's own space is not the rig's).
// And a stand-in never stands under an effect overlay that blends (the ghost run,
// stealth, Shadowform, Moonkin, the Soul Rend mark): three sorts blended meshes by
// depth, which one merged mesh cannot, so the parts draw by themselves until it ends.
// The stand-in stays mounted meanwhile, hidden (parked): the host mounts its overlays
// on the merged meshes too, so what THEY wear says when an overlay is on and when it
// is gone, and a toggle costs a few flags, never a rebuild. That also covers a stand-in
// adopted while an overlay still links (the host mounts an effect on a new mesh ahead
// of the parts, which keep their materials until the swap commits): it is born parked.
// The host says when it mounted another effect state's materials (effectsChanged), so
// nothing is read per frame: a blended stand-in is parked inside that very call and is
// never drawn blended (so a host that links its blended clones ahead of mounting them
// can leave the merged meshes, tagged `wocArmorMerged`, out of that: they never draw one).
//
// A stand-in draws only once the host's compile gate linked what it wears (reveal), the
// parts drawing meanwhile. The gate proves what is mounted when it settles, so an
// effect edge during the link reads as unprepared and is simply asked for again; a gate
// that cannot prepare the very materials it was asked with twice running leaves the kit
// in its parts for as long as that gate lasts.
//
// The geometry is cached by the parts it folds (wocArmorMergeKey, by each part's SOURCE
// geometry) and leased: every character in one kit on one body fit shares one buffer per
// material, whatever its detail. The fold carries the parts' coarser levels (their index
// lists, offset as its own index is: assets/geometry_lod.ts), and each character's merged
// mesh draws the level its parts draw, a variant over the very same buffers. An idle entry is
// kept for a while (the same kit comes back when a peer walks into view) and the oldest
// are dropped past a cap. A mount is real main-thread work (the fold on a miss, the
// host's per-mesh setup always), so this module never decides WHEN: the rig only plans
// and waits, and its owner asks the host's work queue for the mount
// (woc_armor_dressing.ts), whose frame budget spreads a crowd arriving at once. Everyone
// waiting keeps drawing their parts: correct, just not yet cheap.
import * as THREE from 'three';
import {
  type GeometryLodLevel,
  geometryLodSourceOf,
  geometryLodVariant,
  mergeGeometryLod,
} from '../assets/geometry_lod';
import { recordBuildSpan } from '../build_spans';
import { logAssetMissOnce } from './asset_miss_log';
import { rebakeMatrix, solveRebindTransform } from './rig_merge';
import { characterMeshCastsShadow } from './shadow_policy';
import { wocRigBindOf, wocRigSkeletonOf } from './woc_armor_bind';
import {
  WOC_ARMOR_MERGE_ATTRIBUTES,
  type WocArmorMergeFacts,
  wocArmorMergeBake,
  wocArmorMergeBatches,
  wocArmorMergeKey,
  wocArmorMergeLayout,
  wocMatrixIsIdentity,
  wocScaleIsUniform,
} from './woc_armor_merge_core';
import { wocArmorContainers, wocArmorFileMaterial, wocArmorPieces } from './woc_armor_packs';

/** Tag on a merged armor mesh (beside `wocArmorPart`, which keeps it out of the rig's
 *  body-mesh lookups exactly like the parts it folds). */
export const WOC_ARMOR_MERGED_KEY = 'wocArmorMerged';

/** The one wrapper a model's merged armor meshes hang under, and the stem of their
 *  names (`woc_armor_merged_<n>`). */
export const WOC_ARMOR_MERGED_NAME = 'woc_armor_merged';

type VertexAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

// ---------------------------------------------------------------------------
// What a model draws
// ---------------------------------------------------------------------------

/** One drawn armor mesh, as the merge takes it. */
export interface WocArmorMergeCandidate {
  readonly mesh: THREE.Mesh;
  /** The FILE material it hangs with (woc_armor_packs.ts wocArmorFileMaterial), never
   *  the tier or effect material a host mounted since. */
  readonly material: THREE.Material;
  /** The node its file hung it under: the Group of skinned parts, or a rigid part's
   *  wrapper on its bone (woc_armor_packs.ts wocArmorPieces). */
  readonly root: THREE.Object3D;
}

/** Whether `node` draws under `model`: it and every ancestor below the model are visible. */
function drawnUnder(node: THREE.Object3D, model: THREE.Object3D): boolean {
  let at: THREE.Object3D | null = node;
  while (at && at !== model) {
    if (!at.visible) return false;
    at = at.parent;
  }
  return at === model;
}

function collectDrawn(
  node: THREE.Object3D,
  root: THREE.Object3D,
  out: WocArmorMergeCandidate[],
): void {
  if (!node.visible) return;
  const mesh = node as THREE.Mesh;
  const tags = node.userData;
  // a head piece carries the armor tag too (woc_head_packs.ts): the head merges itself
  if (mesh.isMesh && tags.wocArmorPart && !tags.wocHeadPart && !tags[WOC_ARMOR_MERGED_KEY]) {
    const material = wocArmorFileMaterial(mesh);
    if (material) out.push({ mesh, material, root });
  }
  for (const child of node.children) collectDrawn(child, root, out);
}

/**
 * The armor meshes a model draws right now: every mesh of an attached file whose whole
 * chain up to the model is visible. A part the dressing hid is not drawn, and neither
 * is any part of a file still linking behind the compile gate (its nodes stay hidden
 * until its reveal settles). By name, so two characters in one kit fold their parts in
 * the same order whatever order their files landed in, and share one merged buffer.
 */
export function wocArmorDrawnParts(model: THREE.Object3D): WocArmorMergeCandidate[] {
  const out: WocArmorMergeCandidate[] = [];
  for (const container of wocArmorContainers(model)) {
    for (const root of wocArmorPieces(container)) {
      if (drawnUnder(root, model)) collectDrawn(root, root, out);
    }
  }
  return out.sort((a, b) => (a.mesh.name < b.mesh.name ? -1 : a.mesh.name > b.mesh.name ? 1 : 0));
}

// ---------------------------------------------------------------------------
// The common bind, and each part's way into it
// ---------------------------------------------------------------------------

/** The bind every merged part is baked into: the body's own shared skeleton. */
export interface WocArmorMergeBind {
  readonly skeleton: THREE.Skeleton;
  readonly bindMatrix: THREE.Matrix4;
  /** Each bone of the skeleton to its joint index. */
  readonly joints: ReadonlyMap<THREE.Object3D, number>;
}

/** A model's bind (the skeleton its body meshes share and the body's bind matrix:
 *  what attachWocArmorPack binds a set to), or null for a model with no rig. */
export function wocArmorMergeBindOf(model: THREE.Object3D): WocArmorMergeBind | null {
  const skeleton = wocRigSkeletonOf(model);
  const rig = skeleton ? wocRigBindOf(model) : null;
  if (!skeleton || !rig) return null;
  const joints = new Map<THREE.Object3D, number>();
  for (const [i, bone] of skeleton.bones.entries()) if (!joints.has(bone)) joints.set(bone, i);
  return { skeleton, bindMatrix: rig.bindMatrix, joints };
}

/** One part folded into a merged geometry. */
export interface WocArmorMergePart {
  readonly mesh: THREE.Mesh;
  /** Its vertex space to the bind space; null: already there, copied as stored. */
  readonly toBind: THREE.Matrix4 | null;
  /** Its normals' way there (see the header: a skinned part's go through the linear
   *  part of `toBind`, a rigid part's through its inverse transpose); null with it. */
  readonly normalToBind: THREE.Matrix3 | null;
  /** A skinned part's joint indices into the body's bone order; null: already in it. */
  readonly joints: readonly number[] | null;
  /** The joint a rigid part is weighted to; null for a skinned part. */
  readonly bone: number | null;
  /** A mirrored rigid part: its winding is flipped. */
  readonly flip: boolean;
}

/** Whether a material's draws are order free: three's opaque list, testing and writing
 *  depth. Anything else (a blended or depth-free material) is sorted per mesh. */
function drawsOpaque(m: THREE.Material): boolean {
  return (
    !m.transparent &&
    m.blending === THREE.NormalBlending &&
    m.depthWrite &&
    m.depthTest &&
    !((m as THREE.MeshPhysicalMaterial).transmission > 0)
  );
}

/**
 * Whether an effect overlay blends on any of these meshes, by what is MOUNTED on them
 * now (the host's overlays swap a blended clone onto every mesh of a body, the merged
 * ones included). The one place that decides a stand-in does not stand under one.
 */
function overlaid(meshes: readonly THREE.Mesh[]): boolean {
  for (const mesh of meshes) {
    const m = mesh.material;
    if (Array.isArray(m) || !drawsOpaque(m)) return true;
  }
  return false;
}

/** A layer that reads the raw vertex position (worn_stone.ts, object space) sees a
 *  rigid part's own space, which a fold would move into the rig's. */
function readsObjectSpace(material: THREE.Material | THREE.Material[]): boolean {
  const m = Array.isArray(material) ? material[0] : material;
  const spec = m?.userData.surfaceDetailSpec as { objectSpace?: boolean } | undefined;
  return spec?.objectSpace === true;
}

const _step = new THREE.Matrix4();
const _fromBind = new THREE.Matrix4();
const IDENTITY = new THREE.Matrix4();

function sameMatrix(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  if (a === b) return true;
  for (let i = 0; i < 16; i++) if (a.elements[i] !== b.elements[i]) return false;
  return true;
}

/** A node's local space to `ancestor`'s, composed from local transforms (never world
 *  matrices: a body is dressed before its first matrix update); null when the node is
 *  not under it. */
function matrixTo(node: THREE.Object3D, ancestor: THREE.Object3D): THREE.Matrix4 | null {
  const out = new THREE.Matrix4();
  let at: THREE.Object3D | null = node;
  while (at && at !== ancestor) {
    out.premultiply(
      at.matrixAutoUpdate ? _step.compose(at.position, at.quaternion, at.scale) : at.matrix,
    );
    at = at.parent;
  }
  return at === ancestor ? out : null;
}

/** The scales on a bone's chain up to the model: whether every one is uniform, and
 *  whether they mirror (an odd count of negative ones). Null for a bone not under it. */
function chainScale(
  bone: THREE.Object3D,
  model: THREE.Object3D,
): { uniform: boolean; mirrored: boolean } | null {
  let uniform = true;
  let mirrored = false;
  let at: THREE.Object3D | null = bone;
  while (at && at !== model) {
    const s = at.scale;
    if (!wocScaleIsUniform(s.x, s.y, s.z)) uniform = false;
    if (s.x * s.y * s.z < 0) mirrored = !mirrored;
    at = at.parent;
  }
  return at === model ? { uniform, mirrored } : null;
}

/** The joints a skinned geometry's vertices are weighted to; null when a weighted slot
 *  names a joint its skeleton lacks. */
function weightedJoints(geometry: THREE.BufferGeometry, jointCount: number): Set<number> | null {
  const index = geometry.getAttribute('skinIndex') as VertexAttribute;
  const weight = geometry.getAttribute('skinWeight') as VertexAttribute;
  const used = new Set<number>();
  for (let i = 0; i < index.count; i++) {
    for (let c = 0; c < 4; c++) {
      if (weight.getComponent(i, c) === 0) continue;
      const joint = index.getComponent(i, c);
      if (!Number.isInteger(joint) || joint < 0 || joint >= jointCount) return null;
      used.add(joint);
    }
  }
  return used;
}

function skinnedPart(
  mesh: THREE.SkinnedMesh,
  model: THREE.Object3D,
  bind: WocArmorMergeBind,
): WocArmorMergePart | null {
  const index = mesh.geometry.getAttribute('skinIndex') as VertexAttribute | undefined;
  const weight = mesh.geometry.getAttribute('skinWeight') as VertexAttribute | undefined;
  if (mesh.bindMode !== THREE.AttachedBindMode || !mesh.skeleton) return null;
  if (index?.itemSize !== 4 || index.normalized || weight?.itemSize !== 4) return null;
  // a skinned mesh's own transform cancels out of its positions, never out of its
  // normals: only a part sitting where the merged mesh will (at the model's origin)
  const local = matrixTo(mesh, model);
  if (!local || !wocMatrixIsIdentity(local.elements)) return null;
  let t: THREE.Matrix4 | null = IDENTITY;
  let joints: number[] | null = null;
  const own = mesh.skeleton;
  if (own !== bind.skeleton) {
    const used = weightedJoints(mesh.geometry, own.bones.length);
    if (!used || used.size === 0) return null;
    const remap = own.bones.map((bone) => bind.joints.get(bone) ?? -1);
    const canon: THREE.Matrix4[] = [];
    const part: THREE.Matrix4[] = [];
    let shared = true;
    for (const joint of used) {
      const to = remap[joint];
      // weighted to a bone the body's skeleton does not drive: nothing to convert to
      if (to < 0) return null;
      canon.push(bind.skeleton.boneInverses[to]);
      part.push(own.boneInverses[joint]);
      if (!sameMatrix(canon[canon.length - 1], part[part.length - 1])) shared = false;
    }
    // a clone's Skeleton shares the source's inverses: no algebra, nothing to rebake
    if (!shared) t = solveRebindTransform(canon, part);
    if (!t) return null;
    // a slot of no weight may name a bone the body lacks: it draws nothing, so any
    // joint stands in for it
    if (remap.some((to, from) => to !== from)) joints = remap.map((to) => (to < 0 ? 0 : to));
  }
  if (t === IDENTITY && sameMatrix(mesh.bindMatrix, bind.bindMatrix)) {
    return { mesh, toBind: null, normalToBind: null, joints, bone: null, flip: false };
  }
  const toBind = rebakeMatrix(bind.bindMatrix, mesh.bindMatrix, t);
  const normalToBind = new THREE.Matrix3().setFromMatrix4(toBind);
  return { mesh, toBind, normalToBind, joints, bone: null, flip: false };
}

function rigidPart(
  c: WocArmorMergeCandidate,
  model: THREE.Object3D,
  bind: WocArmorMergeBind,
): WocArmorMergePart | null {
  const mesh = c.mesh;
  // the bone its wrapper hangs on: a joint of the body's skeleton, or it cannot be skinned
  const bone = c.root.parent;
  const joint = bone ? bind.joints.get(bone) : undefined;
  if (!bone || joint === undefined || readsObjectSpace(mesh.material)) return null;
  const toBone = matrixTo(mesh, bone);
  const chain = chainScale(bone, model);
  // a non-uniformly scaled chain: the skin matrix would bend its normals (see the header)
  if (!toBone || !chain?.uniform) return null;
  _fromBind.multiplyMatrices(bind.skeleton.boneInverses[joint], bind.bindMatrix);
  const det = _fromBind.determinant();
  const own = toBone.determinant();
  if (!Number.isFinite(det) || det === 0 || !Number.isFinite(own) || own === 0) return null;
  const boneToBind = _fromBind.clone().invert();
  const toBind = boneToBind.clone().multiply(toBone);
  const normalToBind = new THREE.Matrix3()
    .setFromMatrix4(boneToBind)
    .multiply(new THREE.Matrix3().getNormalMatrix(toBone));
  return {
    mesh,
    toBind,
    normalToBind,
    joints: null,
    bone: joint,
    flip: own < 0 !== chain.mirrored,
  };
}

/** A mesh's layout (woc_armor_merge_core.ts), or null for one no merged draw carries:
 *  morph targets (another program, and vertices that move), a partial draw range, an
 *  instanced or batched mesh, an empty one. */
function layoutOf(mesh: THREE.Mesh, layers: number): string | null {
  const geometry = mesh.geometry;
  const flags = mesh as { isInstancedMesh?: boolean; isBatchedMesh?: boolean };
  if (!geometry || flags.isInstancedMesh || flags.isBatchedMesh) return null;
  if (Object.keys(geometry.morphAttributes).length > 0) return null;
  const range = geometry.drawRange;
  if (range.start !== 0 || range.count !== Number.POSITIVE_INFINITY) return null;
  const attributes: Record<string, number> = {};
  for (const name of Object.keys(geometry.attributes)) {
    attributes[name] = geometry.attributes[name].itemSize;
  }
  if (!((geometry.getAttribute('position')?.count ?? 0) > 0)) return null;
  return wocArmorMergeLayout({
    attributes,
    renderOrder: mesh.renderOrder,
    layers,
    caster: characterMeshCastsShadow(mesh),
  });
}

function partOf(
  c: WocArmorMergeCandidate,
  model: THREE.Object3D,
  bind: WocArmorMergeBind,
): WocArmorMergePart | null {
  if (Array.isArray(c.mesh.material) || !drawsOpaque(c.material)) return null;
  const skinned = c.mesh as THREE.SkinnedMesh;
  return skinned.isSkinnedMesh ? skinnedPart(skinned, model, bind) : rigidPart(c, model, bind);
}

// ---------------------------------------------------------------------------
// The plan: which drawn parts fold into which draw
// ---------------------------------------------------------------------------

/** One merged draw: the parts folded into it and what the merged mesh presents. */
export interface WocArmorMergeBatch {
  /** The identity of its geometry (wocArmorMergeKey). */
  readonly key: string;
  /** The file material its parts share: the merged mesh's source material. */
  readonly material: THREE.Material;
  readonly parts: readonly WocArmorMergePart[];
  readonly renderOrder: number;
  readonly layers: number;
  readonly caster: boolean;
}

export interface WocArmorMergePlan {
  /** Every batch's key, in order: what a mounted stand-in is compared by. */
  readonly key: string;
  readonly batches: readonly WocArmorMergeBatch[];
  /** Every folded part mesh, batch by batch: what leaves the render lists. */
  readonly sources: readonly THREE.Mesh[];
}

/**
 * Plan the stand-in for `drawn`: the batches of two or more parts sharing a file
 * material and a layout, each part with its conversion into `bind`. Null when nothing
 * folds. `layersOf` is a part's layer mask as it draws (a part a standing stand-in
 * took out of the render lists reads zero meanwhile).
 */
export function planWocArmorMerge(
  model: THREE.Object3D,
  bind: WocArmorMergeBind,
  drawn: readonly WocArmorMergeCandidate[],
  layersOf: (mesh: THREE.Mesh) => number = (mesh) => mesh.layers.mask,
): WocArmorMergePlan | null {
  const parts: (WocArmorMergePart | null)[] = [];
  const facts: WocArmorMergeFacts[] = [];
  for (const c of drawn) {
    const layout = layoutOf(c.mesh, layersOf(c.mesh));
    const part = layout === null ? null : partOf(c, model, bind);
    parts.push(part);
    facts.push({ material: c.material.uuid, layout: layout ?? '', foldable: part !== null });
  }
  const batches: WocArmorMergeBatch[] = [];
  for (const members of wocArmorMergeBatches(facts)) {
    const folded = members.map((i) => parts[i] as WocArmorMergePart);
    const first = drawn[members[0]];
    const key = wocArmorMergeKey(
      folded.map((p) => ({
        // the part's SOURCE geometry: a kit folds the same buffer at every level (its levels
        // ride the merged geometry), so characters of every detail share one entry
        geometry: geometryLodSourceOf(p.mesh.geometry).uuid,
        material: first.material.uuid,
        bone: p.bone,
        bake: wocArmorMergeBake({
          matrix: p.toBind?.elements ?? null,
          normal: p.normalToBind?.elements ?? null,
          joints: p.joints,
          flip: p.flip,
        }),
      })),
    );
    batches.push({
      key,
      material: first.material,
      parts: folded,
      renderOrder: first.mesh.renderOrder,
      layers: layersOf(first.mesh),
      caster: characterMeshCastsShadow(first.mesh),
    });
  }
  if (batches.length === 0) return null;
  return {
    key: batches.map((b) => b.key).join('||'),
    batches,
    sources: batches.flatMap((b) => b.parts.map((p) => p.mesh)),
  };
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

const _v = new THREE.Vector3();
const _linear = new THREE.Matrix3();

/** A plain attribute's own array (its values as stored), or null for an interleaved or
 *  normalized one, which is read through its accessors. */
function storedArray(src: VertexAttribute): THREE.TypedArray | null {
  if ((src as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return null;
  return src.normalized ? null : (src as THREE.BufferAttribute).array;
}

/** Copy an attribute's values as floats (a quantized one read through its accessors,
 *  which denormalize; a plain float one as stored, bit for bit). */
function copyFloats(out: Float32Array, at: number, src: VertexAttribute, size: number): void {
  const stored = storedArray(src);
  if (stored instanceof Float32Array) {
    out.set(stored.subarray(0, src.count * size), at);
    return;
  }
  for (let i = 0; i < src.count; i++) {
    for (let c = 0; c < size; c++) out[at + i * size + c] = src.getComponent(i, c);
  }
}

/**
 * Fold `parts` (one batch: they share a layout) into one skinned geometry in the bind
 * space: positions, normals and tangents converted (or copied as stored), every other
 * carried attribute as stored, a skinned part's joints and weights (renumbered into
 * the body's bone order where its skeleton had another) and a rigid part's full weight
 * on its bone. `jointCount` is the body skeleton's, which sizes the joint attribute.
 *
 * Each part is folded from its SOURCE geometry (a part drawn at a coarser level draws a
 * variant: assets/geometry_lod.ts), and the merged geometry carries the parts' coarser
 * levels, offset and flipped as its own index is, so a character of any detail draws the
 * merged kit at the level its parts drew.
 */
export function mergeWocArmorGeometry(
  parts: readonly WocArmorMergePart[],
  jointCount: number,
): THREE.BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const { mesh } of parts) {
    const source = geometryLodSourceOf(mesh.geometry);
    const count = source.getAttribute('position').count;
    vertices += count;
    indices += Math.floor((source.index ? source.index.count : count) / 3) * 3;
  }
  const first = geometryLodSourceOf(parts[0].mesh.geometry);
  const carried: { name: string; size: number; array: Float32Array }[] = [];
  for (const name of WOC_ARMOR_MERGE_ATTRIBUTES.keys()) {
    const size = first.getAttribute(name)?.itemSize;
    if (size) carried.push({ name, size, array: new Float32Array(vertices * size) });
  }
  const position = new Float32Array(vertices * 3);
  const skinIndex =
    jointCount <= 0x100 ? new Uint8Array(vertices * 4) : new Uint16Array(vertices * 4);
  const skinWeight = new Float32Array(vertices * 4);
  const index = vertices > 0xffff ? new Uint32Array(indices) : new Uint16Array(indices);
  let v0 = 0;
  let i0 = 0;
  for (const part of parts) {
    const geo = geometryLodSourceOf(part.mesh.geometry);
    const pos = geo.getAttribute('position') as VertexAttribute;
    const count = pos.count;
    const toBind = part.toBind;
    if (toBind) {
      for (let i = 0; i < count; i++) {
        _v.fromBufferAttribute(pos, i)
          .applyMatrix4(toBind)
          .toArray(position, (v0 + i) * 3);
      }
      _linear.setFromMatrix4(toBind);
    } else {
      copyFloats(position, v0 * 3, pos, 3);
    }
    for (const { name, size, array } of carried) {
      const src = geo.getAttribute(name) as VertexAttribute | undefined;
      if (!src) continue;
      const matrix = name === 'normal' ? part.normalToBind : name === 'tangent' ? _linear : null;
      if (!toBind || !matrix) {
        copyFloats(array, v0 * size, src, size);
        continue;
      }
      // a direction: its length is the shader's to normalize, the handedness (a
      // tangent's fourth component) rides through
      for (let i = 0; i < count; i++) {
        const at = (v0 + i) * size;
        _v.fromBufferAttribute(src, i).applyMatrix3(matrix).normalize().toArray(array, at);
        if (size > 3) array[at + 3] = src.getW(i);
      }
    }
    if (part.bone === null) {
      const joints = geo.getAttribute('skinIndex') as VertexAttribute;
      const remap = part.joints;
      const stored = remap ? null : storedArray(joints);
      if (stored) {
        skinIndex.set(stored.subarray(0, count * 4), v0 * 4);
      } else {
        for (let i = 0; i < count; i++) {
          for (let c = 0; c < 4; c++) {
            const joint = joints.getComponent(i, c);
            skinIndex[(v0 + i) * 4 + c] = remap ? (remap[joint] ?? 0) : joint;
          }
        }
      }
      copyFloats(skinWeight, v0 * 4, geo.getAttribute('skinWeight') as VertexAttribute, 4);
    } else {
      for (let i = 0; i < count; i++) {
        skinIndex[(v0 + i) * 4] = part.bone;
        skinWeight[(v0 + i) * 4] = 1;
      }
    }
    const tris = geo.index;
    const n = Math.floor((tris ? tris.count : count) / 3) * 3;
    for (let k = 0; k < n; k += 3) {
      const a = tris ? tris.getX(k) : k;
      const b = tris ? tris.getX(k + 1) : k + 1;
      const c = tris ? tris.getX(k + 2) : k + 2;
      index[i0 + k] = v0 + a;
      index[i0 + k + 1] = v0 + (part.flip ? c : b);
      index[i0 + k + 2] = v0 + (part.flip ? b : c);
    }
    v0 += count;
    i0 += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  for (const { name, size, array } of carried) {
    out.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  out.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  mergeGeometryLod(
    out,
    parts.map((part) => ({ geometry: part.mesh.geometry, flip: part.flip })),
  );
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// ---------------------------------------------------------------------------
// The shared geometry cache
// ---------------------------------------------------------------------------

interface Entry {
  geometry: THREE.BufferGeometry;
  refs: number;
}

const cache = new Map<string, Entry>();
/** Idle merged kits kept for a kit that comes back (a few hundred KB each; the
 *  heaviest, the male warrior's, about 0.8 MB). */
const MAX_IDLE_MERGES = 16;

export interface WocArmorMergeLease {
  readonly geometry: THREE.BufferGeometry;
  release(): void;
}

/** Whether a merged geometry is already built (taking it costs no build). */
export function wocArmorMergeBuilt(key: string): boolean {
  return cache.has(key);
}

function trimIdle(): void {
  let idle = 0;
  for (const entry of cache.values()) if (entry.refs === 0) idle++;
  for (const [key, entry] of cache) {
    if (idle <= MAX_IDLE_MERGES) break;
    if (entry.refs > 0) continue;
    cache.delete(key);
    entry.geometry.dispose();
    idle--;
  }
}

/** Lease the merged geometry for `key`, building it on a miss. */
export function retainWocArmorMerge(
  key: string,
  build: () => THREE.BufferGeometry,
): WocArmorMergeLease {
  let entry = cache.get(key);
  if (!entry) {
    entry = { geometry: build(), refs: 0 };
    cache.set(key, entry);
  }
  entry.refs++;
  const held = entry;
  let released = false;
  return {
    geometry: entry.geometry,
    release() {
      if (released) return;
      released = true;
      held.refs--;
      // release order is the LRU order, as in the far bake cache
      if (held.refs === 0 && cache.get(key) === held) {
        cache.delete(key);
        cache.set(key, held);
      }
      trimIdle();
    },
  };
}

/**
 * Drop every merged kit nobody draws (a graphics profile change: the views that leased
 * them are gone, and the idle entries would otherwise outlive the renderer that
 * uploaded them). A kit still leased is left to its holder.
 */
export function clearIdleWocArmorMerges(): void {
  for (const [key, entry] of cache) {
    if (entry.refs > 0) continue;
    cache.delete(key);
    entry.geometry.dispose();
  }
}

export const wocArmorMergeInternalsForTest = {
  cache,
  reset(): void {
    for (const entry of cache.values()) entry.geometry.dispose();
    cache.clear();
  },
};

// ---------------------------------------------------------------------------
// One character's merged armor
// ---------------------------------------------------------------------------

/** The character-visual side of a merged kit: the armor dressing's own host
 *  (woc_armor_dressing.ts WocArmorDressingHost). */
export interface WocArmorMergeHost {
  /** Give a freshly mounted wrapper's meshes the visual's per-mesh setup. */
  adopt(node: THREE.Object3D): void;
  /** Reveal a wrapper once its programs link, then call `live`. `prepared` is false
   *  when what the wrapper wears as the gate settles is not known linked: the gate gave
   *  up, or an effect put other materials on while it linked. */
  reveal(node: THREE.Object3D, live?: (prepared: boolean) => void): void;
  /** Take a removed wrapper's meshes out of the visual's bookkeeping. */
  forget(node: THREE.Object3D): void;
}

type Worn = THREE.Material | THREE.Material[];

interface Mounted {
  readonly plan: WocArmorMergePlan;
  readonly leases: WocArmorMergeLease[];
  readonly wrapper: THREE.Group;
  readonly meshes: THREE.SkinnedMesh[];
  /** Each part's layer mask from before it was taken out of the render lists; null
   *  while the stand-in does not stand (its programs link, or it is parked). */
  masks: Map<THREE.Mesh, number> | null;
  /** What the merged meshes wore when the compile gate was asked to link them; null
   *  while no link is in flight. */
  linking: readonly Worn[] | null;
  /** What they wore when a link settled: the programs the gate is known to have linked. */
  linked: readonly Worn[] | null;
}

/** Whether the merged meshes wear exactly `worn` (the same material objects). */
function wearing(meshes: readonly THREE.Mesh[], worn: readonly Worn[] | null): boolean {
  if (!worn) return false;
  for (let i = 0; i < meshes.length; i++) if (meshes[i].material !== worn[i]) return false;
  return true;
}

/** Whether an overlay blends on a mounted stand-in: on its own meshes (the host mounts
 *  an effect on a mesh it adopts ahead of the parts) or on the parts it folds. */
function blended(m: Mounted): boolean {
  return overlaid(m.meshes) || overlaid(m.plan.sources);
}

/** How many links of one kit in a row may come back unprepared, on the very materials
 *  the gate was asked with, before the kit is left in its parts (the head's rule:
 *  woc_head_merge.ts MAX_UNPREPARED_REVEALS). */
const MAX_UNPREPARED_LINKS = 2;

/** Whether two plans stand in for the very same part meshes with the same buffers. */
function sameStandIn(a: WocArmorMergePlan, b: WocArmorMergePlan): boolean {
  if (a.key !== b.key || a.sources.length !== b.sources.length) return false;
  for (let i = 0; i < a.sources.length; i++) if (a.sources[i] !== b.sources[i]) return false;
  return true;
}

export class WocArmorMergeRig {
  private mounted: Mounted | null = null;
  /** The stand-in wanted but not mounted yet: its owner asks for the mount. */
  private pending: WocArmorMergePlan | null = null;
  /** The body's bind, read once (a model keeps its skeleton for life). */
  private bind: WocArmorMergeBind | null = null;
  /** A kit that could not mount (its mount threw, or the gate could not prepare its
   *  programs twice running): it keeps its parts and is not tried again under this gate. */
  private refused: string | null = null;
  /** Links of one kit in a row that came back unprepared on exactly what was asked. */
  private unprepared: { key: string; count: number } | null = null;
  /** The parts of the waiting stand-in wear a blended overlay: nothing to mount yet. */
  private blocked = false;
  /** Something a mounted stand-in's state hangs on changed (the host mounted other
   *  materials, its gate was replaced): the next poll settles it again. */
  private dirty = false;

  /** `lod`: the geometry level the body's parts draw (woc_lod_core.ts): the merged meshes draw
   *  the same level of the shared merged geometry. */
  constructor(
    private readonly host: WocArmorMergeHost,
    private readonly model: THREE.Object3D,
    private readonly lod: GeometryLodLevel = 'lod0',
  ) {}

  /** The merged meshes while a stand-in is mounted (drawn only while it stands). */
  get meshes(): readonly THREE.SkinnedMesh[] {
    return this.mounted?.meshes ?? [];
  }

  /** Whether the merged meshes stand in for their parts right now. */
  get standing(): boolean {
    return this.mounted?.masks != null;
  }

  /** Whether a planned stand-in waits to be mounted (its owner asks: `mountPending`). */
  get isWaiting(): boolean {
    return this.pending !== null;
  }

  /** Whether the waiting stand-in can mount now: under a blended overlay the parts draw
   *  by themselves, and it waits for the overlay to end (effectsChanged). */
  get mountable(): boolean {
    return this.pending !== null && this.mounted === null && !this.blocked;
  }

  /** Whether the waiting stand-in's geometry is already built (its mount costs no fold). */
  get pendingBuilt(): boolean {
    const plan = this.pending;
    if (!plan) return false;
    for (const batch of plan.batches) if (!wocArmorMergeBuilt(batch.key)) return false;
    return true;
  }

  /**
   * Reconcile with the armor the model draws right now. A stand-in already mounted for
   * exactly those parts is left alone; any other is dropped first, so its parts draw
   * again at once. `build: false` only drops (a kit change lands inside the host's own
   * dressing pass, and a mount's milliseconds belong to its owner's budget); the new kit
   * then waits (isWaiting) for `mountPending`. Returns whether the mounted stand-in
   * changed.
   */
  sync(build = true): boolean {
    const plan = this.plan();
    this.pending = null;
    if (!plan || plan.key === this.refused) return this.unmount();
    const m = this.mounted;
    if (m && sameStandIn(m.plan, plan)) return false;
    const dropped = this.unmount();
    this.wait(plan);
    return (build && this.mountPlan(plan)) || dropped;
  }

  /**
   * Mount the stand-in `sync` left waiting. The caller owns the when (its frame
   * budget). The parts are read again first, so it stands in for what draws NOW.
   * Returns whether a stand-in is mounted afterwards: one whose parts wear a blended
   * overlay keeps waiting, and one that throws leaves the kit in its parts.
   */
  mountPending(): boolean {
    if (!this.pending || this.mounted) return false;
    const plan = this.plan();
    this.pending = null;
    if (!plan || plan.key === this.refused) return false;
    this.wait(plan);
    return this.mountPlan(plan);
  }

  /**
   * Per frame: bring a mounted stand-in to the state its materials allow (standing,
   * linking behind the compile gate, or parked under a blended overlay), once something
   * that state hangs on changed. One flag read otherwise.
   */
  poll(): void {
    const m = this.mounted;
    if (!m || !this.dirty) return;
    this.dirty = false;
    this.settle(m);
  }

  /**
   * The host mounted another effect state's materials (every mesh of the body, the
   * merged ones included). A stand-in that turned blended goes back to its parts at
   * once, inside this call: it is never drawn blended. One that turned opaque again
   * stands from the next poll (never from inside the host's own material pass), and a
   * waiting one learns whether its parts still wear an overlay.
   */
  effectsChanged(): void {
    const m = this.mounted;
    if (m) {
      if (m.masks && blended(m)) this.park(m);
      this.dirty = true;
    }
    const plan = this.pending;
    if (plan) this.blocked = overlaid(plan.sources);
  }

  /** The host's compile gate was replaced (a pooled body handed out again, or to another
   *  renderer generation): a link still in flight may wait on a settle that never comes,
   *  so the next poll asks again, and a kit the old gate gave up on gets another try. */
  gateChanged(): void {
    if (this.mounted) this.mounted.linking = null;
    this.refused = null;
    this.unprepared = null;
    this.dirty = true;
  }

  /** Take the stand-in down and want none until the next `sync`; its parts draw again.
   *  Returns whether one was up. */
  drop(): boolean {
    this.pending = null;
    return this.unmount();
  }

  dispose(): void {
    this.drop();
  }

  private plan(): WocArmorMergePlan | null {
    this.bind ??= wocArmorMergeBindOf(this.model);
    if (!this.bind) return null;
    const hidden = this.mounted?.masks;
    return planWocArmorMerge(
      this.model,
      this.bind,
      wocArmorDrawnParts(this.model),
      hidden ? (mesh) => hidden.get(mesh) ?? mesh.layers.mask : undefined,
    );
  }

  /** Leave `plan` waiting for its mount, knowing whether its parts wear an overlay now. */
  private wait(plan: WocArmorMergePlan): void {
    this.pending = plan;
    this.blocked = overlaid(plan.sources);
  }

  private mountPlan(plan: WocArmorMergePlan): boolean {
    const bind = this.bind;
    if (!bind || this.blocked) return false;
    this.pending = null;
    const started = performance.now();
    try {
      this.mount(plan, bind);
    } catch (err) {
      // a kit that cannot mount keeps its parts, and is never tried again: a throw from
      // the per-frame path would stall every frame after it
      this.unmount();
      this.refused = plan.key;
      logAssetMissOnce(
        `woc-armor-merge:${err instanceof Error ? err.message : String(err)}`,
        'WOC merged armor could not mount, the kit keeps drawing part by part:',
        err,
      );
      return false;
    }
    // the whole mount (the fold on a miss, the visual's per-mesh setup) under its own
    // view-lane kind: it runs from the per-frame path, never inside a view build
    recordBuildSpan('view:woc-armor-merge', performance.now() - started, started);
    return true;
  }

  private mount(plan: WocArmorMergePlan, bind: WocArmorMergeBind): void {
    const wrapper = new THREE.Group();
    wrapper.name = WOC_ARMOR_MERGED_NAME;
    // drawn only while it stands: a mount that fails half way never draws over its parts
    wrapper.visible = false;
    const m: Mounted = {
      plan,
      leases: [],
      wrapper,
      meshes: [],
      masks: null,
      linking: null,
      linked: null,
    };
    // from here on a throw is cleaned up by unmount (the leases taken, the wrapper)
    this.mounted = m;
    for (const [n, batch] of plan.batches.entries()) {
      const lease = retainWocArmorMerge(batch.key, () =>
        mergeWocArmorGeometry(batch.parts, bind.skeleton.bones.length),
      );
      m.leases.push(lease);
      const mesh = new THREE.SkinnedMesh(
        geometryLodVariant(lease.geometry, this.lod),
        batch.material,
      );
      mesh.name = `${WOC_ARMOR_MERGED_NAME}_${n}`;
      mesh.userData = { wocArmorPart: true, [WOC_ARMOR_MERGED_KEY]: true };
      if (!batch.caster) mesh.userData.shadowCaster = false;
      mesh.renderOrder = batch.renderOrder;
      mesh.layers.mask = batch.layers;
      // never culled on a bind-pose sphere its parts would have outlived: the host's
      // setup gives a caster the padded one (skinned_cull_bounds.ts) and turns this on
      mesh.frustumCulled = false;
      // ...and the sphere three sorts by, so it never skins every vertex to find one
      const sphere = lease.geometry.boundingSphere;
      if (sphere) mesh.boundingSphere = sphere.clone();
      mesh.bind(bind.skeleton, bind.bindMatrix);
      wrapper.add(mesh);
      m.meshes.push(mesh);
    }
    this.model.add(wrapper);
    this.host.adopt(wrapper);
    this.settle(m);
  }

  private unmount(): boolean {
    const m = this.mounted;
    if (!m) return false;
    this.mounted = null;
    if (m.masks) for (const [mesh, mask] of m.masks) mesh.layers.mask = mask;
    this.host.forget(m.wrapper);
    m.wrapper.removeFromParent();
    for (const lease of m.leases) lease.release();
    return true;
  }

  /** Where a mounted stand-in's materials put it: parked while an overlay blends on its
   *  meshes or its parts, standing once the gate linked what it wears, else linking. */
  private settle(m: Mounted): void {
    if (blended(m)) {
      this.park(m);
      return;
    }
    if (m.masks || m.linking) return;
    if (wearing(m.meshes, m.linked)) this.stand(m);
    else this.link(m);
  }

  /** Back to the parts: they draw again, the merged meshes do not. */
  private park(m: Mounted): void {
    if (m.masks) for (const [mesh, mask] of m.masks) mesh.layers.mask = mask;
    m.masks = null;
    m.wrapper.visible = false;
  }

  /** The parts leave the render lists and the merged meshes draw, in one step. */
  private stand(m: Mounted): void {
    const masks = new Map<THREE.Mesh, number>();
    for (const source of m.plan.sources) {
      masks.set(source, source.layers.mask);
      source.layers.mask = 0;
    }
    m.masks = masks;
    m.wrapper.visible = true;
  }

  /** Link what the merged meshes wear behind the host's compile gate, the parts drawing
   *  meanwhile. */
  private link(m: Mounted): void {
    const asked = m.meshes.map((mesh) => mesh.material);
    m.linking = asked;
    this.host.reveal(m.wrapper, (prepared) => {
      // dropped while its programs linked: the wrapper went with it
      if (this.mounted !== m) return;
      // the gate shows what it linked, whichever ask this is: the wrapper draws only
      // while its parts have stepped aside, so it is hidden again before anything else
      if (!m.masks) m.wrapper.visible = false;
      // an ask the gate's replacement superseded (gateChanged): not this link's to settle
      if (m.linking !== asked) return;
      m.linking = null;
      const same = wearing(m.meshes, asked);
      if (!prepared) {
        // What it wears is not known linked: drawing it now could link on a live frame,
        // and the parts are still there to draw. The gate proves what is mounted when it
        // settles, so an effect edge during the link (a buff glow, a hit response) reads
        // as unprepared although the gate did its work: no verdict on the kit, and what
        // it wears now is asked for from the next poll. A gate that could not prepare the
        // very materials it was asked with gets one more try; twice running, the kit
        // keeps its parts for as long as this gate lasts (never an ask per frame).
        if (same) {
          const key = m.plan.key;
          const count = this.unprepared?.key === key ? this.unprepared.count + 1 : 1;
          this.unprepared = { key, count };
          if (count >= MAX_UNPREPARED_LINKS) {
            this.unmount();
            this.refused = key;
            return;
          }
        }
        this.dirty = true;
        return;
      }
      this.unprepared = null;
      // only what the gate was asked with is known linked: an overlay (or a skin) that
      // landed meanwhile put other materials on, and those link in their own turn
      if (same) m.linked = asked;
      this.settle(m);
    });
  }
}
