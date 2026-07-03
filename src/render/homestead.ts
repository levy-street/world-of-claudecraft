// The Homestead Glens: the visual system for the player-housing band. The
// renderer owns a HomesteadView and calls update(camX, camZ) each frame; slots
// build lazily as the camera approaches (a visitor only ever sees their own
// glen) and cull by distance. Ground height comes from the SAME
// sim/world.terrainHeight the collider uses (hard invariant), so what you see
// is what you stand on; the cottage/well/fence/garden are the CC0 village +
// foliage GLBs every town already ships, cloned per plot from the shared
// blueprint in sim/content/housing.ts.

import * as THREE from 'three';
import {
  HOMESTEAD_CAMPFIRE,
  HOMESTEAD_FENCE,
  HOMESTEAD_HOUSE,
  HOMESTEAD_SHRUBS,
  HOMESTEAD_TREES,
  HOMESTEAD_WELL,
} from '../sim/content/housing';
import { HOMESTEAD_SLOT_COUNT, homesteadOrigin } from '../sim/data';
import { terrainHeight } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX, surfaceMat } from './gfx';

const HOMESTEAD_MODEL_URLS = {
  house: '/models/props/house_2.glb',
  well: '/models/props/well.glb',
  fence: '/models/props/fence.glb',
  bonfire: '/models/props/bonfire.glb',
  oak: 'models/foliage/oak_1.glb',
  oak2: 'models/foliage/oak_2.glb',
  bush: 'models/foliage/bush.glb',
  bushFlowers: 'models/foliage/bush_flowers.glb',
} as const;

type HomesteadModelKey = keyof typeof HOMESTEAD_MODEL_URLS;

// kick off fetches at import; buildHomestead assumes the cache is populated
const loadedModels = new Map<HomesteadModelKey, THREE.Object3D>();
for (const [key, url] of Object.entries(HOMESTEAD_MODEL_URLS) as [HomesteadModelKey, string][]) {
  registerPreload(
    loadGltf(url).then((gltf) => {
      loadedModels.set(key, gltf.scene);
    }),
  );
}

const GROUND_SIZE_X = 200;
const GROUND_SIZE_Z = 240;
const GROUND_SEGMENTS = 72;
const BUILD_RANGE = 320; // build a slot's visuals when the camera gets this close
const VIEW_RANGE = 420; // and hide them again past this

// Clone a cached model, ground its base at y=0, and scale its footprint to
// roughly targetWidth across x (uniform scale keeps proportions).
function cloneScaled(key: HomesteadModelKey, targetWidth: number): THREE.Object3D | null {
  const source = loadedModels.get(key);
  if (!source) return null;
  const clone = source.clone(true);
  const box = new THREE.Box3().setFromObject(clone);
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = size.x > 1e-3 ? targetWidth / size.x : 1;
  clone.scale.setScalar(scale);
  clone.position.y = -box.min.y * scale;
  return clone;
}

function groundY(seed: number, x: number, z: number): number {
  return terrainHeight(x, z, seed);
}

function buildFenceRing(seed: number, originX: number, originZ: number, group: THREE.Group): void {
  const segmentSource = loadedModels.get('fence');
  if (!segmentSource) return;
  const probe = cloneScaled('fence', 3.4);
  if (!probe) return;
  const segLen = 3.4;
  const { minX, maxX, minZ, maxZ, gateHalfWidth } = HOMESTEAD_FENCE;
  const runs: { x1: number; z1: number; x2: number; z2: number }[] = [
    // south run splits around the gate
    { x1: minX, z1: minZ, x2: -gateHalfWidth, z2: minZ },
    { x1: gateHalfWidth, z1: minZ, x2: maxX, z2: minZ },
    { x1: minX, z1: maxZ, x2: maxX, z2: maxZ },
    { x1: minX, z1: minZ, x2: minX, z2: maxZ },
    { x1: maxX, z1: minZ, x2: maxX, z2: maxZ },
  ];
  for (const run of runs) {
    const dx = run.x2 - run.x1;
    const dz = run.z2 - run.z1;
    const len = Math.hypot(dx, dz);
    const count = Math.max(1, Math.round(len / segLen));
    const yaw = Math.atan2(dx, dz) + Math.PI / 2;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const lx = run.x1 + dx * t;
      const lz = run.z1 + dz * t;
      const seg = cloneScaled('fence', segLen);
      if (!seg) return;
      seg.rotation.y = yaw;
      const wx = originX + lx;
      const wz = originZ + lz;
      seg.position.set(lx, groundY(seed, wx, wz), lz);
      group.add(seg);
    }
  }
}

