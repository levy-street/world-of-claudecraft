import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PROPS, WORLD_MIN_Z } from '../sim/data';
import { hash2 } from '../sim/rng';
import { terrainHeight, WATER_LEVEL } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX, sharedUniforms, surfaceMat } from './gfx';

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
// Batching: repeated non-hideable kinds (headstones, fence modules, small
// dressing) become InstancedMesh per (asset part × z-band); one-off compositions
// and camera-ghost props stay as groups or are baked into world space and merged
// per (material, z-band). Converted materials are deduped per (kit, name) so
// the merge collapses to a handful of draws. Animated campfire flames + fire
// PointLights stay live objects.

export interface PropsResult {
  group: THREE.Group;
  flames: THREE.Mesh[]; // animated campfire flames
  fireLights: THREE.PointLight[];
  /**
   * Hides merged/instanced prop bands that sit entirely past the fog far plane,
   * and hides any camera-ghost prop crossing the current eye-to-camera segment
   * so the chase cam can pass through props without a wall in view.
   */
  update(
    camX: number,
    camY: number,
    camZ: number,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    fogFar: number,
  ): void;
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
  // Meshy-generated portal door used as the overworld Reliquary Hill marker;
  // has its own backing slab so the animated shader plane sits on the front face.
  // yaw: Math.PI if the model loads backwards after inspecting in-game.
  delveEntrance2: { url: '/models/dungeon/delve_entrance_2.glb', kit: 'dungeon' },
};

type PropKey = keyof typeof PROP_ASSET_DEFS;

const loadedProps = new Map<string, GLTF>();
const ACTIVE_PROP_KEYS = new Set<PropKey>(
  GFX.standardMaterials
    ? (Object.keys(PROP_ASSET_DEFS) as PropKey[])
    : [
        'house1',
        'house2',
        'house3',
        'blacksmith',
        'inn',
        'bellTower',
        'well',
        'stand1',
        'stand2',
        'cart',
        'fence',
        'bonfire',
        'oreRocks',
        'tentOpen',
        'tentSmall',
        'rockLargeD',
        'mushroomRed',
        'column',
        'columnBroken',
        'dockPlatform',
        'rowboat',
        'graveRound',
        'timberPillar',
        'crateWooden',
        'barrel',
        'delveEntrance2', // delve entrance portal, a landmark, so keep it on low gfx too
      ],
);

// Headless sim/test imports never fetch; the browser kicks loads immediately.
if (typeof window !== 'undefined') {
  for (const [key, def] of Object.entries(PROP_ASSET_DEFS)) {
    if (!ACTIVE_PROP_KEYS.has(key as PropKey)) continue;
    registerPreload(
      loadGltf(def.url).then((gltf) => {
        loadedProps.set(key, gltf);
      }),
    );
  }
}

// Per-material look overrides, keyed `${kit}:${name}` (falls back to name).
// Kenney/Quaternius flat materials need small nudges to sit in our lighting.
const MAT_OVERRIDES: Record<
  string,
  {
    color?: number;
    emissive?: number;
    emissiveIntensity?: number;
    metalness?: number;
    roughness?: number;
  }
