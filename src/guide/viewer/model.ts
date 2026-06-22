// Builds a display-ready Three.js model for the Guide's interactive viewer from a baked
// GuideModelSpec (mirrored from the renderer's VisualDef manifest by the content
// generator). It reuses the renderer's pure GLB loader (loadGltf) so the Guide loads
// exactly ONE model on demand instead of the renderer's full ~23 MB boot preload, and
// mirrors the renderer's assembleModel logic (accessory allowlist, weapon attachments,
// orientation fixups, subtle tint) so a figure here looks like it does in game.
//
// This file is only ever reached through the lazy viewer chunk (scene.ts dynamically
// imports it), so its three.js + loader cost never lands in the main Guide bundle.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadGltf } from '../../render/assets/loader';
import type { GuideModelSpec } from '../content.generated';

export interface BuiltModel {
  /** Normalized root: centered on x/z, feet at y=0, uniform-scaled to a stable height. */
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  /** Bounding-sphere radius after normalize, for camera framing. */
  radius: number;
  /** Normalized height (world units), for camera aim. */
  height: number;
  dispose(): void;
}

// GLTFLoader sanitizes node names (PropertyBinding strips [].:/ ), so an authored
// "handslot.r" arrives as "handslotr" — try both, exactly as the renderer does.
const findBone = (root: THREE.Object3D, name: string): THREE.Object3D | undefined =>
  root.getObjectByName(name) ?? root.getObjectByName(name.replace(/[[\].:/]/g, ''));

const TARGET_HEIGHT = 2.2; // world units; every model frames to roughly this tall

export async function buildModel(spec: GuideModelSpec, tint: number | null): Promise<BuiltModel> {
  const gltf = await loadGltf(spec.url);
  // SkeletonUtils clone duplicates the hierarchy + skeleton but SHARES geometries and
  // materials with the cached GLTF, so we must clone any material before mutating it.
  const model = cloneSkinned(gltf.scene);
  const ownedMaterials: THREE.Material[] = [];

  // Tag the character's own meshes so a tint hits the body, not attached weapons.
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) o.userData.bodyMesh = true;
  });

  // KayKit characters ship every accessory mesh visible; keep only the kit's allowlist.
  if (spec.show) {
    const keep = new Set(spec.show);
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh && !keep.has(o.name)) {
        mesh.visible = false;
      }
    });
  }

  // Weapons and held props: load each, bind to its hand bone, copy any grip reference.
  for (const att of spec.attach ?? []) {
    const bone = findBone(model, att.bone);
    if (!bone) continue; // manifest/bone mismatch — ship without the prop
    const propGltf = await loadGltf(att.url);
    const prop = cloneSkinned(propGltf.scene);
    if (att.gripRef) {
      const grip = findBone(model, att.gripRef);
      if (grip) {
        prop.position.copy(grip.position);
        prop.quaternion.copy(grip.quaternion);
        prop.scale.copy(grip.scale);
      }
    }
    if (att.position) prop.position.set(att.position[0], att.position[1], att.position[2]);
    if (att.rotationY) prop.rotation.y = att.rotationY;
    bone.add(prop);
  }

  // In-place orientation fixups for weapon/prop nodes baked into a GLB at the wrong angle.
  for (const fix of spec.weaponFix ?? []) {
    const node = findBone(model, fix.node);
    if (!node) continue;
    if (fix.rotX) node.rotateX(fix.rotX);
    if (fix.rotY) node.rotateY(fix.rotY);
    if (fix.rotZ) node.rotateZ(fix.rotZ);
  }

  // Subtle tint toward the entity color (matching the renderer's gentle lerp, not a hard
  // multiply that muddies the hand-painted textures). Clone each source material once.
  if (tint !== null) {
    const strength = spec.tintStrength ?? 0.4;
    const tintColor = new THREE.Color(tint);
    const cloned = new Map<THREE.Material, THREE.Material>();
    const tintOne = (mat: THREE.Material): THREE.Material => {
      let next = cloned.get(mat);
      if (!next) {
        next = mat.clone();
        const std = next as THREE.MeshStandardMaterial;
        if (std.color) std.color.lerp(tintColor, strength);
        cloned.set(mat, next);
        ownedMaterials.push(next);
      }
      return next;
    };
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !o.userData.bodyMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tintOne) : tintOne(mesh.material);
    });
  }

  // Orientation: yaw to face +Z (the camera looks down -Z); lift floating rigs.
  if (spec.yaw) model.rotation.y = spec.yaw;
  if (spec.hover) model.position.y += spec.hover;

  // Normalize into a wrapper: uniform-scale to a stable height, center on x/z, drop the
  // feet to y=0, so a hare and a dragonkin both frame nicely with one camera rule.
  const root = new THREE.Object3D();
  root.add(model);
  root.updateWorldMatrix(true, true);
  const rawBox = new THREE.Box3().setFromObject(root);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const rawHeight = rawSize.y || spec.height || 1;
  model.scale.multiplyScalar(TARGET_HEIGHT / rawHeight);

  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;

  root.updateWorldMatrix(true, true);
  const finalBox = new THREE.Box3().setFromObject(root);
  const sphere = finalBox.getBoundingSphere(new THREE.Sphere());
  const height = finalBox.max.y - finalBox.min.y;

  // Idle animation (or the first clip the rig ships).
  let mixer: THREE.AnimationMixer | null = null;
  const clips = gltf.animations ?? [];
  if (clips.length > 0) {
    mixer = new THREE.AnimationMixer(model);
    const idle = (spec.idle && THREE.AnimationClip.findByName(clips, spec.idle)) || clips[0];
    if (idle) mixer.clipAction(idle).play();
  }

  const dispose = (): void => {
    mixer?.stopAllAction();
    mixer = null;
    // Geometries/materials from the GLTF are a shared, never-disposed cache (loadGltf
    // memoizes the GLTF), so we only dispose the material clones WE created for the tint.
    for (const mat of ownedMaterials) mat.dispose();
    ownedMaterials.length = 0;
    root.clear();
  };

  return { root, mixer, radius: sphere.radius, height, dispose };
}
