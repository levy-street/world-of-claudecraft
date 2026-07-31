// Still-water dressing for the whole world: the Willowfen's lily rafts and
// river reeds instanced onto every declared zone lake EXCEPT the frozen
// Frostveil, the molten Drakelands, and the two realms that already dress
// their own water (the Willowfen itself and the Palmreach). The placement walk
// lives in water_flora_core.ts (pure, Node-tested) and comes back grouped per
// zone; each zone's flora becomes its own child group so the renderer's
// zone-feature distance cull can drop it, where the old one-mesh-per-part
// layout spanned the world and could never be culled. Render-only.
import * as THREE from 'three';
import { hollowWillowSpots } from '../sim/fen_willows';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { type WaterFloraPlacement, waterFloraRegions } from './water_flora_core';

export interface WaterFloraView {
  group: THREE.Group;
  /** per-region children, registered individually for the distance cull */
  cullGroups: THREE.Group[];
  update(time: number): void;
}

const FLORA_URLS = {
  lilies: '/models/props/fen_lilies.glb',
  reeds: '/models/props/fen_reeds.glb',
  willow: '/models/props/willow_tree.glb',
} as const;
type FloraKey = keyof typeof FLORA_URLS;
const floraScenes: Partial<Record<FloraKey, THREE.Group>> = {};
for (const key of Object.keys(FLORA_URLS) as FloraKey[]) {
  registerDeferredPreload(() =>
    loadGltf(FLORA_URLS[key]).then((gltf) => {
      floraScenes[key] = gltf.scene;
    }),
  );
}

export const waterFloraPreloadInternalsForTest = {
  propUrls: Object.values(FLORA_URLS),
};

// One extraction per prop model, shared by every region group: extraction
// CLONES geometry, and per-region extraction would upload a duplicate GPU
// buffer set for each lake-bearing zone.
const partsCache = new Map<FloraKey, { geo: THREE.BufferGeometry; mat: THREE.Material }[]>();

function extractParts(scene: THREE.Group): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  scene.updateMatrixWorld(true);
  const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  scene.traverse((o) => {
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
  return parts;
}

export function buildWaterFlora(seed: number): WaterFloraView {
  const group = new THREE.Group();
  group.name = 'water-flora';
  const cullGroups: THREE.Group[] = [];

  const instanceProp = (parent: THREE.Group, key: FloraKey, spots: WaterFloraPlacement[]): void => {
    const scene = floraScenes[key];
    if (!scene || spots.length === 0) return;
    let parts = partsCache.get(key);
    if (!parts) {
      parts = extractParts(scene);
      partsCache.set(key, parts);
    }
    for (const part of parts) {
      const mesh = new THREE.InstancedMesh(part.geo, part.mat, spots.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
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
      parent.add(mesh);
    }
  };

  const addRegion = (name: string, fill: (regionGroup: THREE.Group) => void): void => {
    const regionGroup = new THREE.Group();
    regionGroup.name = name;
    fill(regionGroup);
    if (regionGroup.children.length === 0) return;
    group.add(regionGroup);
    cullGroups.push(regionGroup);
  };

  for (const region of waterFloraRegions(seed)) {
    addRegion(`water-flora:${region.zoneId}`, (regionGroup) => {
      instanceProp(regionGroup, 'lilies', region.lilies);
      instanceProp(regionGroup, 'reeds', region.reeds);
    });
  }

  // the Veiled Hollow's willows: drawn from the shared sim list so every
  // trunk the renderer shows is a trunk the colliders block
  addRegion('water-flora:hollow-willows', (regionGroup) => {
    instanceProp(
      regionGroup,
      'willow',
      hollowWillowSpots(seed).map((w) => ({ x: w.x, y: w.y, z: w.z, s: w.s, rot: w.rot })),
    );
  });

  return {
    group,
    cullGroups,
    update(): void {
      // rafts and reeds ride the still water; the water shader is the motion
    },
  };
}