> = {
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

interface AssetPart {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}
interface PropAsset {
  parts: AssetPart[];
  size: THREE.Vector3;
}

const extractCache = new Map<string, PropAsset>();
const matConvCache = new Map<string, THREE.Material>();

/** denormalized float copy — meshopt/quantized attrs must not be transformed in place */
function toFloatAttr(
  attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  itemSize: number,
): THREE.BufferAttribute {
  const out = new Float32Array(attr.count * itemSize);
  for (let i = 0; i < attr.count; i++) {
    out[i * itemSize] = attr.getX(i);
    if (itemSize > 1) out[i * itemSize + 1] = attr.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attr.getZ(i);
  }
  return new THREE.BufferAttribute(out, itemSize);
}

function convertMaterial(
  src: THREE.Material,
  kit: string,
  hasVertexColors: boolean,
): THREE.Material {
  const s = src as THREE.MeshStandardMaterial; // basic (unlit) shares the fields we read
  const ov = MAT_OVERRIDES[`${kit}:${s.name}`] ?? MAT_OVERRIDES[s.name];
  // hasVertexColors must key the cache: kits share material names between
  // COLOR_0 meshes (trim 'Vertex' props) and colorless ones — a shared
  // vertexColors:true material would render the colorless meshes black
  const key = `${kit}|${s.name}|${s.color?.getHexString() ?? ''}|${s.map ? 'm' : ''}|${hasVertexColors ? 'v' : ''}|${GFX.standardMaterials ? 's' : 'l'}`;
  const cached = matConvCache.get(key);
  if (cached) return cached;
  const color =
    ov?.color !== undefined
      ? new THREE.Color(ov.color)
      : (s.color?.clone() ?? new THREE.Color(0xffffff));
  const map = s.map ?? null;
  let mat: THREE.Material;
  if (GFX.standardMaterials) {
    mat = new THREE.MeshStandardMaterial({
      color,
      map,
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
      color,
      map,
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
    if (src.getAttribute('normal'))
      geo.setAttribute('normal', toFloatAttr(src.getAttribute('normal'), 3));
    const uv = src.getAttribute('uv');
    geo.setAttribute(
      'uv',
      uv
        ? toFloatAttr(uv, 2)
        : new THREE.BufferAttribute(
            new Float32Array((src.getAttribute('position') as THREE.BufferAttribute).count * 2),
            2,
          ),
    );
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
  const cx = (box.min.x + box.max.x) / 2,
    cz = (box.min.z + box.max.z) / 2;
  for (const p of parts) {
    p.geo.translate(-cx, -box.min.y, -cz);
    p.geo.computeBoundingBox();
    p.geo.computeBoundingSphere();
  }
  const asset: PropAsset = { parts, size: box.getSize(new THREE.Vector3()) };
  extractCache.set(key, asset);
  return asset;
}

export function buildPropMaterialPrewarmGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'prop-material-prewarm';
  group.visible = true;
  group.userData.renderCategory = 'prewarm';
  const seen = new Set<string>();
  let idx = 0;
  const instanceMatrix = new THREE.Matrix4();
  const place = (obj: THREE.Object3D): void => {
    const col = idx % 10;
    const row = Math.floor(idx / 10) % 8;
    const layer = Math.floor(idx / 80);
    obj.position.set((col - 4.5) * 1.2, row * 0.85, -8 - layer * 1.5);
    obj.scale.setScalar(0.08);
    obj.frustumCulled = false;
    group.add(obj);
    idx++;
  };
  for (const key of ACTIVE_PROP_KEYS) {
    const asset = propAsset(key);
    for (const part of asset.parts) {
      const matKey = `${part.mat.uuid}:${part.geo.getAttribute('color') ? 'color' : 'plain'}`;
      if (seen.has(matKey)) continue;
      seen.add(matKey);
      const mesh = new THREE.Mesh(part.geo, part.mat);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      place(mesh);
      const instanced = new THREE.InstancedMesh(part.geo, part.mat, 1);
      instanced.setMatrixAt(0, instanceMatrix.identity());
      instanced.instanceMatrix.needsUpdate = true;
      instanced.castShadow = false;
      instanced.receiveShadow = false;
      place(instanced);
    }
  }
  return group;
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

// ---------------------------------------------------------------------------
// Delve-mouth portal: a self-animating red "void" sheet that fills the entrance
// arch, driven by the shared uTime clock (no per-frame JS plumbing, same
// pattern as the Drowned-Temple water in dungeon.ts). A churning swirl + a
// global breathing pulse take a deep near-black red up to a hot bright red; the
// circular alpha mask hides the plane's rectangular edges so it reads as a glowing
// mouth. On the composer tiers the hot core is pushed past 1.0 (uHdr) so it
// blooms; on low/headless (no composer) the colour stays saturated so it still
// reads without bloom.
// ---------------------------------------------------------------------------
const DELVE_PORTAL_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWPos;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWPos = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const DELVE_PORTAL_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDim;
  uniform vec3 uBright;
  uniform float uHdr;
  varying vec2 vUv;
  varying vec3 vWPos;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec2 p = vUv * 2.0 - 1.0; // centre-origin -1..1
    float r = length(p);

    // spinning vortex: angular phase + time rotates concentric rings inward
    float angle  = atan(p.y, p.x) / (2.0 * PI); // 0..1 around the disc
    float vortex = sin((angle + uTime * 0.10) * PI * 12.0 + r * 10.0 - uTime * 2.0) * 0.5 + 0.5;

    // three churning noise layers for organic variation
    float swirl = sin(p.x * 5.0 + uTime * 1.0)
                + sin(p.y * 6.0 - uTime * 0.85)
                + sin((p.x + p.y) * 4.5 + uTime * 0.65);
    float churn = 0.5 + 0.28 * (swirl / 3.0);

    // slow ominous breathing pulse
    float pulse = 0.5 + 0.5 * sin(uTime * 0.85);

    // hot crimson outer rim (baked, distinct from the purple mid-zone)
    vec3 rimCol = vec3(0.85, 0.04, 0.10) * uHdr;

    // zone blending: void core (uDim) → purple swirl (uBright) → crimson rim
    float toPurple  = smoothstep(0.06, 0.55, r);
    float toCrimson = smoothstep(0.45, 0.85, r);
    float ringEnergy = vortex * churn * smoothstep(0.90, 0.05, r);

    vec3 col = uDim;
    col = mix(col, uBright, toPurple  * (0.55 + 0.45 * ringEnergy));
    col = mix(col, rimCol,  toCrimson * (0.45 + 0.55 * pulse));
    col += uBright * smoothstep(0.28, 0.0, r) * 0.6 * uHdr; // purple core bloom

    // fill the whole opening as a dark solid portal; feather only the outer rim
    vec2 e = abs(p);
    float fill = (1.0 - smoothstep(0.76, 1.0, e.x)) * (1.0 - smoothstep(0.76, 1.0, e.y));
    float alpha = fill * (0.93 + 0.07 * pulse);

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

let delvePortalMat: THREE.ShaderMaterial | null = null;
function delvePortalMaterial(): THREE.ShaderMaterial {
  if (delvePortalMat) return delvePortalMat;
  delvePortalMat = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: sharedUniforms.uTime,
      uDim: { value: new THREE.Color(0x03000a) }, // near-void purple-black core
      uBright: { value: new THREE.Color(0x6e0a85) }, // deep purple swirl
      uHdr: { value: GFX.composer ? 2.8 : 1.0 },
    },
    vertexShader: DELVE_PORTAL_VERT,
    fragmentShader: DELVE_PORTAL_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide, // only the town-facing front glows; the dark vault sits behind it
    fog: true,
  });
  return delvePortalMat;
}

// Embers drifting up out of the delve mouth, a deterministic point cloud whose
// whole motion (rise + sideways waver + life fade) is a function of uTime, so it
// self-animates with no per-frame JS. Additive + HDR-boosted so it glows and
// blooms on composer tiers; reads as warm sparks on low too.
const DELVE_EMBER_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uRise;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aDrift;
  varying float vLife;
  void main() {
    float t = fract(uTime * aSpeed + aPhase); // 0..1 life cycle
    vLife = t;
    vec3 pos = position;
    pos.y += t * uRise;                                  // rise
    pos.x += sin((t + aPhase) * 6.2831) * aDrift;        // lazy sideways waver
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = (95.0 / max(-mv.z, 1.0)) * (0.45 + 0.55 * sin(t * 3.14159));
    gl_Position = projectionMatrix * mv;
  }
`;
const DELVE_EMBER_FRAG = /* glsl */ `
  uniform float uHdr;
  varying float vLife;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, d);
    float fade = sin(vLife * 3.14159);                   // fade in then out over life
    vec3 col = mix(vec3(1.0, 0.16, 0.09), vec3(1.0, 0.5, 0.18), vLife) * uHdr;
    gl_FragColor = vec4(col, soft * fade * 0.85);
  }
