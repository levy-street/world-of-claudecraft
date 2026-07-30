// The Willowfen's dressing, render-only: the maintainer's generated willow
// trees trailing over the pools, water-lily rafts on the still water, river
// reeds rooted along every shoreline, and clumped mushroom-and-log patches
// out on the fen floor. All the modeled
// pieces are GPU-instanced from five optimized GLBs (the flower-bed
// fidelity recipe; scripts/assets/build_willowfen_props.mjs). Same contract
// as the sibling realm modules: build once, update(time) animates gently.
import * as THREE from 'three';
import { WILLOWFEN_PROPS, WILLOWFEN_ZONE } from '../sim/content/willowfen';
import { fenWillowSpots } from '../sim/fen_willows';
import { hash2 } from '../sim/rng';
import {
  generateDecorationsInBounds,
  roadDistance,
  terrainHeight,
  WATER_LEVEL,
} from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';

export interface FenFeaturesView {
  group: THREE.Group;
  update(time: number): void;
}

const FEN_ZMIN = 180;
const FEN_ZMAX = 700;

// the five Willowfen prop models (built by build_willowfen_props.mjs)
const FEN_PROP_URLS = {
  willow: '/models/props/willow_tree.glb',
  lilies: '/models/props/fen_lilies.glb',
  reeds: '/models/props/fen_reeds.glb',
  mushrooms: '/models/props/fen_mushrooms.glb',
  log: '/models/props/fen_log.glb',
} as const;
type FenPropKey = keyof typeof FEN_PROP_URLS;
const propScenes: Partial<Record<FenPropKey, THREE.Group>> = {};
for (const key of Object.keys(FEN_PROP_URLS) as FenPropKey[]) {
  registerPreload(
    loadGltf(FEN_PROP_URLS[key]).then((gltf) => {
      propScenes[key] = gltf.scene;
    }),
  );
}

export const fenFeaturesPreloadInternalsForTest = {
  propUrls: Object.values(FEN_PROP_URLS),
};

interface Placement {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
  tint?: number;
}

// bake a loaded scene into (geometry, material) parts: world matrices
// applied, the whole model re-based so xz is centered and min-y sits at 0
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

