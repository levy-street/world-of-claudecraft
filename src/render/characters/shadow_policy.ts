import type { Object3D } from 'three';

type ShadowPolicyNode = Pick<Object3D, 'name' | 'userData'>;

/** Whether an authored character mesh belongs in the runtime shadow-caster set. */
export function characterMeshCastsShadow(node: ShadowPolicyNode): boolean {
  return node.name !== 'class_halo' && node.userData.shadowCaster !== false;
}
