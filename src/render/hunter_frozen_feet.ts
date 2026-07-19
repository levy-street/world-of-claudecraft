import * as THREE from 'three';
import { surfaceMat } from './gfx';

/** Ice restraint shown only while the authoritative Freezing Trap aura is present. */
export class HunterFrozenFeetVisual {
  readonly group = new THREE.Group();

  constructor(characterHeight: number) {
    this.group.name = 'hunter-frozen-feet';
    this.group.visible = false;
    const scale = Math.max(0.72, Math.min(1.35, characterHeight / 1.8));
    this.group.scale.setScalar(scale);
    const material = surfaceMat({
      color: 0xb5efff,
      emissive: 0x247fae,
      emissiveIntensity: 0.72,
      roughness: 0.16,
      flatShading: true,
    }).clone();
    material.transparent = true;
    material.opacity = 0.88;
    material.depthWrite = false;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.9, 0.22, 10), material);
    base.name = 'hunter-frozen-feet-base';
    base.position.y = 0.12;
    base.scale.z = 0.78;
    base.renderOrder = 2;
    this.group.add(base);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.08, 6, 18), material);
    ring.name = 'hunter-frozen-feet-ring';
    ring.position.y = 0.2;
    ring.rotation.x = Math.PI / 2;
    ring.scale.z = 0.78;
    ring.renderOrder = 2;
    this.group.add(ring);

    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.95, 5), material);
      shard.name = `hunter-frozen-feet-shard-${i}`;
      shard.position.set(Math.sin(angle) * 0.68, 0.56, Math.cos(angle) * 0.52);
      shard.rotation.z = Math.sin(angle) * 0.18;
      shard.rotation.x = Math.cos(angle) * 0.14;
      shard.renderOrder = 2;
      this.group.add(shard);
    }
  }

  update(active: boolean): void {
    this.group.visible = active;
  }

  dispose(): void {
    const materials = new Set<THREE.Material>();
    this.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const material = child.material as THREE.Material;
      if (!materials.has(material)) {
        materials.add(material);
        material.dispose();
      }
    });
  }
}

export function syncHunterFrozenFeet(
  current: HunterFrozenFeetVisual | null,
  parent: THREE.Group,
  characterHeight: number,
  active: boolean,
): HunterFrozenFeetVisual | null {
  let visual = current;
  if (active && !visual) {
    visual = new HunterFrozenFeetVisual(characterHeight);
    parent.add(visual.group);
  }
  visual?.update(active);
  return visual;
}
