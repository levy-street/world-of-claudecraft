// Procedural Hellgate prop (content/hellgate.ts): a jagged fel and crimson
// arch around a dark swirl with drifting embers, behind the Soulwell
// build/sync/dispose seam and registered through summoned_objects.ts.

import * as THREE from 'three';
import {
  additiveMaterial,
  addSwirlRings,
  disposeOwnedMaterials,
  emissiveMaterial,
  OWNED_MATERIALS_KEY,
  spinSwirlRings,
  stoneMaterial,
} from './summoned_prop_kit';

export const HELLGATE_VISUAL_SPEC = { height: 3.4, shardCount: 9, emberCount: 10 } as const;

// Deterministic per-entity scatter: no Math.random in a build.
function hash01(entityId: number, salt: number): number {
  let h = (entityId * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function buildHellgate(entityId: number): { group: THREE.Group; height: number } {
  const root = new THREE.Group();
  root.name = `hellgate_${entityId}`;
  const shardMat = stoneMaterial(0x2c1f22, 0.78, 0.1);
  const felMat = emissiveMaterial(0x4fd63a, 0x62ff2a, 2.4, 0.34);
  const bloodMat = emissiveMaterial(0x8a1a1a, 0xff3b2a, 1.8, 0.34);
  const owned: THREE.Material[] = [];

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.18, 1.36, 0.22, 9),
    stoneMaterial(0x1a1212, 0.96, 0.1),
  );
  base.position.y = 0.11;
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);

  // Jagged arch: leaning shards fan out along a half circle, alternating fel
  // and crimson tips.
  const arch = new THREE.Group();
  arch.position.y = 0.22;
  for (let i = 0; i < HELLGATE_VISUAL_SPEC.shardCount; i++) {
    const angle = Math.PI * (1 - i / (HELLGATE_VISUAL_SPEC.shardCount - 1));
    const x = Math.cos(angle) * 1.15;
    const y = Math.sin(angle) * 1.35 + 0.2;
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7 + (i % 3) * 0.18, 4), shardMat);
    shard.position.set(x, y, 0);
    shard.rotation.z = angle - Math.PI / 2;
    shard.castShadow = true;
    arch.add(shard);
    const tip = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.09, 0),
      i % 2 === 0 ? felMat : bloodMat,
    );
    tip.position.set(x * 1.12, y * 1.12 + 0.12, 0);
    arch.add(tip);
  }
  root.add(arch);

  const swirl = new THREE.Group();
  swirl.position.y = 1.55;
  swirl.add(
    new THREE.Mesh(
      new THREE.CircleGeometry(1.0, 24),
      additiveMaterial(0x120a16, 0.9, owned, {
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
      }),
    ),
  );
  addSwirlRings(
    swirl,
    [
      [0.88, 0.55, 0x3fff2c],
      [0.6, 0.62, 0xff4a2a],
      [0.32, 0.8, 0x9dff5a],
    ],
    0.035,
    owned,
  );
  root.add(swirl);

  const emberMaterial = additiveMaterial(0xff6a2a, 0.85, owned);
  const embers = new THREE.Group();
  for (let i = 0; i < HELLGATE_VISUAL_SPEC.emberCount; i++) {
    const ember = new THREE.Mesh(new THREE.TetrahedronGeometry(0.045, 0), emberMaterial);
    const angle = hash01(entityId, i * 2) * Math.PI * 2;
    const radius = 0.4 + hash01(entityId, i * 2 + 1) * 0.9;
    ember.position.set(Math.cos(angle) * radius, 0.4 + hash01(entityId, i * 7) * 2.2, 0.35);
    ember.userData.emberSeed = hash01(entityId, i * 11);
    embers.add(ember);
  }
  root.add(embers);

  const light = new THREE.PointLight(0x5cff33, 4.0, 8, 2);
  light.position.set(0, 1.55, 0.4);
  root.add(light);

  root.userData.hellgateSwirl = swirl;
  root.userData.hellgateEmbers = embers;
  root.userData.hellgateLight = light;
  root.userData[OWNED_MATERIALS_KEY] = owned;
  return { group: root, height: HELLGATE_VISUAL_SPEC.height };
}

export const disposeHellgateVisual = disposeOwnedMaterials;

export function syncHellgateVisual(root: THREE.Object3D, time: number, entityId: number): void {
  const swirl = root.userData.hellgateSwirl as THREE.Object3D | undefined;
  const embers = root.userData.hellgateEmbers as THREE.Object3D | undefined;
  const light = root.userData.hellgateLight as THREE.PointLight | undefined;
  if (swirl) spinSwirlRings(swirl, time * 1.9 + entityId * 0.31, -1);
  if (embers) {
    for (const ember of embers.children) {
      const seed = ember.userData.emberSeed as number;
      ember.position.y = 0.4 + ((time * (0.35 + seed * 0.4) + seed * 3) % 2.6);
      ember.rotation.y = time * 2 + seed;
    }
  }
  if (light) light.intensity = 3.4 + Math.sin(time * 3.1 + entityId) * 0.8;
}
