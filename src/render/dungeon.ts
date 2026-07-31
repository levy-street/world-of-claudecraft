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
import { arenaOriginAt, instanceOrigin } from '../sim/data';
import type { DelveModuleId } from '../sim/delve_layout';
import { isLitanyModuleId, polygonWallSegments } from '../sim/delve_litany_layout';
import {
  arenaMapForSlot,
  CRYPT_LAYOUT,
  DAIS_HEIGHT,
  DUNGEON_END_WALL_HW,
  DUNGEON_WALL_HEIGHT,
  DUNGEON_WALL_HW,
  DUNGEON_WALL_X,
  type DungeonLayout,
  type GridPoint,
  type InteriorStyle,
  LASTKEEP_LAYOUT,
  NYTHRAXIS_LAYOUT,
  SANCTUM_LAYOUT,
  TEMPLE_LAYOUT,
  TOMB_HD,
  tombSlotRoll,
  type WallStub,
} from '../sim/dungeon_layout';
import { polygonContainsPoint, polygonXAtZ } from '../sim/geometry2d';
import {
  authoredLiftAt,
  authoredWallSegments,
  doorRampHalf,
  type WallSeg,
} from '../sim/rift/authored';
import { ARENA_WATER_NAVE_HALF_X, arenaWaterBands } from './arena_water_band_core';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { fitAuthoredWallSegment } from './authored_walls_core';
import { DAIS_PLATFORM_HEIGHT } from './dais_lift';
import {
  placeLitanyMarshDressing,
  placeMarshBlackwaterPools,
  placeMarshClutter,
  placeMarshDryIslands,
  placeMarshTombs,
  placeMarshWallDressing,
} from './delve_marsh_dressing';
import { rectShellWallSegments, stubFaceSegments } from './dungeon_wall_segments';
import { sharedUniforms } from './gfx';
import { buildLastKeepDressing, ensureLastKeepDressing } from './lastkeep_dressing';
import { buildInfernalDecor, ensureInfernalDecorAssets } from './rift_decor';
import { radialGlowTexture } from './textures';
import { buildWildheartFieldInterior } from './wildheart_props';

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
  // The Drowned Court: the ODD-slot arena map, a flooded-temple pit (temple
  // moonfire palette + water bands over the shared arena wall machinery).
  | 'arena_drowned'
  // The Last Keep: the lived-in Drakelands castle interior. Clean stone walls,
  // warm candle torchlight, and the kcas furniture dressing on stories 1-2;
  // only its undercroft rooms keep the crypt's cracked stone and cold flame.
  | 'lastkeep'
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

/** True for either arena pit variant (both share the arena wall machinery). */
export function isArenaVariant(variant: DungeonInteriorVariant): boolean {
  return variant === 'arena' || variant === 'arena_drowned';
}

