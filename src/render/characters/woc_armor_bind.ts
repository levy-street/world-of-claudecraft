// Bind a WOC armor file's parts onto a character's own skeleton by bone NAME
// (the 2026-09-25 character size gameplan, step 6). Loader-free three.js, so
// the renderer's armor store (woc_armor_packs.ts) and the Guide's standalone
// viewer (src/guide/viewer/model.ts) bind exactly the same way.
//
// A split file carries its own copy of the rig and its own vertex
// quantization, which gltf-transform folds into each skin's inverse bind
// matrices: a base and an armor file written apart never share IBMs, though
// their rest poses agree bone for bone (the build rejects a file whose do
// not). rig_merge.ts proves the algebra that reconciles the two: a part's
// inverses differ from the base's by ONE constant transform T, so
// pre-transforming the part's vertices by `bind^-1 * T * bind` makes it skin
// identically against the BASE skeleton. So a set is prepared ONCE per file:
//
//   1. its parts merge by item and material (a pair of boots is one draw, as
//      the per-class files merged them), under the file's own skin;
//   2. every part is rebaked into the base rig's bind space and its joint
//      indices are renumbered into the base skeleton's bone order;
//
// and a character then draws each part as a new SkinnedMesh over the SHARED
// geometry and material, bound to the character's own (already shared)
// Skeleton: no extra bone texture, no per-wearer geometry, and every wearer of
// a set shares one copy of it.
//
// A RIGID part (a shoulder pad riding its armor_shoulder bone, as authored) is
// no skin at all: its node hangs under a bone of the file's rig copy. It keeps
// that node (and its dequantizing transform) and is re-hung, cloned over the
// same shared geometry, under the character's own bone of that name.
import * as THREE from 'three';
import { mergeSkinnedParts, rebakeGeometry, rebakeMatrix, solveRebindTransform } from './rig_merge';

/** The bind data every part is rebaked into: a base rig's shared skeleton. */
export interface WocRigBind {
  /** Bone names in the skeleton's own order (the order joint indices address). */
  readonly boneNames: readonly string[];
  readonly boneInverses: readonly THREE.Matrix4[];
  readonly bindMatrix: THREE.Matrix4;
}

/** The canonical bind data of a root whose skinned meshes share one skeleton (a base clone
 *  after shareRigSkeleton): its first skinned mesh's skeleton and bind matrix. */
export function wocRigBindOf(root: THREE.Object3D): WocRigBind | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!found && sm.isSkinnedMesh && sm.skeleton && isRigBodyMesh(o)) found = sm;
  });
  const mesh = found as THREE.SkinnedMesh | null;
  if (!mesh) return null;
  return {
    boneNames: mesh.skeleton.bones.map((b) => b.name),
    boneInverses: mesh.skeleton.boneInverses,
    bindMatrix: mesh.bindMatrix.clone(),
  };
}

/** The live skeleton armor parts bind to: the one a root's body meshes share. */
export function wocRigSkeletonOf(root: THREE.Object3D): THREE.Skeleton | null {
  let found: THREE.Skeleton | null = null;
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!found && sm.isSkinnedMesh && sm.skeleton && isRigBodyMesh(o)) found = sm.skeleton;
  });
  return found;
}

/** A mesh of the base itself: never an attached armor part or a held prop on its own rig. */
function isRigBodyMesh(o: THREE.Object3D): boolean {
  return !o.userData.wocArmorPart && !o.userData.weaponMesh;
}

/** One armor part ready to draw on any character of its rig. */
export interface WocArmorTemplate {
  readonly name: string;
  /** In the rig's bind space; joint indices in the rig's bone order. */
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  /** Carries rig_merge's mergedSkinnedPartNames for a merged pair. */
  readonly userData: Readonly<Record<string, unknown>>;
}

/** One rigid part: its node subtree (shared geometry) and the bone it hangs from. */
export interface WocRigidTemplate {
  /** The bone's name as loaded (GLTFLoader's sanitized form, the character's own). */
  readonly bone: string;
  readonly node: THREE.Object3D;
}

export interface PreparedWocArmor {
  readonly templates: readonly WocArmorTemplate[];
  readonly rigid: readonly WocRigidTemplate[];
  /** Parts no single transform maps onto the rig (a rest pose that genuinely differs):
   *  never drawn, named so the caller can say so once. */
  readonly refused: readonly string[];
}

/** Renumber a geometry's joint indices through `remap` (pack bone index -> rig bone index),
 *  narrowed to the smallest exact integer array. */
function remapJoints(geometry: THREE.BufferGeometry, remap: readonly number[]): void {
  const src = geometry.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
  if (!src) return;
  let max = 0;
  for (const v of remap) if (v > max) max = v;
  const out =
    max < 0x100
      ? new Uint8Array(src.count * src.itemSize)
      : new Uint16Array(src.count * src.itemSize);
  for (let i = 0; i < src.count; i++) {
    for (let c = 0; c < src.itemSize; c++) {
      const j = src.getComponent(i, c);
      out[i * src.itemSize + c] = remap[j] ?? 0;
    }
  }
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(out, src.itemSize));
}

