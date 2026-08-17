// Procedural Soulwell prop. This is deliberately isolated behind the same
// build/sync seam a future generated GLB can implement without touching sim
// rules, interaction, or wire state.

import * as THREE from 'three';
import { SOULWELL_FOOTPRINT_RADIUS } from '../sim/soulwell';
import { GFX, surfaceMat } from './gfx';

export const SOULWELL_VISUAL_SPEC = {
  height: 2.45,
  footprintRadius: SOULWELL_FOOTPRINT_RADIUS,
  pillarCount: 3,
  stoneCount: 3,
} as const;

function stoneMaterial(color: number, roughness = 0.88): THREE.Material {
  return surfaceMat({
    color,
    roughness,
    metalness: 0.08,
    flatShading: !GFX.standardMaterials,
  });
}

function emissiveMaterial(color: number, emissive: number, intensity: number): THREE.Material {
  return surfaceMat({
    color,
    emissive,
    emissiveIntensity: intensity,
    roughness: 0.32,
    metalness: 0.02,
    flatShading: !GFX.standardMaterials,
  });
}

export function buildSoulwell(entityId: number): {
  group: THREE.Group;
  height: number;
} {
  const root = new THREE.Group();
  root.name = `soulwell_${entityId}`;

  // baseMat/stoneMat/edgeMat/runeMat/soulMat all come from surfaceMat, a global
  // dedupe cache (see gfx.ts) that returns the SAME instance for equal opts.
  // They are shared across every prop that asks for that color/roughness
  // combination, so they must never be disposed here: only the per-instance
  // MeshBasicMaterials built below (basinMaterial, the energy ring materials)
  // belong to this one soulwell.
  const baseMat = stoneMaterial(0x171624, 0.96);
  const stoneMat = stoneMaterial(0x29263a);
  const edgeMat = stoneMaterial(0x443d59, 0.76);
  const runeMat = emissiveMaterial(0x62d72d, 0x47ff20, 2.1);
  const soulMat = emissiveMaterial(0x6b2a91, 0xb34cff, 2.5);
  const ownedMaterials: THREE.Material[] = [];

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.32, 1.45, 0.24, 12), baseMat);
  base.position.y = 0.12;
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);

  const lowerRing = new THREE.Mesh(new THREE.TorusGeometry(1.04, 0.19, 6, 16), stoneMat);
  lowerRing.rotation.x = Math.PI / 2;
  lowerRing.position.y = 0.43;
  lowerRing.castShadow = true;
  lowerRing.receiveShadow = true;
  root.add(lowerRing);

  // Twelve chunky rim blocks keep the silhouette in the KayKit vocabulary.
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.3, 0.34), edgeMat);
    block.position.set(Math.sin(angle) * 1.02, 0.58, Math.cos(angle) * 1.02);
    block.rotation.y = angle;
    block.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.035;
    block.castShadow = true;
    block.receiveShadow = true;
    root.add(block);
  }

  const basinMaterial = new THREE.MeshBasicMaterial({
    color: 0x55ff31,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  ownedMaterials.push(basinMaterial);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.83, 0.88, 0.08, 20), basinMaterial);
  basin.position.y = 0.61;
  root.add(basin);

  const energy = new THREE.Group();
  energy.userData.soulwellEnergy = true;
  energy.position.y = 0.65;
  for (const [radius, opacity] of [
    [0.69, 0.25],
    [0.47, 0.38],
    [0.25, 0.56],
  ] as const) {
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: radius > 0.4 ? 0x68ff3d : 0xc65cff,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    ownedMaterials.push(ringMaterial);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035, 6, 24), ringMaterial);
    ring.rotation.x = Math.PI / 2;
    energy.add(ring);
  }
  root.add(energy);

  for (let i = 0; i < SOULWELL_VISUAL_SPEC.pillarCount; i++) {
    const angle = (i / SOULWELL_VISUAL_SPEC.pillarCount) * Math.PI * 2;
    const pylon = new THREE.Group();
    pylon.position.set(Math.sin(angle) * 1.14, 0.3, Math.cos(angle) * 1.14);
    pylon.rotation.y = angle;

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.3, 1.42, 5), stoneMat);
    shaft.position.y = 0.72;
    shaft.rotation.z = -0.08;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    pylon.add(shaft);

    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.72, 5), edgeMat);
    horn.position.set(0, 1.66, -0.08);
    horn.rotation.x = -0.23;
    horn.castShadow = true;
    pylon.add(horn);

    const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), runeMat);
    rune.position.set(0, 0.78, -0.2);
    pylon.add(rune);
    root.add(pylon);
  }

  const stones = new THREE.Group();
  stones.userData.soulwellStones = true;
  for (let i = 0; i < SOULWELL_VISUAL_SPEC.stoneCount; i++) {
    const angle = (i / SOULWELL_VISUAL_SPEC.stoneCount) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), soulMat);
    stone.position.set(Math.sin(angle) * 0.57, 1.38 + (i % 2) * 0.08, Math.cos(angle) * 0.57);
    stone.rotation.set(0.25 + i * 0.2, angle, -0.18);
    stones.add(stone);
  }
  root.add(stones);

  const light = new THREE.PointLight(0x65ff35, 4.2, 8, 2);
  light.position.set(0, 1.05, 0);
  light.userData.soulwellLight = true;
  root.add(light);

  root.userData.soulwellEnergy = energy;
  root.userData.soulwellStones = stones;
  root.userData.soulwellLight = light;
  root.userData.soulwellOwnedMaterials = ownedMaterials;
  return { group: root, height: SOULWELL_VISUAL_SPEC.height };
}

export function disposeSoulwellVisual(root: THREE.Object3D): void {
  const materials = root.userData.soulwellOwnedMaterials as THREE.Material[] | undefined;
  if (!materials) return;
  for (const material of new Set(materials)) material.dispose();
  delete root.userData.soulwellOwnedMaterials;
}

export function syncSoulwellVisual(root: THREE.Object3D, time: number, entityId: number): void {
  const energy = root.userData.soulwellEnergy as THREE.Object3D | undefined;
  const stones = root.userData.soulwellStones as THREE.Object3D | undefined;
  const light = root.userData.soulwellLight as THREE.PointLight | undefined;
  if (energy) {
    energy.rotation.y = time * 0.72 + entityId * 0.17;
    energy.position.y = 0.65 + Math.sin(time * 2.1 + entityId) * 0.035;
  }
  if (stones) {
    stones.rotation.y = -time * 0.52 + entityId * 0.11;
    stones.position.y = Math.sin(time * 1.7 + entityId * 0.4) * 0.07;
    for (let i = 0; i < stones.children.length; i++) {
      stones.children[i].rotation.y = time * (0.8 + i * 0.13);
    }
  }
  if (light) light.intensity = 3.7 + Math.sin(time * 2.4 + entityId) * 0.65;
}
