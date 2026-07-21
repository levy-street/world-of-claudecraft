// Dungeon interiors rebuilt from the KayKit Dungeon Remastered modular kit
// (+ Halloween Bits for crypt dressing). Structure comes from the plain-data
// layouts in src/sim/dungeon_layout.ts — the SAME data colliders.ts derives
// CRYPT_COLLIDERS/SANCTUM_COLLIDERS from, so visuals and collision cannot
// drift. Repeated modules render as one InstancedMesh per kind (~30 draws
// per interior instance).
//
// Three looks from two layouts:
//   Hollow Crypt   (interior 'crypt',  origin x 900 band)  - blue flame, coffins/graves/bones
//   Sunken Bastion (interior 'crypt',  origin x 1500 band) - teal flame, cargo/banners fortress
//   Gravewyrm Sanctum (interior 'sanctum')                 - green ritual fire, necromantic
//   Drowned Temple (interior 'temple')                     - pale moon-violet, drowned reliquaries
//   Abandoned Crypt raid (interior 'nythraxis')            - dark violet soul wards
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { instanceOrigin } from '../sim/data';
import type { DelveModuleId } from '../sim/delve_layout';
import { isLitanyModuleId, polygonWallSegments } from '../sim/delve_litany_layout';
import {
  ARENA_LAYOUT,
  CRYPT_LAYOUT,
  DUNGEON_END_WALL_HW,
  DUNGEON_WALL_HEIGHT,
  DUNGEON_WALL_HW,
  DUNGEON_WALL_X,
  type DungeonLayout,
  type GridPoint,
  NYTHRAXIS_LAYOUT,
  SANCTUM_LAYOUT,
  TEMPLE_LAYOUT,
  TOMB_HD,
  type WallStub,
} from '../sim/dungeon_layout';
import { polygonContainsPoint, polygonXAtZ } from '../sim/geometry2d';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import {
  placeLitanyMarshDressing,
  placeMarshBlackwaterPools,
  placeMarshClutter,
  placeMarshDryIslands,
  placeMarshTombs,
  placeMarshWallDressing,
} from './delve_marsh_dressing';
import { sharedUniforms } from './gfx';
import { radialGlowTexture } from './textures';

const FLAME_EMISSIVE_HIGH = 2.2;
// dungeon torch point lights: pumped + hung low so warm pools break up the
// floor (the daylight rig is dropped underground; torches carry the scene)
const DUNGEON_LIGHT_Y = 6.4;
const DUNGEON_LIGHT_INTENSITY = 46;
const DUNGEON_LIGHT_DISTANCE = 34;

const MODULE_SCALE = 2; // KayKit walls are 4u tall/long -> 8u at our room scale
const FLOOR_CELL = 4; // kit floor tiles are 4x4 at MODULE_SCALE 1
const FLOOR_Y = -0.05; // tile tops sit 0.05 above origin; sink so tops land at y=0
const PILLAR_XZ_SCALE = 1.3; // 1.5u kit pillar -> ~1.95u footprint (collider r=1)

export type DungeonInteriorVariant =
  | 'crypt'
  | 'bastion'
  | 'sanctum'
  | 'temple'
  | 'arena'
  | 'nythraxis'
  // Collapsed Reliquary delve sub-themes (share the ember crypt-stone base, see
  // isDelveVariant; differ only in wall-side props, clutter, and the dais).
  | 'delve_ossuary'
  | 'delve_bell'
  | 'delve_hall'
  | 'delve_finale'
  // Drowned Litany marsh delve sub-themes (share the delve crypt-stone base via
  // isDelveVariant, but light with a sickly bog-green torch tint; the trash
  // rooms route through the ossuary dressing path, the apse through the finale).
  | 'delve_marsh'
  | 'delve_marsh_apse';

/** True for any delve module variant (Collapsed Reliquary or Drowned Litany). */
export function isDelveVariant(variant: DungeonInteriorVariant): boolean {
  return (
    variant === 'delve_ossuary' ||
    variant === 'delve_bell' ||
    variant === 'delve_hall' ||
    variant === 'delve_finale' ||
    variant === 'delve_marsh' ||
    variant === 'delve_marsh_apse'
  );
}
type Variant = DungeonInteriorVariant;

export function dungeonDaisHasRaisedPlatform(variant: DungeonInteriorVariant): boolean {
  // Flat fighting floors: the arena, the Nythraxis raid, and the delve trash
  // rooms (their "dais" marker is only the exit threshold). The delve finale
  // keeps a raised boss stage for Deacon Varric.
  if (variant === 'arena' || variant === 'nythraxis') return false;
  if (variant === 'delve_ossuary' || variant === 'delve_bell' || variant === 'delve_hall')
    return false;
  // marsh trash rooms are flat fighting floors like the other delve trash; the
  // marsh apse keeps a raised boss stage like delve_finale.
  if (variant === 'delve_marsh') return false;
  return true;
}

interface TorchColors {
  flame: number;
  emissive: number;
  light: number;
}

const TORCH_COLORS: Record<Variant, TorchColors> = {
  crypt: { flame: 0x7fd4ff, emissive: 0x2288cc, light: 0x66bbff },
  bastion: { flame: 0x7ffbe0, emissive: 0x18b89a, light: 0x4fe3c0 },
  sanctum: { flame: 0xa6ffb8, emissive: 0x22cc55, light: 0x55e08a },
  // the Drowned Temple burns with cold moonfire — pale lilac over still water
  temple: { flame: 0xd9c9ff, emissive: 0x6a4fd0, light: 0xb79cff },
  // the Ashen Coliseum burns warm — amber braziers ringing the fighting sands
  arena: { flame: 0xffb24a, emissive: 0xcc5a14, light: 0xff9a3c },
  nythraxis: { flame: 0x8f5cff, emissive: 0x4b1c9a, light: 0x7b4dff },
  // delve reliquaries burn with grave-ember red: warm coals over cold stone
  delve_ossuary: { flame: 0xff7a3c, emissive: 0xcc3a14, light: 0xff6a3c },
  delve_bell: { flame: 0xff7a3c, emissive: 0xcc3a14, light: 0xff6a3c },
  delve_hall: { flame: 0xff7a3c, emissive: 0xcc3a14, light: 0xff6a3c },
  // the bell-buried boss chamber burns hotter: brighter ember over the arena
  delve_finale: { flame: 0xffa24a, emissive: 0xe04a18, light: 0xff7a3c },
  // the Drowned Litany burns with sickly bog-light: cold green marsh-gas flames
  // over wet stone, clearly distinct from the reliquary ember-orange.
  delve_marsh: { flame: 0x6abf6a, emissive: 0x2f6f2f, light: 0x6aff8c },
  // the drowned apse burns brighter and colder: a cyan corpse-glow over the stage
  delve_marsh_apse: { flame: 0x7fe6c0, emissive: 0x2f8f6f, light: 0x6affb0 },
};

// The Drowned Litany reuses the same KayKit crypt-stone wall/floor/pillar kit as
// every other interior, so without a tint it would just read as a recolored
// crypt. These multiply the shared pack material toward wet mossy stone (walls,
// pillars) and dark peat/mud (floors) for delve_marsh / delve_marsh_apse only;
// tuned pale enough that the bog-green torchlight (TORCH_COLORS.delve_marsh*)
// still reads clearly against them. See marshMaterial() for how the tint is
// applied to a clone of the shared pack material, never the source itself.
const MARSH_WALL_TINT = 0x5a6a52;
const MARSH_FLOOR_TINT = 0x3c3830;

// The Drowned Temple is flooded — a translucent, self-animating water sheet
// (driven by the shared uTime so it needs no per-frame plumbing) with cheap
// layered-sine caustics, a fresnel sheen and bioluminescent glow in the
// ripples. Nothing else in the game floods its floor, which is the point.
const TEMPLE_WATER_VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vWPos;
  #include <fog_pars_vertex>
  void main() {
    vec3 pos = position;
    pos.y += sin(uTime * 1.3 + pos.x * 0.5) * 0.02 + sin(uTime * 0.9 + pos.z * 0.42) * 0.02;
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWPos = wp.xyz;
    // Name this mvPosition: the fog_vertex chunk reads mvPosition for vFogDepth,
    // so a different name fails to compile once USE_FOG is defined (outdoor fog).
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const TEMPLE_WATER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uGlow;
  varying vec3 vWPos;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec3 V = normalize(cameraPosition - vWPos);
    float fres = 0.12 + 0.88 * pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
    // layered-sine caustic web (three octaves so the veins read from any angle)
    vec2 p = vWPos.xz;
    float c = sin(p.x * 0.8 + uTime * 1.1) * sin(p.y * 0.75 - uTime * 0.95)
            + 0.6 * sin((p.x - p.y) * 0.55 + uTime * 0.8)
            + 0.4 * sin((p.x + p.y) * 1.3 - uTime * 1.4);
    float caust = smoothstep(0.5, 1.5, c * 0.5 + 0.7);
    // slow deep/shallow banding so the sheet never reads as a flat slab
    vec3 col = mix(uDeep, uShallow, 0.45 + 0.45 * sin(p.x * 0.18 + p.y * 0.12 + uTime * 0.3));
    col += uGlow * caust;                            // bright bioluminescent veins
    col = mix(col, uShallow * 1.35, fres * 0.55);    // glassy fresnel sheen at grazing
    float alpha = clamp(0.72 + caust * 0.22, 0.0, 0.97);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// ---------------------------------------------------------------------------
// Module assets: loaded once at import, geometry merged per model, one shared
// atlas material per source pack ('kit' = Dungeon Remastered, 'bits' =
// Halloween Bits). main.ts awaits assetsReady() before the Renderer builds,
// so buildInterior can assume everything below is resolved.
// ---------------------------------------------------------------------------

const KIT_MODELS = [
  'floor_tile_large',
  'floor_tile_large_rocks',
  'floor_dirt_large',
  'floor_dirt_large_rocky',
  'floor_tile_small',
  'floor_tile_small_broken_A',
  'floor_tile_small_broken_B',
  'floor_tile_small_weeds_A',
  'floor_tile_small_weeds_B',
  'floor_tile_small_decorated',
  'floor_tile_grate',
  'floor_foundation_allsides',
  'wall',
  'wall_cracked',
  'wall_pillar',
  'wall_arched',
  'wall_archedwindow_gated',
  'wall_gated',
  'pillar',
  'pillar_decorated',
  'torch_mounted',
  'banner_white',
  'banner_thin_white',
  'banner_blue',
  'banner_shield_blue',
  'banner_triple_blue',
  'banner_green',
  'banner_patternC_green',
  'banner_triple_green',
  'chest',
  'chest_gold',
  'coin_stack_medium',
  'barrel_large',
  'barrel_small_stack',
  'keg',
  'crates_stacked',
  'box_stacked',
  'box_small',
  'table_long_broken',
  'sword_shield',
  'sword_shield_broken',
  'rubble_half',
  'candle_lit',
  'candle_triple',
  'trunk_large_A',
] as const;

const BITS_MODELS = [
  'coffin',
  'coffin_decorated',
  'grave_B',
  'gravestone',
  'gravemarker_A',
  'ribcage',
  'bone_A',
  'bone_B',
  'skull',
  'skull_candle',
  'shrine',
  'shrine_candles',
  'plaque_candles',
  'arch',
] as const;

type Pack = 'kit' | 'bits';

interface ModuleAsset {
  geo: THREE.BufferGeometry;
  pack: Pack;
}

const moduleAssets = new Map<string, ModuleAsset>();
const packSourceMaterial = new Map<Pack, THREE.MeshStandardMaterial>();
let dungeonAssetsPromise: Promise<void> | null = null;

// Meshopt-quantized attributes are normalized ints; bake them to plain floats
// so applyMatrix4/merge cannot clamp world-space values into the [-1,1] range.
function attributeToFloat(geo: THREE.BufferGeometry, name: string): void {
  const attr = geo.getAttribute(name);
  if (!attr || (attr.array instanceof Float32Array && !attr.normalized)) return;
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
  }
  geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
}

