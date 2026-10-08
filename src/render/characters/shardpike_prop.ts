import * as THREE from 'three';

/** A short-lived display copy sharing the already-drawn weapon's geometry and
 * materials. No inventory mutation, new texture, material, light or shader variant.
 * Restoration writes only the old holder, never reattaches a replaced weapon. */
export class ShardpikeProp {
  readonly root = new THREE.Group();
  private readonly shown: boolean;
  private readonly axis = new THREE.Vector3(0, 1, 0);
  private readonly direction = new THREE.Vector3();
  private readonly initialRotation = new THREE.Quaternion();
  private readonly turn = new THREE.Quaternion();
  private readonly tip = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly materials = new Set<THREE.Material>();
  private readonly owner: THREE.Object3D;
  private retired = false;
  private readonly onMaterialDisposed = () => this.dispose();
  constructor(private readonly holder: THREE.Object3D) {
    let owner = holder;
    while (owner.parent) owner = owner.parent;
    this.owner = owner;
    this.shown = holder.visible;
    holder.updateWorldMatrix(true, true);
    holder.matrixWorld.decompose(this.root.position, this.root.quaternion, this.root.scale);
    this.initialRotation.copy(this.root.quaternion);
    const inverse = holder.matrixWorld.clone().invert();
    const bounds = new THREE.Box3();
    holder.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.userData.weaponMesh || mesh.userData.weaponVfxMesh) return;
      const copy = new THREE.Mesh(mesh.geometry, mesh.material);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        this.materials.add(material);
        material.addEventListener('dispose', this.onMaterialDisposed);
      }
      copy.matrix.copy(inverse).multiply(mesh.matrixWorld);
      copy.matrix.decompose(copy.position, copy.quaternion, copy.scale);
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox)
        bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(copy.matrix));
      copy.castShadow = false;
      copy.receiveShadow = mesh.receiveShadow;
      this.root.add(copy);
    });
    if (!bounds.isEmpty()) this.tip.set(0, bounds.max.y, 0);
    this.axis.applyQuaternion(this.initialRotation).normalize();
    holder.visible = false;
  }
  isUsable(): boolean {
    if (this.retired) return false;
    let owner = this.holder;
    while (owner.parent) owner = owner.parent;
    return owner === this.owner;
  }
  sampleTip(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return out.copy(this.tip).applyMatrix4(this.root.matrixWorld);
  }
  /** Drive the point, not the grip, so the shaft cannot pass through the eye. */
  moveTip(at: THREE.Vector3, target: THREE.Vector3): void {
    this.root.position.copy(at);
    this.aim(target);
    this.offset.copy(this.tip).multiply(this.root.scale).applyQuaternion(this.root.quaternion);
    this.root.position.sub(this.offset);
  }
  aim(target: THREE.Vector3): void {
    this.direction.subVectors(target, this.root.position);
    if (this.direction.lengthSq() < 1e-8) return;
    this.turn.setFromUnitVectors(this.axis, this.direction.normalize());
    this.root.quaternion.copy(this.turn).multiply(this.initialRotation);
  }
  dispose(): void {
    if (this.retired) return;
    this.retired = true;
    for (const material of this.materials)
      material.removeEventListener('dispose', this.onMaterialDisposed);
    this.materials.clear();
    this.holder.visible = this.shown;
    this.root.removeFromParent();
    this.root.clear(); // Geometry and materials belong to the character, never dispose them.
  }
}

export function shardpikeProp(model: THREE.Object3D): ShardpikeProp | null {
  let holder: THREE.Object3D | null = null;
  model.traverse((node) => {
    if (node.userData.heldPropHolder && node.userData.heldSlot === 0 && node.visible) holder = node;
  });
  return holder ? new ShardpikeProp(holder) : null;
}
