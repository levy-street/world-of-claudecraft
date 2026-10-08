// A WOC key's shadow stand-in: what a WOC body casts in the proxy band (past the
// articulated shadow range) while its own far bake does not exist or is still linking
// (far_lod_reveal_core.ts shadowStandInShown). It is the key's bare body mid-idle with an
// ellipsoid for the head its base file does not carry (woc_shadow_stand_in_core.ts), baked
// once per key by assets.ts prepareVisual, where the key's unused far mesh used to be
// baked, and shared by every body of the key.
//
// Why a stand-in at all: a WOC far bake is one bake per LOOK (the worn parts, their armor
// files, the face), minted only when a body first crosses into the far band, so a body
// that has never been far has no baked silhouette, and a body with no proxy casts nothing
// between the articulated range and that crossing. Baking each body's own silhouette for
// its shadow alone was a full far bake per character standing in the middle distance. The
// stand-in differs from a dressed silhouette by a shoulder pad and a hairstyle, which is
// one or two texels of a blurred shadow map at that range.
//
// POSITIONS ONLY, and only the vertices the far level draws: the stand-in is drawn by the
// shadow-only material (no lighting, no texture), so normals and uvs would be dead weight,
// and a WOC far index reaches about two fifths of its geometry's vertices.
import * as THREE from 'three';
import { wocStandInHead } from './woc_shadow_stand_in_core';

/** The ellipsoid's tessellation: a shadow of a head, a few texels across. */
const HEAD = new THREE.SphereGeometry(1, 8, 6);

/**
 * Bake the stand-in of the bare body `model` (dressed as its anatomy, at REST when this is
 * called: `neckTop` and `crown` are heights of that pose). `meshes` is the walk to bake
 * (never a held prop: a stand-in is shared by every body of the key, whatever it holds).
 * The model is posed mid-idle here, exactly as a far bake poses its own, and left with the
 * clip's bindings released. Null when there is nothing to bake.
 */
export function bakeWocShadowStandIn(
  model: THREE.Object3D,
  meshes: readonly THREE.Mesh[],
  idle: THREE.AnimationClip | undefined,
  norm: THREE.Matrix4,
  neckTop: number,
  crown: number,
): THREE.BufferGeometry | null {
  const bone = model.getObjectByName('head') ?? null;
  const rest = bone ? bone.matrixWorld.clone() : null;
  const mixer = new THREE.AnimationMixer(model);
  try {
    if (idle) {
      mixer.clipAction(idle).play();
      mixer.update(Math.min(0.5, idle.duration * 0.5));
    }
    model.updateMatrixWorld(true);
    const positions: number[] = [];
    const indices: number[] = [];
    const v = new THREE.Vector3();
    const full = new THREE.Matrix4();
    for (const mesh of meshes) {
      const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const index = mesh.geometry.index;
      const skinned = (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh
        ? (mesh as unknown as THREE.SkinnedMesh)
        : null;
      full.multiplyMatrices(norm, mesh.matrixWorld);
      // each vertex the index draws, once, in the order it is first drawn
      const baked = new Int32Array(position.count).fill(-1);
      const drawn = index ? index.count : position.count;
      for (let k = 0; k < drawn; k++) {
        const i = index ? index.getX(k) : k;
        if (baked[i] < 0) {
          v.fromBufferAttribute(position, i);
          if (skinned) {
            skinned.applyBoneTransform(i, v);
            v.applyMatrix4(skinned.matrixWorld).applyMatrix4(norm);
          } else {
            v.applyMatrix4(full);
          }
          baked[i] = positions.length / 3;
          positions.push(v.x, v.y, v.z);
        }
        indices.push(baked[i]);
      }
    }
    const head =
      bone && rest
        ? wocStandInHead(neckTop, crown, [rest.elements[12], 0, rest.elements[14]])
        : null;
    if (head && bone && rest) {
      // the ellipsoid rides the head bone: from where the bone rests to where the idle put it
      const at = positions.length / 3;
      full
        .multiplyMatrices(norm, bone.matrixWorld)
        .multiply(rest.invert())
        .multiply(new THREE.Matrix4().makeTranslation(...head.center))
        .multiply(new THREE.Matrix4().makeScale(...head.radii));
      const unit = HEAD.getAttribute('position');
      for (let i = 0; i < unit.count; i++) {
        v.fromBufferAttribute(unit, i).applyMatrix4(full);
        positions.push(v.x, v.y, v.z);
      }
      const unitIndex = HEAD.index;
      if (unitIndex) for (let k = 0; k < unitIndex.count; k++) indices.push(at + unitIndex.getX(k));
    }
    if (indices.length === 0) return null;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    out.setIndex(indices);
    return out;
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(model);
  }
}
