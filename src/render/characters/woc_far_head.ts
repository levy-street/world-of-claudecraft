// The far bake's pose of a WOC character's modular head (woc_far_bake.ts): the
// drawn head pieces posed with the character's own face morphs (quantized,
// woc_far_head_core.ts) on the throwaway bake model, so the frozen far mesh
// freezes the face the near body draws: the chin, the eyes and brows, the bald
// crown and the worn hairstyle's scalp tuck.
//
// Posing works on the throwaway only: its hung pieces are clones over the
// PACK's shared geometry (woc_head_packs.ts), which is never written. Each
// morphed piece is handed a scratch geometry carrying its morph-applied
// positions (and the source's uv, index and skin attributes by reference),
// because bakeStaticPose reads the plain position attribute; the scratch never
// reaches the GPU and the caller disposes it after the bake.
//
// The fold (foldWocHeadForBake) is the draw-count half: a face is a dozen rigid
// pieces, each on its own material, and a group per material made the far mesh
// of one character 17 to 20 draws, a dozen of them the head (2026-10-02, 40
// characters far away: 67 fps against 105 to 110 for the two-piece bodies they
// replace). Every piece the near merge would fold (woc_head_merge.ts
// wocHeadMergeFold, ONE rule for both) bakes into one group instead, drawn by
// the merged tint layer (woc_far_tint.ts): each vertex carries the slot of the
// material it came from, and a flat-coloured piece reads the atlas's white
// cell. The group is drawn two sided, as its source is, and the layer drops the
// back of a slot whose own material was one sided, so nothing is baked twice.
// A piece the rule refuses keeps its own group, exactly as before.
import * as THREE from 'three';
import { type WocFarHeadPose, wocFarHeadVertexSlots } from './woc_far_head_core';
import type { WocHeadTintedRole, WocLinearRgb } from './woc_head_look_core';
import {
  type WocHeadMergeCandidate,
  wocHeadMergedSource,
  wocHeadMergeFold,
} from './woc_head_merge';
import { WOC_HEAD_MERGE_SLOT_ATTRIBUTE, type WocHeadMergeSlot } from './woc_head_merge_core';
import {
  WOC_HEAD_TINT_REF_KEY,
  WOC_HEAD_TINT_ROLE_KEY,
  type WocHeadRig,
  wocHeadFileMaterial,
  wocHeadRigOf,
} from './woc_head_packs';

/** A mesh whose whole chain up to the bake model is visible (it bakes). */
function drawn(mesh: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = mesh; o; o = o.parent) {
    if (!o.visible) return false;
    if (o === root) return true;
  }
  return true;
}

/** A piece's positions with its current morph influences applied (never its
 *  bones: bakeStaticPose skins what it is handed), over the source's other
 *  attributes by reference. */
function morphedGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  const src = mesh.geometry;
  const pos = src.getAttribute('position');
  const baked = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    THREE.Mesh.prototype.getVertexPosition.call(mesh, i, v);
    baked[i * 3] = v.x;
    baked[i * 3 + 1] = v.y;
    baked[i * 3 + 2] = v.z;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(baked, 3));
  for (const name of ['uv', 'skinIndex', 'skinWeight']) {
    const a = src.getAttribute(name);
    if (a) out.setAttribute(name, a);
  }
  if (src.index) out.setIndex(src.index);
  return out;
}

/**
 * Pose a throwaway bake model's hung head with a far pose: every piece's
 * influences written BY NAME, exactly as the dressing drives the live body (a
 * piece without a target is skipped), then every drawn piece with a non-zero
 * influence baked into a scratch geometry. Returns the scratch geometries for
 * the caller to dispose once the bake has read them. A no-op without a hung
 * head or a pose.
 */
export function poseWocHeadForBake(
  model: THREE.Object3D,
  pose: WocFarHeadPose | null,
): THREE.BufferGeometry[] {
  const rig = wocHeadRigOf(model);
  if (!rig || !pose) return [];
  const scratch: THREE.BufferGeometry[] = [];
  for (const mesh of rig.meshes) {
    const dict = mesh.morphTargetDictionary;
    const influences = mesh.morphTargetInfluences;
    if (!dict || !influences) continue;
    for (const name in pose.morphs) {
      const at = dict[name];
      if (at !== undefined) influences[at] = pose.morphs[name];
    }
    if (!drawn(mesh, model) || !influences.some((w) => w !== 0)) continue;
    const geometry = morphedGeometry(mesh);
    mesh.geometry = geometry;
    scratch.push(geometry);
  }
  return scratch;
}

/** What a far bake draws as ONE head group. */
export interface WocFarHeadFold {
  /** Each folded piece mesh's slot in the merged material's tables. */
  readonly slotOf: ReadonlyMap<THREE.Mesh, number>;
  /** The SOURCE material the group draws with (woc_head_merge.ts wocHeadMergedSource). */
  readonly source: THREE.Material;
  readonly slots: readonly WocHeadMergeSlot[];
  /** One FILE material per slot: the far tier derives each, for the surface its
   *  slot's row carries (woc_far_tint.ts). */
  readonly slotSources: readonly THREE.Material[];
  /** The textures the merged material samples beside the core atlas on its `map`: the
   *  hairstyle's, the beard's and the scalp cap's. */
  readonly hairMap: THREE.Texture | null;
  readonly beardMap: THREE.Texture | null;
  readonly scalpMap: THREE.Texture | null;
}

