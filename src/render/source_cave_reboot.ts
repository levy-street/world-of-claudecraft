// Source Cave reboot-button visual. The sim exposes it as a normal ground
// object; this renderer-only builder dresses it with the requested red mushroom
// asset, enlarged into a room-centre button. Gameplay and interaction range stay
// entirely in the sim.

import * as THREE from 'three';
import { propAsset } from './props';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

// Sized against the 2.6u characters: a big red button, not a parade float
// (was 4.5 x 2.4, oversized per user report).
const BUTTON_WIDTH = 3.0;
const BUTTON_HEIGHT = 1.6;

const materialCache = new Map<string, THREE.Material>();

function rebootMaterial(source: THREE.Material): THREE.Material {
  const cached = materialCache.get(source.uuid);
  if (cached) return cached;
  const material = source.clone();
  const cap = source.name.includes('colorRed');
  if (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshLambertMaterial
  ) {
    material.color.setHex(cap ? 0xd31324 : 0x6f1219);
    material.emissive.setHex(cap ? 0x380006 : 0x140002);
    material.emissiveIntensity = cap ? 0.45 : 0.2;
  }
  material.name = `source-cave-reboot:${source.name}`;
  markSharedMaterial(material);
  materialCache.set(source.uuid, material);
  return material;
}

export function buildSourceCaveRebootButton(): { group: THREE.Group; height: number } {
  const asset = propAsset('mushroomRed');
  const group = new THREE.Group();
  for (const part of asset.parts) {
    // propAsset geometries are process-lifetime cache entries shared with static
    // world mushrooms. Tag them so entity-view churn never disposes that cache.
    const mesh = new THREE.Mesh(markSharedGeometry(part.geo), rebootMaterial(part.mat));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.scale.set(
    BUTTON_WIDTH / asset.size.x,
    BUTTON_HEIGHT / asset.size.y,
    BUTTON_WIDTH / asset.size.z,
  );
  // The renderer squashes a pressed (non-lootable) button against this baseline.
  group.userData.baseScaleY = group.scale.y;
  return { group, height: BUTTON_HEIGHT };
}