/**
 * A part drawn with several materials is its NODE (named for the part, `Armor_...`) holding one
 * mesh per primitive, and the glTF loader names those meshes after the glTF MESH
 * (`Female_Warrior_Boot_L_|_Mesh001`, `..._1`), which no manifest names: the dressing would
 * never find the part and it stayed hidden (every female set's boots, the female warrior's
 * gauntlets). Name each such mesh after its part, `_N` for the later primitives, exactly the
 * split-primitive form the part resolver already reads (woc_parts_core wocNodeNameOf).
 */
export function nameMeshesAfterParts(scene: THREE.Object3D): void {
  scene.traverse((o) => {
    const node = o.parent;
    if (!(o as THREE.Mesh).isMesh || !node || node === scene || (node as THREE.Bone).isBone) return;
    if (!node.name.startsWith('Armor_') || o.name.startsWith(node.name)) return;
    const meshes = node.children.filter((c) => (c as THREE.Mesh).isMesh);
    const i = meshes.indexOf(o as THREE.Mesh);
    o.name = i <= 0 ? node.name : `${node.name}_${i}`;
  });
}

/**
 * Prepare an armor file's parsed scene against a rig (see the header). Consumes `scene`
 * (merges in place): pass a clone when the parse is shared. `partitionKey` keeps two
 * independently worn items out of one merged draw (woc_parts_core wocMergePartition).
 */
export function prepareWocArmor(
  scene: THREE.Object3D,
  rig: WocRigBind,
  partitionKey?: (mesh: THREE.SkinnedMesh) => string,
): PreparedWocArmor {
  nameMeshesAfterParts(scene);
  mergeSkinnedParts(scene, undefined, partitionKey ? { partitionKey } : undefined);
  scene.updateMatrixWorld(true);
  const rigIndex = new Map<string, number>();
  for (const [i, name] of rig.boneNames.entries()) rigIndex.set(name, i);
  const templates: WocArmorTemplate[] = [];
  const refused: string[] = [];
  const parts: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh && sm.skeleton) parts.push(sm);
  });
  // rigid parts: a meshed subtree hanging directly under a rig bone (never a skinned one)
  const bones = new Set<THREE.Object3D>();
  for (const part of parts) for (const bone of part.skeleton.bones) bones.add(bone);
  scene.traverse((o) => {
    if ((o as THREE.Bone).isBone || rigIndex.has(o.name)) bones.add(o);
  });
  const rigid: WocRigidTemplate[] = [];
  for (const bone of bones) {
    for (const child of [...bone.children]) {
      if (bones.has(child)) continue;
      let meshed = false;
      let skinned = false;
      child.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshed = true;
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
      });
      if (!meshed || skinned) continue;
      child.removeFromParent();
      rigid.push({ bone: bone.name, node: child });
    }
  }
  for (const part of parts) {
    const bones = part.skeleton.bones;
    const remap: number[] = [];
    const canon: THREE.Matrix4[] = [];
    let known = true;
    for (const bone of bones) {
      const i = rigIndex.get(bone.name);
      if (i === undefined) {
        known = false;
        break;
      }
      remap.push(i);
      canon.push(rig.boneInverses[i]);
    }
    const t = known ? solveRebindTransform(canon, part.skeleton.boneInverses) : null;
    if (!t || Array.isArray(part.material)) {
      refused.push(part.name);
      continue;
    }
    const geometry = rebakeGeometry(
      part.geometry,
      rebakeMatrix(rig.bindMatrix, part.bindMatrix, t),
    );
    remapJoints(geometry, remap);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    templates.push({
      name: part.name,
      geometry,
      material: part.material,
      userData: { ...part.userData },
    });
  }
  return { templates, rigid, refused };
}

/** Hang a prepared set's rigid parts on a character's own bones (a clone of each part's node
 *  over the shared geometry and material, inside a wrapper the caller can gate without
 *  touching the part's own visibility). Returns the wrappers; a part whose bone the character
 *  lacks is left off. */
export function hangWocRigidArmor(
  rigid: readonly WocRigidTemplate[],
  model: THREE.Object3D,
): THREE.Object3D[] {
  const wrappers: THREE.Object3D[] = [];
  for (const part of rigid) {
    const bone = model.getObjectByName(part.bone);
    if (!bone) continue;
    const wrapper = new THREE.Group();
    wrapper.name = `woc_armor_rigid_${part.node.name}`;
    const clone = part.node.clone(true);
    clone.traverse((o) => {
      o.userData = { ...o.userData, wocArmorPart: true };
    });
    wrapper.add(clone);
    bone.add(wrapper);
    wrappers.push(wrapper);
  }
  return wrappers;
}

/** Draw a prepared set's parts on a character: one SkinnedMesh per template over the shared
 *  geometry and material, bound to the character's skeleton with the rig's bind matrix. */
export function instantiateWocArmor(
  templates: readonly WocArmorTemplate[],
  skeleton: THREE.Skeleton,
  bindMatrix: THREE.Matrix4,
): THREE.SkinnedMesh[] {
  return templates.map((t) => {
    const mesh = new THREE.SkinnedMesh(t.geometry, t.material);
    mesh.name = t.name;
    mesh.userData = { ...t.userData, wocArmorPart: true };
    mesh.bind(skeleton, bindMatrix);
    if (t.geometry.boundingSphere) mesh.boundingSphere = t.geometry.boundingSphere.clone();
    return mesh;
  });
}