function extractModule(name: string, pack: Pack, gltf: GLTF): void {
  const geos: THREE.BufferGeometry[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = (mesh.geometry as THREE.BufferGeometry).clone();
    for (const attr of Object.keys(geo.attributes)) {
      if (attr !== 'position' && attr !== 'normal' && attr !== 'uv') geo.deleteAttribute(attr);
    }
    attributeToFloat(geo, 'position');
    attributeToFloat(geo, 'normal');
    attributeToFloat(geo, 'uv');
    geo.applyMatrix4(mesh.matrixWorld);
    geos.push(geo);
    if (!packSourceMaterial.has(pack)) {
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        packSourceMaterial.set(pack, mat as THREE.MeshStandardMaterial);
      }
    }
  });
  if (!geos.length) throw new Error(`dungeon module has no meshes: ${name}`);
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (!merged) throw new Error(`dungeon module merge failed: ${name}`);
  moduleAssets.set(name, { geo: merged, pack });
}

function loadModuleAsset(name: string, pack: Pack): Promise<void> {
  const url = `models/dungeon/${name}.glb`;
  return loadGltf(url).then((g) => {
    extractModule(name, pack, g);
    releaseGltf(url);
  });
}

export function ensureDungeonAssets(): Promise<void> {
  dungeonAssetsPromise ??= Promise.all([
    ...KIT_MODELS.map((name) => loadModuleAsset(name, 'kit')),
    ...BITS_MODELS.map((name) => loadModuleAsset(name, 'bits')),
  ]).then(() => undefined);
  return dungeonAssetsPromise;
}

// Kit-pack modules loaded on demand by scenes outside the dungeon interiors
// (the jail). They land in the same moduleAssets/material registry, so
// buildDungeonPropMesh serves them once resolved.
const extraModulePromises = new Map<string, Promise<void>>();

export function loadKitModules(names: readonly string[]): Promise<void> {
  return Promise.all(
    names.map((name) => {
      let task = extraModulePromises.get(name);
      if (!task) {
        task = loadModuleAsset(name, 'kit');
        extraModulePromises.set(name, task);
      }
      return task;
    }),
  ).then(() => undefined);
}

// Fold the dungeon GLBs into the boot preload (like terrain/foliage/props/sky)
// instead of fetching them lazily on first dungeon approach. Without this the
// kit + Halloween-bits modules stream in (and their shaders compile) the moment
// the camera nears a dungeon door, which is the on-approach freeze at the Fallen
// Chapel. assetsReady() now genuinely covers everything buildInterior needs.
if (typeof window !== 'undefined') registerPreload(ensureDungeonAssets());

// ---------------------------------------------------------------------------
// Deterministic placement helpers
// ---------------------------------------------------------------------------