function buildSlot(seed: number, slot: number): THREE.Group {
  const origin = homesteadOrigin(slot);
  const group = new THREE.Group();
  group.position.set(origin.x, 0, origin.z);

  // Ground patch (plot-local: the plane is centred on the origin).
  const geo = new THREE.PlaneGeometry(
    GROUND_SIZE_X,
    GROUND_SIZE_Z,
    GROUND_SEGMENTS,
    GROUND_SEGMENTS,
  );
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const meadow = new THREE.Color(0x5d8a44);
  const meadowDry = new THREE.Color(0x74924b);
  const path = new THREE.Color(0x8a6f4d);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    pos.setY(i, terrainHeight(origin.x + lx, origin.z + lz, seed));
    const onPath = Math.abs(lx) < 1.7 && lz > -24 && lz < 3.5;
    if (onPath) c.copy(path);
    else {
      const t = Math.abs(
        (Math.sin((origin.x + lx) * 12.9898 + (origin.z + lz) * 78.233) * 43758.5453) % 1,
      );
      c.copy(meadow).lerp(meadowDry, t * 0.6);
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(
    geo,
    surfaceMat({
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0,
      flatShading: !GFX.standardMaterials,
      vertexColors: true,
    }),
  );
  // Nudge the skin a whisker above the analytic heightfield so it never
  // z-fights the water plane or the props' ground contact.
  ground.position.y = 0.02;
  group.add(ground);

  // The cottage, facing the gate.
  const house = cloneScaled('house', HOMESTEAD_HOUSE.w);
  if (house) {
    house.rotation.y = HOMESTEAD_HOUSE.rot;
    const y = groundY(seed, origin.x + HOMESTEAD_HOUSE.x, origin.z + HOMESTEAD_HOUSE.z);
    house.position.x = HOMESTEAD_HOUSE.x;
    house.position.z = HOMESTEAD_HOUSE.z;
    house.position.y += y;
    group.add(house);
  }

  const well = cloneScaled('well', HOMESTEAD_WELL.radius * 2.2);
  if (well) {
    const y = groundY(seed, origin.x + HOMESTEAD_WELL.x, origin.z + HOMESTEAD_WELL.z);
    well.position.x = HOMESTEAD_WELL.x;
    well.position.z = HOMESTEAD_WELL.z;
    well.position.y += y;
    group.add(well);
  }

  const fire = cloneScaled('bonfire', 1.6);
  if (fire) {
    const y = groundY(seed, origin.x + HOMESTEAD_CAMPFIRE.x, origin.z + HOMESTEAD_CAMPFIRE.z);
    fire.position.x = HOMESTEAD_CAMPFIRE.x;
    fire.position.z = HOMESTEAD_CAMPFIRE.z;
    fire.position.y += y;
    group.add(fire);
  }

  buildFenceRing(seed, origin.x, origin.z, group);

  HOMESTEAD_TREES.forEach((tree, i) => {
    const oak = cloneScaled(i % 2 === 0 ? 'oak' : 'oak2', 6.5 * tree.scale);
    if (!oak) return;
    const y = groundY(seed, origin.x + tree.x, origin.z + tree.z);
    oak.position.set(tree.x, oak.position.y + y, tree.z);
    oak.rotation.y = (slot * 7 + i * 3) % 6;
    group.add(oak);
  });
  HOMESTEAD_SHRUBS.forEach((shrub, i) => {
    const bush = cloneScaled(i % 2 === 0 ? 'bushFlowers' : 'bush', 2.2 * shrub.scale);
    if (!bush) return;
    const y = groundY(seed, origin.x + shrub.x, origin.z + shrub.z);
    bush.position.set(shrub.x, bush.position.y + y, shrub.z);
    group.add(bush);
  });

  group.matrixAutoUpdate = false;
  group.updateMatrix();
  group.traverse((o) => {
    if (o !== group) {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    }
  });
  return group;
}

export interface HomesteadView {
  group: THREE.Group;
  update(camX: number, camZ: number): void;
}

export function buildHomestead(seed: number): HomesteadView {
  const group = new THREE.Group();
  const built = new Map<number, THREE.Group>();

  function update(camX: number, camZ: number): void {
    // Far from the band entirely: one cheap reject covers the common case.
    if (camX > -400) {
      for (const g of built.values()) g.visible = false;
      return;
    }
    for (let slot = 0; slot < HOMESTEAD_SLOT_COUNT; slot++) {
      const origin = homesteadOrigin(slot);
      const dx = camX - origin.x;
      const dz = camZ - origin.z;
      const d = Math.hypot(dx, dz);
      let g = built.get(slot);
      if (!g && d < BUILD_RANGE) {
        g = buildSlot(seed, slot);
        built.set(slot, g);
        group.add(g);
      }
      if (g) g.visible = d < VIEW_RANGE;
    }
  }

  return { group, update };
}
