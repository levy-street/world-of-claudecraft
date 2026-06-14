import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { terrainHeight, WATER_LEVEL } from '../sim/world';
import { PROPS, WORLD_MIN_Z } from '../sim/data';
import { hash2 } from '../sim/rng';
import { GFX, surfaceMat } from './gfx';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';

// Static world props: buildings, tents, campfires, mines, ruins, docks,
// fences, graveyards — all real CC0 glTF assets (Quaternius medieval village +
// fantasy props, Kenney nature/pirate/graveyard/fantasy-town kits).
//
// Placement comes from the per-zone content modules (merged into PROPS by
// sim/data.ts) — the collider grid uses the same defs, so positions/footprints
// must not move. Each asset is scaled so its VISUAL footprint matches the
// analytic collider footprint (building w×d with the door on local +z, tent
// r=1.5*scale, crate 0.65, campfire 0.85, mud hut 1.1, ruin column 0.6, ...).
//
// Batching: repeated kinds (tents, crates, campfires, headstones, ruin
// columns, fence modules, mushroom huts) become InstancedMesh per
// (asset part × z-band); one-off compositions (buildings, mines, docks) are
// baked into world space and merged per (material, z-band). Converted
// materials are deduped per (kit, name) so the merge collapses to a handful
// of draws. Animated campfire flames + fire PointLights stay live objects.

export interface PropsResult {
  group: THREE.Group;
  flames: THREE.Mesh[]; // animated campfire flames
  fireLights: THREE.PointLight[];
  /** hides merged/instanced prop bands that sit entirely past the fog far plane */
  update(camX: number, camZ: number, fogFar: number): void;
}

const MERGE_BAND_DEPTH = GFX.standardMaterials ? 180 : 90;

// ---------------------------------------------------------------------------
// Asset registry — loads kick off at module import; main.ts awaits
// assetsReady() before the Renderer is constructed, so buildProps() can read
// the resolved GLTFs synchronously.
// ---------------------------------------------------------------------------

interface PropAssetDef {
  url: string;
  /** material-dedup namespace (one kit shares flat materials across files) */
  kit: string;
  /** pre-rotation (radians) baked into geometry so the door/opening faces +z */
  yaw?: number;
  /** drop parts whose material name matches (e.g. the market cart's awning) */
  strip?: RegExp;
}

const PROP_ASSET_DEFS: Record<string, PropAssetDef> = {
  house1: { url: '/models/props/house_1.glb', kit: 'village' },
  house2: { url: '/models/props/house_2.glb', kit: 'village', yaw: -Math.PI / 2 },
  house3: { url: '/models/props/house_3.glb', kit: 'village' },
  blacksmith: { url: '/models/props/blacksmith.glb', kit: 'village' },
  inn: { url: '/models/props/inn.glb', kit: 'village' },
  bellTower: { url: '/models/props/bell_tower.glb', kit: 'village' },
  well: { url: '/models/props/well.glb', kit: 'village' },
  stand1: { url: '/models/props/market_stand_1.glb', kit: 'village', yaw: -Math.PI / 2 },
  stand2: { url: '/models/props/market_stand_2.glb', kit: 'village', yaw: -Math.PI / 2 },
  cart: { url: '/models/props/cart.glb', kit: 'village', strip: /^(Red|Beige)$/ },
  fence: { url: '/models/props/fence.glb', kit: 'village' },
  bonfire: { url: '/models/props/bonfire.glb', kit: 'village' },
  oreRocks: { url: '/models/props/ore_rocks.glb', kit: 'ore' },
  tentOpen: { url: '/models/props/tent_open.glb', kit: 'tent', yaw: Math.PI },
  tentSmall: { url: '/models/props/tent_small.glb', kit: 'tent', yaw: Math.PI },
  rockTallA: { url: '/models/props/rock_tall_a.glb', kit: 'minerock' },
  rockTallH: { url: '/models/props/rock_tall_h.glb', kit: 'minerock' },
  rockLargeD: { url: '/models/props/rock_large_d.glb', kit: 'minerock' },
  rockLargeF: { url: '/models/props/rock_large_f.glb', kit: 'minerock' },
  mushroomRed: { url: '/models/props/mushroom_red.glb', kit: 'shroom' },
  mushroomTan: { url: '/models/props/mushroom_tan.glb', kit: 'shroom' },
  column: { url: '/models/props/column.glb', kit: 'nature' },
  columnBroken: { url: '/models/props/column_broken.glb', kit: 'nature' },
  statueHead: { url: '/models/props/statue_head.glb', kit: 'nature' },
  statueBlock: { url: '/models/props/statue_block.glb', kit: 'nature' },
  dockPlatform: { url: '/models/props/dock_platform.glb', kit: 'pirate' },
  rowboat: { url: '/models/props/rowboat.glb', kit: 'pirate' },
  graveRound: { url: '/models/props/gravestone_round.glb', kit: 'grave' },
  graveCross: { url: '/models/props/gravestone_cross.glb', kit: 'grave' },
  graveBevel: { url: '/models/props/gravestone_bevel.glb', kit: 'grave' },
  graveDecor: { url: '/models/props/gravestone_decorative.glb', kit: 'grave' },
  timberPillar: { url: '/models/props/timber_pillar.glb', kit: 'town' },
  crateWooden: { url: '/models/props/crate_wooden.glb', kit: 'qprops' },
  farmCrate: { url: '/models/props/farmcrate_apple.glb', kit: 'qprops' },
  barrel: { url: '/models/props/barrel.glb', kit: 'qprops' },
  anvil: { url: '/models/props/anvil.glb', kit: 'qprops' },
  weaponStand: { url: '/models/props/weapon_stand.glb', kit: 'qprops' },
  lanternWall: { url: '/models/props/lantern_wall.glb', kit: 'qprops' },
};

