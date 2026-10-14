import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { CLUTTER_KINDS, type ClutterStamp, clutterStampsNear } from '../sim/city_clutter';
import { getActiveWorldContent, isBuiltinWorldActive } from '../sim/data';
import { terrainHeight } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { clutterItemsForStamp } from './city_clutter_core';
import { GFX, type GfxSettings } from './gfx';

// Painted ground clutter: the Studio's Paint Clutter brush leaves stamps on the
// map (sim/city_clutter.ts); this layer scatters the ten tiny clutter models
// inside every stamp near the camera. One InstancedMesh per kind (ten draws at
// most), a camera-centred pool, pieces ground-conformed from the heightfield.
//
// Tier-gated: GFX.cityClutter is High and up, and below it this builds
// NOTHING (no fetch, no meshes, no per-frame work), so a dressed map costs a
// Medium machine exactly zero. The editor viewport forces the layer on so a
// maker sees what the brush paints; the game keeps the gate.
//
// Placement is deterministic per stamp (city_clutter_core.ts) and cached per
// stamp object, so walking only re-copies matrices; a terrain edit calls
// invalidate() and the ground is re-sampled.

const MODEL_URLS = CLUTTER_KINDS.map((kind) => `models/clutter/${kind}.glb`);
const POOL = 800; // instances per kind within the draw radius
const MOVE_REBUILD = 5; // yards of camera travel before the resident set is recomputed
const SLOPE_PROBE = 0.4; // yards: half-width of the ground-normal probe
const SINK = 0.01; // yards: bury the base a touch so flat pieces never float

export interface CityClutterView {
  group: THREE.Group;
  update(px: number, pz: number): void;
  invalidate(): void;
}

const loadedModels: GLTF[] = [];
let modelsReady: Promise<void> | null = null;
function loadModels(): Promise<void> {
  if (loadedModels.length === MODEL_URLS.length) return Promise.resolve();
  modelsReady ??= Promise.all(MODEL_URLS.map((url) => loadGltf(url)))
    .then((gltfs) => {
      loadedModels.length = 0;
      loadedModels.push(...gltfs);
      modelsReady = null;
    })
    .catch((err) => {
      modelsReady = null;
      throw err;
    });
  return modelsReady;
}

export function prepareCityClutterProfileAssets(
  target: Pick<GfxSettings, 'cityClutter'>,
): Promise<void> {
  // Painted clutter is authored-map content: the built-in world carries no
  // stamps, so it never fetches the clutter GLBs (nor holds the curtain on them).
  return target.cityClutter && !isBuiltinWorldActive() ? loadModels() : Promise.resolve();
}

registerDeferredPreload(() => prepareCityClutterProfileAssets(GFX));

// the shipped GLBs are meshopt-quantized: bake attributes to float32 + world
// space once so the geometry can back an InstancedMesh directly
function toFloatAttribute(
  attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): THREE.BufferAttribute {
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let j = 0; j < attr.itemSize; j++) out[i * attr.itemSize + j] = attr.getComponent(i, j);
  }
  return new THREE.BufferAttribute(out, attr.itemSize);
}

// kinds whose faces are thin cards (letters, leaves, pot shards): double-sided
// Kinds modelled as FLAT CARDS, which must be drawn from both sides or they
// vanish as the camera crosses their plane. `paper_scraps` was missing here
// while `letter`, the same sheet of paper, one size up, was listed, so
// scattered scraps popped in and out depending on which way you looked at
// them (found chasing SPACEY's "little white pixels", 2026-09-22: the big one
// he could see clearly was the `letter` model, not a decal).
const CARD_KINDS = new Set<string>(['letter', 'paper_scraps', 'leaves', 'pot_shards']);

interface BakedClutter {
  geometries: THREE.BufferGeometry[];
  /** per kind, index-aligned with CLUTTER_KINDS */
  materials: THREE.MeshStandardMaterial[];
}

let baked: BakedClutter | null = null;

export function resetCityClutterProfileCaches(): void {
  baked = null;
}

function bakeModels(): BakedClutter | null {
  if (baked) return baked;
  if (loadedModels.length < MODEL_URLS.length) return null;
  const geometries: THREE.BufferGeometry[] = [];
  for (const gltf of loadedModels) {
    gltf.scene.updateMatrixWorld(true);
    let mesh: THREE.Mesh | null = null;
    gltf.scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!mesh && m.isMesh) mesh = m;
    });
    if (!mesh) throw new Error('city clutter: model has no meshes');
    const src = (mesh as THREE.Mesh).geometry;
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color']) {
      const attr = src.getAttribute(name);
      if (attr) out.setAttribute(name, toFloatAttribute(attr));
    }
    if (src.index) out.setIndex(src.index.clone());
    out.applyMatrix4((mesh as THREE.Mesh).matrixWorld);
    geometries.push(out);
  }
  // flat-shaded, vertex-coloured: the models carry their colours. Solid pieces
  // are front-faced; the paper and leaf cards are seen from either side.
  const solid = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
  });
  const card = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const materials = CLUTTER_KINDS.map((kind) => (CARD_KINDS.has(kind) ? card : solid));
  loadedModels.length = 0;
  baked = { geometries, materials };
  return baked;
}