export function buildFenFeatures(seed: number): FenFeaturesView {
  const group = new THREE.Group();
  group.name = 'fen-features';

  const instance = (
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    spots: Placement[],
    tinted = false,
  ) => {
    if (spots.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, material, spots.length);
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
      if (tinted && sp.tint !== undefined) mesh.setColorAt(i, new THREE.Color(sp.tint));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };

  // instance every part of a loaded prop model at the given placements
  const instanceProp = (key: FenPropKey, spots: Placement[]): void => {
    const scene = propScenes[key];
    if (!scene || spots.length === 0) return;
    for (const part of extractParts(scene)) {
      instance(part.geo, part.mat, spots);
    }
  };

  const hub = WILLOWFEN_ZONE.hub;

  // --- placement obstacles: authored props and the terrain's own scattered
  // rocks; nothing modeled may stand on any of them (only trees overlap) ---
  const zp = WILLOWFEN_PROPS;
  const zoneProps = {
    campfires: zp.campfires ?? [],
    buildings: zp.buildings ?? [],
    decorProps: (zp.decorProps ?? []).map((d) => ({ x: d.x, z: d.z, r: d.r ?? 3 })),
    stalls: zp.stalls ?? [],
    wells: zp.wells ?? [],
    crates: zp.crates ?? [],
    fences: zp.fences ?? [],
  };
  const fenRocks = generateDecorationsInBounds(seed, {
    minX: -540,
    maxX: -180,
    minZ: FEN_ZMIN,
    maxZ: FEN_ZMAX,
  }).filter((d) => d.kind === 'rock');
  const segDist = (x: number, z: number, f: { x1: number; z1: number; x2: number; z2: number }) => {
    const dx = f.x2 - f.x1;
    const dz = f.z2 - f.z1;
    const t = Math.max(
      0,
      Math.min(1, ((x - f.x1) * dx + (z - f.z1) * dz) / (dx * dx + dz * dz || 1)),
    );
    return Math.hypot(x - (f.x1 + dx * t), z - (f.z1 + dz * t));
  };
  const clearOfProps = (x: number, z: number, pad: number): boolean => {
    for (const f of zoneProps.campfires) if (Math.hypot(x - f[0], z - f[1]) < 8 + pad) return false;
    for (const b of zoneProps.buildings) if (Math.hypot(x - b.x, z - b.z) < 8 + pad) return false;
    for (const d of zoneProps.decorProps)
      if (Math.hypot(x - d.x, z - d.z) < d.r + 2 + pad) return false;
    for (const st of zoneProps.stalls) if (Math.hypot(x - st.x, z - st.z) < 4 + pad) return false;
    for (const w of zoneProps.wells) if (Math.hypot(x - w.x, z - w.z) < 3 + pad) return false;
    for (const cr of zoneProps.crates)
      if (Math.hypot(x - cr[0], z - cr[1]) < 2.5 + pad) return false;
    for (const f of zoneProps.fences) if (segDist(x, z, f) < 2.2 + pad) return false;
    return true;
  };
  const clearOfRocks = (x: number, z: number, pad: number): boolean => {
    for (const r of fenRocks) if (Math.hypot(x - r.x, z - r.z) < 2.2 * r.scale + pad) return false;
    return true;
  };

  // --- the willows: instanced at the shared sim placements (fenWillowSpots
  // in sim/fen_willows.ts), so every trunk the renderer draws is exactly a
  // trunk the sim's colliders block ---
  instanceProp(
    'willow',
    fenWillowSpots(seed).map((w) => ({ x: w.x, y: w.y, z: w.z, s: w.s, rot: w.rot })),
  );

  // --- the water lilies: modeled lily rafts drifting on every pool ---
  {
    const spots: Placement[] = [];
    for (const lake of WILLOWFEN_ZONE.lakes) {
      const count = 2 + Math.floor(hash2(lake.z, lake.x, seed + 2201) * 3);
      for (let k = 0; k < count; k++) {
        const ang = hash2(k * 3, lake.x, seed + 2211) * Math.PI * 2;
        const dist = Math.sqrt(hash2(lake.z, k * 5, seed + 2221)) * lake.radius * 0.7;
        const x = lake.x + Math.sin(ang) * dist;
        const z = lake.z + Math.cos(ang) * dist;
        if (terrainHeight(x, z, seed) > WATER_LEVEL - 0.7) continue;
        if (roadDistance(x, z) < 4) continue;
        spots.push({
          x,
          z,
          y: WATER_LEVEL + 0.03,
          s: 3.5 + hash2(lake.x, k + 11, seed + 2241) * 2,
          rot: hash2(k, lake.x + 7, seed + 2231) * Math.PI * 2,
        });
      }
    }
    instanceProp('lilies', spots);
  }

  // --- the river reeds: rooted in the shallows along every shoreline ---
  {
    const spots: Placement[] = [];
    for (const lake of WILLOWFEN_ZONE.lakes) {
      const count = 4 + Math.floor(hash2(lake.x + 3, lake.z, seed + 2401) * 3);
      for (let k = 0; k < count; k++) {
        const ang = hash2(k * 7, lake.z, seed + 2411) * Math.PI * 2;
        // walk outward until the shallows band at the waterline is found
        let placed = false;
        for (let dist = lake.radius * 0.9; dist < lake.radius * 1.7; dist += 0.6) {
          const x = lake.x + Math.sin(ang) * dist;
          const z = lake.z + Math.cos(ang) * dist;
          const y = terrainHeight(x, z, seed);
          if (y < WATER_LEVEL - 0.45 || y > WATER_LEVEL + 0.25) continue;
          if (roadDistance(x, z) < 4) break;
          spots.push({
            x,
            z,
            y: y - 0.1,
            s: 2.6 + hash2(lake.z, k + 5, seed + 2421) * 1.2,
            rot: hash2(k, lake.x + 13, seed + 2431) * Math.PI * 2,
          });
          placed = true;
          break;
        }
        if (!placed) continue;
      }
    }
    instanceProp('reeds', spots);
  }

  // --- mushroom-and-log patches: clumped clusters out on the fen floor ---
  {
    const mushroomSpots: Placement[] = [];
    const logSpots: Placement[] = [];
    for (let gx = -520; gx <= -200; gx += 14) {
      for (let gz = FEN_ZMIN + 30; gz <= FEN_ZMAX - 60; gz += 14) {
        // a coarse patch gate: most cells stay empty, the rest clump
        if (hash2(gx, gz, seed + 2501) > 0.16) continue;
        const n = 2 + Math.floor(hash2(gz, gx, seed + 2511) * 2);
        for (let k = 0; k <= n; k++) {
          const x = gx + (hash2(gx + k, gz, seed + 2521) - 0.5) * 9;
          const z = gz + (hash2(gx, gz + k, seed + 2531) - 0.5) * 9;
          const y = terrainHeight(x, z, seed);
          if (y < WATER_LEVEL + 0.8) continue;
          if (roadDistance(x, z) < 4.5) continue;
          if (Math.hypot(x - hub.x, z - hub.z) < 22) continue;
          if (!clearOfProps(x, z, 0)) continue;
          if (!clearOfRocks(x, z, 0.6)) continue;
          // clusters never stand on one another: each keeps its own ground
          if (mushroomSpots.some((sp) => Math.hypot(sp.x - x, sp.z - z) < 3.2)) continue;
          if (logSpots.some((sp) => Math.hypot(sp.x - x, sp.z - z) < 3.2)) continue;
          const spot: Placement = {
            x,
            z,
            y: y - 0.08,
            s: 2.4 + hash2(x, z, seed + 2541) * 1.4,
            rot: hash2(z, x, seed + 2551) * Math.PI * 2,
          };
          // one log anchors some patches; the rest are mushroom clusters
          if (k === 0 && hash2(gx, gz, seed + 2561) < 0.45) logSpots.push({ ...spot, s: 3 });
          else mushroomSpots.push(spot);
        }
      }
    }
    instanceProp('mushrooms', mushroomSpots);
    instanceProp('log', logSpots);
  }

  return {
    group,
    update(): void {
      // everything modeled sits still; the fen's motion is the water's
    },
  };
}