type PropKey = keyof typeof PROP_ASSET_DEFS;

const loadedProps = new Map<string, GLTF>();
const ACTIVE_PROP_KEYS = new Set<PropKey>(GFX.standardMaterials
  ? Object.keys(PROP_ASSET_DEFS) as PropKey[]
  : [
    'house1', 'house2', 'house3', 'blacksmith', 'inn', 'bellTower', 'well',
    'stand1', 'stand2', 'cart', 'fence', 'bonfire', 'oreRocks',
    'tentOpen', 'tentSmall', 'rockLargeD', 'mushroomRed', 'column', 'columnBroken',
    'dockPlatform', 'rowboat', 'graveRound', 'timberPillar', 'crateWooden', 'barrel',
  ]);

// Headless sim/test imports never fetch; the browser kicks loads immediately.
if (typeof window !== 'undefined') {
  for (const [key, def] of Object.entries(PROP_ASSET_DEFS)) {
    if (!ACTIVE_PROP_KEYS.has(key as PropKey)) continue;
    registerPreload(loadGltf(def.url).then((gltf) => { loadedProps.set(key, gltf); }));
  }
}

// Per-material look overrides, keyed `${kit}:${name}` (falls back to name).
// Kenney/Quaternius flat materials need small nudges to sit in our lighting.
const MAT_OVERRIDES: Record<string, {
  color?: number; emissive?: number; emissiveIntensity?: number;
  metalness?: number; roughness?: number;
}> = {
  'village:Windows': { emissive: 0x2a3c55, emissiveIntensity: 1.1, roughness: 0.4 },
  'village:Bell': { metalness: 0.6, roughness: 0.35 },
  'ore:Stone_Dark': { color: 0xb87333, metalness: 0.45, roughness: 0.5 },
  // bandit/cult tents: weathered canvas instead of Kenney's toy red
  'tent:colorRed': { color: 0x9c8662 },
  'tent:colorRedDark': { color: 0x6e5c42 },
  // murloc huts: a giant mushroom recolored to read as a woven thatch dome
  'shroom:colorRed': { color: 0xb29459 },
  'shroom:_defaultMat': { color: 0xc9b896 },
  // mine mound: Kenney nature rocks are beige dirt + teal grass — regrade to
  // granite with a dull moss cap so the pile reads as blasted rock
  'minerock:dirt': { color: 0x82868a },
  'minerock:grass': { color: 0x77846a },
  'minerock:_defaultMat': { color: 0x6f7376 },
  // graveyard colormap is near-white; knock it toward weathered stone
  'grave:colormap': { color: 0xd2d2c8 },
};

// ---------------------------------------------------------------------------
// Extraction: GLTF scene -> world-baked float-attribute geometry + converted
// shared materials. Geometries are CLONES — the cached GLTF stays pristine
// for any other consumer, and the static merge may freely dispose ours.
// ---------------------------------------------------------------------------

interface AssetPart { geo: THREE.BufferGeometry; mat: THREE.Material }
interface PropAsset { parts: AssetPart[]; size: THREE.Vector3 }

const extractCache = new Map<string, PropAsset>();
const matConvCache = new Map<string, THREE.Material>();

/** denormalized float copy — meshopt/quantized attrs must not be transformed in place */
function toFloatAttr(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, itemSize: number): THREE.BufferAttribute {
  const out = new Float32Array(attr.count * itemSize);
  for (let i = 0; i < attr.count; i++) {
    out[i * itemSize] = attr.getX(i);
    if (itemSize > 1) out[i * itemSize + 1] = attr.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attr.getZ(i);
  }
  return new THREE.BufferAttribute(out, itemSize);
}

