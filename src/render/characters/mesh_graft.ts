// Graft skinned meshes from one GLB onto another GLB's rig, by bone name.
//
// Why this exists
// ---------------
// A level-20 armored body is its own GLB holding only the Armor_* plates, forged
// onto the class body's donor rig. That is exactly right for a fully enclosing
// helm (warrior, paladin, shaman), but six classes wear a MASK or an open HAT:
// the rogue's hood, the mage/priest/warlock hats, the hunter's skull, the druid's
// antler mask. Those need the character's own head rendering underneath, and the
// armor GLB has no head in it.
//
// Why a name-matched graft is exact here, not an approximation
// ------------------------------------------------------------
// three skins a vertex as
//
//     out = bindInv * SUM_i w_i * (bone_i.matrixWorld * boneInverse[i]) * bind * p
//
// Keep the SOURCE mesh's bindMatrix and boneInverses and swap only
// `bone_i.matrixWorld` for the target rig's same-named bone, and the result is
// identical as long as the two rigs place every shared bone at the same world
// transform. For these files they do, to the bit: both carry the same 25-joint
// mixamorig skeleton with byte-identical rest transforms (the armor was forged
// from the body), which is also why the armored bodies already borrow the base
// body's animation clips through `animUrls`. So this does NOT rebind across
// genuinely different skeletons, which stays forbidden: it re-points a mesh at
// the same rig in a different file.
//
// Anything it cannot prove safe is refused rather than grafted crooked: a mesh
// whose skeleton names a bone the target lacks is skipped and reported.
import * as THREE from 'three';

/** Every bone under `root`, by name. GLTFLoader sanitizes node names identically
 *  on both sides, so a raw name match is the right key. */
export function bonesByName(root: THREE.Object3D): Map<string, THREE.Bone> {
  const bones = new Map<string, THREE.Bone>();
  root.traverse((o) => {
    const bone = o as THREE.Bone;
    if (bone.isBone && !bones.has(bone.name)) bones.set(bone.name, bone);
  });
  return bones;
}

/** The target-rig counterparts of `skeleton`'s bones, in the SAME order, or null
 *  when the target is missing any of them (which makes the graft unsound). */
export function retargetBones(
  skeleton: THREE.Skeleton,
  targetBones: Map<string, THREE.Bone>,
): THREE.Bone[] | null {
  const out: THREE.Bone[] = [];
  for (const bone of skeleton.bones) {
    const match = targetBones.get(bone.name);
    if (!match) return null;
    out.push(match);
  }
  return out;
}

export interface GraftResult {
  /** Meshes added to the target, in request order. */
  grafted: THREE.SkinnedMesh[];
  /** Requested names that were not grafted, with the reason. */
  skipped: { name: string; reason: string }[];
}

/**
 * Clone the named skinned meshes out of `source` and bind them to `target`'s rig.
 *
 * Geometry and materials are SHARED with the source clone, matching how the rest
 * of the character pipeline treats per-asset caches (assembleModel's
 * SkeletonUtils clone shares them too, and they are never disposed).
 *
 * One retargeted Skeleton is built per distinct source skeleton and reused across
 * every mesh that rode it, so grafting eleven head variants does not cost eleven
 * bone textures.
 */
export function graftSkinnedNodes(
  target: THREE.Object3D,
  source: THREE.Object3D,
  names: Iterable<string>,
): GraftResult {
  const targetBones = bonesByName(target);
  const grafted: THREE.SkinnedMesh[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const skeletonCache = new Map<string, THREE.Skeleton | null>();
  const local = new THREE.Matrix4();

  for (const name of names) {
    const node = source.getObjectByName(name);
    if (!node) {
      skipped.push({ name, reason: 'not in the source GLB' });
      continue;
    }
    const src = node as THREE.SkinnedMesh;
    if (!src.isSkinnedMesh) {
      skipped.push({ name, reason: 'not a skinned mesh' });
      continue;
    }

    let skeleton = skeletonCache.get(src.skeleton.uuid);
    if (skeleton === undefined) {
      const bones = retargetBones(src.skeleton, targetBones);
      // Keep the source's boneInverses: they are what makes the swap exact.
      skeleton = bones ? new THREE.Skeleton(bones, src.skeleton.boneInverses) : null;
      skeletonCache.set(src.skeleton.uuid, skeleton);
    }
    if (!skeleton) {
      skipped.push({ name, reason: 'target rig is missing one of its bones' });
      continue;
    }

    const mesh = new THREE.SkinnedMesh(src.geometry, src.material);
    mesh.name = src.name;
    mesh.userData = { ...src.userData };
    mesh.castShadow = src.castShadow;
    mesh.receiveShadow = src.receiveShadow;
    mesh.visible = src.visible;
    mesh.renderOrder = src.renderOrder;
    mesh.layers.mask = src.layers.mask;
    // A skinned mesh's bind-pose bounds do not follow the animation; the rig owner
    // decides culling (visual.ts turns it off), so inherit rather than re-decide.
    mesh.frustumCulled = src.frustumCulled;
    // Reproduce the node's placement RELATIVE TO ITS OWN ROOT, so bindMatrixInverse
    // (which tracks matrixWorld in the default attached bind mode) lands where the
    // source's did once the target root is placed.
    source.updateMatrixWorld(true);
    local.copy(source.matrixWorld).invert().multiply(src.matrixWorld);
    local.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.bind(skeleton, src.bindMatrix);

    target.add(mesh);
    grafted.push(mesh);
  }

  return { grafted, skipped };
}