// stable per-position hash (same trick as the prop jitter elsewhere)
function hash2(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

type WeightedKinds = [name: string, weight: number][];

function pickKind(kinds: WeightedKinds, t: number): string {
  let total = 0;
  for (const [, w] of kinds) total += w;
  let acc = 0;
  for (const [name, w] of kinds) {
    acc += w;
    if (t * total < acc) return name;
  }
  return kinds[kinds.length - 1][0];
}

/** Accumulates instance transforms per module kind, then emits InstancedMeshes. */
class Placements {
  readonly byKind = new Map<string, THREE.Matrix4[]>();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scl = new THREE.Vector3();
  private readonly euler = new THREE.Euler();

  add(
    kind: string,
    x: number,
    y: number,
    z: number,
    rotY = 0,
    scale: number | [number, number, number] = 1,
  ): void {
    const m = new THREE.Matrix4();
    this.pos.set(x, y, z);
    this.quat.setFromEuler(this.euler.set(0, rotY, 0));
    if (typeof scale === 'number') this.scl.set(scale, scale, scale);
    else this.scl.set(scale[0], scale[1], scale[2]);
    m.compose(this.pos, this.quat, this.scl);
    const list = this.byKind.get(kind);
    if (list) list.push(m);
    else this.byKind.set(kind, [m]);
  }
}

interface ToggleMat {
  mat: THREE.Material;
  depthWrite: boolean;
}

interface ArenaWallFootprint {
  x: number;
  z: number;
  hw: number;
  hd: number;
  topY: number;
}

interface PendingArenaWall {
  placements: Placements;
  footprint: ArenaWallFootprint;
}

interface PendingArenaWalls {
  left: PendingArenaWall;
  right: PendingArenaWall;
  front: PendingArenaWall;
  back: PendingArenaWall;
  all: PendingArenaWall[];
}

interface ArenaHideable {
  group: THREE.Group;
  mats: ToggleMat[];
  hidden: boolean;
  footprint: ArenaWallFootprint;
}

// kinds that throw shadows from the outdoor sun shaft (point lights don't
// cast); floors + dais receive
const CASTER_KINDS = new Set([
  'pillar',
  'pillar_decorated',
  'coffin',
  'coffin_decorated',
  'crates_stacked',
  'box_stacked',
  'barrel_large',
  'keg',
  'chest',
  'chest_gold',
  'shrine',
  'shrine_candles',
  'grave_B',
  'gravestone',
  'table_long_broken',
  'trunk_large_A',
  'arch',
  'barrel_small_stack',
]);
const ARENA_WALL_CASTER_KINDS = new Set([
  'wall',
  'wall_cracked',
  'wall_pillar',
  'wall_arched',
  'wall_archedwindow_gated',
  'wall_gated',
]);
const RECEIVER_KINDS = new Set([
  'floor_tile_large',
  'floor_tile_large_rocks',
  'floor_dirt_large',
  'floor_dirt_large_rocky',
  'floor_tile_small',
  'floor_tile_small_broken_A',
  'floor_tile_small_broken_B',
  'floor_tile_small_weeds_A',
  'floor_tile_small_weeds_B',
  'floor_tile_small_decorated',
  'floor_tile_grate',
  'floor_foundation_allsides',
]);
// Wall + pillar kinds only, for the delve_marsh wet-stone tint (marshMaterial):
// excludes banners/torches/props so the tint stays scoped to structural stone.
const WALL_PILLAR_KINDS = new Set([...ARENA_WALL_CASTER_KINDS, 'pillar', 'pillar_decorated']);

// ---------------------------------------------------------------------------

/**
 * Build a single non-instanced mesh for one loaded dungeon-kit prop (e.g.
 * 'chest_gold', 'grave_B'). Lets a per-entity render path (delve interactables)
 * use the real KayKit GLB instead of procedural geometry. Returns null if the
 * kit has not finished loading yet, so callers fall back to procedural. Geometry
 * and material are shared with the instanced path (cheap clone-free reuse).
 */
export function buildDungeonPropMesh(kind: string): THREE.Mesh | null {
  const asset = moduleAssets.get(kind);
  if (!asset) return null;
  const mat = packSourceMaterial.get(asset.pack);
  if (!mat) return null;
  const mesh = new THREE.Mesh(asset.geo, mat);
  // asset.geo and mat are the module-level shared kit resources that also back
  // every instanced dungeon-prop draw. The per-entity object path (a delve chest)
  // sets objectPoolKey=null, so removeView would otherwise traverse-and-dispose
  // this geometry when the chest leaves interest range, freeing the GPU buffer
  // out from under the instanced renderer. Flag them shared (the same
  // userData.sharedRendererResource marker the renderer's isShared* checks read)
  // so removeView skips them.
  mesh.geometry.userData.sharedRendererResource = true;
  mat.userData.sharedRendererResource = true;
  mesh.castShadow = CASTER_KINDS.has(kind);
  mesh.receiveShadow = RECEIVER_KINDS.has(kind);
  return mesh;
}

// kept for legacy callers: tile a geometry's 0..1 UVs for shared textures
export function scaleUv(geo: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

function pointInsideArenaWall(f: ArenaWallFootprint, x: number, z: number): boolean {
  return Math.abs(x - f.x) < f.hw && Math.abs(z - f.z) < f.hd;
}

function segmentArenaWallEntry(
  f: ArenaWallFootprint,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  if (pointInsideArenaWall(f, ax, az)) return 0;
  const lax = ax - f.x;
  const laz = az - f.z;
  const lbx = bx - f.x;
  const lbz = bz - f.z;
  const dx = lbx - lax;
  const dz = lbz - laz;
  let tmin = -Infinity;
  let tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (lax < -f.hw || lax > f.hw) return Infinity;
  } else {
    let t1 = (-f.hw - lax) / dx;
    let t2 = (f.hw - lax) / dx;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (Math.abs(dz) < 1e-9) {
    if (laz < -f.hd || laz > f.hd) return Infinity;
  } else {
    let t1 = (-f.hd - laz) / dz;
    let t2 = (f.hd - laz) / dz;
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

function arenaWallSegmentHits(
  f: ArenaWallFootprint,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
): boolean {
  if (
    (eyeY < f.topY && pointInsideArenaWall(f, eyeX, eyeZ)) ||
    (camY < f.topY && pointInsideArenaWall(f, camX, camZ))
  ) {
    return true;
  }
  const t = segmentArenaWallEntry(f, eyeX, eyeZ, camX, camZ);
  if (t < 0 || t > 1) return false;
  return eyeY + (camY - eyeY) * t < f.topY;
}

export class DungeonInteriors {
  private glowDecalGeo: THREE.BufferGeometry | null = null;
  private glowDecalTex: THREE.Texture | null = null;
  private glowDecalMats = new Map<number, THREE.MeshBasicMaterial>();
  private flameGeo: THREE.BufferGeometry | null = null;
  private packMats = new Map<Pack, THREE.Material>();
  // delve_marsh / delve_marsh_apse wall+pillar and floor tints: clones of
  // packMats keyed by pack, built once and reused for every marsh room this
  // instance draws (see marshMaterial). Never touched by any other variant.
  private marshWallMats = new Map<Pack, THREE.Material>();
  private marshFloorMats = new Map<Pack, THREE.Material>();
  private waterMat: THREE.ShaderMaterial | null = null;
  private arenaHideables: ArenaHideable[] = [];

  constructor(
    private scene: THREE.Scene,
    private lowGfx: boolean,
    private flames: THREE.Mesh[],
    private fireLights: THREE.PointLight[],
  ) {}

  // Instantiate every distinct interior material once so the startup prewarm's
  // compile step links their shader programs up front. Without this the kit /
  // Halloween-bits pack materials, the Drowned Temple water shader and the
  // additive torch-glow decal all compile on first dungeon entry (a freeze).
  // It builds the materials on THIS instance, so the live buildInterior() reuses
  // the already-linked programs (Three dedupes by program-cache key regardless).
  // Cheap by design: one instanced mesh per pack plus two small decals, not a
  // full interior. Caller adds the returned group to the scene before the
  // compile pass and removes it afterwards.
  async buildPrewarmGroup(): Promise<THREE.Group> {
    await ensureDungeonAssets();
    const group = new THREE.Group();
    group.name = 'dungeon-material-prewarm';
    let kitGeo: THREE.BufferGeometry | null = null;
    let bitsGeo: THREE.BufferGeometry | null = null;
    for (const asset of moduleAssets.values()) {
      if (asset.pack === 'kit') kitGeo ??= asset.geo;
      else if (asset.pack === 'bits') bitsGeo ??= asset.geo;
      if (kitGeo && bitsGeo) break;
    }
    const identity = new THREE.Matrix4();
    const addPack = (geo: THREE.BufferGeometry | null, pack: Pack): void => {
      if (!geo) return;
      const mesh = new THREE.InstancedMesh(geo, this.material(pack), 1);
      mesh.setMatrixAt(0, identity);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      group.add(mesh);
    };
    addPack(kitGeo, 'kit');
    addPack(bitsGeo, 'bits');
    // Drowned Temple flood water (the one bespoke interior shader).
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      this.templeWaterMaterial(),
    );
    water.frustumCulled = false;
    group.add(water);
    // Torch-glow decal: one MeshBasic program shared by every variant's colour.
    this.addTorchGlow(group, 0, 0, TORCH_COLORS.crypt.light);
    return group;
  }

  async buildInterior(
    interior: string,
    ox: number,
    oz: number,
    opts?: {
      layout?: DungeonLayout;
      variant?: Variant;
      hazards?: Array<{
        x: number;
        z: number;
        r: number;
        rx?: number;
        rz?: number;
        tier?: 'shallow' | 'deep';
      }>;
      moduleId?: DelveModuleId;
    },
  ): Promise<void> {
    await ensureDungeonAssets();
    // Delve modules pass an explicit per-module layout so render geometry matches
    // the SAME layout sim/colliders.ts derives collision from (what you see is
    // what you collide with). Without it, every module fell back to CRYPT_LAYOUT
    // while collision used the real delve footprint, drifting walls and floor.
    const layout =
      opts?.layout ??
      (interior === 'sanctum'
        ? SANCTUM_LAYOUT
        : interior === 'temple'
          ? TEMPLE_LAYOUT
          : interior === 'arena'
            ? ARENA_LAYOUT
            : interior === 'nythraxis'
              ? NYTHRAXIS_LAYOUT
              : CRYPT_LAYOUT);
    const variant = opts?.variant ?? this.variantFor(interior, ox);
    const group = new THREE.Group();
    const p = new Placements();
    const arenaWalls = variant === 'arena' ? this.pendingArenaWalls(layout, ox, oz) : undefined;

    this.placeFloor(p, layout, variant);
    this.placeWalls(p, layout, variant, arenaWalls);
    this.placePillarsAndTorches(group, p, layout, variant);
    this.placeTombs(p, layout, variant);
    this.placeStubs(p, layout.stubs, variant);
    this.placeDais(group, p, layout, variant);
    this.placeAisleClutter(p, layout, variant);
    this.placeWallDressing(p, layout, variant, arenaWalls);
    if (variant === 'temple') {
      this.placeFloodwater(group, layout);
      this.placeAquaticDressing(group, layout);
    }
    if (opts?.hazards?.length) {
      if (variant === 'delve_marsh' || variant === 'delve_marsh_apse') {
        placeMarshBlackwaterPools(group, opts.hazards, (x, z, color, y, scale) =>
          this.addTorchGlow(group, x, z, color, y, scale),
        );
      } else {
        this.placeBlackwaterPools(group, opts.hazards);
      }
    }
    if (variant === 'delve_marsh' || variant === 'delve_marsh_apse') {
      if (opts?.moduleId && isLitanyModuleId(opts.moduleId)) {
        // Dry islands render ON TOP of the pool overlays so the sim's
        // dry-ground exemption is readable (safe ground must not read lethal).
        placeMarshDryIslands(group, opts.moduleId);
        placeLitanyMarshDressing(p, group, opts.moduleId, layout, variant);
      }
    }

    this.emit(group, p, variant);
    if (arenaWalls) {
      for (const wall of arenaWalls.all) this.emitArenaHideable(group, wall);
    }
    group.position.set(ox, 0, oz);
    this.scene.add(group);
  }

  update(camX: number, camY: number, camZ: number, eyeX: number, eyeY: number, eyeZ: number): void {
    for (const h of this.arenaHideables) {
      const hide = arenaWallSegmentHits(h.footprint, eyeX, eyeY, eyeZ, camX, camY, camZ);
      if (hide === h.hidden) continue;
      h.hidden = hide;
      for (const m of h.mats) {
        m.mat.colorWrite = !hide;
        m.mat.depthWrite = hide ? false : m.depthWrite;
      }
    }
  }

  // -------------------------------------------------------------------------
  // The Drowned Temple's water: a translucent caustic sheet flooding the whole
  // room (the raised altar dais emerges as an island), bioluminescent pools
  // pooled into the flood, kelp climbing the colonnade and lily pads drifting
  // by the walls. All deterministic; nothing here is shared with other rooms.
  // -------------------------------------------------------------------------

  private templeWaterMaterial(): THREE.ShaderMaterial {
    if (this.waterMat) return this.waterMat;
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: sharedUniforms.uTime,
        uShallow: { value: new THREE.Color(0x49c9bd) },
        uDeep: { value: new THREE.Color(0x07303c) },
        uGlow: { value: new THREE.Color(0x76f0dd) },
      },
      vertexShader: TEMPLE_WATER_VERT,
      fragmentShader: TEMPLE_WATER_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    return this.waterMat;
  }

  private placeFloodwater(group: THREE.Group, layout: DungeonLayout): void {
    const length = layout.zMax - layout.zMin;
    const geo = new THREE.PlaneGeometry(2 * (DUNGEON_WALL_X - 1), length).rotateX(-Math.PI / 2);
    geo.translate(0, 0.2, (layout.zMin + layout.zMax) / 2); // shin-deep over the floor (y=0)
    const sheet = new THREE.Mesh(geo, this.templeWaterMaterial());
    sheet.renderOrder = 1; // floats over the floor tiles
    group.add(sheet);
    // bioluminescent pools breathed along the flooded aisle + at the altar
    for (let z = layout.zMin + 14; z < layout.zMax - 8; z += 22) {
      this.addTorchGlow(group, 0, z, 0x37e6cf, 0.24, 1.4);
    }
    this.addTorchGlow(group, layout.dais.x, layout.dais.z, 0x37e6cf, 0.74, 2.0);
  }

  // The Drowned Litany's static Blackwater hazards: a dark, near-opaque pool with
  // a sickly bog-green rim glow at each zone, so the damage area reads clearly at a
  // glance (the sim deals damage to players standing inside, see runs.ts). Drawn in
  // instance-local coords; the group is positioned at the module origin like the
  // rest of the interior.
  private placeBlackwaterPools(
    group: THREE.Group,
    hazards: Array<{ x: number; z: number; r: number }>,
  ): void {
    for (const h of hazards) {
      const pool = new THREE.Mesh(
        new THREE.CircleGeometry(h.r, 28).rotateX(-Math.PI / 2).translate(h.x, 0.12, h.z),
        new THREE.MeshBasicMaterial({
          color: 0x0a1a12,
          transparent: true,
          opacity: 0.82,
          depthWrite: false,
        }),
      );
      pool.renderOrder = 1; // floats over the floor tiles
      group.add(pool);
      // Bog-green rim so the edge of the hazard is unmistakable.
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(h.r * 0.82, h.r, 32).rotateX(-Math.PI / 2).translate(h.x, 0.14, h.z),
        new THREE.MeshBasicMaterial({
          color: 0x3fae5a,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      rim.renderOrder = 2;
      group.add(rim);
      this.addTorchGlow(group, h.x, h.z, 0x2f8f4f, 0.3, h.r * 0.6);
    }
  }

  private placeAquaticDressing(group: THREE.Group, layout: DungeonLayout): void {
    const inWaist = (z: number) => layout.stubs.some((s) => Math.abs(z - s.z) < s.hd + 2);
    const obj = new THREE.Object3D();

    // lily pads drifting on the flood, hugging the walls (clear of the aisle)
    const padGeo = new THREE.CircleGeometry(0.95, 14).rotateX(-Math.PI / 2);
    const padMat = new THREE.MeshLambertMaterial({
      color: 0x2f6e3a,
      emissive: 0x0c3a26,
      emissiveIntensity: 0.5,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
    });
    const pads: THREE.Matrix4[] = [];
    for (let z = layout.zMin + 8; z < layout.zMax - 6; z += 12) {
      for (const side of [-1, 1]) {
        if (inWaist(z)) continue;
        const h = hash2(side * 5.7, z);
        if (h < 0.4) continue;
        const x = side * (9 + h * 9);
        obj.position.set(x, 0.22, z + (hash2(z, side) - 0.5) * 4);
        obj.rotation.set(0, hash2(x, z) * Math.PI, 0);
        obj.scale.setScalar(0.7 + hash2(z * 1.7, x) * 0.7);
        obj.updateMatrix();
        pads.push(obj.matrix.clone());
      }
    }
    if (pads.length) {
      const padMesh = new THREE.InstancedMesh(padGeo, padMat, pads.length);
      for (let i = 0; i < pads.length; i++) padMesh.setMatrixAt(i, pads[i]);
      padMesh.instanceMatrix.needsUpdate = true;
      padMesh.renderOrder = 2;
      group.add(padMesh);
    }

    // kelp climbing out of the flood near the colonnade and walls
    const kelpGeo = new THREE.CylinderGeometry(0.05, 0.22, 1, 5).translate(0, 0.5, 0);
    const kelpMat = new THREE.MeshLambertMaterial({
      color: 0x1f6b52,
      emissive: 0x0a3326,
      emissiveIntensity: 0.6,
    });
    const stalks: THREE.Matrix4[] = [];
    for (let z = layout.zMin + 10; z < layout.zMax - 8; z += 13) {
      for (const side of [-1, 1]) {
        if (inWaist(z)) continue;
        const h = hash2(side * 3.1, z * 1.3);
        if (h < 0.45) continue;
        const cx = side * (13 + h * 7);
        const clump = 2 + Math.floor(hash2(z, side * 2.2) * 2);
        for (let k = 0; k < clump; k++) {
          const jx = cx + (hash2(cx + k, z) - 0.5) * 2.2;
          const jz = z + (hash2(z, cx + k * 3) - 0.5) * 2.2;
          const height = 2.4 + hash2(jx, jz) * 2.4;
          obj.position.set(jx, 0.05, jz);
          obj.rotation.set(
            (hash2(jx, jz * 2) - 0.5) * 0.5,
            hash2(jz, jx) * Math.PI,
            (hash2(jx * 2, jz) - 0.5) * 0.5,
          );
          obj.scale.set(1, height, 1);
          obj.updateMatrix();
          stalks.push(obj.matrix.clone());
        }
      }
    }
    if (stalks.length) {
      const kelpMesh = new THREE.InstancedMesh(kelpGeo, kelpMat, stalks.length);
      for (let i = 0; i < stalks.length; i++) kelpMesh.setMatrixAt(i, stalks[i]);
      kelpMesh.instanceMatrix.needsUpdate = true;
      group.add(kelpMesh);
    }
  }

  // Hollow Crypt and Sunken Bastion share interior 'crypt'; the origin x-band
  // (instanceOrigin in sim/data.ts: 900 + index*600) says which dungeon.
  private variantFor(interior: string, ox: number): Variant {
    if (interior === 'arena') return 'arena';
    if (interior === 'nythraxis') return 'nythraxis';
    if (interior === 'sanctum') return 'sanctum';
    if (interior === 'temple') return 'temple';
    const bastionX = instanceOrigin(1, 0).x;
    if (Math.abs(ox - bastionX) < 250) return 'bastion';
    return 'crypt';
  }

  private material(pack: Pack): THREE.Material {
    let mat = this.packMats.get(pack);
    if (mat) return mat;
    const src = packSourceMaterial.get(pack);
    if (this.lowGfx) {
      mat = new THREE.MeshLambertMaterial({ map: src?.map ?? null });
    } else if (src) {
      const std = src.clone();
      std.vertexColors = false;
      std.metalness = 0;
      std.roughness = Math.max(0.85, std.roughness);
      mat = std;
    } else {
      mat = new THREE.MeshStandardMaterial({ color: 0x777788, roughness: 0.95 });
    }
    this.packMats.set(pack, mat);
    return mat;
  }

  // delve_marsh / delve_marsh_apse only: a tinted clone of the shared pack
  // material (never the source, never this.material(pack)'s own instance) so
  // the Drowned Litany's wall/pillar/floor stone reads as wet mossy rock and
  // dark peat instead of the same crypt-stone grey every other interior uses.
  // Cached per pack + surface (wall vs floor), built once per DungeonInteriors
  // instance and reused for every marsh room, never cloned per room or mesh.
  private marshMaterial(pack: Pack, surface: 'wall' | 'floor'): THREE.Material {
    const cache = surface === 'wall' ? this.marshWallMats : this.marshFloorMats;
    let mat = cache.get(pack);
    if (mat) return mat;
    // this.material(pack) is itself already a clone of the immutable GLB cache
    // source (see material() above); clone again so the marsh tint never
    // mutates the shared pack material every other variant instances from.
    const base = this.material(pack).clone() as
      | THREE.MeshLambertMaterial
      | THREE.MeshStandardMaterial;
    base.color.multiply(new THREE.Color(surface === 'wall' ? MARSH_WALL_TINT : MARSH_FLOOR_TINT));
    if (base instanceof THREE.MeshStandardMaterial) base.roughness = Math.max(base.roughness, 0.92);
    mat = base;
    cache.set(pack, mat);
    return mat;
  }

  private emit(group: THREE.Group, p: Placements, variant: Variant): void {
    const isMarsh = variant === 'delve_marsh' || variant === 'delve_marsh_apse';
    for (const [kind, mats] of p.byKind) {
      const asset = moduleAssets.get(kind);
      if (!asset) {
        // ensureDungeonAssets() guarantees loads completed; guard against a bad kind name
        console.warn(`dungeon: unknown module kind '${kind}'`);
        continue;
      }
      // Marsh wall/pillar/floor stone gets a wet-mossy / peat tint (see
      // marshMaterial); every other kind (banners, torches, props) and every
      // other variant keep the plain shared pack material unchanged.
      let mat = this.material(asset.pack);
      if (isMarsh && WALL_PILLAR_KINDS.has(kind)) mat = this.marshMaterial(asset.pack, 'wall');
      else if (isMarsh && RECEIVER_KINDS.has(kind)) mat = this.marshMaterial(asset.pack, 'floor');
      const mesh = new THREE.InstancedMesh(asset.geo, mat, mats.length);
      for (let i = 0; i < mats.length; i++) mesh.setMatrixAt(i, mats[i]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = !this.lowGfx && CASTER_KINDS.has(kind);
      mesh.receiveShadow = RECEIVER_KINDS.has(kind);
      group.add(mesh);
    }
  }

  private pendingArenaWalls(layout: DungeonLayout, ox: number, oz: number): PendingArenaWalls {
    const topY = DUNGEON_WALL_HEIGHT;
    const wallX = layout.wallX ?? DUNGEON_WALL_X;
    const endWallHw = layout.endWallHw ?? DUNGEON_END_WALL_HW;
    const wall = (footprint: ArenaWallFootprint): PendingArenaWall => ({
      placements: new Placements(),
      footprint,
    });
    const left = wall({
      x: ox - wallX,
      z: oz + layout.sideWallZ,
      hw: DUNGEON_WALL_HW,
      hd: layout.sideWallHd,
      topY,
    });
    const right = wall({
      x: ox + wallX,
      z: oz + layout.sideWallZ,
      hw: DUNGEON_WALL_HW,
      hd: layout.sideWallHd,
      topY,
    });
    const front = wall({ x: ox, z: oz + layout.zMin, hw: endWallHw, hd: DUNGEON_WALL_HW, topY });
    const back = wall({ x: ox, z: oz + layout.zMax, hw: endWallHw, hd: DUNGEON_WALL_HW, topY });
    return {
      left,
      right,
      front,
      back,
      all: [left, right, front, back],
    };
  }

  private emitArenaHideable(group: THREE.Group, pending: PendingArenaWall): void {
    const wallGroup = new THREE.Group();
    const mats: ToggleMat[] = [];
    for (const [kind, matrices] of pending.placements.byKind) {
      const asset = moduleAssets.get(kind);
      if (!asset) {
        console.warn(`dungeon: unknown arena wall module kind '${kind}'`);
        continue;
      }
      const material = this.material(asset.pack).clone();
      mats.push({ mat: material, depthWrite: material.depthWrite });
      const mesh = new THREE.InstancedMesh(asset.geo, material, matrices.length);
      for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow =
        !this.lowGfx && (CASTER_KINDS.has(kind) || ARENA_WALL_CASTER_KINDS.has(kind));
      mesh.receiveShadow = RECEIVER_KINDS.has(kind);
      wallGroup.add(mesh);
    }
    if (!mats.length) return;
    group.add(wallGroup);
    this.arenaHideables.push({
      group: wallGroup,
      mats,
      hidden: false,
      footprint: pending.footprint,
    });
  }

  // -------------------------------------------------------------------------
  // Structure
  // -------------------------------------------------------------------------

  private floorKind(variant: Variant, t: number): string {
    if (variant === 'bastion') {
      return pickKind(
        [
          ['floor_tile_large', 56],
          ['floor_tile_large_rocks', 5],
          ['floor_dirt_large', 4],
          ['floor_dirt_large_rocky', 4],
          ['grate', 8],
          ['quad', 23],
        ],
        t,
      );
    }
    if (variant === 'sanctum') {
      return pickKind(
        [
          ['floor_tile_large', 68],
          ['floor_tile_large_rocks', 7],
          ['floor_dirt_large', 4],
          ['floor_dirt_large_rocky', 4],
          ['quad', 17],
        ],
        t,
      );
    }
    if (variant === 'temple') {
      // flooded flagstones: more broken/weeded subdivisions, grate pits draining
      return pickKind(
        [
          ['floor_tile_large', 52],
          ['floor_tile_large_rocks', 6],
          ['floor_dirt_large', 4],
          ['floor_dirt_large_rocky', 4],
          ['grate', 9],
          ['quad', 25],
        ],
        t,
      );
    }
    if (isDelveVariant(variant)) {
      // collapsed reliquary: grave-dust over cracked flags, more dirt and rubble
      return pickKind(
        [
          ['floor_tile_large', 54],
          ['floor_tile_large_rocks', 10],
          ['floor_dirt_large', 10],
          ['floor_dirt_large_rocky', 8],
          ['quad', 18],
        ],
        t,
      );
    }
    return pickKind(
      [
        ['floor_tile_large', 70],
        ['floor_tile_large_rocks', 6],
        ['floor_dirt_large', 6],
        ['floor_dirt_large_rocky', 5],
        ['quad', 13],
      ],
      t,
    );
  }

  private floorQuadKind(variant: Variant, t: number): string {
    if (variant === 'bastion') {
      return pickKind(
        [
          ['floor_tile_small', 30],
          ['floor_tile_small_broken_A', 15],
          ['floor_tile_small_broken_B', 15],
          ['floor_tile_small_weeds_A', 18],
          ['floor_tile_small_weeds_B', 18],
          ['floor_tile_small_decorated', 4],
        ],
        t,
      );
    }
    if (variant === 'sanctum') {
      return pickKind(
        [
          ['floor_tile_small', 35],
          ['floor_tile_small_broken_A', 12],
          ['floor_tile_small_broken_B', 12],
          ['floor_tile_small_weeds_A', 8],
          ['floor_tile_small_weeds_B', 8],
          ['floor_tile_small_decorated', 25],
        ],
        t,
      );
    }
    if (variant === 'temple') {
      // damp temple flags: heavy weed growth between cracked, broken tiles
      return pickKind(
        [
          ['floor_tile_small', 26],
          ['floor_tile_small_broken_A', 16],
          ['floor_tile_small_broken_B', 16],
          ['floor_tile_small_weeds_A', 18],
          ['floor_tile_small_weeds_B', 18],
          ['floor_tile_small_decorated', 6],
        ],
        t,
      );
    }
    return pickKind(
      [
        ['floor_tile_small', 40],
        ['floor_tile_small_broken_A', 18],
        ['floor_tile_small_broken_B', 18],
        ['floor_tile_small_weeds_A', 7],
        ['floor_tile_small_weeds_B', 7],
        ['floor_tile_small_decorated', 10],
      ],
      t,
    );
  }

  // 4u tile grid covering the room (x -24..24, z just past both end walls)
  private placeFloor(p: Placements, layout: DungeonLayout, variant: Variant): void {
    const quarter = Math.PI / 2;
    // Default the floor to the inner wall face so wider rooms (delve |x|=25)
    // are not left with a bare strip between the aisle floor and the side walls.
    const floorHalfX = layout.floorHalfX ?? (layout.wallX ?? DUNGEON_WALL_X) - 1;
    const poly = layout.shellPolygon;
    for (let z = layout.zMin - 2; z <= layout.zMax + 2; z += FLOOR_CELL) {
      for (let x = -floorHalfX; x <= floorHalfX; x += FLOOR_CELL) {
        // Polygon shell: mask the rectangular grid down to the authored room
        // outline (same grid stepping and tile-kind logic, just skip cells
        // whose own center falls outside the polygon). Boundary tiles will
        // stair-step; accepted for this kit.
        if (poly && !polygonContainsPoint(poly, x, z)) continue;
        let kind = this.floorKind(variant, hash2(x * 1.31, z));
        if (kind === 'grate' && Math.abs(x) < 4) kind = 'floor_tile_large'; // keep pits off the walk aisle
        if (kind === 'grate') {
          // floor_tile_grate is 4x2: a pair fills the cell, test each half's own center
          if (!poly || polygonContainsPoint(poly, x, z - 1))
            p.add('floor_tile_grate', x, FLOOR_Y, z - 1);
          if (!poly || polygonContainsPoint(poly, x, z + 1))
            p.add('floor_tile_grate', x, FLOOR_Y, z + 1);
          continue;
        }
        if (kind === 'quad') {
          for (const dx of [-1, 1]) {
            for (const dz of [-1, 1]) {
              if (poly && !polygonContainsPoint(poly, x + dx, z + dz)) continue;
              const sub = this.floorQuadKind(variant, hash2(x + dx, z + dz));
              const rot = Math.floor(hash2(z + dz, x + dx) * 4) * quarter;
              p.add(sub, x + dx, FLOOR_Y, z + dz, rot);
            }
          }
          continue;
        }
        const rot = Math.floor(hash2(z, x) * 4) * quarter;
        p.add(kind, x, FLOOR_Y, z, rot);
      }
    }
  }

  private wallKind(variant: Variant, t: number): string {
    if (variant === 'bastion') {
      return pickKind(
        [
          ['wall', 44],
          ['wall_pillar', 22],
          ['wall_cracked', 18],
          ['wall_arched', 8],
          ['wall_archedwindow_gated', 8],
        ],
        t,
      );
    }
    if (variant === 'sanctum') {
      return pickKind(
        [
          ['wall', 46],
          ['wall_pillar', 22],
          ['wall_cracked', 12],
          ['wall_arched', 14],
          ['wall_archedwindow_gated', 6],
        ],
        t,
      );
    }
    if (variant === 'temple') {
      // arched moon-windows let pale light into the flooded halls; weathered, cracked
      return pickKind(
        [
          ['wall', 38],
          ['wall_pillar', 20],
          ['wall_cracked', 18],
          ['wall_arched', 12],
          ['wall_archedwindow_gated', 12],
        ],
        t,
      );
    }
    if (isDelveVariant(variant)) {
      // long-sealed reliquary: heavily cracked masonry, the odd gated arch
      return pickKind(
        [
          ['wall', 40],
          ['wall_pillar', 20],
          ['wall_cracked', 26],
          ['wall_arched', 9],
          ['wall_archedwindow_gated', 5],
        ],
        t,
      );
    }
    return pickKind(
      [
        ['wall', 50],
        ['wall_pillar', 22],
        ['wall_cracked', 14],
        ['wall_arched', 9],
        ['wall_archedwindow_gated', 5],
      ],
      t,
    );
  }

  private bannerKind(variant: Variant, t: number): string {
    if (variant === 'bastion') {
      return pickKind(
        [
          ['banner_shield_blue', 4],
          ['banner_blue', 3],
          ['banner_triple_blue', 3],
        ],
        t,
      );
    }
    if (variant === 'sanctum') {
      return pickKind(
        [
          ['banner_green', 4],
          ['banner_patternC_green', 3],
          ['banner_triple_green', 3],
        ],
        t,
      );
    }
    if (variant === 'temple') {
      // pale temple hangings, the odd faded-blue choir banner
      return pickKind(
        [
          ['banner_white', 5],
          ['banner_thin_white', 4],
          ['banner_blue', 2],
        ],
        t,
      );
    }
    if (isDelveVariant(variant)) {
      // tattered funereal hangings, mostly thin and faded
      return pickKind(
        [
          ['banner_thin_white', 7],
          ['banner_white', 3],
        ],
        t,
      );
    }
    return pickKind(
      [
        ['banner_thin_white', 6],
        ['banner_white', 4],
      ],
      t,
    );
  }

  // Side walls run along z at |x| = DUNGEON_WALL_X (8u modules at scale 2,
  // 2u thick: matches the hw=1 collider slabs); end walls run along x.
  private placeWalls(
    p: Placements,
    layout: DungeonLayout,
    variant: Variant,
    arenaWalls?: PendingArenaWalls,
  ): void {
    if (layout.shellPolygon) {
      this.placePolygonWalls(p, layout.shellPolygon, variant);
      return;
    }
    const bannerEvery = variant === 'crypt' ? 4 : 3;
    const wallX = layout.wallX ?? DUNGEON_WALL_X;
    const endWallHw = layout.endWallHw ?? DUNGEON_END_WALL_HW;
    for (const side of [-1, 1]) {
      const target = arenaWalls
        ? side < 0
          ? arenaWalls.left.placements
          : arenaWalls.right.placements
        : p;
      const ry = side < 0 ? Math.PI / 2 : -Math.PI / 2; // detail + banners face the room
      let i = 0;
      for (let z = layout.zMin; z <= layout.zMax + 2; z += 8, i++) {
        const kind = this.wallKind(variant, hash2(side * 13.7, z));
        target.add(kind, side * wallX, 0, z, ry, MODULE_SCALE);
        if (i % bannerEvery === 2 && kind !== 'wall_archedwindow_gated') {
          target.add(
            this.bannerKind(variant, hash2(z, side * 7.3)),
            side * wallX,
            0,
            z,
            ry,
            MODULE_SCALE,
          );
        }
      }
    }
    for (const end of [
      { z: layout.zMin, ry: 0 },
      { z: layout.zMax, ry: Math.PI },
    ]) {
      const target = arenaWalls
        ? end.z === layout.zMin
          ? arenaWalls.front.placements
          : arenaWalls.back.placements
        : p;
      for (let x = -endWallHw + 4; x <= endWallHw - 4; x += 8) {
        const kind = this.wallKind(variant, hash2(x, end.z * 3.1));
        target.add(kind, x, 0, end.z, end.ry, MODULE_SCALE);
      }
    }
    // back wall banners flank the boss dais
    const backTarget = arenaWalls?.back.placements ?? p;
    for (const bx of [-12, -4, 4, 12]) {
      backTarget.add(
        this.bannerKind(variant, hash2(bx, layout.zMax)),
        bx,
        0,
        layout.zMax,
        Math.PI,
        MODULE_SCALE,
      );
    }
  }

  // Polygon-shell wall path: walks the exact shared collision segments and
  // scales one wall module to each span, with the same variant-keyed wall and
  // banner logic as the rectangular loop above. This covers the end faces too
  // (the polygon already closes the
  // room), so there is no separate end-cap pass and no door gap (Drowned
  // Litany rooms are teleport-in, matching the sim shell colliders built by
  // polygonShellColliders in sim/delve_litany_layout.ts). Rotation uses the
  // SAME rot = atan2(-edgeDz, edgeDx) convention as that sim helper (and the
  // fence OBBs in sim/colliders.ts): it aligns the OBB/module's local +x
  // (world (cos(rot), -sin(rot)) under Three's Y-Euler) along the edge
  // direction, which reproduces the existing side-wall ry for the west/east
  // straight edges (see report for the verification walkthrough).
  private placePolygonWalls(
    p: Placements,
    points: ReadonlyArray<{ x: number; z: number }>,
    variant: Variant,
  ): void {
    const bannerEvery = variant === 'crypt' ? 4 : 3;
    let i = 0;
    for (const segment of polygonWallSegments(points)) {
      const { x, z, rot, halfLength } = segment;
      const kind = this.wallKind(variant, hash2(x * 13.7, z));
      // KayKit wall modules are 4u long on local X. Scale each one to the exact
      // shared segment span instead of drawing an 8u module past a short edge.
      const scale: [number, number, number] = [halfLength / 2, MODULE_SCALE, MODULE_SCALE];
      p.add(kind, x, 0, z, rot, scale);
      if (i % bannerEvery === 2 && kind !== 'wall_archedwindow_gated') {
        p.add(this.bannerKind(variant, hash2(z, x * 7.3)), x, 0, z, rot, MODULE_SCALE);
      }
      i++;
    }
  }

  private placePillarsAndTorches(
    group: THREE.Group,
    p: Placements,
    layout: DungeonLayout,
    variant: Variant,
  ): void {
    const kind =
      variant === 'sanctum' || variant === 'temple' || variant === 'delve_hall'
        ? 'pillar_decorated'
        : 'pillar';
    const colors = TORCH_COLORS[variant];
    for (const pt of layout.pillars) {
      const faceAisle = pt.x < 0 ? Math.PI / 2 : -Math.PI / 2;
      p.add(kind, pt.x, 0, pt.z, faceAisle, [PILLAR_XZ_SCALE, MODULE_SCALE, PILLAR_XZ_SCALE]);
      this.addPillarTorch(group, p, pt, colors);
    }
  }

  // Torch on the aisle face of a pillar. KEEPS the renderer contract:
  // animated flame cone -> this.flames, PointLight with userData.baseIntensity
  // -> this.fireLights (budgetFireLights keeps the nearest GFX.maxPointLights).
  private addPillarTorch(
    group: THREE.Group,
    p: Placements,
    pt: GridPoint,
    colors: TorchColors,
  ): void {
    const dir = pt.x < 0 ? 1 : -1; // toward the centre aisle
    p.add('torch_mounted', pt.x + dir * 0.98, 5.5, pt.z, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 1.6);

    this.flameGeo ??= new THREE.ConeGeometry(0.22, 0.6, 6);
    const flame = new THREE.Mesh(
      this.flameGeo,
      new THREE.MeshLambertMaterial({
        color: colors.flame,
        emissive: colors.emissive,
        emissiveIntensity: this.lowGfx ? 1.6 : FLAME_EMISSIVE_HIGH,
        transparent: true,
        opacity: 0.92,
      }),
    );
    flame.position.set(pt.x + dir * 1.7, 6.6, pt.z);
    group.add(flame);
    this.flames.push(flame);

    const light = new THREE.PointLight(
      colors.light,
      10,
      this.lowGfx ? 22 : DUNGEON_LIGHT_DISTANCE,
      2,
    );
    if (!this.lowGfx) light.userData.baseIntensity = DUNGEON_LIGHT_INTENSITY;
    light.position.set(pt.x + dir * 1.2, this.lowGfx ? 8.2 : DUNGEON_LIGHT_Y, pt.z);
    group.add(light);
    this.fireLights.push(light);

    this.addTorchGlow(group, pt.x + dir * 1.7, pt.z, colors.light);
  }

  // Additive light-pool decal under a torch: the point-light budget only keeps
  // the nearest few lights live, so the floor pools are baked in.
  private addTorchGlow(
    group: THREE.Group,
    x: number,
    z: number,
    colorHex: number,
    y = 0.07,
    scale = 1,
  ): void {
    if (this.lowGfx) return;
    this.glowDecalGeo ??= new THREE.CircleGeometry(6.6, 20).rotateX(-Math.PI / 2);
    this.glowDecalTex ??= radialGlowTexture();
    let mat = this.glowDecalMats.get(colorHex);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        map: this.glowDecalTex,
        color: colorHex,
        transparent: true,
        opacity: 0.46,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.glowDecalMats.set(colorHex, mat);
    }
    const glow = new THREE.Mesh(this.glowDecalGeo, mat);
    glow.position.set(x, y, z);
    glow.scale.setScalar(scale);
    glow.renderOrder = 1; // after the floor it floats over
    group.add(glow);
  }

  // Wall-side obstacles at +-19 (OBB 2.2 x 4.2): sarcophagi in the crypt and
  // sanctum-free; the drowned bastion stacks cargo in the same footprints.
  private placeTombs(p: Placements, layout: DungeonLayout, variant: Variant): void {
    if (variant === 'delve_marsh') {
      placeMarshTombs(p, layout);
      return;
    }
    for (const t of layout.tombs) {
      const r = hash2(t.x * 3.7, t.z);
      if (variant === 'bastion') {
        if (r < 0.5) {
          p.add('crates_stacked', t.x, 0, t.z - 1.0, hash2(t.z, t.x) * 0.4 - 0.2, 1.0);
          p.add('barrel_large', t.x + 0.1, 0, t.z + 1.3, hash2(t.x, t.z * 2.1) * Math.PI, 0.85);
        } else {
          p.add('box_stacked', t.x, 0, t.z - 1.0, hash2(t.z, t.x) * 0.4 - 0.2, 0.6);
          p.add('keg', t.x - 0.1, 0, t.z + 1.3, hash2(t.x, t.z * 1.7) * Math.PI, 0.9);
        }
        continue;
      }
      if (variant === 'temple') {
        // drowned reliquary altars: a candle-shrine over grave-offerings
        const face = t.x < 0 ? -Math.PI / 2 : Math.PI / 2;
        p.add('shrine_candles', t.x, 0, t.z, face, 1.45);
        p.add(
          r < 0.5 ? 'candle_triple' : 'skull_candle',
          t.x,
          0,
          t.z + 1.6,
          hash2(t.z, t.x) * Math.PI,
          1.3,
        );
        if (hash2(t.z * 1.3, t.x) > 0.5)
          p.add('skull', t.x, 0, t.z - 1.6, hash2(t.x, t.z) * Math.PI * 2, 1.2);
        continue;
      }
      if (variant === 'delve_ossuary') {
        // burial shelves: stacked coffins with bone spill at their feet
        p.add(r < 0.5 ? 'coffin' : 'coffin_decorated', t.x, 0, t.z, 0, [1.15, 1.35, 1.45]);
        const sx = t.x < 0 ? 1 : -1;
        p.add('ribcage', t.x + sx * 1.5, 0.4, t.z - 1.4, hash2(t.x, t.z) * Math.PI * 2, 1.5);
        if (r > 0.45)
          p.add(
            'skull',
            t.x + sx * 1.7,
            0,
            t.z + TOMB_HD + 0.4,
            hash2(t.z, t.x) * Math.PI * 2,
            1.25,
          );
        continue;
      }
      if (variant === 'delve_hall') {
        // defaced saint statues set in wall niches: toppled markers, broken plaques
        const face = t.x < 0 ? -Math.PI / 2 : Math.PI / 2;
        p.add(r < 0.5 ? 'gravemarker_A' : 'gravestone', t.x, 0, t.z, face, 1.7);
        p.add('plaque_candles', t.x, 0, t.z + (r < 0.5 ? 1.8 : -1.8), face, 1.4);
        continue;
      }
      // crypt / delve_finale fallback: plain and decorated coffins
      const kind = r < 0.55 ? 'coffin' : 'coffin_decorated';
      p.add(kind, t.x, 0, t.z, 0, [1.1, 1.3, 1.4]);
      if (hash2(t.z * 1.9, t.x) > 0.55) {
        const sx = t.x < 0 ? 1 : -1;
        p.add('skull', t.x + sx * 1.6, 0, t.z + TOMB_HD + 0.5, hash2(t.x, t.z) * Math.PI * 2, 1.3);
      }
    }
  }

  // Sanctum chamber waists: solid wall blocks built from stretched kit walls
  // (cap flush at |x|=6 so the visual never intrudes into the 10u passage),
  // plus a ritual arch spanning the centre passage.
  private placeStubs(p: Placements, stubs: WallStub[], variant: Variant): void {
    if (variant === 'delve_bell') {
      // Bell Niche: each stub is a solid pier (hw x hd OBB) flush against the
      // side wall, dividing the deep handbell alcoves. Render the aisle-facing
      // face so the visible pier matches the collider; the mass behind it sits
      // against the side wall and is never seen from the aisle.
      for (const s of stubs) {
        const sign = s.x < 0 ? -1 : 1;
        // aisle-facing edge is toward the centre (|x| = hw - ... ), i.e. s.x moved
        // back toward x=0 by hw. The mass fills from here to the side wall.
        const innerX = s.x - sign * s.hw; // collider aisle face (|x| = 5)
        // Place the slab centreline 1u outside each collider face (same 1u wall
        // half-thickness the side walls use) so the visible surface sits exactly
        // on the collider and the player stands flush instead of clipping in.
        p.add('wall', innerX + sign, 0, s.z, sign < 0 ? Math.PI / 2 : -Math.PI / 2, [
          s.hd / 2,
          MODULE_SCALE,
          MODULE_SCALE,
        ]);
        // end faces closing the pier sides out to the side wall (length 2*hw along x)
        for (const ez of [s.z - s.hd + 1, s.z + s.hd - 1]) {
          p.add('wall', s.x, 0, ez, 0, [s.hw / 2, MODULE_SCALE, MODULE_SCALE]);
        }
      }
      return;
    }
    const archZ = new Set<number>();
    for (const s of stubs) {
      const sign = s.x < 0 ? -1 : 1;
      // passage-facing cap (length 2*hd along z)
      p.add('wall', sign * 6, 0, s.z, Math.PI / 2, [s.hd / 2, MODULE_SCALE, MODULE_SCALE]);
      // front/back faces, two 9u modules from |x| 5..23, flush inside the OBB
      for (const fz of [s.z - s.hd + 1, s.z + s.hd - 1]) {
        const ry = fz < s.z ? 0 : Math.PI;
        p.add('wall_pillar', sign * 9.5, 0, fz, ry, [2.25, MODULE_SCALE, MODULE_SCALE]);
        p.add('wall', sign * 18.5, 0, fz, ry, [2.25, MODULE_SCALE, MODULE_SCALE]);
      }
      archZ.add(s.z);
    }
    if (variant === 'sanctum' || variant === 'temple') {
      for (const z of archZ) p.add('arch', 0, 0, z, 0, [2.6, 1.9, 2.0]);
    }
  }

  // Boss dais: chunky circular platform of foundation blocks (0.6u high,
  // walkable — deliberately NO collider, matching the layout contract).
  private placeDais(
    group: THREE.Group,
    p: Placements,
    layout: DungeonLayout,
    variant: Variant,
  ): void {
    const d = layout.dais;
    // The arena and Nythraxis raid keep flat fighting floors: no raised platform
    // or rim clutter to visually disagree with the walkable sim collision.
    if (!dungeonDaisHasRaisedPlatform(variant)) {
      this.addTorchGlow(group, d.x, d.z, TORCH_COLORS[variant].light, 0.07, 2.4);
      return;
    }
    const quarter = Math.PI / 2;
    for (let x = -16; x <= 16; x += 4) {
      for (let z = -16; z <= 16; z += 4) {
        if (Math.hypot(x, z) > d.r) continue;
        const rot = Math.floor(hash2(x, z) * 4) * quarter;
        p.add('floor_foundation_allsides', d.x + x, 0, d.z + z, rot, [1.85, 0.3, 1.85]);
      }
    }
    // ritual glow pooled on the dais top so the boss stage never reads as a
    // black slab (torch pillars stop short of the back chamber)
    this.addTorchGlow(group, d.x, d.z, TORCH_COLORS[variant].light, 0.68, 1.6);
    // rim decor (small, walk-through by design)
    const rim = d.r - 1.6;
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + 0.35;
      const x = d.x + Math.sin(ang) * rim;
      const z = d.z + Math.cos(ang) * rim;
      if (variant === 'bastion') p.add('candle_triple', x, 0.6, z, hash2(x, z) * Math.PI, 1.3);
      else if (variant === 'sanctum')
        p.add(i % 2 ? 'skull_candle' : 'candle_triple', x, 0.6, z, hash2(x, z) * Math.PI, 1.4);
      else if (variant === 'temple')
        p.add(i % 2 ? 'candle_triple' : 'shrine_candles', x, 0.6, z, hash2(x, z) * Math.PI, 1.3);
      else if (variant === 'delve_finale' || variant === 'delve_marsh_apse')
        p.add(i % 2 ? 'skull_candle' : 'candle_triple', x, 0.6, z, hash2(x, z) * Math.PI, 1.4);
      else p.add(i % 2 ? 'skull' : 'candle_lit', x, 0.6, z, hash2(x, z) * Math.PI, 1.3);
    }
    if (variant === 'bastion') {
      // the drowned keep's plunder, heaped behind the dais
      p.add('chest_gold', d.x - 2.2, 0.6, d.z + d.r - 3.4, Math.PI + 0.3, 1.4);
      p.add('coin_stack_medium', d.x + 1.8, 0.6, d.z + d.r - 3.2, 0.8, 1.5);
      p.add('trunk_large_A', d.x + 4.6, 0, d.z + d.r + 1.2, Math.PI - 0.4, 1.5);
    }
    if (variant === 'temple') {
      // the goddess's tithe: pearls and coin heaped before the altar
      p.add('chest_gold', d.x + 2.4, 0.6, d.z + d.r - 3.6, Math.PI - 0.3, 1.4);
      p.add('coin_stack_medium', d.x - 2.0, 0.6, d.z + d.r - 3.4, -0.7, 1.5);
      p.add('skull_candle', d.x, 0.68, d.z, 0, 1.6); // the moon-idol at the altar's heart
    }
    if (variant === 'delve_finale' || variant === 'delve_marsh_apse') {
      // Deacon Varric's bell-chamber: low ribcage trophies flanking the south
      // (entrance-facing) edge of the stage. The reward chest is a gameplay
      // object the sim places centre-south, and the surface-exit stairs sit at
      // the north edge: keep both clear, so no idol, hoard, or back-corner chest.
      p.add('ribcage', d.x - 5.2, 0, d.z - d.r + 2.6, 0.6, 1.6);
      p.add('skull_candle', d.x + 5.2, 0, d.z - d.r + 2.8, -0.5, 1.4);
    }
  }

  // Bone piles / debris strewn along the aisle (legacy deterministic spots)
  private placeAisleClutter(p: Placements, layout: DungeonLayout, variant: Variant): void {
    if (variant === 'arena') return; // the fighting sands stay clear of obstacles
    // Delve modules drive clutter straight from their layout's authored scatter
    // points so the visible bone piles sit exactly on the collision circles
    // (the Drowned Litany marsh shapes use bespoke scatter, not the sine aisle
    // formula). The Reliquary clutter arrays mirror the old formula positions, so
    // their rendered output is unchanged.
    if (isDelveVariant(variant)) {
      if (variant === 'delve_marsh') {
        placeMarshClutter(p, layout);
        return;
      }
      for (const c of layout.clutter ?? []) {
        const x = c.x;
        const z = c.z;
        if (z > layout.zMax - 4) continue;
        const r = hash2(x, z);
        p.add('ribcage', x, 0.5, z, r * Math.PI * 2, 1.7);
        p.add('bone_A', x + 1.2, 0.08, z + 0.9, r * 7, 1.9);
        if (r > 0.4) p.add('bone_B', x - 1.1, 0.06, z - 0.8, r * 11, 1.8);
        if (r > 0.55) p.add('skull', x + 0.4, 0, z - 1.4, r * 3, 1.35);
      }
      return;
    }
    const dense = variant === 'sanctum' || variant === 'temple';
    const count = variant === 'sanctum' ? 14 : variant === 'temple' ? 12 : 10;
    for (let i = 0; i < count; i++) {
      const x = Math.sin(i * (dense ? 2.1 : 2.4)) * 14;
      const z = 12 + i * (dense ? 10 : 9.5);
      if (variant === 'sanctum' && ((z > 60 && z < 74) || (z > 110 && z < 120))) continue; // waist walls
      if (variant === 'temple' && z > 60 && z < 72) continue; // single waist arch
      if (z > layout.zMax - 4) continue;
      const r = hash2(x, z);
      if (variant === 'bastion') {
        p.add('box_small', x, 0, z, r * Math.PI * 2, 1.2);
        if (r > 0.35) p.add('bone_A', x + 1.3, 0.06, z + 0.7, r * 9, 1.8);
        if (r > 0.65) p.add('skull', x - 0.9, 0, z + 1.1, r * 5, 1.2);
        continue;
      }
      p.add('ribcage', x, 0.5, z, r * Math.PI * 2, 1.7);
      p.add('bone_A', x + 1.2, 0.08, z + 0.9, r * 7, 1.9);
      if (r > 0.4) p.add('bone_B', x - 1.1, 0.06, z - 0.8, r * 11, 1.8);
      const candleAccent = (variant === 'sanctum' && r > 0.8) || (variant === 'temple' && r > 0.7);
      if (r > 0.55)
        p.add(candleAccent ? 'skull_candle' : 'skull', x + 0.4, 0, z - 1.4, r * 3, 1.35);
    }
  }

  // Variant-specific dressing hugging the walls (outside the walkable aisle)
  private placeWallDressing(
    p: Placements,
    layout: DungeonLayout,
    variant: Variant,
    arenaWalls?: PendingArenaWalls,
  ): void {
    if (variant === 'arena') {
      // gladiatorial weapon trophies mounted high on the pit's side walls
      for (const z of [layout.zMin + 9, (layout.zMin + layout.zMax) / 2, layout.zMax - 9]) {
        for (const side of [-1, 1]) {
          const target = arenaWalls
            ? side < 0
              ? arenaWalls.left.placements
              : arenaWalls.right.placements
            : p;
          const kind = hash2(side * 4.2, z) < 0.5 ? 'sword_shield' : 'sword_shield_broken';
          target.add(
            kind,
            side * (DUNGEON_WALL_X - 1.1),
            4.4,
            z,
            side < 0 ? Math.PI / 2 : -Math.PI / 2,
            1.7,
          );
        }
      }
      return;
    }
    // collapsed masonry in the legacy rubble corners
    const rubble: [number, number][] =
      variant === 'sanctum'
        ? [
            [-19, 4],
            [19, 48],
            [-19, 95],
            [18, 150],
          ]
        : variant === 'temple'
          ? [
              [-19, -10],
              [19, 24],
              [-19, 88],
              [18, 124],
            ]
          : isDelveVariant(variant)
            ? [
                [-19, -8],
                [19, 18],
                [-19, 58],
                [18, 84],
              ] // within the 110u delve room
            : [
                [-19, -13],
                [19, 6],
                [-18, 70],
                [19, 108],
              ];
    for (const [x, z] of rubble) {
      p.add('rubble_half', x < 0 ? -22 : 22, 0, z, x < 0 ? 0 : Math.PI, 1.1);
    }

    if (isDelveVariant(variant)) {
      const edge = (layout.wallX ?? DUNGEON_WALL_X) - 1.6;
      if (variant === 'delve_ossuary') {
        // ossuary shelves: rows of graves and bone reliquaries hugging the walls
        for (let z = layout.zMin + 22; z < layout.zMax - 10; z += 17) {
          for (const side of [-1, 1]) {
            const r = hash2(side * 5.1, z);
            const kind = r < 0.4 ? 'grave_B' : r < 0.7 ? 'gravestone' : 'gravemarker_A';
            p.add(kind, side * edge, 0, z, side < 0 ? Math.PI / 2 : -Math.PI / 2, 1.5);
            if (r > 0.5) p.add('skull', side * (edge - 1.4), 0, z + 2.2, r * 6, 1.2);
          }
        }
        p.add('shrine_candles', -edge, 0, layout.zMin + 4, Math.PI / 4, 1.5);
        p.add('shrine', edge, 0, layout.zMax - 5, -Math.PI * 0.75, 1.5);
        return;
      }
      if (variant === 'delve_marsh') {
        placeMarshWallDressing(p, layout);
        return;
      }
      if (variant === 'delve_bell') {
        // choir plaques and candles lining the handbell alcoves
        for (const z of [18, 47, 76]) {
          p.add('plaque_candles', -edge, 0, z, Math.PI / 2, 1.45);
          p.add('plaque_candles', edge, 0, z, -Math.PI / 2, 1.45);
        }
        p.add('gravestone', -3.4, 0, layout.dais.z + 4, Math.PI, 1.7);
        p.add('gravestone', 3.4, 0, layout.dais.z + 4, Math.PI, 1.7);
        return;
      }
      if (variant === 'delve_hall') {
        // defaced colonnade: votive candles at the column bases, shrines at the ends
        for (const pt of layout.pillars) {
          if (hash2(pt.x, pt.z * 1.3) < 0.5) continue;
          const dir = pt.x < 0 ? 1 : -1;
          p.add('candle_triple', pt.x + dir * 1.9, 0, pt.z + 1.7, hash2(pt.z, pt.x) * Math.PI, 1.4);
        }
        p.add('shrine_candles', -edge, 0, layout.zMin + 5, Math.PI / 2, 1.5);
        p.add('shrine', edge, 0, layout.zMax - 6, -Math.PI / 2, 1.5);
        return;
      }
      // delve_finale / delve_marsh_apse: bell-chamber trophies and the boss's
      // reliquary hoard south. delve_marsh_apse is a litany room (polygon
      // shell), so hug the polygon edge instead of the constant wallX band
      // when one is authored.
      const shellPolygon = layout.shellPolygon;
      const edgeAt = (z: number, side: -1 | 1): number => {
        if (!shellPolygon) return side * edge;
        const x = polygonXAtZ(shellPolygon, z, side);
        return x === null ? side * edge : x - side * 1.6;
      };
      for (let z = layout.zMin + 14; z < layout.dais.z - 16; z += 20) {
        for (const side of [-1, 1] as const) {
          const r = hash2(side * 9.2, z);
          p.add(
            r < 0.5 ? 'ribcage' : 'gravestone',
            edgeAt(z, side),
            0,
            z,
            side < 0 ? Math.PI / 2 : -Math.PI / 2,
            1.6,
          );
        }
      }
      const daisZ = layout.dais.z - 4;
      p.add('shrine_candles', edgeAt(daisZ, -1), 0, daisZ, Math.PI / 2, 1.5);
      p.add('shrine_candles', edgeAt(daisZ, 1), 0, daisZ, -Math.PI / 2, 1.5);
      return;
    }

    const wallEdge = (layout.wallX ?? DUNGEON_WALL_X) - 1.6; // just proud of the wall face
    if (variant === 'crypt') {
      for (let z = layout.zMin + 26; z < layout.zMax - 8; z += 19) {
        for (const side of [-1, 1]) {
          const r = hash2(side * 5.1, z);
          const kind = r < 0.4 ? 'grave_B' : r < 0.7 ? 'gravestone' : 'gravemarker_A';
          p.add(kind, side * wallEdge, 0, z + 9.5, side < 0 ? Math.PI / 2 : -Math.PI / 2, 1.5);
        }
      }
      p.add('shrine_candles', -20, 0, layout.zMin + 3.2, Math.PI / 4, 1.5);
      p.add('shrine', 20, 0, layout.zMax - 3.2, -Math.PI * 0.75, 1.5);
      return;
    }
    if (variant === 'bastion') {
      // armoury wall trophies between the banners
      for (let z = layout.zMin + 21; z < layout.zMax - 8; z += 24) {
        for (const side of [-1, 1]) {
          const kind = hash2(side * 9.2, z) < 0.5 ? 'sword_shield' : 'sword_shield_broken';
          p.add(
            kind,
            side * (DUNGEON_WALL_X - 1.1),
            4.4,
            z + 5,
            side < 0 ? Math.PI / 2 : -Math.PI / 2,
            1.7,
          );
        }
      }
      p.add('table_long_broken', -19.5, 0, 36, 0.4, 1.4);
      p.add('barrel_small_stack', 19.8, 0, 55, -0.3, 1.3);
      p.add('chest', -19.6, 0, layout.zMax - 6, 0.9, 1.3);
      p.add('keg', 20, 0, layout.zMin + 4, 0.2, 1.0);
      return;
    }
    if (variant === 'temple') {
      // choir-shrines set into the flooded walls, candles burning on the colonnade
      p.add('shrine_candles', -20, 0, 52, Math.PI / 2, 1.55);
      p.add('plaque_candles', -20, 0, 56.2, Math.PI / 2, 1.45);
      p.add('shrine_candles', 20, 0, 100, -Math.PI / 2, 1.55);
      p.add('plaque_candles', 20, 0, 104.2, -Math.PI / 2, 1.45);
      for (const pt of layout.pillars) {
        if (hash2(pt.x, pt.z * 1.3) < 0.5) continue;
        const dir = pt.x < 0 ? 1 : -1;
        p.add('candle_triple', pt.x + dir * 1.9, 0, pt.z + 1.7, hash2(pt.z, pt.x) * Math.PI, 1.4);
      }
      p.add('gravestone', -3.4, 0.6, layout.dais.z + 4, Math.PI, 1.7);
      p.add('gravestone', 3.4, 0.6, layout.dais.z + 4, Math.PI, 1.7);
      return;
    }
    // sanctum: necromantic ritual furniture per chamber
    for (const [x, z, ry] of [
      [-20, 16, Math.PI / 2],
      [20, 34, -Math.PI / 2],
      [-20, 96, Math.PI / 2],
      [20, 132, -Math.PI / 2],
    ] as [number, number, number][]) {
      p.add('shrine_candles', x, 0, z, ry, 1.6);
      p.add('plaque_candles', x, 0, z + 4.2, ry, 1.5);
    }
    for (const pt of layout.pillars) {
      if (hash2(pt.x, pt.z * 1.3) < 0.45) continue;
      const dir = pt.x < 0 ? 1 : -1;
      p.add('candle_triple', pt.x + dir * 1.9, 0, pt.z + 1.7, hash2(pt.z, pt.x) * Math.PI, 1.45);
    }
    p.add('gravestone', -3.4, 0.6, layout.dais.z + 4, Math.PI, 1.8);
    p.add('gravestone', 3.4, 0.6, layout.dais.z + 4, Math.PI, 1.8);
  }
}