function convertMaterial(src: THREE.Material, kit: string, hasVertexColors: boolean): THREE.Material {
  const s = src as THREE.MeshStandardMaterial; // basic (unlit) shares the fields we read
  const ov = MAT_OVERRIDES[`${kit}:${s.name}`] ?? MAT_OVERRIDES[s.name];
  // hasVertexColors must key the cache: kits share material names between
  // COLOR_0 meshes (trim 'Vertex' props) and colorless ones — a shared
  // vertexColors:true material would render the colorless meshes black
  const key = `${kit}|${s.name}|${s.color?.getHexString() ?? ''}|${s.map ? 'm' : ''}|${hasVertexColors ? 'v' : ''}|${GFX.standardMaterials ? 's' : 'l'}`;
  const cached = matConvCache.get(key);
  if (cached) return cached;
  const color = ov?.color !== undefined ? new THREE.Color(ov.color) : (s.color?.clone() ?? new THREE.Color(0xffffff));
  const map = s.map ?? null;
  let mat: THREE.Material;
  if (GFX.standardMaterials) {
    mat = new THREE.MeshStandardMaterial({
      color, map,
      vertexColors: hasVertexColors,
      normalMap: s.normalMap ?? null,
      roughnessMap: s.roughnessMap ?? null,
      metalnessMap: s.metalnessMap ?? null,
      aoMap: s.aoMap ?? null,
      roughness: ov?.roughness ?? (s.isMeshStandardMaterial ? s.roughness : 0.9),
      metalness: ov?.metalness ?? (s.isMeshStandardMaterial ? Math.min(s.metalness, 0.85) : 0),
      emissive: new THREE.Color(ov?.emissive ?? 0x000000),
      emissiveIntensity: ov?.emissiveIntensity ?? 1,
    });
  } else {
    mat = new THREE.MeshLambertMaterial({
      color, map,
      vertexColors: hasVertexColors,
      emissive: new THREE.Color(ov?.emissive ?? 0x000000),
      emissiveIntensity: (ov?.emissiveIntensity ?? 1) * 0.6,
    });
  }
  mat.name = `${kit}:${s.name}`;
  matConvCache.set(key, mat);
  return mat;
}

/** parts of a loaded asset, world-baked (incl. yaw), origin centered at the
 *  footprint center with min-y at 0, materials converted + deduped */
function propAsset(key: PropKey): PropAsset {
  const cached = extractCache.get(key);
  if (cached) return cached;
  const def = PROP_ASSET_DEFS[key];
  const gltf = loadedProps.get(key);
  if (!gltf) throw new Error(`prop asset not preloaded: ${key} (${def.url})`);
  gltf.scene.updateMatrixWorld(true);
  const parts: AssetPart[] = [];
  const yawM = def.yaw ? new THREE.Matrix4().makeRotationY(def.yaw) : null;
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const srcMat = mesh.material as THREE.Material;
    if (def.strip?.test(srcMat.name)) return;
    const src = mesh.geometry;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', toFloatAttr(src.getAttribute('position'), 3));
    if (src.getAttribute('normal')) geo.setAttribute('normal', toFloatAttr(src.getAttribute('normal'), 3));
    const uv = src.getAttribute('uv');
    geo.setAttribute('uv', uv ? toFloatAttr(uv, 2) : new THREE.BufferAttribute(new Float32Array((src.getAttribute('position') as THREE.BufferAttribute).count * 2), 2));
    // authored vertex tints (trim-kit 'Vertex' materials depend on them);
    // toFloatAttr denormalizes the uint8 COLOR_0, alpha is 1.0 kit-wide
    const col = src.getAttribute('color');
    if (col) geo.setAttribute('color', toFloatAttr(col, 3));
    if (src.index) geo.setIndex(src.index.clone());
    geo.applyMatrix4(mesh.matrixWorld);
    if (yawM) geo.applyMatrix4(yawM);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    parts.push({ geo, mat: convertMaterial(srcMat, def.kit, !!col) });
  });
  if (!parts.length) throw new Error(`prop asset has no meshes: ${key}`);
  // normalize origin: xz-center at 0, base at y=0
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geo.computeBoundingBox();
    box.union(p.geo.boundingBox as THREE.Box3);
  }
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  for (const p of parts) {
    p.geo.translate(-cx, -box.min.y, -cz);
    p.geo.computeBoundingBox();
    p.geo.computeBoundingSphere();
  }
  const asset: PropAsset = { parts, size: box.getSize(new THREE.Vector3()) };
  extractCache.set(key, asset);
  return asset;
}

// ---------------------------------------------------------------------------
// deterministic per-prop rand streams (no native random — placement is shared
// with colliders/tests via the world seed)
// ---------------------------------------------------------------------------

function propRand(x: number, z: number, n: number): number {
  return hash2(Math.round(x * 37), Math.round(z * 37) + n * 7919, 0x517cc1);
}

function keyRand(key: number, n: number): number {
  return hash2(Math.round(key * 97), n * 7919, 0x9e3779);
}

type Scale = number | [number, number, number];

function setScale(o: THREE.Object3D, s: Scale): void {
  if (typeof s === 'number') o.scale.setScalar(s);
  else o.scale.set(s[0], s[1], s[2]);
}

