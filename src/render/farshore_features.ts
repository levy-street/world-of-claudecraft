// The Farshore's strand dressing: the three beach-palm models instanced
// over the isle's beach apron at the deterministic farshorePalmSpots
// (world.ts, the same list sim/colliders.ts blocks), with fallen-coconut
// clusters dropped around the trunks (the Palmreach idiom throughout).
// Render-only; build once, update() is still air.
import * as THREE from 'three';
import { hash2 } from '../sim/rng';
import {
  farshorePalmSpots,
  type ReachPalm,
  roadDistance,
  terrainHeight,
  WATER_LEVEL,
} from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { bakedPalmVariant } from './jungle_features';

export interface FarshoreFeaturesView {
  group: THREE.Group;
  update(time: number): void;
}

const COCONUT_URL = '/models/props/fallen_coconuts.glb';
let coconutScene: THREE.Group | null = null;
registerPreload(
  loadGltf(COCONUT_URL).then((gltf) => {
    coconutScene = gltf.scene;
  }),
);

export const farshoreFeaturesPreloadInternalsForTest = {
  propUrls: [COCONUT_URL],
};

export function buildFarshoreFeatures(seed: number): FarshoreFeaturesView {
  const group = new THREE.Group();
  group.name = 'farshore-features';

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();

  // --- the palms, instanced per variant from the shared sim list ---
  const byVariant: ReachPalm[][] = [[], [], []];
  for (const sp of farshorePalmSpots(seed)) byVariant[sp.variant]?.push(sp);
  byVariant.forEach((list, variant) => {
    const parts = bakedPalmVariant(variant);
    if (!parts || list.length === 0) return;
    for (const part of parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      list.forEach((sp, i) => {
        q.setFromAxisAngle(up, sp.rot);
        v.set(sp.x, sp.y, sp.z);
        sc.set(sp.scale, sp.scale, sp.scale);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  });

  // --- the fallen coconuts, dropped around the trunks ---
  if (coconutScene) {
    coconutScene.updateMatrixWorld(true);
    const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
    coconutScene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);
      parts.push({ geo, mat: mesh.material as THREE.Material });
    });
    const box = new THREE.Box3();
    for (const p of parts) {
      p.geo.computeBoundingBox();
      box.union(p.geo.boundingBox as THREE.Box3);
    }
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    for (const p of parts) {
      p.geo.translate(-cx, -box.min.y, -cz);
      p.geo.computeBoundingBox();
      p.geo.computeBoundingSphere();
    }
    const spots: { x: number; y: number; z: number; s: number; rot: number }[] = [];
    for (const sp of farshorePalmSpots(seed)) {
      if (hash2(sp.x, sp.z, seed + 5601) > 0.5) continue;
      const n = 1 + Math.floor(hash2(sp.z, sp.x, seed + 5611) * 2);
      for (let k = 0; k < n; k++) {
        const ang = hash2(sp.x + k, sp.z, seed + 5621) * Math.PI * 2;
        const dist = 2.6 + hash2(sp.x, sp.z + k, seed + 5631) * 2.2;
        const x = sp.x + Math.sin(ang) * dist;
        const z = sp.z + Math.cos(ang) * dist;
        const y = terrainHeight(x, z, seed);
        if (y < WATER_LEVEL + 0.4) continue;
        if (roadDistance(x, z) < 3) continue;
        spots.push({
          x,
          z,
          y: y - 0.04,
          s: 3.0 + hash2(k, sp.x, seed + 5641) * 1.75,
          rot: hash2(z, x, seed + 5651) * Math.PI * 2,
        });
      }
    }
    for (const part of parts) {
      if (spots.length === 0) break;
      const mesh = new THREE.InstancedMesh(part.geo, part.mat, spots.length);
      spots.forEach((sp, i) => {
        q.setFromAxisAngle(up, sp.rot);
        v.set(sp.x, sp.y, sp.z);
        sc.set(sp.s, sp.s, sp.s);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }

  return {
    group,
    update(): void {
      // still air: the global wind shader sways the fronds
    },
  };
}
