import * as THREE from 'three';

/** Flatten a one-node GLTF scene into an attachment holder.
 *
 * KayKit's generic accessories are deliberately stripped because their hand
 * grips were authored against centered geometry. Variant/pipeline weapons put
 * their grip origin in the root-node transform, which must remain intact. */
export function flattenWeaponScene(src: THREE.Object3D, keepNodeTransform = false): THREE.Object3D {
  if (src.children.length !== 1) return src;
  const holder = new THREE.Group();
  const child = src.children[0];
  if (keepNodeTransform) {
    src.remove(child);
    holder.add(child);
    return holder;
  }
  holder.scale.copy(child.scale);
  child.scale.set(1, 1, 1);
  child.position.set(0, 0, 0);
  child.rotation.set(0, 0, 0);
  src.remove(child);
  holder.add(child);
  return holder;
}

/** Apply the attachment policy selected by variant-grip resolution. */
export function flattenWeaponAttachmentScene(
  src: THREE.Object3D,
  variantGrip: object | null,
): THREE.Object3D {
  return flattenWeaponScene(src, variantGrip !== null);
}