export function dungeonDaisHasRaisedPlatform(variant: DungeonInteriorVariant): boolean {
  // Flat fighting floors: the arena pits, the Nythraxis raid, and the delve
  // trash rooms (their "dais" marker is only the exit threshold). The delve
  // finale keeps a raised boss stage for Deacon Varric.
  if (isArenaVariant(variant) || variant === 'nythraxis') return false;
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
  // the Drowned Court fights under the temple's cold moonfire (same palette)
  arena_drowned: { flame: 0xd9c9ff, emissive: 0x6a4fd0, light: 0xb79cff },
  // The Last Keep is a LIVED-IN castle: soft candle-orange hearth light, warmer
  // and paler than the arena's hard ember (its undercroft alone burns the
  // crypt's cold blue, split per story in the authored build path).
  lastkeep: { flame: 0xffc27a, emissive: 0xcc6a1e, light: 0xffa14e },
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

// The Drowned Court (arena_drowned) uses the same clone-and-tint trick to
// read as a moonlit flooded ruin instead of a recolored Coliseum: cold
// blue-slate walls and colonnades over dark waterlogged flagstones, so the
// pit's identity shows at EVERY graphics tier (tints are plain material
// colors, unlike the glow decals the low tier sheds).
// Tuned against max-preset captures: dark enough to kill the Coliseum's warm
// beige read, light enough that fighters and cover still stand out on the
// nave (the mood comes from the moonfire lights and the flood, not from
// crushing the stone albedo).
const DROWNED_WALL_TINT = 0x8b9cb8;
const DROWNED_FLOOR_TINT = 0x93a2b4;

// The Last Keep multiplies the shared crypt-stone pack toward warm, kept
// sandstone (walls) and honeyed flags (floors) so the castle reads lived-in
// rather than sepulchral; deliberately pale so the warm torchlight still
// carries the mood. Applied through the same tintedMaterial path an authored
// rift style uses, so no other interior is touched.
const KEEP_WALL_TINT = 0xe4d6bd;
const KEEP_FLOOR_TINT = 0xdccdb2;

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
  // The Infernal Citadel's authored halls hang blood-red war banners (the kit
  // already ships them; the crypt's pale ones read as bedsheets under its grade).
  'banner_red',
  'banner_triple_red',
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
if (typeof window !== 'undefined') registerDeferredPreload(() => ensureDungeonAssets());

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
  /**
   * Every tinted grade of a pack material, keyed `${pack}:${tint}`: the marsh
   * and Drowned Court wall/floor tints and any authored InteriorStyle grade all
   * share this one cache, built once per DungeonInteriors instance and reused
   * for every room, never cloned per room or mesh.
   */
  private tintedMats = new Map<string, THREE.Material>();
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
      // Rift hazards render as molten lava instead of the delve's blackwater; the
      // sim damage model is shared, only the palette differs.
      hazardStyle?: 'blackwater' | 'lava';
      // Rift ice-slide zone (frictionless slick you skate across to the goal
      // sigil): a pale frost sheet over this rect, purely cosmetic.
      iceZone?: { x: number; z: number; hw: number; hd: number } | null;
      // Rift raised "sanctum" tier: a full-width staircase (rampZ0 to rampZ1) up to
      // a raised rear deck at `height`. The geometry matches the sim height field
      // (riftPlatformLift), so the player stands exactly on the rendered deck.
      platform?: { rampZ0: number; rampZ1: number; height: number } | null;
      moduleId?: DelveModuleId;
      // Procedural Rift re-grade: a generated palette layered over one of the four
      // base kits. `style.kit` picks the wall/floor/prop mesh mix; `style.torch`
      // overrides the torch/light colours. Undefined for authored dungeons/delves.
      style?: InteriorStyle;
    },
  ): Promise<THREE.Group> {
    await ensureDungeonAssets();
    if (interior === 'wildheart') {
      const group = buildWildheartFieldInterior({
        lowGfx: this.lowGfx,
        flames: this.flames,
        fireLights: this.fireLights,
      });
      group.position.set(ox, 0, oz);
      group.userData.renderCategory = 'dungeon';
      this.scene.add(group);
      return group;
    }
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
            ? // per-slot arena map: same parity selection collision uses
              // (arenaCollidersForSlot), resolved from the instance origin
              arenaMapForSlot(arenaOriginAt(oz).slot).layout
            : interior === 'nythraxis'
              ? NYTHRAXIS_LAYOUT
              : interior === 'lastkeep'
                ? // The Last Keep: an authored room-graph castle interior; its
                  // rooms/doors/decor route the build through the authored path
                  // below, exactly like the citadel's set-piece floors.
                  LASTKEEP_LAYOUT
                : CRYPT_LAYOUT);
    const variant = opts?.style?.kit ?? opts?.variant ?? this.variantFor(interior, ox, oz);
    const torch = opts?.style?.torch ?? TORCH_COLORS[variant];
    const daisRaised = opts?.style?.daisRaised;
    const group = new THREE.Group();
    const p = new Placements();
    const arenaWalls = isArenaVariant(variant) ? this.pendingArenaWalls(layout, ox, oz) : undefined;

    // Authored room-graph floor (the set-piece citadel): its rooms/doors/decor
    // replace the single-room shell entirely. Walls come from the SAME segment
    // helper the sim derives collision from, so they cannot drift apart.
    if (layout.rooms) {
      await ensureInfernalDecorAssets();
      this.placeAuthoredFloor(p, layout, variant);
      this.placeAuthoredWalls(p, layout, variant);
      this.placeAuthoredRelief(group, layout);
      const liftAt = (x: number, z: number): number =>
        authoredLiftAt(layout.rooms ?? [], layout.doors ?? [], x, z);
      const light = (x: number, z: number, color: number, y?: number, scale?: number): void =>
        this.addInfernalLight(group, x, z, color, y, scale);
      if (variant === 'lastkeep') {
        // The keep's stories light differently: the undercroft (the one
        // dungeon-flavored story) keeps the crypt's cold blue flame while the
        // lived-in floors above burn warm candle-orange, so the same decor
        // list splits by the story its position sits on.
        const decor = layout.decor ?? [];
        buildInfernalDecor(
          group,
          decor.filter((d) => liftAt(d.x, d.z) < 1.6),
          TORCH_COLORS.crypt,
          light,
          liftAt,
        );
        buildInfernalDecor(
          group,
          decor.filter((d) => liftAt(d.x, d.z) >= 1.6),
          torch,
          light,
          liftAt,
        );
        // The lived-in furnishing: kcas bookcases, tables, benches, kegs,
        // banners, and mounted torches instanced along the authored room walls.
        await ensureLastKeepDressing();
        buildLastKeepDressing(group, light, this.lowGfx);
      } else {
        buildInfernalDecor(group, layout.decor ?? [], torch, light, liftAt);
      }
      this.placeDais(group, p, layout, variant, torch, daisRaised);
      if (opts?.hazards?.length) {
        this.placeBlackwaterPools(group, opts.hazards, opts?.hazardStyle ?? 'lava', liftAt);
      }
      if (layout.illusionWalls?.length) {
        this.placeIllusionWalls(group, layout.illusionWalls, variant);
      }
      // The authored floor honours its InteriorStyle's stone grade (the base kit
      // reads as grey crypt otherwise). Scoped to this path: the procedural rift
      // floors keep the look they shipped with; the keep grades its stone warm.
      this.emit(group, p, variant, {
        wall: opts?.style?.wallTint ?? (variant === 'lastkeep' ? KEEP_WALL_TINT : undefined),
        floor: opts?.style?.floorTint ?? (variant === 'lastkeep' ? KEEP_FLOOR_TINT : undefined),
      });
      group.position.set(ox, 0, oz);
      group.userData.renderCategory = 'dungeon';
      this.scene.add(group);
      return group;
    }

    this.placeFloor(p, layout, variant);
    this.placeWalls(p, layout, variant, arenaWalls);
    this.placePillarsAndTorches(group, p, layout, variant, torch);
    this.placeTombs(p, layout, variant);
    this.placeStubs(p, layout.stubs, variant);
    this.placeDais(group, p, layout, variant, torch, daisRaised);
    this.placeAisleClutter(p, layout, variant);
    this.placeWallDressing(p, layout, variant, arenaWalls);
    if (variant === 'temple') {
      this.placeFloodwater(group, layout);
      this.placeAquaticDressing(group, layout);
    }
    if (variant === 'arena_drowned') {
      this.placeArenaWaterBands(group, layout);
      // kelp climbing the colonnades and lily pads drifting on the flooded
      // aisles: the temple's aquatic dressing reads straight off the layout,
      // and its placement ranges (pads |x| 9..18, kelp |x| 13..20) land
      // entirely inside the flooded aisles here.
      this.placeAquaticDressing(group, layout);
    }
    if (opts?.hazards?.length) {
      if (variant === 'delve_marsh' || variant === 'delve_marsh_apse') {
        placeMarshBlackwaterPools(group, opts.hazards, (x, z, color, y, scale) =>
          this.addTorchGlow(group, x, z, color, y, scale),
        );
      } else {
        this.placeBlackwaterPools(group, opts.hazards, opts?.hazardStyle ?? 'blackwater');
      }
    }
    if (opts?.iceZone) this.placeIceSheet(group, opts.iceZone);
    if (opts?.platform) this.placeRiftPlatform(group, layout, opts.platform);
    if (layout.illusionWalls?.length) this.placeIllusionWalls(group, layout.illusionWalls, variant);
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
      for (const wall of arenaWalls.all) this.emitArenaHideable(group, wall, variant);
    }
    group.position.set(ox, 0, oz);
    group.userData.renderCategory = 'dungeon';
    this.scene.add(group);
    return group;
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

  // The Drowned Court's water: both aisles flood ankle-deep (the colonnades
  // and reliquaries rise out of the water) while the processional nave stays
  // dry, sized by the pure core (arena_water_band_core.ts) and sharing the
  // temple's self-animating water material, so there is no new shader and no
  // new per-frame plumbing. The sheets carry no collision: arena floors are
  // gameplay-flat by contract. Bioluminescent pools breathe along each
  // flooded aisle (skipped on the low tier like every glow decal).
  private placeArenaWaterBands(group: THREE.Group, layout: DungeonLayout): void {
    for (const b of arenaWaterBands(layout)) {
      if (b.width <= 0 || b.depth <= 0) continue;
      const geo = new THREE.PlaneGeometry(b.width, b.depth).rotateX(-Math.PI / 2);
      geo.translate(b.x, 0.14, b.z);
      const sheet = new THREE.Mesh(geo, this.templeWaterMaterial());
      sheet.renderOrder = 1; // floats over the floor tiles
      group.add(sheet);
    }
    const aisleX =
      ARENA_WATER_NAVE_HALF_X + (DUNGEON_WALL_X - DUNGEON_WALL_HW - ARENA_WATER_NAVE_HALF_X) / 2;
    for (let z = layout.zMin + 10; z < layout.zMax - 8; z += 16) {
      for (const side of [-1, 1]) {
        this.addTorchGlow(group, side * aisleX, z, 0x37e6cf, 0.22, 1.3);
      }
    }
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
    hazards: Array<{ x: number; z: number; r: number; rx?: number; rz?: number }>,
    style: 'blackwater' | 'lava' = 'blackwater',
    liftAt?: (x: number, z: number) => number,
  ): void {
    // Rift lava reuses the delve blackwater overlay with a molten palette: the
    // sim damage model (tickRiftHazards) mirrors tickDelveBlackwater, so the
    // hazard reads identically, only the colour changes. Bands can be ellipses
    // (rx/rz), so the disc is a unit circle scaled to match the sim footprint.
    const pal =
      style === 'lava'
        ? { pool: 0xd83410, poolOpacity: 0.9, rim: 0xffca4a, glow: 0xff5a1e }
        : { pool: 0x0a1a12, poolOpacity: 0.82, rim: 0x3fae5a, glow: 0x2f8f4f };
    for (const h of hazards) {
      const rx = h.rx ?? h.r;
      const rz = h.rz ?? h.r;
      const y0 = liftAt?.(h.x, h.z) ?? 0;
      const pool = new THREE.Mesh(
        new THREE.CircleGeometry(1, 28)
          .rotateX(-Math.PI / 2)
          .scale(rx, 1, rz)
          .translate(h.x, 0.12 + y0, h.z),
        new THREE.MeshBasicMaterial({
          color: pal.pool,
          transparent: true,
          opacity: pal.poolOpacity,
          depthWrite: false,
        }),
      );
      pool.renderOrder = 1; // floats over the floor tiles
      group.add(pool);
      // A hot/bog rim so the edge of the hazard is unmistakable.
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(0.82, 1, 32)
          .rotateX(-Math.PI / 2)
          .scale(rx, 1, rz)
          .translate(h.x, 0.14 + y0, h.z),
        new THREE.MeshBasicMaterial({
          color: pal.rim,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      rim.renderOrder = 2;
      group.add(rim);
      this.addTorchGlow(
        group,
        h.x,
        h.z,
        pal.glow,
        (style === 'lava' ? 0.55 : 0.3) + y0,
        Math.max(rx, rz) * 0.6,
      );
    }
  }

  // The ice-slide slick: a pale, faintly glowing frost sheet the player skates
  // across (the sim gives it near-zero friction). Cosmetic only; the slide is
  // resolved server-side in updateRiftTriggers.
  private placeIceSheet(
    group: THREE.Group,
    zone: { x: number; z: number; hw: number; hd: number },
  ): void {
    // A brighter frost margin peeks out around the inner sheet, giving the slick
    // a clean glowing border so its edge (where you regain footing) reads.
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(zone.hw * 2 + 1.4, zone.hd * 2 + 1.4)
        .rotateX(-Math.PI / 2)
        .translate(zone.x, 0.07, zone.z),
      new THREE.MeshBasicMaterial({
        color: 0x9fe8ff,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.renderOrder = 1;
    group.add(halo);
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(zone.hw * 2, zone.hd * 2)
        .rotateX(-Math.PI / 2)
        .translate(zone.x, 0.09, zone.z),
      new THREE.MeshBasicMaterial({
        color: 0xdff6ff,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    );
    sheet.renderOrder = 2;
    group.add(sheet);
  }

  // The rift raised "sanctum" tier: a full-width staircase (rampZ0 to rampZ1) up to
  // a raised rear deck at `height`. Built in instance-local space (the group is
  // seated at the instance origin), and the deck top lands at y=height so it lines
  // up with the sim height field (riftPlatformLift): the player stands ON it.
  // Illusion (fake) walls: solid-looking stone panels that carry NO collider (the
  // sim omits them from layoutColliders), so the player walks through them into the
  // hidden treasure pocket. Rendered as a plain stone box matching the murky wall
  // read; a curious explorer pushing into the "dead end" passes clean through.
  private placeIllusionWalls(group: THREE.Group, walls: WallStub[], variant: Variant): void {
    const mat = new THREE.MeshLambertMaterial({
      color: variant === 'temple' ? 0x3a4a52 : 0x54525c,
      emissive: 0x080810,
    });
    for (const w of walls) {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(w.hw * 2, DUNGEON_WALL_HEIGHT, w.hd * 2),
        mat,
      );
      panel.position.set(w.x, DUNGEON_WALL_HEIGHT / 2, w.z);
      panel.castShadow = true;
      panel.receiveShadow = true;
      group.add(panel);
    }
  }

  /** Solid risers under every lifted authored room, plus stair runs across each
   * door that joins rooms of different lift. Box tops follow the same linear
   * ramp authoredLiftAt gives the sim, so what you climb is what the sim
   * stands you on (the sub-step mismatch is the platform stairs' own). */
  private placeAuthoredRelief(group: THREE.Group, layout: DungeonLayout): void {
    const rooms = layout.rooms ?? [];
    const doors = layout.doors ?? [];
    if (!rooms.some((r) => (r.lift ?? 0) !== 0)) return;
    const mat = new THREE.MeshLambertMaterial({ color: 0x4a4652, emissive: 0x0a0a12 });
    for (const r of rooms) {
      const lift = r.lift ?? 0;
      if (lift <= 0) continue;
      // Top sits a hair below the tile tops so the slab never z-fights them.
      const riser = new THREE.Mesh(
        new THREE.BoxGeometry(r.x1 - r.x0 + 2, lift - 0.02, r.z1 - r.z0 + 2),
        mat,
      );
      riser.position.set((r.x0 + r.x1) / 2, (lift - 0.02) / 2, (r.z0 + r.z1) / 2);
      riser.receiveShadow = true;
      group.add(riser);
    }
    for (const d of doors) {
      const south = rooms.find((r) => r.z1 === d.z && d.x >= r.x0 && d.x <= r.x1);
      const north = rooms.find((r) => r.z0 === d.z && d.x >= r.x0 && d.x <= r.x1);
      if (south && north) {
        const a = south.lift ?? 0;
        const b = north.lift ?? 0;
        if (a === b) continue;
        const h = doorRampHalf(d.hd, b - a);
        const width = d.hw * 2 + 1;
        const steps = Math.max(4, Math.min(16, Math.round((2 * h) / 0.9)));
        const depth = (2 * h) / steps;
        for (let i = 0; i < steps; i++) {
          const zMid = d.z - h + (i + 0.5) * depth;
          const top = Math.max(0.05, a + ((b - a) * (i + 0.5)) / steps);
          const step = new THREE.Mesh(new THREE.BoxGeometry(width, top, depth + 0.05), mat);
          step.position.set(d.x, top / 2, zMid);
          step.receiveShadow = true;
          group.add(step);
        }
        continue;
      }
      const west = rooms.find((r) => r.x1 === d.x && d.z >= r.z0 && d.z <= r.z1);
      const east = rooms.find((r) => r.x0 === d.x && d.z >= r.z0 && d.z <= r.z1);
      if (west && east) {
        const a = west.lift ?? 0;
        const b = east.lift ?? 0;
        if (a === b) continue;
        const h = doorRampHalf(d.hw, b - a);
        const width = d.hd * 2 + 1;
        const steps = Math.max(4, Math.min(16, Math.round((2 * h) / 0.9)));
        const depth = (2 * h) / steps;
        for (let i = 0; i < steps; i++) {
          const xMid = d.x - h + (i + 0.5) * depth;
          const top = Math.max(0.05, a + ((b - a) * (i + 0.5)) / steps);
          const step = new THREE.Mesh(new THREE.BoxGeometry(depth + 0.05, top, width), mat);
          step.position.set(xMid, top / 2, d.z);
          step.receiveShadow = true;
          group.add(step);
        }
      }
    }
  }

  private placeRiftPlatform(
    group: THREE.Group,
    layout: DungeonLayout,
    platform: { rampZ0: number; rampZ1: number; height: number },
  ): void {
    const { rampZ0, rampZ1, height } = platform;
    const halfW = Math.min((layout.wallX ?? 18) - 0.5, 22);
    const mat = new THREE.MeshLambertMaterial({ color: 0x4a4652, emissive: 0x0a0a12 });
    // Raised rear deck: a solid riser from the floor up to the platform surface.
    const deckDepth = Math.max(2, layout.zMax - rampZ1);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2, height, deckDepth), mat);
    deck.position.set(0, height / 2, rampZ1 + deckDepth / 2);
    deck.receiveShadow = true;
    group.add(deck);
    // Full-width staircase rising 0 to height; each step's top approximates the
    // linear lift at its centre (the tiny sub-step mismatch is imperceptible). Step
    // count scales with the ramp length (~2yd tread) so both a short steep sanctum
    // and a long gentle climb read as proper stairs, not a few giant blocks.
    const rampLen = rampZ1 - rampZ0;
    const steps = Math.max(5, Math.min(20, Math.round(rampLen / 2.2)));
    const stepDepth = rampLen / steps;
    for (let i = 0; i < steps; i++) {
      const topY = (height * (i + 1)) / steps;
      const step = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2, topY, stepDepth + 0.05), mat);
      step.position.set(0, topY / 2, rampZ0 + (i + 0.5) * stepDepth);
      step.receiveShadow = true;
      group.add(step);
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
  private variantFor(interior: string, ox: number, oz: number): Variant {
    // Arena slots host fixed maps by parity (EVEN = Coliseum, ODD = Drowned
    // Court). The map id comes from the SAME arenaMapForSlot the sim's
    // colliders use, so look and collision cannot disagree on parity.
    if (interior === 'arena') {
      return arenaMapForSlot(arenaOriginAt(oz).slot).id === 'drowned_court'
        ? 'arena_drowned'
        : 'arena';
    }
    if (interior === 'nythraxis') return 'nythraxis';
    if (interior === 'sanctum') return 'sanctum';
    if (interior === 'temple') return 'temple';
    // The Last Keep gets its own warm castle grade (clean stone, candle light,
    // kcas furniture). Explicit so the overflow band's origin x can never
    // accidentally trip the bastion-band check below.
    if (interior === 'lastkeep') return 'lastkeep';
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
    return this.tintedMaterial(pack, surface === 'wall' ? MARSH_WALL_TINT : MARSH_FLOOR_TINT);
  }

  private drownedMaterial(pack: Pack, surface: 'wall' | 'floor'): THREE.Material {
    return this.tintedMaterial(pack, surface === 'wall' ? DROWNED_WALL_TINT : DROWNED_FLOOR_TINT);
  }

  /** A pack material multiplied by an arbitrary 0xRRGGBB grade, cached per
   * (pack, tint). The same trick marshMaterial plays, generalized so an authored
   * floor can carry its InteriorStyle's wall/floor tint. */
  private tintedMaterial(pack: Pack, tint: number): THREE.Material {
    const key = `${pack}:${tint}`;
    let mat = this.tintedMats.get(key);
    if (mat) return mat;
    // this.material(pack) is already a clone of the immutable GLB cache source;
    // clone again so the tint never mutates the shared pack material.
    const base = this.material(pack).clone() as
      | THREE.MeshLambertMaterial
      | THREE.MeshStandardMaterial;
    base.color.multiply(new THREE.Color(tint));
    mat = base;
    this.tintedMats.set(key, mat);
    return mat;
  }

  private emit(
    group: THREE.Group,
    p: Placements,
    variant: Variant,
    tints?: { wall?: number; floor?: number },
  ): void {
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
      else if (tints?.wall !== undefined && WALL_PILLAR_KINDS.has(kind))
        mat = this.tintedMaterial(asset.pack, tints.wall);
      else if (tints?.floor !== undefined && RECEIVER_KINDS.has(kind))
        mat = this.tintedMaterial(asset.pack, tints.floor);
      else if (variant === 'arena_drowned' && WALL_PILLAR_KINDS.has(kind))
        mat = this.drownedMaterial(asset.pack, 'wall');
      else if (variant === 'arena_drowned' && RECEIVER_KINDS.has(kind))
        mat = this.drownedMaterial(asset.pack, 'floor');
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

  private emitArenaHideable(group: THREE.Group, pending: PendingArenaWall, variant: Variant): void {
    const wallGroup = new THREE.Group();
    const mats: ToggleMat[] = [];
    for (const [kind, matrices] of pending.placements.byKind) {
      const asset = moduleAssets.get(kind);
      if (!asset) {
        console.warn(`dungeon: unknown arena wall module kind '${kind}'`);
        continue;
      }
      const material = this.material(asset.pack).clone();
      // Hideable walls bypass emit(), so the Drowned Court's wet-stone tint is
      // applied to this per-wall clone directly (structural stone only: the
      // banners keep their true colors, same scoping as the marsh tint).
      if (variant === 'arena_drowned' && WALL_PILLAR_KINDS.has(kind)) {
        (material as THREE.MeshLambertMaterial | THREE.MeshStandardMaterial).color.multiply(
          new THREE.Color(DROWNED_WALL_TINT),
        );
      }
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
    // The Drowned Court dresses as the temple (flooded flagstones, pale walls,
    // faded banners); structural placement keys on the real variant elsewhere.
    if (variant === 'arena_drowned') return this.floorKind('temple', t);
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
    if (variant === 'lastkeep') {
      // a KEPT castle floor: whole flags with decorated insets, no dirt, no
      // weeds, no grates (the undercroft cells re-key to the crypt mix)
      return pickKind(
        [
          ['floor_tile_large', 72],
          ['floor_tile_large_rocks', 3],
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
    if (variant === 'arena_drowned') return this.floorQuadKind('temple', t);
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
    if (variant === 'lastkeep') {
      // swept castle flags: mostly whole slabs. The decorated tile carries a
      // baked candle cluster, so its share stays LOW: a lit votive here and
      // there reads lived-in, a hall full of them reads like a vigil.
      return pickKind(
        [
          ['floor_tile_small', 70],
          ['floor_tile_small_decorated', 12],
          ['floor_tile_small_broken_A', 9],
          ['floor_tile_small_broken_B', 9],
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

  // Authored room-graph floor: tile each room's rectangle with the SAME
  // variant-keyed floor modules the procedural rooms use, masked to the union of
  // the rooms (so the solid rock between them stays bare).
  private placeAuthoredFloor(p: Placements, layout: DungeonLayout, variant: Variant): void {
    const rooms = layout.rooms ?? [];
    if (rooms.length === 0) return;
    const doors = layout.doors ?? [];
    const quarter = Math.PI / 2;
    const inside = (x: number, z: number): boolean =>
      rooms.some((r) => x >= r.x0 - 1 && x <= r.x1 + 1 && z >= r.z0 - 1 && z <= r.z1 + 1);
    // Per-room raised floors: a tile sits at its room's lift; a cell whose exact
    // lift differs (a door ramp band) is left to the relief stairs instead.
    const roomLift = (x: number, z: number): number =>
      rooms.find((r) => x >= r.x0 - 1 && x <= r.x1 + 1 && z >= r.z0 - 1 && z <= r.z1 + 1)?.lift ??
      0;
    const inRampBand = (x: number, z: number): boolean =>
      Math.abs(authoredLiftAt(rooms, doors, x, z) - roomLift(x, z)) > 0.01;
    const minX = Math.min(...rooms.map((r) => r.x0)) - 2;
    const maxX = Math.max(...rooms.map((r) => r.x1)) + 2;
    const minZ = Math.min(...rooms.map((r) => r.z0)) - 2;
    const maxZ = Math.max(...rooms.map((r) => r.z1)) + 2;
    // The Last Keep's undercroft (lift below the state floor) keeps the crypt's
    // cracked, weeded flags while the lived-in stories above tile clean: the
    // per-cell room lift already says which story a tile belongs to.
    const cellVariant = (x: number, z: number): Variant =>
      variant === 'lastkeep' && roomLift(x, z) < 1.6 ? 'crypt' : variant;
    for (let z = minZ; z <= maxZ; z += FLOOR_CELL) {
      for (let x = minX; x <= maxX; x += FLOOR_CELL) {
        if (!inside(x, z) || inRampBand(x, z)) continue;
        const y = FLOOR_Y + roomLift(x, z);
        let kind = this.floorKind(cellVariant(x, z), hash2(x * 1.31, z));
        if (kind === 'grate') kind = 'floor_tile_large'; // no pits in an authored floor
        if (kind === 'quad') {
          for (const dx of [-1, 1]) {
            for (const dz of [-1, 1]) {
              if (!inside(x + dx, z + dz) || inRampBand(x + dx, z + dz)) continue;
              const sub = this.floorQuadKind(cellVariant(x + dx, z + dz), hash2(x + dx, z + dz));
              const rot = Math.floor(hash2(z + dz, x + dx) * 4) * quarter;
              p.add(sub, x + dx, FLOOR_Y + roomLift(x + dx, z + dz), z + dz, rot);
            }
          }
          continue;
        }
        const rot = Math.floor(hash2(z, x) * 4) * quarter;
        p.add(kind, x, y, z, rot);
      }
    }
  }

  // Authored walls: one run of ~8u modules along every wall segment the sim's
  // `authoredWallSegments` produced (doorway gaps already subtracted), each turned
  // to face into the room it borders. The fitted wall ends frame each opening on
  // their own: placing a nominal "arched wall" in the gap visually sealed doors
  // even though the shared sim collider correctly left them open.
  private placeAuthoredWalls(p: Placements, layout: DungeonLayout, variant: Variant): void {
    const rooms = layout.rooms ?? [];
    const doors = layout.doors ?? [];
    const bannerEvery = variant === 'crypt' ? 4 : 3;
    const isKeep = variant === 'lastkeep';
    const openAt = (x: number, z: number): boolean =>
      rooms.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
    // Highest lift among the rooms a wall segment borders: says which story the
    // wall belongs to (the keep's undercroft keeps cracked crypt stone, and the
    // lookout's parapet row is shortened so it stays an OPEN rooftop).
    const segMaxLift = (seg: WallSeg): number => {
      let best = 0;
      for (const r of rooms) {
        const touches =
          seg.axis === 'x'
            ? (r.z0 === seg.fixed || r.z1 === seg.fixed) && r.x1 > seg.a && r.x0 < seg.b
            : (r.x0 === seg.fixed || r.x1 === seg.fixed) && r.z1 > seg.a && r.z0 < seg.b;
        if (touches) best = Math.max(best, r.lift ?? 0);
      }
      return best;
    };
    const segRy = (seg: WallSeg): number => {
      const mid = (seg.a + seg.b) / 2;
      if (seg.axis === 'x') return openAt(mid, seg.fixed + 1.5) ? 0 : Math.PI;
      return openAt(seg.fixed + 1.5, mid) ? Math.PI / 2 : -Math.PI / 2;
    };
    let i = 0;
    for (const seg of authoredWallSegments(rooms, doors)) {
      const cells = fitAuthoredWallSegment(seg.a, seg.b, 8);
      // Face the wall detail into an adjacent room (either one, when it is shared).
      const ry = segRy(seg);
      const segVariant: Variant = isKeep && segMaxLift(seg) < 1.6 ? 'crypt' : variant;
      for (const cell of cells) {
        const t = cell.center;
        const x = seg.axis === 'x' ? t : seg.fixed;
        const z = seg.axis === 'x' ? seg.fixed : t;
        const kind = this.wallKind(segVariant, hash2(x * 13.7, z));
        const scale: [number, number, number] = [cell.length / 4, MODULE_SCALE, MODULE_SCALE];
        p.add(kind, x, 0, z, ry, scale);
        // The keep hangs its red kcas banners from the lastkeep dressing pass
        // instead of the kit's crypt hangings.
        if (!isKeep && i % bannerEvery === 2 && kind !== 'wall_archedwindow_gated') {
          const banner = hash2(z, x * 7.3) < 0.5 ? 'banner_red' : 'banner_triple_red';
          p.add(banner, x, 0, z, ry, scale);
        }
        i++;
      }
    }
    if (!isKeep) return;
    // ---- The Last Keep's SECOND wall storey ----
    // One 8u module row is only wall-top 8, which the residence floor (lift 6)
    // and tower would poke straight through. Stack a second row at y=8 so the
    // state floor soars (13u of wall over its 3.0 floor) and the residence
    // keeps 10u. The row is cut by the SAME door openings as the base row:
    // capping a low doorway looks like a lintel but puts the chase camera
    // inside the solid cap whenever it trails the player through a door (the
    // cap carries no collider, so the boom happily enters it and the frame
    // blacks out). Tall open archways cost that lintel read but keep every
    // doorway camera-safe. Segments bordering the lookout (lift 9) shorten to
    // a parapet so the tower top stays an open rooftop.
    for (const seg of authoredWallSegments(rooms, doors)) {
      const maxLift = segMaxLift(seg);
      const ry = segRy(seg);
      const upperVariant: Variant = maxLift < 1.6 ? 'crypt' : 'lastkeep';
      const sy = maxLift >= 8 ? 0.75 : MODULE_SCALE; // lookout parapet: 3u, not 8u
      for (const cell of fitAuthoredWallSegment(seg.a, seg.b, 8)) {
        const t = cell.center;
        const x = seg.axis === 'x' ? t : seg.fixed;
        const z = seg.axis === 'x' ? seg.fixed : t;
        let kind = this.wallKind(upperVariant, hash2(x * 7.1, z * 3.3));
        if (kind === 'wall_arched') kind = 'wall'; // no archways floating at mid-wall
        p.add(kind, x, DUNGEON_WALL_HEIGHT, z, ry, [cell.length / 4, sy, MODULE_SCALE]);
      }
    }
  }

  private wallKind(variant: Variant, t: number): string {
    if (variant === 'arena_drowned') return this.wallKind('temple', t);
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
    if (variant === 'lastkeep') {
      // the kept castle: clean coursed masonry, engaged pillars, arched bays
      // and the odd barred window, and NO cracked stone (the undercroft's wall
      // runs re-key to the crypt mix in placeAuthoredWalls)
      return pickKind(
        [
          ['wall', 56],
          ['wall_pillar', 24],
          ['wall_arched', 13],
          ['wall_archedwindow_gated', 7],
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
    if (variant === 'arena_drowned') return this.bannerKind('temple', t);
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
    // Exact collider-run coverage (see dungeon_wall_segments.ts): each side/end
    // run is split into equal segments and one module is scaled to each span,
    // so the drawn shell always matches the collision shell (the legacy fixed
    // 8u grid left visual corner gaps whenever endWallHw was not module-aligned,
    // which a rift's arbitrary wallX + 1 almost never is).
    const shell = rectShellWallSegments(layout, DUNGEON_WALL_X, DUNGEON_END_WALL_HW);
    for (const side of [-1, 1]) {
      const target = arenaWalls
        ? side < 0
          ? arenaWalls.left.placements
          : arenaWalls.right.placements
        : p;
      const segments = side < 0 ? shell.left : shell.right;
      let i = 0;
      for (const seg of segments) {
        const kind = this.wallKind(variant, hash2(side * 13.7, seg.z));
        target.add(kind, seg.x, 0, seg.z, seg.ry, [seg.halfLength / 2, MODULE_SCALE, MODULE_SCALE]);
        if (i % bannerEvery === 2 && kind !== 'wall_archedwindow_gated') {
          target.add(
            this.bannerKind(variant, hash2(seg.z, side * 7.3)),
            seg.x,
            0,
            seg.z,
            seg.ry,
            MODULE_SCALE,
          );
        }
        i++;
      }
    }
    for (const end of [
      { segments: shell.front, atMin: true },
      { segments: shell.back, atMin: false },
    ]) {
      const target = arenaWalls
        ? end.atMin
          ? arenaWalls.front.placements
          : arenaWalls.back.placements
        : p;
      for (const seg of end.segments) {
        const kind = this.wallKind(variant, hash2(seg.x, seg.z * 3.1));
        target.add(kind, seg.x, 0, seg.z, seg.ry, [seg.halfLength / 2, MODULE_SCALE, MODULE_SCALE]);
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
    torch?: TorchColors,
  ): void {
    const kind =
      variant === 'sanctum' ||
      variant === 'temple' ||
      variant === 'arena_drowned' ||
      variant === 'delve_hall'
        ? 'pillar_decorated'
        : 'pillar';
    const colors = torch ?? TORCH_COLORS[variant];
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

  /** A real, budgeted light plus its baked floor pool for the authored citadel.
   * The nearest GFX-tier allowance shines; the rest remain zero-intensity, so the
   * richer authored lighting does not expand the forward-render light budget. */
  private addInfernalLight(
    group: THREE.Group,
    x: number,
    z: number,
    colorHex: number,
    y = 0.7,
    scale = 1,
  ): void {
    this.addTorchGlow(group, x, z, colorHex, y, scale);
    const base = this.lowGfx ? 10 : DUNGEON_LIGHT_INTENSITY * Math.min(1.35, 0.55 + scale * 0.3);
    const distance = this.lowGfx
      ? 20
      : DUNGEON_LIGHT_DISTANCE * Math.min(1.25, 0.65 + scale * 0.18);
    const light = new THREE.PointLight(colorHex, base, distance, 2);
    light.userData.baseIntensity = base;
    light.position.set(x, Math.max(2.8, y + 1.8), z);
    group.add(light);
    this.fireLights.push(light);
  }

  // Wall-side obstacles at +-19 (OBB 2.2 x 4.2): sarcophagi in the crypt and
  // sanctum-free; the drowned bastion stacks cargo in the same footprints.
  private placeTombs(p: Placements, layout: DungeonLayout, variant: Variant): void {
    if (variant === 'delve_marsh') {
      placeMarshTombs(p, layout);
      return;
    }
    for (const t of layout.tombs) {
      // The shared per-slot roll: the sim builds the slot's standable collider
      // from the SAME draw, so the prop drawn here is the surface stood on.
      const r = tombSlotRoll(t.x, t.z);
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
      if (variant === 'temple' || variant === 'arena_drowned') {
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

  // Chamber waists use variant-specific geometry derived from their authored
  // stub OBBs so their visible footprint stays aligned with collision.
  private placeStubs(p: Placements, stubs: WallStub[], variant: Variant): void {
    if (isArenaVariant(variant)) {
      // Arena cover is a narrow full-height wall rather than the large
      // sanctum chamber mass. The centered KayKit wall is 4u long and 1u
      // thick, so these scales map its visual bounds exactly onto the OBB.
      for (const s of stubs) {
        p.add('wall', s.x, 0, s.z, Math.PI / 2, [s.hd / 2, MODULE_SCALE, s.hw * 2]);
      }
      return;
    }
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
    // Derive every pier face from the stub's own collider OBB
    // (dungeon_wall_segments.ts). The legacy branch hardcoded the classic
    // crypt/sanctum geometry (cap at |x| 6, faces spanning |x| 5..23), which a
    // parameterized rift waist (passage half 7 to 8.5, piers out to a variable
    // wallX) turned into a phantom wall panel INSIDE the open passage plus an
    // uncovered invisible collider strip beyond |x| 23. Evaluated at the
    // classic stub geometry (hw 9 around |x| 14) these segments reproduce the
    // old faces exactly.
    const archAt = new Map<number, number>();
    for (const s of stubs) {
      const faces = stubFaceSegments(s);
      for (const seg of faces.caps) {
        p.add('wall', seg.x, 0, seg.z, seg.ry, [seg.halfLength / 2, MODULE_SCALE, MODULE_SCALE]);
      }
      let i = 0;
      for (const seg of faces.faces) {
        // Alternate the classic pillar-then-wall reading along each face.
        const kind = i % 2 === 0 ? 'wall_pillar' : 'wall';
        p.add(kind, seg.x, 0, seg.z, seg.ry, [seg.halfLength / 2, MODULE_SCALE, MODULE_SCALE]);
        i++;
      }
      const prior = archAt.get(s.z);
      archAt.set(s.z, prior === undefined ? faces.innerFaceX : Math.min(prior, faces.innerFaceX));
    }
    if (variant === 'sanctum' || variant === 'temple') {
      // The arch module spans ~10.4u; only span passages it actually fits
      // (classic half-5 aisles). A wider rift passage gets no floating arch.
      for (const [z, innerFaceX] of archAt) {
        if (innerFaceX <= 5.5) p.add('arch', 0, 0, z, 0, [2.6, 1.9, 2.0]);
      }
    }
  }

  // Boss dais: chunky circular platform of foundation blocks (DAIS_HEIGHT
  // high). The platform is REAL elevation: the sim's interior floor rises to
  // the same height (world.ts groundHeight via dungeon_floor.ts), so bodies
  // stand ON these blocks; there is still no obstacle collider.
  private placeDais(
    group: THREE.Group,
    p: Placements,
    layout: DungeonLayout,
    variant: Variant,
    torch?: TorchColors,
    daisRaisedOverride?: boolean,
  ): void {
    const d = layout.dais;
    const glow = (torch ?? TORCH_COLORS[variant]).light;
    // The arena and Nythraxis raid keep flat fighting floors: no raised platform
    // or rim clutter to visually disagree with the walkable sim collision. A rift
    // style can force either shape (daisRaisedOverride) independent of the kit.
    const raised = daisRaisedOverride ?? dungeonDaisHasRaisedPlatform(variant);
    if (!raised) {
      this.addTorchGlow(group, d.x, d.z, glow, 0.07, 2.4);
      return;
    }
    const quarter = Math.PI / 2;
    for (let x = -16; x <= 16; x += 4) {
      for (let z = -16; z <= 16; z += 4) {
        if (Math.hypot(x, z) > d.r) continue;
        const rot = Math.floor(hash2(x, z) * 4) * quarter;
        // y-scale = DAIS_PLATFORM_HEIGHT / 2 (2u blocks): ground cues (the
        // death-zone danger ring) lift by the same shared constant.
        p.add('floor_foundation_allsides', d.x + x, 0, d.z + z, rot, [
          1.85,
          DAIS_PLATFORM_HEIGHT / 2,
          1.85,
        ]);
      }
    }
    // ritual glow pooled on the dais top so the boss stage never reads as a
    // black slab (torch pillars stop short of the back chamber)
    this.addTorchGlow(group, d.x, d.z, glow, 0.68, 1.6);
    // rim decor (small, walk-through by design)
    const rim = d.r - 1.6;
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + 0.35;
      const x = d.x + Math.sin(ang) * rim;
      const z = d.z + Math.cos(ang) * rim;
      if (variant === 'bastion')
        p.add('candle_triple', x, DAIS_HEIGHT, z, hash2(x, z) * Math.PI, 1.3);
      else if (variant === 'sanctum')
        p.add(
          i % 2 ? 'skull_candle' : 'candle_triple',
          x,
          DAIS_HEIGHT,
          z,
          hash2(x, z) * Math.PI,
          1.4,
        );
      else if (variant === 'temple')
        p.add(
          i % 2 ? 'candle_triple' : 'shrine_candles',
          x,
          DAIS_HEIGHT,
          z,
          hash2(x, z) * Math.PI,
          1.3,
        );
      else if (variant === 'delve_finale' || variant === 'delve_marsh_apse')
        p.add(
          i % 2 ? 'skull_candle' : 'candle_triple',
          x,
          DAIS_HEIGHT,
          z,
          hash2(x, z) * Math.PI,
          1.4,
        );
      else p.add(i % 2 ? 'skull' : 'candle_lit', x, DAIS_HEIGHT, z, hash2(x, z) * Math.PI, 1.3);
    }
    if (variant === 'bastion') {
      // the drowned keep's plunder, heaped behind the dais
      p.add('chest_gold', d.x - 2.2, DAIS_HEIGHT, d.z + d.r - 3.4, Math.PI + 0.3, 1.4);
      p.add('coin_stack_medium', d.x + 1.8, DAIS_HEIGHT, d.z + d.r - 3.2, 0.8, 1.5);
      p.add('trunk_large_A', d.x + 4.6, 0, d.z + d.r + 1.2, Math.PI - 0.4, 1.5);
    }
    if (variant === 'temple') {
      // the goddess's tithe: pearls and coin heaped before the altar
      p.add('chest_gold', d.x + 2.4, DAIS_HEIGHT, d.z + d.r - 3.6, Math.PI - 0.3, 1.4);
      p.add('coin_stack_medium', d.x - 2.0, DAIS_HEIGHT, d.z + d.r - 3.4, -0.7, 1.5);
      p.add('skull_candle', d.x, DAIS_HEIGHT + 0.08, d.z, 0, 1.6); // the moon-idol at the altar's heart
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
    if (isArenaVariant(variant)) return; // the fighting floors stay clear of obstacles
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
    // The Drowned Court keeps bare moonlit walls: banners already come from
    // placeWalls, and the water bands + reliquary altars carry the theme.
    if (variant === 'arena_drowned') return;
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
