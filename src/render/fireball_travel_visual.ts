import * as THREE from 'three';
import { surfaceMat } from './gfx';

const CORE_GEOMETRY = new THREE.IcosahedronGeometry(0.78, 2);
const SHELL_GEOMETRY = new THREE.IcosahedronGeometry(0.92, 2);
const FLAME_GEOMETRY = new THREE.ConeGeometry(0.34, 1.25, 7);
const EMBER_GEOMETRY = new THREE.IcosahedronGeometry(0.055, 0);

interface FireballMaterials {
  core: THREE.Material;
  shell: THREE.Material;
  flame: THREE.Material;
  ember: THREE.Material;
}

let materials: FireballMaterials | null = null;

function fireballMaterials(): FireballMaterials {
  if (materials) return materials;
  const core = surfaceMat({
    color: 0xffc53d,
    emissive: 0xff4a08,
    emissiveIntensity: 2.4,
    roughness: 0.38,
    flatShading: true,
  });
  const shell = new THREE.MeshBasicMaterial({
    color: 0xff6a12,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const flame = new THREE.MeshBasicMaterial({
    color: 0xff7b18,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const ember = new THREE.MeshBasicMaterial({
    color: 0xffd769,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  materials = { core, shell, flame, ember };
  return materials;
}

const EMBER_COUNT = 12;

/** Persistent render-only presentation for the Mage travel form. */
export class FireballTravelVisual {
  readonly group = new THREE.Group();
  private readonly shell: THREE.Mesh;
  private readonly tail: THREE.Group;
  private readonly embers: THREE.InstancedMesh;
  private readonly emberTransform = new THREE.Object3D();
  private time = 0;

  constructor() {
    this.group.name = 'fireball-travel-form';
    this.group.visible = false;
    this.group.position.y = 1.05;

    const material = fireballMaterials();
    const core = new THREE.Mesh(CORE_GEOMETRY, material.core);
    core.name = 'fireball-travel-core';
    this.group.add(core);

    this.shell = new THREE.Mesh(SHELL_GEOMETRY, material.shell);
    this.shell.name = 'fireball-travel-flame-shell';
    this.shell.renderOrder = 8;
    this.group.add(this.shell);

    this.tail = new THREE.Group();
    this.tail.name = 'fireball-travel-tail';
    this.tail.position.z = -0.56;
    const flames = new THREE.InstancedMesh(FLAME_GEOMETRY, material.flame, 5);
    flames.name = 'fireball-travel-tail-flames';
    const flameTransform = new THREE.Object3D();
    for (let index = 0; index < 5; index++) {
      flameTransform.rotation.x = -Math.PI / 2;
      const angle = (index / 5) * Math.PI * 2;
      const radius = index === 0 ? 0 : 0.3;
      flameTransform.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, -0.42);
      const scale = index === 0 ? 1 : 0.64;
      flameTransform.scale.set(scale, scale, 0.8 + index * 0.04);
      flameTransform.updateMatrix();
      flames.setMatrixAt(index, flameTransform.matrix);
    }
    flames.instanceMatrix.needsUpdate = true;
    this.tail.add(flames);
    this.group.add(this.tail);

    this.embers = new THREE.InstancedMesh(EMBER_GEOMETRY, material.ember, EMBER_COUNT);
    this.embers.name = 'fireball-travel-embers';
    this.group.add(this.embers);
  }

  update(active: boolean, dt: number, motion: number, detailed = true): void {
    this.group.visible = active;
    if (!active) return;
    this.tail.visible = detailed;
    this.embers.visible = detailed;
    this.time += Math.max(0, dt);
    const moving = THREE.MathUtils.clamp(motion, 0, 1);
    const pulse = 1 + Math.sin(this.time * 7.5) * 0.055;
    this.shell.scale.setScalar(pulse);
    this.shell.rotation.y = this.time * 1.35;
    this.shell.rotation.z = Math.sin(this.time * 2.1) * 0.16;
    this.tail.scale.set(1, 1, 0.72 + moving * 1.55);

    if (!detailed) return;
    for (let index = 0; index < EMBER_COUNT; index++) {
      const phase = this.time * (1.65 + (index % 3) * 0.18) + index * 2.399;
      const radius = 0.68 + (index % 4) * 0.11;
      this.emberTransform.position.set(
        Math.cos(phase) * radius,
        Math.sin(phase * 1.37) * 0.62,
        Math.sin(phase) * radius - moving * (0.2 + (index % 5) * 0.1),
      );
      const emberScale = 0.72 + Math.sin(phase * 2.3) * 0.22;
      this.emberTransform.scale.setScalar(emberScale);
      this.emberTransform.updateMatrix();
      this.embers.setMatrixAt(index, this.emberTransform.matrix);
    }
    this.embers.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    // Geometry and materials are shared by all Mage views and live for the renderer lifetime.
  }
}

export function syncFireballTravelVisual(
  visual: FireballTravelVisual | null,
  parent: THREE.Group,
  active: boolean,
  dt: number,
  motion: number,
  detailed = true,
): FireballTravelVisual | null {
  let current = visual;
  if (active && !current) {
    current = new FireballTravelVisual();
    parent.add(current.group);
  }
  current?.update(active, dt, motion, detailed);
  return current;
}