interface PlacedStamp {
  kind: Int8Array;
  x: Float32Array;
  z: Float32Array;
  matrices: Float32Array;
}

/**
 * Build the painted-clutter layer. `force` is the editor viewport's override:
 * the brush must show its work whatever the tier; the game passes nothing.
 */
export function buildCityClutter(
  seed: number,
  settings: Pick<GfxSettings, 'cityClutter' | 'cityClutterRadius'> = GFX,
  force = false,
): CityClutterView {
  const group = new THREE.Group();
  group.name = 'cityClutter';
  if (!settings.cityClutter && !force) {
    return { group, update: () => undefined, invalidate: () => undefined };
  }
  const radius = Math.max(20, settings.cityClutterRadius);

  const meshes: THREE.InstancedMesh[] = [];
  const matrixArrays: Float32Array[] = [];
  let ready = false;
  const tryBuild = (): void => {
    if (ready) return;
    const models = bakeModels();
    if (!models) return;
    for (let kind = 0; kind < models.geometries.length; kind++) {
      const im = new THREE.InstancedMesh(models.geometries[kind], models.materials[kind], POOL);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = false; // pebbles and paper cast nothing worth a shadow pass
      im.receiveShadow = true;
      im.frustumCulled = false; // pool is centred on the camera
      im.count = 0;
      meshes.push(im);
      matrixArrays.push(im.instanceMatrix.array as Float32Array);
      group.add(im);
    }
    ready = true;
  };
  tryBuild();
  if (!ready)
    void loadModels()
      .then(tryBuild)
      .catch(() => undefined);

  let placed = new WeakMap<ClutterStamp, PlacedStamp>();
  let lastX = Number.NaN;
  let lastZ = Number.NaN;
  let lastStamps: readonly ClutterStamp[] | undefined;
  let dirty = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();
  const qTilt = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  function placeStamp(stamp: ClutterStamp): PlacedStamp {
    const items = clutterItemsForStamp(stamp);
    const out: PlacedStamp = {
      kind: new Int8Array(items.length),
      x: new Float32Array(items.length),
      z: new Float32Array(items.length),
      matrices: new Float32Array(items.length * 16),
    };
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const h = terrainHeight(it.x, it.z, seed);
      const hE = terrainHeight(it.x + SLOPE_PROBE, it.z, seed);
      const hW = terrainHeight(it.x - SLOPE_PROBE, it.z, seed);
      const hN = terrainHeight(it.x, it.z + SLOPE_PROBE, seed);
      const hS = terrainHeight(it.x, it.z - SLOPE_PROBE, seed);
      normal.set(-(hE - hW) / (2 * SLOPE_PROBE), 1, -(hN - hS) / (2 * SLOPE_PROBE)).normalize();
      qTilt.setFromUnitVectors(up, normal);
      qYaw.setFromAxisAngle(up, it.yaw);
      q.multiplyQuaternions(qTilt, qYaw);
      m.compose(pos.set(it.x, h - SINK * it.scale, it.z), q, scl.set(it.scale, it.scale, it.scale));
      out.kind[i] = it.kind;
      out.x[i] = it.x;
      out.z[i] = it.z;
      out.matrices.set(m.elements, i * 16);
    }
    return out;
  }

  const counts = new Uint16Array(MODEL_URLS.length);

  function rebuild(px: number, pz: number, stamps: readonly ClutterStamp[] | undefined): void {
    counts.fill(0);
    const near = clutterStampsNear(stamps, px, pz, radius);
    // nearest stamps first, so a crowded map fills the pools from the camera outward
    near.sort(
      (a, b) => Math.hypot(a.x - px, a.z - pz) - a.r - (Math.hypot(b.x - px, b.z - pz) - b.r),
    );
    const r2 = radius * radius;
    for (const stamp of near) {
      let entry = placed.get(stamp);
      if (!entry) {
        entry = placeStamp(stamp);
        placed.set(stamp, entry);
      }
      for (let i = 0; i < entry.kind.length; i++) {
        const kind = entry.kind[i];
        if (kind >= meshes.length || counts[kind] >= POOL) continue;
        const dx = entry.x[i] - px;
        const dz = entry.z[i] - pz;
        if (dx * dx + dz * dz > r2) continue;
        matrixArrays[kind].set(entry.matrices.subarray(i * 16, i * 16 + 16), counts[kind] * 16);
        counts[kind]++;
      }
    }
    for (let kind = 0; kind < meshes.length; kind++) {
      const im = meshes[kind];
      im.count = counts[kind];
      if (im.count > 0) im.instanceMatrix.addUpdateRange(0, im.count * 16);
      im.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    group,
    invalidate(): void {
      // the ground moved (sculpt, water) or the stamps changed: re-sample everything
      placed = new WeakMap();
      dirty = true;
    },
    update(px: number, pz: number): void {
      if (!ready) return;
      const stamps = getActiveWorldContent().clutter;
      const moved = !(Math.abs(px - lastX) < MOVE_REBUILD && Math.abs(pz - lastZ) < MOVE_REBUILD);
      if (!dirty && !moved && stamps === lastStamps) return;
      lastX = px;
      lastZ = pz;
      lastStamps = stamps;
      dirty = false;
      rebuild(px, pz, stamps);
    },
  };
}
