import type * as THREE from 'three';

/** Storm Bolt borrows the throwing hand; Jawcrack retains both weapons. */
export class WarriorActionProps {
  private readonly hidden = new Map<THREE.Object3D, boolean>();
  private current = '';
  constructor(private readonly model: THREE.Object3D) {}
  action(name: string): void {
    this.restore();
    this.current = name;
    if (name !== 'Signature_storm_bolt' && name !== 'Warrior_Storm_Bolt') return;
    this.model.traverse((node) => {
      if (!node.userData.heldPropHolder || node.userData.heldSlot !== 0) return;
      this.hidden.set(node, node.visible);
      node.visible = false;
    });
  }
  refresh(): void {
    this.action(this.current);
  }
  restore(): void {
    for (const [node, visible] of this.hidden) node.visible = visible;
    this.hidden.clear();
  }
}