export function buildProps(seed: number): PropsResult {
  const group = new THREE.Group();
  const flames: THREE.Mesh[] = [];
  const fireLights: THREE.PointLight[] = [];

  const ground = (x: number, z: number) => terrainHeight(x, z, seed);

  // live small materials (decals / glow) — shared, never per-instance
  const usePbr = GFX.standardMaterials;
  const lowProps = !usePbr;
  const recessMat = surfaceMat({ color: 0x14100b, roughness: 1 });
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const lanternMat = surfaceMat({ color: 0xffcc66, emissive: 0xff9933, emissiveIntensity: usePbr ? 2 : 1.2, roughness: 0.4 });

  // emissive glass / black hole-fillers opt out of shadow casting; shadowed()
  // runs after the builders so a plain `castShadow = false` would be clobbered
  const noShadow = new Set<THREE.Mesh>();
  function shadowed<T extends THREE.Object3D>(o: T): T {
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        (c as THREE.Mesh).castShadow = !noShadow.has(c as THREE.Mesh);
        (c as THREE.Mesh).receiveShadow = true;
      }
    });
    return o;
  }

  /** add one asset's meshes under `parent` with a local transform */
  function addParts(parent: THREE.Object3D, key: PropKey, opts: {
    x?: number; y?: number; z?: number; rot?: number; scale: Scale; euler?: THREE.Euler;
  }): THREE.Group {
    const a = propAsset(key);
    const holder = new THREE.Group();
    for (const p of a.parts) holder.add(new THREE.Mesh(p.geo, p.mat));
    holder.position.set(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0);
    if (opts.euler) holder.quaternion.setFromEuler(opts.euler);
    else if (opts.rot) holder.rotation.y = opts.rot;
    setScale(holder, opts.scale);
    parent.add(holder);
    return holder;
  }

  // ---- instancing: repeated kinds collect matrices per (asset × z-band) ----
  const instanceBatches = new Map<string, { key: PropKey; mats: THREE.Matrix4[] }>();
  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();

  function addInstance(key: PropKey, x: number, y: number, z: number, rot: THREE.Euler | number, scale: Scale): void {
    tmpPos.set(x, y, z);
    tmpQuat.setFromEuler(typeof rot === 'number' ? new THREE.Euler(0, rot, 0) : rot);
    if (typeof scale === 'number') tmpScale.setScalar(scale);
    else tmpScale.set(scale[0], scale[1], scale[2]);
    const band = Math.floor((z - WORLD_MIN_Z) / MERGE_BAND_DEPTH);
    const bucketKey = `${key}:${band}`;
    let bucket = instanceBatches.get(bucketKey);
    if (!bucket) {
      bucket = { key, mats: [] };
      instanceBatches.set(bucketKey, bucket);
    }
    bucket.mats.push(new THREE.Matrix4().compose(tmpPos, tmpQuat, tmpScale));
  }

  // ---- buildings: village houses / inn / composed chapel ------------------
  const housePool: PropKey[] = ['house1', 'house2', 'blacksmith'];
  const houseHeight: Record<string, number> = { house1: 8.0, house2: 7.6, blacksmith: 6.6, inn: 7.6 };

  for (const b of PROPS.buildings) {
    const key = b.x * 13.7 + b.z * 3.1;
    const y = ground(b.x, b.z);
    if (b.kind === 'chapel') {
      // composed chapel: tall bell tower at the rear + squat stone entry hall
      // in front; the hall door lands on the footprint's +z edge.
      const g = new THREE.Group();
      const tower = propAsset('bellTower');
      addParts(g, 'bellTower', {
        z: -0.75,
        scale: [(b.w * 0.98) / tower.size.x, 10.6 / tower.size.y, (b.d * 0.72) / tower.size.z],
      });
      const hall = propAsset('house3');
      addParts(g, 'house3', {
        z: b.d / 2 - 1.62,
        scale: [(b.w * 0.9) / hall.size.x, 2.5 / hall.size.y, 3.2 / hall.size.z],
      });
      g.position.set(b.x, y - 0.12, b.z);
      g.rotation.y = b.rot;
      group.add(shadowed(g));
      continue;
    }
    const asset: PropKey = b.kind === 'inn' ? 'inn' : housePool[Math.floor(keyRand(key, 3) * 0.999 * housePool.length)];
    const a = propAsset(asset);
    const g = new THREE.Group();
    addParts(g, asset, { scale: [b.w / a.size.x, houseHeight[asset] / a.size.y, b.d / a.size.z] });
    g.position.set(b.x, y - 0.12, b.z);
    g.rotation.y = b.rot;
    group.add(shadowed(g));
  }

  // ---- market stalls (smith/armorer stalls get anvil + weapon stand) ------
  PROPS.stalls.forEach((s, i) => {
    const key = s.x * 7.7 + s.z * 2.3;
    const g = new THREE.Group();
    const standKey: PropKey = i % 2 === 0 ? 'stand1' : 'stand2';
    const stand = propAsset(standKey);
    addParts(g, standKey, {
      scale: [3.1 / stand.size.x, 2.6 / stand.size.y, 2.5 / stand.size.z],
      rot: (keyRand(key, 1) - 0.5) * 0.1,
    });
    if (!lowProps && (i === 1 || i === 4)) {
      // Smith Haldren (z1) / Armorer Hode (z3): forge-front dressing
      addParts(g, 'anvil', { x: 1.35, z: 1.15, rot: 0.9, scale: 1.35 });
      addParts(g, 'weaponStand', { x: -1.45, z: 0.6, rot: 0.5 + Math.PI, scale: 1.25 });
    } else if (!lowProps) {
      addParts(g, 'farmCrate', { x: 1.3, z: 1.05, rot: keyRand(key, 2) * Math.PI, scale: 1.5 });
      addParts(g, 'barrel', { x: -1.35, z: 0.85, rot: keyRand(key, 3) * Math.PI, scale: 1.15 });
    }
    g.position.set(s.x, ground(s.x, s.z) - 0.06, s.z);
    g.rotation.y = s.rot;
    group.add(shadowed(g));
  });

  // ---- wells ---------------------------------------------------------------
  for (const w of PROPS.wells) {
    const g = new THREE.Group();
    const a = propAsset('well');
    addParts(g, 'well', { scale: [2.6 / a.size.x, 3.6 / a.size.y, 2.9 / a.size.z] });
    g.position.set(w.x, ground(w.x, w.z) - 0.1, w.z);
    g.rotation.y = propRand(w.x, w.z, 1) * Math.PI;
    group.add(shadowed(g));
  }

  // ---- graveyards: 4 headstone shapes, leaning, instanced ------------------
  const graveKinds: PropKey[] = lowProps ? ['graveRound'] : ['graveRound', 'graveCross', 'graveBevel', 'graveDecor'];
  for (const gy of PROPS.graveyards) {
    for (let i = 0; i < 6; i++) {
      const gx = gy.x + (i % 3) * 2.2, gz = gy.z + Math.floor(i / 3) * 2.6;
      const s = 2.0 + keyRand(gx * 3 + gz, 4) * 0.5;
      addInstance(graveKinds[i % graveKinds.length], gx, ground(gx, gz) - 0.06, gz, new THREE.Euler(
        (propRand(gx, gz, 1) - 0.5) * 0.2,
        i * 0.4 + (propRand(gx, gz, 2) - 0.5) * 0.5,
        (propRand(gx, gz, 3) - 0.5) * 0.22,
      ), s);
    }
  }

  // ---- town fences: village fence module repeated along the run ------------
  for (const f of PROPS.fences) {
    const len = Math.hypot(f.x2 - f.x1, f.z2 - f.z1);
    const n = Math.max(1, Math.round(len / 2.35));
    const dirx = (f.x2 - f.x1) / len, dirz = (f.z2 - f.z1) / len;
    const yaw = Math.atan2(-dirz, dirx); // module length runs along local +x
    for (let i = 0; i < n; i++) {
      const x0 = f.x1 + (f.x2 - f.x1) * (i / n), z0 = f.z1 + (f.z2 - f.z1) * (i / n);
      const x1 = f.x1 + (f.x2 - f.x1) * ((i + 1) / n), z1 = f.z1 + (f.z2 - f.z1) * ((i + 1) / n);
      const g0 = ground(x0, z0), g1 = ground(x1, z1);
      const pitch = Math.atan2(g1 - g0, len / n);
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const sy = 2.9 + (propRand(mx, mz, 1) - 0.5) * 0.5;
      addInstance('fence', mx, (g0 + g1) / 2 - 0.05, mz,
        new THREE.Euler(0, yaw, pitch, 'YZX'), [3.0, sy, 3.0]);
    }
  }

  // ---- campfires: instanced bonfire base + live animated flame + light -----
  const flamePts = [[0, 0], [0.16, 0.1], [0.27, 0.28], [0.3, 0.45], [0.22, 0.66], [0.1, 0.84], [0.001, 0.95]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const flameGeo = new THREE.LatheGeometry(flamePts, 7);
  for (const [x, z] of PROPS.campfires) {
    const y = ground(x, z);
    addInstance('bonfire', x, y - 0.05, z, propRand(x, z, 1) * Math.PI * 2, 4.3);
    const g = new THREE.Group();
    const flame = new THREE.Mesh(flameGeo, new THREE.MeshLambertMaterial({
      color: 0xffaa33, emissive: 0xff6600, emissiveIntensity: usePbr ? 2.2 : 1.4,
      transparent: true, opacity: 0.92,
    }));
    flame.position.y = 0.16;
    flame.scale.setScalar(1.15);
    g.add(flame);
    flames.push(flame);
    noShadow.add(flame);
    const light = new THREE.PointLight(0xff8830, 12, 16, 2);
    light.position.y = 1.2;
    g.add(light);
    fireLights.push(light);
    g.position.set(x, y, z);
    group.add(g);
  }

  // ---- bandit/war tents: Kenney ridge tents, opening on +z, instanced ------
  for (const t of PROPS.tents) {
    const kind: PropKey = propRand(t.x, t.z, 2) < 0.55 ? 'tentOpen' : 'tentSmall';
    const a = propAsset(kind);
    const s = (3.0 * t.scale) / Math.max(a.size.x, a.size.z);
    addInstance(kind, t.x, ground(t.x, t.z) - 0.06, t.z, new THREE.Euler(
      (propRand(t.x, t.z, 3) - 0.5) * 0.06, t.rot, (propRand(t.x, t.z, 4) - 0.5) * 0.06,
    ), [s, s * 1.32, s]);
  }

  // ---- crates: camp clutter (wooden crate / barrel mix), instanced ---------
  PROPS.crates.forEach(([x, z], i) => {
    const kind: PropKey = i % 3 === 2 ? 'barrel' : 'crateWooden';
    const s = kind === 'barrel' ? 1.25 : 1.3 + propRand(x, z, 5) * 0.15;
    addInstance(kind, x, ground(x, z) - 0.04, z, new THREE.Euler(
      (propRand(x, z, 7) - 0.5) * 0.05, ((x * 13 + z * 7) % 1) * Math.PI, 0,
    ), s);
  });

  // ---- murloc mud huts: giant swamp mushrooms, doorway facing camp center --
  const hutCenter = PROPS.mudHuts.reduce(
    (acc, [hx, hz]) => ({ x: acc.x + hx / PROPS.mudHuts.length, z: acc.z + hz / PROPS.mudHuts.length }),
    { x: 0, z: 0 },
  );
  for (const [x, z] of PROPS.mudHuts) {
    const y = ground(x, z);
    const sxz = 13 + propRand(x, z, 15) * 3;
    const sy = 10.5 + propRand(x, z, 16) * 3;
    addInstance('mushroomRed', x, y - 0.15, z, new THREE.Euler(
      (propRand(x, z, 13) - 0.5) * 0.1, propRand(x, z, 12) * Math.PI * 2, (propRand(x, z, 14) - 0.5) * 0.1,
    ), [sxz, sy, sxz]);
    // doorway decal aimed at the camp heart
    const face = Math.atan2(hutCenter.x - x, hutCenter.z - z);
    const doorway = new THREE.Mesh(new THREE.CircleGeometry(0.62, 8, 0, Math.PI), recessMat);
    doorway.position.set(x + Math.sin(face) * 1.0, y + 0.04, z + Math.cos(face) * 1.0);
    doorway.rotation.y = face;
    doorway.rotation.x = -0.14;
    noShadow.add(doorway);
    group.add(doorway);
    if (!lowProps) {
      // toadstool cluster at the foot
      const a2 = face + 0.9 + propRand(x, z, 18);
      addInstance('mushroomTan', x + Math.sin(a2) * 1.7, y - 0.05, z + Math.cos(a2) * 1.7,
        propRand(x, z, 19) * Math.PI * 2, 2.6 + propRand(x, z, 20) * 1.4);
    }
  }

  // ---- ruin rings: weathered monolith columns at the exact collider angles -
  for (const r of PROPS.ruinRings) {
    for (let i = 0; i < r.columns; i++) {
      const ang = (i / r.columns) * Math.PI * 2;
      const x = r.x + Math.sin(ang) * r.ringR, z = r.z + Math.cos(ang) * r.ringR;
      const intact = i % 4 === 1;
      const kind: PropKey = intact ? 'column' : 'columnBroken';
      const sy = intact ? 3.5 + (i % 2) * 0.5 : 1.7 + (i % 3) * 0.85;
      addInstance(kind, x, ground(x, z) - 0.1, z, new THREE.Euler(
        0, propRand(x, z, 8) * Math.PI,
        (i % 3 === 0 ? 0.13 : 0.03) * (i % 2 ? 1 : -1),
      ), [3.8, sy, 3.8]);
    }
    if (lowProps) continue;
    // toppled relics at the ring's heart: half-buried head + fallen column
    const fy = ground(r.x - 2, r.z - 3);
    const g = new THREE.Group();
    addParts(g, 'statueHead', {
      x: -0.4, y: -0.55, z: 0.3, scale: 2.3,
      euler: new THREE.Euler(0.34, propRand(r.x, r.z, 30) * Math.PI * 2, 0.22),
    });
    addParts(g, 'statueBlock', {
      x: 2.1, y: -0.2, z: -1.3, rot: propRand(r.x, r.z, 31) * Math.PI, scale: 2.1,
    });
    addParts(g, 'column', {
      x: -1.2, y: 0.62, z: -2.2, scale: 3.2,
      euler: new THREE.Euler(Math.PI / 2 - 0.06, 0.6 + (propRand(r.x, r.z, 32) - 0.5) * 0.4, 0, 'YXZ'),
    });
    g.position.set(r.x - 2, fy, r.z - 3);
    group.add(shadowed(g));
  }

  // ---- mine entrances: timber portal, rock mound, ore cart, lantern --------
  for (const m of PROPS.mines) {
    const g = new THREE.Group();
    for (const sx of [-1.45, 1.45]) {
      addParts(g, 'timberPillar', { x: sx, scale: [3.4, 3.5, 3.4] });
    }
    // lintel + cap beam: the same square timber laid across the posts
    addParts(g, 'timberPillar', { y: 3.42, x: -2.2, euler: new THREE.Euler(0, 0, -Math.PI / 2), scale: [3.6, 4.4, 3.6] });
    addParts(g, 'timberPillar', { y: 3.85, x: -2.45, euler: new THREE.Euler(0, 0, -Math.PI / 2), scale: [3.0, 4.9, 3.0] });
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.1), holeMat);
    hole.position.set(0, 1.55, -0.2);
    noShadow.add(hole);
    g.add(hole);
    // boulder mound swallowing the portal (same mound the collider blocks):
    // pairs of mid-sized granite rocks per anchor read as a rubble pile where
    // one giant scaled rock would read as a box
    const mound: [number, number, number, number][] = [
      [0, 1.4, -3.0, 2.6], [-2.7, 0.3, -2.0, 1.9], [2.7, 0.35, -2.2, 2.0],
      [-1.6, 0.1, -1.0, 1.2], [1.8, 0.1, -0.9, 1.1], [0.3, 3.0, -4.2, 2.3],
      [-1.4, 1.6, -3.4, 1.8], [1.5, 1.7, -3.2, 1.7], [0, 0.2, -1.6, 1.4],
    ];
    const rockKinds: PropKey[] = lowProps ? ['rockLargeD'] : ['rockTallA', 'rockLargeD', 'rockTallH', 'rockLargeF'];
    for (let i = 0; i < mound.length; i++) {
      const [rx, ry, rz, rr] = mound[i];
      const kind = rockKinds[(i * 2 + 1) % rockKinds.length];
      const a = propAsset(kind);
      addParts(g, kind, {
        x: rx, y: ry, z: rz, scale: (2.1 * rr) / Math.max(a.size.x, a.size.z),
        euler: new THREE.Euler(
          (propRand(m.x, m.z, i + 80) - 0.5) * 0.5,
          propRand(m.x, m.z, i + 70) * Math.PI,
          (propRand(m.x, m.z, i + 90) - 0.5) * 0.5,
        ),
      });
    }
    // ore cart (market awning stripped) + raw copper ore in the bed
    addParts(g, 'cart', { x: 2.8, z: 1.6, rot: 0.5, scale: 1.9 });
    addParts(g, 'oreRocks', { x: 2.75, y: 0.78, z: 1.55, rot: 0.9, scale: 2.6 });
    addParts(g, 'oreRocks', { x: 3.4, z: 0.4, rot: 2.2, scale: 1.8 });
    if (!lowProps) {
      // hanging lantern on the right post
      addParts(g, 'lanternWall', { x: 1.45, y: 2.0, z: 0.28, scale: 1.25 });
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.26, 6), lanternMat);
      glass.position.set(1.45, 2.52, 1.32);
      noShadow.add(glass);
      g.add(glass);
    }
    g.position.set(m.x, ground(m.x, m.z), m.z);
    g.rotation.y = m.rot;
    group.add(shadowed(g));
  }

  // ---- fishing docks: pirate-kit platforms, moored rowboat, stone hut ------
  for (const d of PROPS.docks) {
    const y = ground(d.x, d.z);
    const g = new THREE.Group();
    const key = d.x * 3.3 + d.z * 1.7;
    for (let i = 0; i < 3; i++) {
      // step each pier section down toward the water so the far legs stay
      // grounded on a dropping shore (flat shores keep a level deck)
      const lz = -1.05 - i * 2.13;
      const wx = d.x + lz * Math.sin(d.rot);
      const wz = d.z + lz * Math.cos(d.rot);
      addParts(g, 'dockPlatform', {
        z: lz, y: Math.min(0, ground(wx, wz) - y + 0.15),
        rot: (keyRand(key, i) - 0.5) * 0.04,
        scale: [0.78, 0.52, 0.85],
      });
    }
    const hut = propAsset('house3');
    addParts(g, 'house3', {
      x: d.hutLocal.x, z: d.hutLocal.z,
      scale: [(d.hutLocal.hw * 2) / hut.size.x, 2.6 / hut.size.y, (d.hutLocal.hd * 2) / hut.size.z],
    });
    if (!lowProps) {
      addParts(g, 'barrel', { x: 0.55, y: 0.52, z: -0.55, rot: keyRand(key, 5) * Math.PI, scale: 0.95 });
      addParts(g, 'barrel', { x: 1.45, z: 0.9, rot: keyRand(key, 6) * Math.PI, scale: 1.15 });
      addParts(g, 'crateWooden', { x: -0.6, y: 0.52, z: -2.2, rot: keyRand(key, 7), scale: 0.9 });
    }
    // rowboat beside the deck's far end: floats at water level when the
    // shore dips below it, otherwise sits hauled up on the bank
    const boatLx = 2.4, boatLz = -5.0;
    const boatWx = d.x + boatLx * Math.cos(d.rot) + boatLz * Math.sin(d.rot);
    const boatWz = d.z - boatLx * Math.sin(d.rot) + boatLz * Math.cos(d.rot);
    const boatGround = ground(boatWx, boatWz);
    const isAfloat = boatGround < WATER_LEVEL - 0.1;
    addParts(g, 'rowboat', {
      x: boatLx, z: boatLz,
      y: (isAfloat ? WATER_LEVEL + 0.18 : boatGround + 0.06) - y,
      rot: 0.5 + (keyRand(key, 8) - 0.5) * 0.4, scale: 0.85,
      euler: isAfloat ? undefined : new THREE.Euler(0.04, 0.5 + (keyRand(key, 8) - 0.5) * 0.4, 0.16),
    });
    g.position.set(d.x, y, d.z);
    g.rotation.y = d.rot;
    group.add(shadowed(g));
  }

  // ---- flush instanced batches ---------------------------------------------
  const cullables: PropCullable[] = [];
  for (const batch of instanceBatches.values()) {
    const a = propAsset(batch.key);
    for (const part of a.parts) {
      const im = new THREE.InstancedMesh(part.geo, part.mat, batch.mats.length);
      for (let i = 0; i < batch.mats.length; i++) im.setMatrixAt(i, batch.mats[i]);
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.computeBoundingBox();
      group.add(im);
      const bounds = cullableBounds(im, im.boundingBox, im.boundingSphere);
      if (bounds) cullables.push(bounds);
    }
  }

  const staticMeshes = mergeStaticMeshes(group, new Set(flames));
  for (const sm of staticMeshes) {
    const bounds = cullableBounds(sm, sm.geometry.boundingBox, sm.geometry.boundingSphere);
    if (bounds) cullables.push(bounds);
  }

  return {
    group,
    flames,
    fireLights,
    update(camX: number, camZ: number, fogFar: number): void {
      for (const c of cullables) {
        c.obj.visible = cullableVisible(c, camX, camZ, fogFar);
      }
    },
  };
}

