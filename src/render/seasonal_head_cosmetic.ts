// The worn pumpkin head's Three half: one small group of meshes sharing the
// event's geometry and its SHARED glow materials (seasonal_decor_assets.ts,
// seasonal_glow.ts), hung on a character's head bone. Who wears one and what it
// hides is seasonal_head_core.ts; the per-frame flip is CharacterVisual's
// setSeasonalHead, driven from the live look diff (live_look_diff.ts).
//
// The pumpkin is authored in yards for a player of ordinary size, centred on
// itself. Bones carry arbitrary frames and scales from rig to rig, so the fit
// is computed against the bone at attach time: the piece is turned to the
// character's own upright facing, sized to the character (not to the bone), and
// lifted so the pumpkin's middle sits where the skull is.
import * as THREE from 'three';
import { gourdlightAssets } from './seasonal_decor_assets';

/** How far above the head bone's origin the pumpkin's centre sits (yards, for a
 *  player of display scale 1), and how far forward. */
export const SEASONAL_HEAD_LIFT = 0.13;
export const SEASONAL_HEAD_FORWARD = 0.015;
/** The pumpkin's size against the authored one (it is built at head size). */
export const SEASONAL_HEAD_SCALE = 1.0;

/** A fresh head piece, or null while the event's assets are not loaded yet
 *  (the first ask starts the fetch; the caller simply asks again next frame). */
export function buildSeasonalHeadPiece(): THREE.Group | null {
  const assets = gourdlightAssets();
  if (!assets || assets.head.length === 0) return null;
  const group = new THREE.Group();
  group.name = 'seasonal-pumpkin-head';
  for (const part of assets.head) {
    const mesh = new THREE.Mesh(part.geometry, part.material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  return group;
}

const boneQ = new THREE.Quaternion();
const rootQ = new THREE.Quaternion();
const boneS = new THREE.Vector3();
const rootS = new THREE.Vector3();
const boneP = new THREE.Vector3();
const offset = new THREE.Vector3();

/** Fit `piece` (about to be parented to `bone`) upright, character-sized and
 *  centred on the skull. `root` is the character's own world frame (the visual's
 *  outer group: its facing and display scale). */
export function fitSeasonalHead(piece: THREE.Object3D, bone: THREE.Object3D, root: THREE.Object3D) {
  root.updateWorldMatrix(true, false);
  bone.updateWorldMatrix(true, false);
  bone.matrixWorld.decompose(boneP, boneQ, boneS);
  root.matrixWorld.decompose(offset, rootQ, rootS);
  const invBone = boneQ.clone().invert();
  piece.quaternion.copy(invBone).multiply(rootQ);
  const charScale = rootS.y || 1;
  const s = (charScale / (boneS.y || 1)) * SEASONAL_HEAD_SCALE;
  piece.scale.setScalar(s);
  offset
    .set(0, SEASONAL_HEAD_LIFT * charScale, SEASONAL_HEAD_FORWARD * charScale)
    .applyQuaternion(rootQ)
    .applyQuaternion(invBone)
    .divideScalar(boneS.y || 1);
  piece.position.copy(offset);
}