`;

function buildDelveEmbers(
  cx: number,
  baseY: number,
  cz: number,
  halfW: number,
  riseY: number,
): THREE.Points {
  const N = GFX.standardMaterials ? 48 : 28; // lighter on low
  const positions = new Float32Array(N * 3);
  const phase = new Float32Array(N);
  const speed = new Float32Array(N);
  const drift = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    positions[i * 3] = (hash2(i * 1.7, cx, 0x656d62) - 0.5) * halfW * 2;
    positions[i * 3 + 1] = hash2(i * 2.3, cz, 0x656d62) * 1.5; // start low in the mouth
    positions[i * 3 + 2] = (hash2(i * 3.1, cx + cz, 0x656d62) - 0.5) * 0.6;
    phase[i] = hash2(i * 4.5, cx, 0x656d62);
    speed[i] = 0.05 + hash2(i * 5.9, cz, 0x656d62) * 0.09;
    drift[i] = 0.3 + hash2(i * 6.7, cx, 0x656d62) * 0.7;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aDrift', new THREE.BufferAttribute(drift, 1));
  // motion happens in the shader, so bound it manually or it culls at rest
  geo.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, riseY / 2, 0),
    Math.max(halfW, riseY) + 1.5,
  );
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uRise: { value: riseY },
      uHdr: { value: GFX.composer ? 2.0 : 1.0 },
    },
    vertexShader: DELVE_EMBER_VERT,
    fragmentShader: DELVE_EMBER_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.position.set(cx, baseY, cz);
  pts.renderOrder = 4; // over the void + vault
  return pts;
}

// `delveLabel` resolves a delve id to its localized display name for the carved
// entrance sign. Passed in by renderer.ts (the only render-side i18n surface) so
// props.ts itself stays string-table-free; falls back to the id if absent.
export function buildProps(seed: number, delveLabel?: (delveId: string) => string): PropsResult {
  const group = new THREE.Group();
  const flames: THREE.Mesh[] = [];
  const fireLights: THREE.PointLight[] = [];

  const ground = (x: number, z: number) => terrainHeight(x, z, seed);

  // Camera-ghost props (see colliders.ts `camGhost`) stay individual and
  // un-merged so they can be hidden while the camera ray passes through their
  // footprint. Footprints mirror the colliders so what hides is exactly what
  // the camera passes through.
  const hideables: Hideable[] = [];
  const keepFromMerge = new Set<THREE.Object3D>();
  /**
   * Mark `g` un-mergeable and register it as hide-when-camera-crossed. Each
   * mesh's material is cloned so flipping colour/depth writes hides only this
   * structure (and leaves the shadow pass untouched).
   */
  function registerHideable(g: THREE.Group, fp: Footprint): void {
    const matMap = new Map<THREE.Material, ToggleMat>();
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      keepFromMerge.add(mesh);
      if (lowProps) return;
      const src = mesh.material as THREE.Material;
      let tm = matMap.get(src);
      if (!tm) {
        const mat = src.clone();
        tm = { mat, depthWrite: mat.depthWrite };
        matMap.set(src, tm);
      }
      mesh.material = tm.mat;
    });
    hideables.push({ group: g, mats: [...matMap.values()], hidden: false, ...fp });
  }

  // live small materials (decals / glow) — shared, never per-instance
  const usePbr = GFX.standardMaterials;
  const lowProps = !usePbr;
  const recessMat = surfaceMat({ color: 0x14100b, roughness: 1 });
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const lanternMat = surfaceMat({
    color: 0xffcc66,
    emissive: 0xff9933,
    emissiveIntensity: usePbr ? 2 : 1.2,
    roughness: 0.4,
  });

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
  function addParts(
    parent: THREE.Object3D,
    key: PropKey,
    opts: {
      x?: number;
      y?: number;
      z?: number;
      rot?: number;
      scale: Scale;
      euler?: THREE.Euler;
    },
  ): THREE.Group {
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

  function addInstance(
    key: PropKey,
    x: number,
    y: number,
    z: number,
    rot: THREE.Euler | number,
    scale: Scale,
  ): void {
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
  const houseHeight: Record<string, number> = {
    house1: 8.0,
    house2: 7.6,
    blacksmith: 6.6,
    inn: 7.6,
  };

  for (const b of PROPS.buildings) {
    const key = b.x * 13.7 + b.z * 3.1;
    const y = ground(b.x, b.z);
    // roof Y mirrors the camera collider height in colliders.ts
    const roofY = y + (b.kind === 'chapel' ? 10.8 : b.kind === 'inn' ? 7.8 : 8.0);
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
      registerHideable(g, obbFootprint(b.x, b.z, b.w / 2, b.d / 2, b.rot, roofY));
      continue;
    }
    const asset: PropKey =
      b.kind === 'inn' ? 'inn' : housePool[Math.floor(keyRand(key, 3) * 0.999 * housePool.length)];
    const a = propAsset(asset);
    const g = new THREE.Group();
    addParts(g, asset, { scale: [b.w / a.size.x, houseHeight[asset] / a.size.y, b.d / a.size.z] });
    g.position.set(b.x, y - 0.12, b.z);
    g.rotation.y = b.rot;
    group.add(shadowed(g));
    registerHideable(g, obbFootprint(b.x, b.z, b.w / 2, b.d / 2, b.rot, roofY));
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
    registerHideable(g, circleFootprint(s.x, s.z, s.r, ground(s.x, s.z) + 3.1));
  });

  // ---- wells ---------------------------------------------------------------
  for (const w of PROPS.wells) {
    const g = new THREE.Group();
    const a = propAsset('well');
    addParts(g, 'well', { scale: [2.6 / a.size.x, 3.6 / a.size.y, 2.9 / a.size.z] });
    g.position.set(w.x, ground(w.x, w.z) - 0.1, w.z);
    g.rotation.y = propRand(w.x, w.z, 1) * Math.PI;
    group.add(shadowed(g));
    registerHideable(g, circleFootprint(w.x, w.z, w.r, ground(w.x, w.z) + 3.7));
  }

  // ---- graveyards: 4 headstone shapes, leaning, instanced ------------------
  const graveKinds: PropKey[] = lowProps
    ? ['graveRound']
    : ['graveRound', 'graveCross', 'graveBevel', 'graveDecor'];
  for (const gy of PROPS.graveyards) {
    for (let i = 0; i < 6; i++) {
      const gx = gy.x + (i % 3) * 2.2,
        gz = gy.z + Math.floor(i / 3) * 2.6;
      const s = 2.0 + keyRand(gx * 3 + gz, 4) * 0.5;
      addInstance(
        graveKinds[i % graveKinds.length],
        gx,
        ground(gx, gz) - 0.06,
        gz,
        new THREE.Euler(
          (propRand(gx, gz, 1) - 0.5) * 0.2,
          i * 0.4 + (propRand(gx, gz, 2) - 0.5) * 0.5,
          (propRand(gx, gz, 3) - 0.5) * 0.22,
        ),
        s,
      );
    }
  }

  // ---- town fences: village fence module repeated along the run ------------
  for (const f of PROPS.fences) {
    const len = Math.hypot(f.x2 - f.x1, f.z2 - f.z1);
    const n = Math.max(1, Math.round(len / 2.35));
    const dirx = (f.x2 - f.x1) / len,
      dirz = (f.z2 - f.z1) / len;
    const yaw = Math.atan2(-dirz, dirx); // module length runs along local +x
    for (let i = 0; i < n; i++) {
      const x0 = f.x1 + (f.x2 - f.x1) * (i / n),
        z0 = f.z1 + (f.z2 - f.z1) * (i / n);
      const x1 = f.x1 + (f.x2 - f.x1) * ((i + 1) / n),
        z1 = f.z1 + (f.z2 - f.z1) * ((i + 1) / n);
      const g0 = ground(x0, z0),
        g1 = ground(x1, z1);
      const pitch = Math.atan2(g1 - g0, len / n);
      const mx = (x0 + x1) / 2,
        mz = (z0 + z1) / 2;
      const sy = 2.9 + (propRand(mx, mz, 1) - 0.5) * 0.5;
      addInstance('fence', mx, (g0 + g1) / 2 - 0.05, mz, new THREE.Euler(0, yaw, pitch, 'YZX'), [
        3.0,
        sy,
        3.0,
      ]);
    }
  }

  // ---- campfires: hideable bonfire base + live animated flame + light ------
  const flamePts = [
    [0, 0],
    [0.16, 0.1],
    [0.27, 0.28],
    [0.3, 0.45],
    [0.22, 0.66],
    [0.1, 0.84],
    [0.001, 0.95],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const flameGeo = new THREE.LatheGeometry(flamePts, 7);
  for (const [x, z] of PROPS.campfires) {
    const y = ground(x, z);
    const g = new THREE.Group();
    addParts(g, 'bonfire', { y: -0.05, rot: propRand(x, z, 1) * Math.PI * 2, scale: 4.3 });
    const flame = new THREE.Mesh(
      flameGeo,
      new THREE.MeshLambertMaterial({
        color: 0xffaa33,
        emissive: 0xff6600,
        emissiveIntensity: usePbr ? 2.2 : 1.4,
        transparent: true,
        opacity: 0.92,
      }),
    );
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
    group.add(shadowed(g));
    registerHideable(g, circleFootprint(x, z, 0.85, y + 1.45, 2.4));
  }

  // ---- bandit/war tents: Kenney ridge tents, opening on +z, hideable -------
  for (const t of PROPS.tents) {
    const kind: PropKey = propRand(t.x, t.z, 2) < 0.55 ? 'tentOpen' : 'tentSmall';
    const a = propAsset(kind);
    const s = (3.0 * t.scale) / Math.max(a.size.x, a.size.z);
    const y = ground(t.x, t.z);
    const g = new THREE.Group();
    addParts(g, kind, { scale: [s, s * 1.32, s] });
    g.position.set(t.x, y - 0.06, t.z);
    g.rotation.set(
      (propRand(t.x, t.z, 3) - 0.5) * 0.06,
      t.rot,
      (propRand(t.x, t.z, 4) - 0.5) * 0.06,
    );
    group.add(shadowed(g));
    registerHideable(g, circleFootprint(t.x, t.z, 1.5 * t.scale, y + 3.4 * t.scale, 3.0 * t.scale));
  }

  // ---- crates: camp clutter (wooden crate / barrel mix), hideable ----------
  PROPS.crates.forEach(([x, z], i) => {
    const kind: PropKey = i % 3 === 2 ? 'barrel' : 'crateWooden';
    const s = kind === 'barrel' ? 1.25 : 1.3 + propRand(x, z, 5) * 0.15;
    const y = ground(x, z);
    const g = new THREE.Group();
    addParts(g, kind, {
      scale: s,
      euler: new THREE.Euler((propRand(x, z, 7) - 0.5) * 0.05, ((x * 13 + z * 7) % 1) * Math.PI, 0),
    });
    g.position.set(x, y - 0.04, z);
    group.add(shadowed(g));
    registerHideable(g, circleFootprint(x, z, 0.65, y + 1.35));
  });

  // ---- murloc mud huts: giant swamp mushrooms, doorway facing camp center --
  const hutCenter = PROPS.mudHuts.reduce(
    (acc, [hx, hz]) => ({
      x: acc.x + hx / PROPS.mudHuts.length,
      z: acc.z + hz / PROPS.mudHuts.length,
    }),
    { x: 0, z: 0 },
  );
  for (const [x, z] of PROPS.mudHuts) {
    const y = ground(x, z);
    const g = new THREE.Group();
    const sxz = 13 + propRand(x, z, 15) * 3;
    const sy = 10.5 + propRand(x, z, 16) * 3;
    addParts(g, 'mushroomRed', {
      y: -0.15,
      scale: [sxz, sy, sxz],
      euler: new THREE.Euler(
        (propRand(x, z, 13) - 0.5) * 0.1,
        propRand(x, z, 12) * Math.PI * 2,
        (propRand(x, z, 14) - 0.5) * 0.1,
      ),
    });
    // doorway decal aimed at the camp heart
    const face = Math.atan2(hutCenter.x - x, hutCenter.z - z);
    const doorway = new THREE.Mesh(new THREE.CircleGeometry(0.62, 8, 0, Math.PI), recessMat);
    doorway.position.set(Math.sin(face) * 1.0, 0.04, Math.cos(face) * 1.0);
    doorway.rotation.y = face;
    doorway.rotation.x = -0.14;
    noShadow.add(doorway);
    g.add(doorway);
    if (!lowProps) {
      // toadstool cluster at the foot
      const a2 = face + 0.9 + propRand(x, z, 18);
      addParts(g, 'mushroomTan', {
        x: Math.sin(a2) * 1.7,
        y: -0.05,
        z: Math.cos(a2) * 1.7,
        rot: propRand(x, z, 19) * Math.PI * 2,
        scale: 2.6 + propRand(x, z, 20) * 1.4,
      });
    }
    g.position.set(x, y, z);
    group.add(shadowed(g));
    registerHideable(g, circleFootprint(x, z, 1.1, y + 12.5, sxz));
  }

  // ---- ruin rings: weathered monolith columns at the exact collider angles -
  for (const r of PROPS.ruinRings) {
    for (let i = 0; i < r.columns; i++) {
      const ang = (i / r.columns) * Math.PI * 2;
      const x = r.x + Math.sin(ang) * r.ringR,
        z = r.z + Math.cos(ang) * r.ringR;
      const intact = i % 4 === 1;
      const kind: PropKey = intact ? 'column' : 'columnBroken';
      const sy = intact ? 3.5 + (i % 2) * 0.5 : 1.7 + (i % 3) * 0.85;
      const y = ground(x, z);
      const g = new THREE.Group();
      addParts(g, kind, {
        scale: [3.8, sy, 3.8],
        euler: new THREE.Euler(
          0,
          propRand(x, z, 8) * Math.PI,
          (i % 3 === 0 ? 0.13 : 0.03) * (i % 2 ? 1 : -1),
        ),
      });
      g.position.set(x, y - 0.1, z);
      group.add(shadowed(g));
      registerHideable(g, circleFootprint(x, z, 0.6, y + 4.3, 2.2));
    }
    if (lowProps) continue;
    // toppled relics at the ring's heart: half-buried head + fallen column
    const fy = ground(r.x - 2, r.z - 3);
    const g = new THREE.Group();
    addParts(g, 'statueHead', {
      x: -0.4,
      y: -0.55,
      z: 0.3,
      scale: 2.3,
      euler: new THREE.Euler(0.34, propRand(r.x, r.z, 30) * Math.PI * 2, 0.22),
    });
    addParts(g, 'statueBlock', {
      x: 2.1,
      y: -0.2,
      z: -1.3,
      rot: propRand(r.x, r.z, 31) * Math.PI,
      scale: 2.1,
    });
    addParts(g, 'column', {
      x: -1.2,
      y: 0.62,
      z: -2.2,
      scale: 3.2,
      euler: new THREE.Euler(
        Math.PI / 2 - 0.06,
        0.6 + (propRand(r.x, r.z, 32) - 0.5) * 0.4,
        0,
        'YXZ',
      ),
    });
    g.position.set(r.x - 2, fy, r.z - 3);
    group.add(shadowed(g));
  }

  // ---- mine entrances: timber portal, rock mound, ore cart, lantern --------
  for (const m of PROPS.mines) {
    const g = new THREE.Group();
    const abandonedCrypt = m.x < -140 && m.z > 590 && m.z < 630;
    for (const sx of [-1.45, 1.45]) {
      addParts(g, 'timberPillar', { x: sx, scale: [3.4, 3.5, 3.4] });
    }
    // lintel + cap beam: the same square timber laid across the posts
    addParts(g, 'timberPillar', {
      y: 3.42,
      x: -2.2,
      euler: new THREE.Euler(0, 0, -Math.PI / 2),
      scale: [3.6, 4.4, 3.6],
    });
    addParts(g, 'timberPillar', {
      y: 3.85,
      x: -2.45,
      euler: new THREE.Euler(0, 0, -Math.PI / 2),
      scale: [3.0, 4.9, 3.0],
    });
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.1), holeMat);
    hole.position.set(0, 1.55, -0.2);
    noShadow.add(hole);
    g.add(hole);
    // boulder mound swallowing the portal (same mound the collider blocks):
    // pairs of mid-sized granite rocks per anchor read as a rubble pile where
    // one giant scaled rock would read as a box
    const mound: [number, number, number, number][] = abandonedCrypt
      ? [
          [0.2, 1.35, -3.2, 2.35],
          [-2.8, 0.25, -2.35, 1.75],
          [2.65, 0.3, -2.3, 1.75],
          [-1.7, 0.1, -1.25, 1.15],
          [1.75, 0.1, -1.2, 1.1],
          [0.2, 2.8, -4.15, 2.0],
          [-1.35, 1.45, -3.45, 1.55],
          [1.45, 1.5, -3.35, 1.5],
          [0, 0.15, -1.85, 1.2],
          [-3.45, 0.6, -3.5, 1.15],
          [3.35, 0.65, -3.45, 1.1],
          [0.1, 3.35, -2.85, 1.25],
        ]
      : [
          [0, 1.4, -3.0, 2.6],
          [-2.7, 0.3, -2.0, 1.9],
          [2.7, 0.35, -2.2, 2.0],
          [-1.6, 0.1, -1.0, 1.2],
          [1.8, 0.1, -0.9, 1.1],
          [0.3, 3.0, -4.2, 2.3],
          [-1.4, 1.6, -3.4, 1.8],
          [1.5, 1.7, -3.2, 1.7],
          [0, 0.2, -1.6, 1.4],
        ];
    const rockKinds: PropKey[] = lowProps
      ? ['rockLargeD']
      : ['rockTallA', 'rockLargeD', 'rockTallH', 'rockLargeF'];
    for (let i = 0; i < mound.length; i++) {
      const [rx, ry, rz, rr] = mound[i];
      const kind = rockKinds[(i * 2 + 1) % rockKinds.length];
      const a = propAsset(kind);
      addParts(g, kind, {
        x: rx,
        y: ry,
        z: rz,
        scale: (2.1 * rr) / Math.max(a.size.x, a.size.z),
        euler: new THREE.Euler(
          (propRand(m.x, m.z, i + 80) - 0.5) * 0.5,
          propRand(m.x, m.z, i + 70) * Math.PI,
          (propRand(m.x, m.z, i + 90) - 0.5) * 0.5,
        ),
      });
    }
    // ore cart (market awning stripped) + raw copper ore in the bed
    if (!abandonedCrypt) {
      addParts(g, 'cart', { x: 2.8, z: 1.6, rot: 0.5, scale: 1.9 });
      addParts(g, 'oreRocks', { x: 2.75, y: 0.78, z: 1.55, rot: 0.9, scale: 2.6 });
      addParts(g, 'oreRocks', { x: 3.4, z: 0.4, rot: 2.2, scale: 1.8 });
    }
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
    // mound circle behind the portal — same offset/radius as the collider
    const mx = m.x - 3.4 * Math.sin(m.rot),
      mz = m.z - 3.4 * Math.cos(m.rot);
    registerHideable(g, circleFootprint(mx, mz, 5, ground(mx, mz) + 5.2));
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
        z: lz,
        y: Math.min(0, ground(wx, wz) - y + 0.15),
        rot: (keyRand(key, i) - 0.5) * 0.04,
        scale: [0.78, 0.52, 0.85],
      });
    }
    const hut = propAsset('house3');
    addParts(g, 'house3', {
      x: d.hutLocal.x,
      z: d.hutLocal.z,
      scale: [(d.hutLocal.hw * 2) / hut.size.x, 2.6 / hut.size.y, (d.hutLocal.hd * 2) / hut.size.z],
    });
    if (!lowProps) {
      addParts(g, 'barrel', {
        x: 0.55,
        y: 0.52,
        z: -0.55,
        rot: keyRand(key, 5) * Math.PI,
        scale: 0.95,
      });
      addParts(g, 'barrel', { x: 1.45, z: 0.9, rot: keyRand(key, 6) * Math.PI, scale: 1.15 });
      addParts(g, 'crateWooden', { x: -0.6, y: 0.52, z: -2.2, rot: keyRand(key, 7), scale: 0.9 });
    }
    // rowboat beside the deck's far end: floats at water level when the
    // shore dips below it, otherwise sits hauled up on the bank
    const boatLx = 2.4,
      boatLz = -5.0;
    const boatWx = d.x + boatLx * Math.cos(d.rot) + boatLz * Math.sin(d.rot);
    const boatWz = d.z - boatLx * Math.sin(d.rot) + boatLz * Math.cos(d.rot);
    const boatGround = ground(boatWx, boatWz);
    const isAfloat = boatGround < WATER_LEVEL - 0.1;
    addParts(g, 'rowboat', {
      x: boatLx,
      z: boatLz,
      y: (isAfloat ? WATER_LEVEL + 0.18 : boatGround + 0.06) - y,
      rot: 0.5 + (keyRand(key, 8) - 0.5) * 0.4,
      scale: 0.85,
      euler: isAfloat
        ? undefined
        : new THREE.Euler(0.04, 0.5 + (keyRand(key, 8) - 0.5) * 0.4, 0.16),
    });
    g.position.set(d.x, y, d.z);
    g.rotation.y = d.rot;
    group.add(shadowed(g));
    // stone hut OBB — same offset/extents/rotation as the collider
    const hc = Math.cos(d.rot),
      hs = Math.sin(d.rot);
    const hx = d.x + d.hutLocal.x * hc + d.hutLocal.z * hs;
    const hz = d.z - d.hutLocal.x * hs + d.hutLocal.z * hc;
    registerHideable(
      g,
      obbFootprint(hx, hz, d.hutLocal.hw, d.hutLocal.hd, d.rot, ground(hx, hz) + 2.9),
    );
  }

  // ---- delve entrance: Meshy portal-door + animated void + carved name lintel -
  // Town/hub is +z (north) of Reliquary Hill. The portal-door model sits just
  // south of Brother Halven facing +z; it has its own stone backing slab so the
  // animated shader plane (FrontSide) reads as a solid void from the approach and
  // is invisible from behind. The carved name slab rides the model's crown.
  // All render-only, players enter by talking to Halven; leaveDelve drops them
  // back at archZ (doorPos.z - 4).
  const delvePortals: THREE.Mesh[] = [];
  for (const dm of PROPS.delveMarkers ?? []) {
    if (!loadedProps.has('delveEntrance2')) continue;
    const gy = ground(dm.x, dm.z);

    // Portal-door model with its own backing slab, no separate vault sphere needed.
    // Rotation 0 = portal face toward +z (town); add yaw: Math.PI to the asset def
    // if the model loads backwards after inspecting in-game.
    const arch = propAsset('delveEntrance2');
    const SX = 3.6,
      SY = 3.6,
      SZ = 3.6;
    const archZ = dm.z - 4; // south of Halven (also the leaveDelve drop: doorPos.z - 4)
    const ag = new THREE.Group();
    for (const part of arch.parts) {
      const m = new THREE.Mesh(part.geo, part.mat);
      m.castShadow = true;
      m.receiveShadow = true;
      ag.add(m);
    }
    ag.scale.set(SX, SY, SZ);
    ag.position.set(dm.x, gy, archZ);
    group.add(ag);

    // portal opening: doorway is roughly half the model's width and a bit over
    // half its height; the animated shader plane sits on the town-facing front face.
    // Tune these fractions after seeing the model in-game.
    const openW = arch.size.x * SX * 0.5;
    const openH = arch.size.y * SY * 0.55;
    const openCY = gy + arch.size.y * SY * 0.32; // centre of the doorway opening
    const townFaceZ = archZ + (arch.size.z * SZ) / 2; // model's +z front face

    // opaque dark backsplash filling the doorway behind the void plane, so no
    // red leaks through from the rear and you can't see daylight through the
    // opening, the portal reads as a solid one-way threshold. Slightly larger
    // than the opening to cover the gap, recessed a touch into the model.
    const backsplash = new THREE.Mesh(
      new THREE.PlaneGeometry(openW * 1.1, openH * 1.1),
      new THREE.MeshBasicMaterial({ color: 0x05030a, side: THREE.DoubleSide }),
    );
    backsplash.position.set(dm.x, openCY, townFaceZ - 0.35);
    group.add(backsplash);

    // swirling void plane, FrontSide, drawn over the dark backsplash so the
    // animated vortex reads against true black from the town approach.
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(openW, openH), delvePortalMaterial());
    portal.position.set(dm.x, openCY, townFaceZ - 0.05);
    portal.renderOrder = 3;
    group.add(portal);
    delvePortals.push(portal);

    // deep purple glow spilling from the mouth, matches the new portal palette.
    const mouthLight = new THREE.PointLight(0x7010b0, 8, 18, 2);
    mouthLight.position.set(dm.x, gy + 2.4, townFaceZ + 0.4);
    mouthLight.userData.baseIntensity = 8;
    group.add(mouthLight);
    fireLights.push(mouthLight);

    // embers drifting up out of the mouth (self-animating; not a mesh, so the
    // static merge skips it automatically)
    group.add(buildDelveEmbers(dm.x, gy + 1.0, townFaceZ + 0.2, openW * 0.34, openH * 0.85));

    // two flaming braziers flanking the mouth, a tended-entrance read. Reuse
    // the campfire flame + fire-light pattern so the renderer flickers them and
    // sheds embers for free; the warm torch orange plays off the red void.
    const postMat = surfaceMat({ color: 0x2a2622, roughness: 1 });
    const bowlMat = surfaceMat({ color: 0x191512, roughness: 1 });
    for (const side of [-1, 1]) {
      const bx = dm.x + side * (openW * 0.5 + 0.7);
      const bz = townFaceZ + 0.5; // just in front of the mouth, on the town side
      const by = ground(bx, bz);
      const bg = new THREE.Group();
      const postH = 2.0;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.33, postH, 8), postMat);
      post.position.y = postH / 2;
      bg.add(post);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.26, 0.38, 10), bowlMat);
      bowl.position.y = postH + 0.1;
      bg.add(bowl);
      const flame = new THREE.Mesh(
        flameGeo,
        new THREE.MeshLambertMaterial({
          color: 0xffaa33,
          emissive: 0xff6a1e,
          emissiveIntensity: usePbr ? 2.2 : 1.4,
          transparent: true,
          opacity: 0.92,
        }),
      );
      flame.position.y = postH + 0.28;
      flame.scale.setScalar(0.72);
      bg.add(flame);
      flames.push(flame);
      noShadow.add(flame);
      const light = new THREE.PointLight(0xff8a3a, 9, 13, 2);
      light.position.y = postH + 0.55;
      light.userData.baseIntensity = 8;
      bg.add(light);
      fireLights.push(light);
      bg.position.set(bx, by, bz);
      group.add(shadowed(bg));
    }

    // (ruin-column dressing removed, the portal-door model has its own pillars,
    // so flanking rubble columns just cluttered and overpowered the silhouette.
    // Mossy boulders flanking the approach feet keep it grounded without competing.)
    const rubble: { kind: PropKey; dx: number; dz: number; s: Scale; rot?: number }[] = [
      { kind: 'rockLargeD', dx: -8.5, dz: -1.8, s: 1.7, rot: 2.1 },
      { kind: 'rockLargeD', dx: 8.0, dz: 2.2, s: 1.45, rot: 0.7 },
    ];
    for (const rb of rubble) {
      const rx = dm.x + rb.dx,
        rz = archZ + rb.dz;
      const rgrp = new THREE.Group();
      addParts(rgrp, rb.kind, { scale: rb.s, rot: rb.rot });
      rgrp.position.set(rx, ground(rx, rz) - 0.08, rz);
      group.add(shadowed(rgrp));
    }

    // ---- carved name slab as the arch's town-facing lintel-sign ------------
    const slabY = gy + arch.size.y * SY * 0.8; // mounted on the crown, above the mouth
    const slabZ = townFaceZ + 0.1; // proud of the town face so it never z-fights the arch

    // stone backing box
    const backMat = surfaceMat({ color: 0x3a3530 });
    const backing = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.9, 0.18), backMat);
    backing.position.set(dm.x, slabY, slabZ);
    backing.castShadow = true;
    group.add(backing);

    // grimy canvas inscription on the town-facing (+z) surface
    const CW = 512,
      CH = 96;
    const cv = document.createElement('canvas');
    cv.width = CW;
    cv.height = CH;
    const ctx = cv.getContext('2d')!;

    ctx.fillStyle = '#2b2722';
    ctx.fillRect(0, 0, CW, CH);
    ctx.strokeStyle = '#16120e';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, CW - 12, CH - 12);

    // horizontal grime streaks (deterministic)
    for (let i = 0; i < 10; i++) {
      const gx = hash2(dm.x + i * 1.3, dm.z, 0x6d61726b) * CW;
      const gy2 = hash2(dm.z + i * 1.7, dm.x, 0x6d61726b) * CH;
      const gw = 20 + hash2(i * 3.1, dm.x + dm.z, 0x6d61726b) * 55;
      ctx.fillStyle = `rgba(6,4,2,${0.22 + hash2(i * 5.9, dm.z, 0x6d61726b) * 0.32})`;
      ctx.fillRect(gx - gw / 2, gy2 - 1.8, gw, 3.6);
    }

    // carved text, shadow pass then bright pass for depth illusion. Shrink the
    // font until the (localized) name fits inside the slab border so a long title
    // like "THE COLLAPSED RELIQUARY" is never clipped at the canvas edges.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = (delveLabel ? delveLabel(dm.delveId) : dm.delveId).toUpperCase();
    const maxTextW = CW - 44; // inside the 6px stroke + breathing room
    // Step down until it fits (kerning/hinting make a single proportional guess
    // unreliable for wide-glyph locales, e.g. CJK names), with a 16px floor.
    let fontPx = 34;
    ctx.font = `bold ${fontPx}px Georgia, "Times New Roman", serif`;
    while (fontPx > 16 && ctx.measureText(label).width > maxTextW) {
      fontPx -= 1;
      ctx.font = `bold ${fontPx}px Georgia, "Times New Roman", serif`;
    }
    ctx.fillStyle = '#120f0b';
    ctx.fillText(label, CW / 2 + 2, CH / 2 + 2);
    ctx.fillStyle = '#7d6e59';
    ctx.fillText(label, CW / 2, CH / 2);

    const tex = new THREE.CanvasTexture(cv);
    const faceMat = new THREE.MeshBasicMaterial({ map: tex });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.78), faceMat);
    // sit flush on the town-facing face of the backing (PlaneGeometry faces +z)
    face.position.set(dm.x, slabY, slabZ + 0.1);
    group.add(face);
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

  // animated flames + camera-ghost props (hidden individually) stay un-merged
  const keep = new Set<THREE.Object3D>(flames);
  for (const m of keepFromMerge) keep.add(m);
  for (const p of delvePortals) keep.add(p); // shader-driven void: keep its transparency/renderOrder
  const staticMeshes = mergeStaticMeshes(group, keep);
  for (const sm of staticMeshes) {
    const bounds = cullableBounds(sm, sm.geometry.boundingBox, sm.geometry.boundingSphere);
    if (bounds) cullables.push(bounds);
  }

  return {
    group,
    flames,
    fireLights,
    update(
      camX: number,
      camY: number,
      camZ: number,
      eyeX: number,
      eyeY: number,
      eyeZ: number,
      fogFar: number,
    ): void {
      for (const c of cullables) {
        c.obj.visible = cullableVisible(c, camX, camZ, fogFar);
      }
      for (const h of hideables) {
        const dx = camX - h.x,
          dz = camZ - h.z;
        if (Math.hypot(dx, dz) - h.cull >= fogFar) {
          h.group.visible = false; // fully fogged: drop it (shadow is out of range too)
          continue;
        }
        // Hide from the camera while still casting a shadow: disable colour +
        // depth writes, not the object.
        const hide = cameraSegmentHitsFootprint(h, eyeX, eyeY, eyeZ, camX, camY, camZ);
        if (h.mats.length === 0) {
          h.hidden = hide;
          h.group.visible = !hide;
          continue;
        }
        h.group.visible = true;
        if (hide !== h.hidden) {
          h.hidden = hide;
          for (const m of h.mats) {
            m.mat.colorWrite = !hide;
            m.mat.depthWrite = hide ? false : m.depthWrite;
          }
        }
      }
    },
  };
}

/** One material we flip on/off, remembering its original depth-write state. */
interface ToggleMat {
  mat: THREE.Material;
  depthWrite: boolean;
}

// A prop that the camera ghosts through and the renderer hides whenever the
// eye-to-camera segment crosses its footprint (below `topY`). Either a circle
// (`r`) or an OBB (`hw`/`hd`/`rot`), matching the collider it mirrors. "Hidden"
// disables colour/depth writes rather than `visible = false`, so the structure
// stays in the shadow pass and keeps casting its shadow.
interface Hideable {
  group: THREE.Group;
  mats: ToggleMat[]; // cloned per-structure so the toggle is local
  hidden: boolean;
  x: number; // footprint centre (world XZ)
  z: number;
  topY: number; // roof height; a camera above this never hides the structure
  cull: number; // bounding radius for the fog-far cull
  r?: number; // circle footprint
  hw?: number; // OBB half-extents + yaw
  hd?: number;
  rot?: number;
}

type Footprint = Omit<Hideable, 'group' | 'mats' | 'hidden'>;

function circleFootprint(x: number, z: number, r: number, topY: number, cull = r): Footprint {
  return { x, z, r, topY, cull };
}

function obbFootprint(
  x: number,
  z: number,
  hw: number,
  hd: number,
  rot: number,
  topY: number,
): Footprint {
  return { x, z, hw, hd, rot, topY, cull: Math.hypot(hw, hd) };
}

function pointInsideFootprint(h: Hideable, x: number, z: number): boolean {
  const dx = x - h.x,
    dz = z - h.z;
  if (h.r !== undefined) return dx * dx + dz * dz < h.r * h.r;
  // world -> OBB local (three.js rotation.y convention), mirrors colliders.rotY
  const c = Math.cos(h.rot!),
    s = Math.sin(h.rot!);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) < h.hw! && Math.abs(lz) < h.hd!;
}

function segmentCircleEntry(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  r: number,
): number {
  const dx = bx - ax,
    dz = bz - az;
  const a = dx * dx + dz * dz;
  if (a < 1e-12) return Infinity;
  const fx = ax - cx,
    fz = az - cz;
  const c = fx * fx + fz * fz - r * r;
  if (c < 0) return 0;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  return (-b - Math.sqrt(disc)) / (2 * a);
}

function segmentObbEntry(h: Hideable, ax: number, az: number, bx: number, bz: number): number {
  const c = Math.cos(h.rot!),
    s = Math.sin(h.rot!);
  const adx = ax - h.x,
    adz = az - h.z;
  const bdx = bx - h.x,
    bdz = bz - h.z;
  const lax = adx * c - adz * s;
  const laz = adx * s + adz * c;
  const lbx = bdx * c - bdz * s;
  const lbz = bdx * s + bdz * c;
  if (Math.abs(lax) < h.hw! && Math.abs(laz) < h.hd!) return 0;

  const dx = lbx - lax,
    dz = lbz - laz;
  let tmin = -Infinity,
    tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (lax < -h.hw! || lax > h.hw!) return Infinity;
  } else {
    let t1 = (-h.hw! - lax) / dx,
      t2 = (h.hw! - lax) / dx;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (Math.abs(dz) < 1e-9) {
    if (laz < -h.hd! || laz > h.hd!) return Infinity;
  } else {
    let t1 = (-h.hd! - laz) / dz,
      t2 = (h.hd! - laz) / dz;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (tmax < tmin || tmax < 0) return Infinity;
  return tmin;
}

function cameraSegmentHitsFootprint(
  h: Hideable,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
): boolean {
  if (
    (eyeY < h.topY && pointInsideFootprint(h, eyeX, eyeZ)) ||
    (camY < h.topY && pointInsideFootprint(h, camX, camZ))
  ) {
    return true;
  }
  const t =
    h.r !== undefined
      ? segmentCircleEntry(eyeX, eyeZ, camX, camZ, h.x, h.z, h.r)
      : segmentObbEntry(h, eyeX, eyeZ, camX, camZ);
  if (t < 0 || t > 1) return false;
  return eyeY + (camY - eyeY) * t < h.topY;
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
  interface Bucket {
    material: THREE.Material;
    castShadow: boolean;
    geoms: THREE.BufferGeometry[];
  }
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