interface PropCullable {
  obj: THREE.Object3D;
  hasBox: boolean;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cx: number;
  cz: number;
  r: number;
}

function cullableBounds(
  obj: THREE.Object3D,
  box: THREE.Box3 | null,
  sphere: THREE.Sphere | null,
): PropCullable | undefined {
  if (box) {
    const fallback = sphere ?? box.getBoundingSphere(new THREE.Sphere());
    return {
      obj,
      hasBox: true,
      minX: box.min.x,
      maxX: box.max.x,
      minZ: box.min.z,
      maxZ: box.max.z,
      cx: fallback.center.x,
      cz: fallback.center.z,
      r: fallback.radius,
    };
  }
  if (!sphere) return undefined;
  return {
    obj,
    hasBox: false,
    minX: sphere.center.x - sphere.radius,
    maxX: sphere.center.x + sphere.radius,
    minZ: sphere.center.z - sphere.radius,
    maxZ: sphere.center.z + sphere.radius,
    cx: sphere.center.x,
    cz: sphere.center.z,
    r: sphere.radius,
  };
}

function cullableVisible(c: PropCullable, camX: number, camZ: number, fogFar: number): boolean {
  const dx = camX < c.minX ? c.minX - camX : camX > c.maxX ? camX - c.maxX : 0;
  const dz = camZ < c.minZ ? c.minZ - camZ : camZ > c.maxZ ? camZ - c.maxZ : 0;
  if (Math.hypot(dx, dz) < fogFar) return true;
  if (c.hasBox) return false;
  return Math.hypot(c.cx - camX, c.cz - camZ) - c.r < fogFar;
}