/** The name of the piece node a hung head mesh draws for (a piece of several
 *  materials is a node holding one mesh per primitive). */
function pieceOf(mesh: THREE.Object3D, rig: WocHeadRig): string | null {
  for (let o: THREE.Object3D | null = mesh; o; o = o.parent) {
    if (rig.pieces.get(o.name) === o) return o.name;
  }
  return null;
}

/** A flat-coloured piece's geometry with every vertex on ONE uv, over the source's
 *  positions and index by reference. */
function flatUvGeometry(
  src: THREE.BufferGeometry,
  uv: readonly [number, number],
): THREE.BufferGeometry {
  const position = src.getAttribute('position');
  const flat = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    flat[i * 2] = uv[0];
    flat[i * 2 + 1] = uv[1];
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', position);
  out.setAttribute('uv', new THREE.BufferAttribute(flat, 2));
  if (src.index) out.setIndex(src.index);
  return out;
}

/**
 * Fold a throwaway bake model's head for the far bake: of the hung head meshes in
 * `meshes` (the bake's walk: what is drawn, posed already), the ones the merged
 * material can draw, each with its slot. A flat-coloured piece is handed a scratch
 * geometry whose uv is the atlas's white cell (pushed onto `scratch` for the caller
 * to dispose with the pose's), because the merged material samples the atlas for
 * every slot. Null without a hung head, or when the rule folds nothing: the bake
 * then groups by material, as it always did.
 */
export function foldWocHeadForBake(
  model: THREE.Object3D,
  meshes: readonly THREE.Mesh[],
  scratch: THREE.BufferGeometry[],
): WocFarHeadFold | null {
  const rig = wocHeadRigOf(model);
  if (!rig) return null;
  const pieces: WocHeadMergeCandidate[] = [];
  for (const mesh of meshes) {
    const material = wocHeadFileMaterial(mesh);
    const piece = material ? pieceOf(mesh, rig) : null;
    if (!material || piece === null) continue;
    pieces.push({
      mesh,
      piece,
      material,
      role: (mesh.userData[WOC_HEAD_TINT_ROLE_KEY] as WocHeadTintedRole | undefined) ?? null,
      ref: (mesh.userData[WOC_HEAD_TINT_REF_KEY] as WocLinearRgb | undefined) ?? null,
    });
  }
  // every piece is baked into the model's own space: nothing to place, none left out
  const fold = wocHeadMergeFold(pieces, () => true);
  if (!fold) return null;
  const slotOf = new Map<THREE.Mesh, number>();
  const slotSources: THREE.Material[] = [];
  for (const { candidate, slot, flatUv } of fold.folded) {
    slotOf.set(candidate.mesh, slot);
    slotSources[slot] ??= candidate.material;
    if (!flatUv) continue;
    const geometry = flatUvGeometry(candidate.mesh.geometry, flatUv);
    candidate.mesh.geometry = geometry;
    scratch.push(geometry);
  }
  return {
    slotOf,
    source: wocHeadMergedSource(fold.base),
    slots: fold.slots,
    slotSources,
    hairMap: fold.hairMap,
    beardMap: fold.beardMap,
    scalpMap: fold.scalpMap,
  };
}

/**
 * Tag a baked far geometry's vertices with their slot (`aWocHmSlot`, the attribute
 * the merged layer declares, woc_head_tint.ts): the folded head pieces' with their
 * own, every other vertex 0. `meshes` is the bake's walk and `order` the order it
 * laid their vertices out in (assets.ts StaticPoseBake.order).
 */
export function setWocFarHeadSlots(
  geo: THREE.BufferGeometry,
  meshes: readonly THREE.Mesh[],
  order: readonly number[],
  slotOf: ReadonlyMap<THREE.Mesh, number>,
): void {
  const slots = wocFarHeadVertexSlots(
    order,
    meshes.map((mesh) => mesh.geometry.getAttribute('position').count),
    meshes.map((mesh) => slotOf.get(mesh) ?? null),
  );
  geo.setAttribute(WOC_HEAD_MERGE_SLOT_ATTRIBUTE, new THREE.BufferAttribute(slots, 1));
}

/**
 * The face morphs a model's hung head DRAWS right now, by name, read back off
 * its pieces: the dressing writes one value per target name to every piece
 * that carries it (the look's morphs, with its own overrides such as a
 * hair-hiding helm raising the bald crown), so the far bake freezes exactly the
 * face the near body shows, whatever rule produced it. A name no hung piece
 * carries is left out (nothing would bake it). Null without a hung head.
 */
export function wocDrawnHeadMorphs(
  model: THREE.Object3D,
  names: Readonly<Record<string, number>>,
): Record<string, number> | null {
  const rig = wocHeadRigOf(model);
  if (!rig) return null;
  const out: Record<string, number> = {};
  for (const name in names) {
    for (const mesh of rig.meshes) {
      const at = mesh.morphTargetDictionary?.[name];
      if (at === undefined) continue;
      out[name] = mesh.morphTargetInfluences?.[at] ?? 0;
      break;
    }
  }
  return out;
}
