import * as THREE from 'three';
import { PALADIN_TEMPLARS_VERDICT_DURATION } from './paladin_templars_verdict_clip';

export interface PaladinTemplarsVerdictFxPlan {
  active: boolean;
  edge: number;
  orbit: number;
  trail: number;
  impact: number;
}

const OFF: PaladinTemplarsVerdictFxPlan = {
  active: false,
  edge: 0,
  orbit: 0,
  trail: 0,
  impact: 0,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smooth(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/** Visual intensities authored against the exact 0.80 second verdict clip. */
export function paladinTemplarsVerdictFxPlan(
  timeSeconds: number | null,
): PaladinTemplarsVerdictFxPlan {
  if (timeSeconds === null || timeSeconds < 0 || timeSeconds >= PALADIN_TEMPLARS_VERDICT_DURATION) {
    return OFF;
  }
  if (timeSeconds < 0.22) {
    const charge = smooth(timeSeconds / 0.22);
    return { active: true, edge: 0.16 + charge * 0.84, orbit: charge, trail: 0, impact: 0 };
  }
  if (timeSeconds < 0.4) {
    const release = clamp01((timeSeconds - 0.22) / 0.18);
    return {
      active: true,
      edge: 1,
      orbit: 1 - release,
      trail: Math.sin(Math.PI * release),
      impact: 0,
    };
  }
  if (timeSeconds < 0.48) {
    const hold = clamp01((timeSeconds - 0.4) / 0.08);
    return { active: true, edge: 1 - hold * 0.12, orbit: 0, trail: 0.3, impact: 1 - hold };
  }
  const recovery = clamp01((timeSeconds - 0.48) / 0.32);
  return { active: true, edge: (1 - recovery) * 0.55, orbit: 0, trail: 0, impact: 0 };
}

interface FxAnchor {
  root: THREE.Group;
  edge: THREE.Mesh;
  trails: readonly THREE.Mesh[];
  orbits: readonly THREE.Mesh[];
  impact: THREE.Mesh;
}

const EDGE_GOLD = 0xffad1f;
const GOLD = 0xffc62e;
const PALE_GOLD = 0xffffc4;

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
 * A weapon-following solar edge. It reuses the held weapon geometry for a
 * precise aura and adds broken orbit rings plus two short swing afterimages.
 */
export class PaladinTemplarsVerdictFx {
  private readonly anchors: FxAnchor[] = [];
  private readonly materials = new Set<THREE.Material>();
  private readonly ownedGeometries = new Set<THREE.BufferGeometry>();
  private elapsed = 0;

  constructor(model: THREE.Object3D) {
    const holders: THREE.Object3D[] = [];
    model.traverse((object) => {
      if (object.userData.swapWeaponHolder) holders.push(object);
    });
    const mainhand = holders.find((object) => object.userData.heldSlot === 0) ?? holders[0];
    if (!mainhand) return;

    const weapons: THREE.Mesh[] = [];
    mainhand.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.weaponMesh && mesh.parent) weapons.push(mesh);
    });
    for (let index = 0; index < weapons.length; index++) {
      const weapon = weapons[index];
      if (!weapon.parent) continue;
      const root = new THREE.Group();
      if (index === 0) root.name = 'paladinTemplarsVerdictFx';
      markEffect(root);
      weapon.parent.add(root);

      const edgeMaterial = additiveMaterial(EDGE_GOLD);
      const edge = new THREE.Mesh(weapon.geometry, edgeMaterial);
      edge.position.copy(weapon.position);
      edge.quaternion.copy(weapon.quaternion);
      edge.scale.copy(weapon.scale).multiplyScalar(1.065);
      edge.renderOrder = 5;
      markEffect(edge);
      root.add(edge);

      const trails = [0.13, 0.25].map((angle, trailIndex) => {
        const material = additiveMaterial(trailIndex === 0 ? GOLD : PALE_GOLD);
        const trail = new THREE.Mesh(weapon.geometry, material);
        trail.position.copy(weapon.position);
        trail.quaternion
          .copy(weapon.quaternion)
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle));
        trail.scale.copy(weapon.scale).multiplyScalar(1.04 + trailIndex * 0.025);
        trail.renderOrder = 4 - trailIndex;
        markEffect(trail);
        root.add(trail);
        this.materials.add(material);
        return trail;
      });

      const orbitGeometry = new THREE.TorusGeometry(0.3, 0.018, 5, 22, Math.PI * 1.42);
      const orbits = [0, 1, 2].map((orbitIndex) => {
        const material = additiveMaterial(orbitIndex === 1 ? PALE_GOLD : GOLD);
        const orbit = new THREE.Mesh(orbitGeometry, material);
        orbit.position.copy(weapon.position);
        orbit.rotation.set(orbitIndex * 1.05, orbitIndex * 0.7, orbitIndex * 2.1);
        orbit.renderOrder = 6;
        markEffect(orbit);
        root.add(orbit);
        this.materials.add(material);
        return orbit;
      });

      const impactGeometry = new THREE.RingGeometry(0.12, 0.25, 28);
      const impactMaterial = additiveMaterial(PALE_GOLD);
      const impact = new THREE.Mesh(impactGeometry, impactMaterial);
      impact.position.copy(weapon.position);
      impact.renderOrder = 7;
      markEffect(impact);
      root.add(impact);

      this.materials.add(edgeMaterial);
      this.materials.add(impactMaterial);
      this.ownedGeometries.add(orbitGeometry);
      this.ownedGeometries.add(impactGeometry);
      this.anchors.push({ root, edge, trails, orbits, impact });
    }
    this.update(null, 0);
  }

  update(timeSeconds: number | null, dt: number): void {
    const plan = paladinTemplarsVerdictFxPlan(timeSeconds);
    this.elapsed += Math.max(0, dt);
    for (const anchor of this.anchors) {
      anchor.edge.visible = plan.edge > 0.001;
      const edgePulse = 0.3 + Math.sin(this.elapsed * 18) * 0.035;
      (anchor.edge.material as THREE.MeshBasicMaterial).opacity = plan.edge * edgePulse;
      for (let index = 0; index < anchor.trails.length; index++) {
        const trail = anchor.trails[index];
        trail.visible = plan.trail > 0.001;
        (trail.material as THREE.MeshBasicMaterial).opacity = plan.trail * (0.18 - index * 0.07);
      }
      for (let index = 0; index < anchor.orbits.length; index++) {
        const orbit = anchor.orbits[index];
        orbit.visible = plan.orbit > 0.001;
        orbit.rotation.z += dt * (2.8 + index * 1.15) * (index % 2 === 0 ? 1 : -1);
        orbit.rotation.y += dt * 1.4;
        orbit.scale.setScalar(0.72 + plan.orbit * 0.45 + Math.sin(this.elapsed * 8 + index) * 0.04);
        (orbit.material as THREE.MeshBasicMaterial).opacity = plan.orbit * (0.44 - index * 0.07);
      }
      anchor.impact.visible = plan.impact > 0.001;
      anchor.impact.scale.setScalar(0.7 + (1 - plan.impact) * 2.4);
      (anchor.impact.material as THREE.MeshBasicMaterial).opacity = plan.impact * 0.82;
    }
  }

  dispose(): void {
    for (const anchor of this.anchors) anchor.root.removeFromParent();
    for (const material of this.materials) material.dispose();
    for (const geometry of this.ownedGeometries) geometry.dispose();
    this.anchors.length = 0;
    this.materials.clear();
    this.ownedGeometries.clear();
  }
}