// Bake every static prop mesh into world space and merge per
// (material, castShadow, z-band). Flames (animated) and InstancedMeshes
// survive untouched, as do the PointLights (not meshes). The merged meshes
// replace the originals on the same group; emptied sub-groups are left in
// place (they carry lights). Geometries are de-indexed before merging so
// indexed glTF extracts and procedural shapes can share a bucket.
function mergeStaticMeshes(group: THREE.Group, keep: Set<THREE.Object3D>): THREE.Mesh[] {
  group.updateMatrixWorld(true);
  interface Bucket { material: THREE.Material; castShadow: boolean; geoms: THREE.BufferGeometry[] }
  const buckets = new Map<string, Bucket>();
  const merged: THREE.Mesh[] = [];
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || keep.has(mesh) || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
    const material = mesh.material as THREE.Material;
    const worldZ = mesh.matrixWorld.elements[14];
    const band = Math.floor((worldZ - WORLD_MIN_Z) / MERGE_BAND_DEPTH);
    const key = `${material.uuid}:${mesh.castShadow ? 1 : 0}:${band}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material, castShadow: mesh.castShadow, geoms: [] };
      buckets.set(key, bucket);
    }
    // clone/de-index: extracted geometries are shared across placements, so
    // the bake must never mutate them in place
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    bucket.geoms.push(geo.applyMatrix4(mesh.matrixWorld));
    merged.push(mesh);
  });
  for (const mesh of merged) mesh.removeFromParent();
  const out: THREE.Mesh[] = [];
  for (const bucket of buckets.values()) {
    const geo = mergeGeometries(bucket.geoms, false);
    if (!geo) continue;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, bucket.material);
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    out.push(mesh);
  }
  return out;
}
