import * as THREE from 'three';
import {
  PALADIN_BASTION_SWEEP_DURATION,
  PALADIN_BASTION_SWEEP_IMPACT_TIME,
} from './paladin_bastion_sweep_clip';

export const PALADIN_BASTION_SWEEP_PROJECTION_SCALE = 2;

export interface PaladinBastionSweepProjectionPlan {
  active: boolean;
  opacity: number;
  trail: number;
  rune: number;
  scale: number;
}

const OFF: PaladinBastionSweepProjectionPlan = {
  active: false,
  opacity: 0,
  trail: 0,
  rune: 0,
  scale: 0,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smooth(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export function paladinBastionSweepProjectionPlan(
  timeSeconds: number | null,
): PaladinBastionSweepProjectionPlan {
  if (timeSeconds === null || timeSeconds < 0 || timeSeconds >= PALADIN_BASTION_SWEEP_DURATION) {
    return OFF;
  }
  if (timeSeconds < 0.16) {
    const windup = smooth(timeSeconds / 0.16);
    return {
      active: true,
      opacity: windup * 0.52,
      trail: 0,
      rune: windup * 0.45,
      scale: 0.72 + windup * 0.28,
    };
  }
  if (timeSeconds < PALADIN_BASTION_SWEEP_IMPACT_TIME) {
    const sweep = clamp01((timeSeconds - 0.16) / (PALADIN_BASTION_SWEEP_IMPACT_TIME - 0.16));
    return {
      active: true,
      opacity: 0.52 + sweep * 0.42,
      trail: Math.sin(sweep * Math.PI * 0.5),
      rune: 0.45 + sweep * 0.55,
      scale: 1 + sweep * 0.08,
    };
  }
  if (timeSeconds < 0.4) {
    const hold = clamp01((timeSeconds - PALADIN_BASTION_SWEEP_IMPACT_TIME) / 0.08);
    return {
      active: true,
      opacity: 0.94 - hold * 0.18,
      trail: 1 - hold * 0.45,
      rune: 1 - hold * 0.35,
      scale: 1.08 + hold * 0.12,
    };
  }
  const recovery = clamp01((timeSeconds - 0.4) / (PALADIN_BASTION_SWEEP_DURATION - 0.4));
  return {
    active: true,
    opacity: (1 - recovery) * 0.5,
    trail: (1 - recovery) * 0.35,
    rune: (1 - recovery) * 0.42,
    scale: 1.2 + recovery * 0.18,
  };
}

function additiveMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function markEffect(object: THREE.Object3D): void {
  object.userData.weaponVfxMesh = true;
  const mesh = object as THREE.Mesh;
  if (mesh.isMesh) mesh.castShadow = false;
}

/**
 * A light-only shield projection parented to the shield hand. The physical
 * offhand hierarchy is never detached, hidden, cloned, or replaced.
 */
export class PaladinBastionSweepFx {
  private readonly root = new THREE.Group();
  private readonly discMaterial = additiveMaterial(0xffffe2);
  private readonly borderMaterial = additiveMaterial(0xffc33f);
  private readonly runeMaterial = additiveMaterial(0xfffff2);
  private readonly trailMaterials = [additiveMaterial(0xffdb68), additiveMaterial(0xffb72e)];
  private readonly ownedGeometries = new Set<THREE.BufferGeometry>();
  private readonly disc: THREE.Mesh;
  private readonly border: THREE.Mesh;
  private readonly rune: THREE.Group;
  private readonly trails: THREE.Mesh[] = [];
  private elapsed = 0;

  constructor(model: THREE.Object3D) {
    this.root.name = 'paladinBastionSweepFx';
    markEffect(this.root);

    const discGeometry = new THREE.CircleGeometry(0.52, 24);
    this.disc = new THREE.Mesh(discGeometry, this.discMaterial);
    markEffect(this.disc);
    this.root.add(this.disc);

    const borderGeometry = new THREE.RingGeometry(0.46, 0.58, 24);
    this.border = new THREE.Mesh(borderGeometry, this.borderMaterial);
    this.border.position.z = 0.012;
    markEffect(this.border);
    this.root.add(this.border);

    this.rune = new THREE.Group();
    markEffect(this.rune);
    const runeRingGeometry = new THREE.RingGeometry(0.14, 0.19, 8);
    const runeRing = new THREE.Mesh(runeRingGeometry, this.runeMaterial);
    markEffect(runeRing);
    this.rune.add(runeRing);
    const spokeGeometry = new THREE.PlaneGeometry(0.055, 0.42);
    for (let index = 0; index < 4; index++) {
      const spoke = new THREE.Mesh(spokeGeometry, this.runeMaterial);
      spoke.rotation.z = (index * Math.PI) / 4;
      spoke.position.z = 0.018;
      markEffect(spoke);
      this.rune.add(spoke);
    }
    this.root.add(this.rune);

    const trailGeometry = new THREE.CircleGeometry(0.5, 20, -Math.PI * 0.4, Math.PI * 1.3);
    for (let index = 0; index < this.trailMaterials.length; index++) {
      const trail = new THREE.Mesh(trailGeometry, this.trailMaterials[index]);
      trail.position.set(0.08 + index * 0.08, 0, -0.018 * (index + 1));
      trail.scale.set(1.3 + index * 0.3, 0.88 - index * 0.08, 1);
      trail.rotation.z = 0.12 + index * 0.1;
      markEffect(trail);
      this.root.add(trail);
      this.trails.push(trail);
    }

    this.root.position.set(-0.2, 0.05, 0.22);
    this.root.rotation.set(0, Math.PI * 0.5, Math.PI * 0.08);
    this.root.scale.setScalar(PALADIN_BASTION_SWEEP_PROJECTION_SCALE);
    this.ownedGeometries.add(discGeometry);
    this.ownedGeometries.add(borderGeometry);
    this.ownedGeometries.add(runeRingGeometry);
    this.ownedGeometries.add(spokeGeometry);
    this.ownedGeometries.add(trailGeometry);
    this.bind(model);
    this.update(null, 0);
  }

  private bind(model: THREE.Object3D): void {
    const hand = model.getObjectByName('handslotl') ?? model.getObjectByName('handslot.l');
    hand?.add(this.root);
  }

  update(timeSeconds: number | null, dt: number): void {
    const plan = paladinBastionSweepProjectionPlan(timeSeconds);
    this.elapsed += Math.max(0, dt);
    this.root.visible = plan.active;
    if (!plan.active) return;
    const scale =
      PALADIN_BASTION_SWEEP_PROJECTION_SCALE *
      plan.scale *
      (1 + Math.sin(this.elapsed * 24) * 0.018);
    this.root.scale.setScalar(scale);
    this.discMaterial.opacity = plan.opacity * 0.34;
    this.borderMaterial.opacity = plan.opacity * 0.88;
    this.runeMaterial.opacity = plan.rune * 0.82;
    this.rune.rotation.z += dt * 2.6;
    for (let index = 0; index < this.trails.length; index++) {
      const trail = this.trails[index];
      trail.visible = plan.trail > 0.001;
      this.trailMaterials[index].opacity = plan.trail * (0.22 - index * 0.07);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.discMaterial.dispose();
    this.borderMaterial.dispose();
    this.runeMaterial.dispose();
    for (const material of this.trailMaterials) material.dispose();
    for (const geometry of this.ownedGeometries) geometry.dispose();
    this.ownedGeometries.clear();
  }
}
