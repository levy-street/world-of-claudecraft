import type * as THREE from 'three';

export type WarriorPowerAnchor = (id: number, piece: number, out: THREE.Matrix4) => boolean;
const names = ['chest', 'lowerarm.l', 'lowerarm.r', 'lowerleg.l', 'lowerleg.r'] as const;
const cache = new WeakMap<THREE.Object3D, (THREE.Object3D | null)[]>();

/** Native bone units, including the model's measured normalization and the
 * actual Avatar scale exactly once. Root identity invalidates cosmetic swaps. */
export function sampleWarriorPowerBone(
  root: THREE.Object3D,
  piece: number,
  out: THREE.Matrix4,
): boolean {
  let bones = cache.get(root);
  if (!bones) {
    bones = names.map(
      (name) => root.getObjectByName(name.replace('.', '')) ?? root.getObjectByName(name) ?? null,
    );
    cache.set(root, bones);
  }
  const bone = bones[piece];
  if (!bone) return false;
  let attached = false;
  for (let node: THREE.Object3D | null = bone; node; node = node.parent) {
    if (!node.visible) return false;
    if (node === root) {
      attached = true;
      break;
    }
  }
  if (!attached) return false;
  bone.updateWorldMatrix(true, false);
  if (
    !bone.matrixWorld.elements.every(Number.isFinite) ||
    Math.abs(bone.matrixWorld.determinant()) < 1e-12
  )
    return false;
  out.copy(bone.matrixWorld);
  return true;
}
