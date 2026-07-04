// The Gravemarch battleground environment (docs/prd/battlegrounds.md): an
// ashen war-field at dusk. Every wall, structure, chapel stub, and scatter
// prop is placed from src/sim/battleground_layout.ts, the SAME plain data
// colliders.ts derives BATTLEGROUND_COLLIDERS from, so what you see is what
// you collide with (the dungeon.ts / dungeon_layout.ts precedent).
//
// Dressing comes from the shipped CC0 kits only: the KayKit Dungeon
// Remastered kit (walls, banners, rubble, graves, bones), the KayKit hex pack
// (keep + tower silhouettes), Quaternius dead trees and rocks, and the
// ambientCG terrain PBR sets (Gravel024 ash field, PavingStones046 roads).
// Repeats render as InstancedMesh per (model part, tint): the whole map is a
// few dozen draws, comparable to a dungeon interior.
//
// Team truth: team A = Ember Company = RED, south base (negative local z);
// team B = Pale Company = BLUE, north base. Brazier flames, warstone glow,
// and banner sets follow that split; tints are chosen to read on the low
// (Lambert) tier too.
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BG_BASE_WALL_Z,
  BG_CHAPEL_R,
  BG_CHAPEL_STUBS,
  BG_HALF_X,
  BG_HALF_Z,
  BG_KNELL_POS,
  BG_LANE_GATE_X,
  BG_LANE_ROAD_HALF_W,
  BG_SCATTER,
  BG_STRUCTURES,
  BG_WALL_H,
  BG_WARSTONE_DAIS_R,
  BG_WARSTONE_Z,
  type BgLane,
  type BgPoint,
  type BgScatterKind,
  type BgStructureDef,
  type BgTeam,
  bgLaneWaypoints,
} from '../sim/battleground_layout';
import { hash2 } from '../sim/rng';
import type { IWorld } from '../world_api';
import { loadGltf, loadTexture, releaseGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX, sharedUniforms, surfaceMat } from './gfx';
import { radialGlowTexture } from './textures';
import type { Vfx } from './vfx';

// deterministic per-prop hash seed (never Math.random; render convention)
const SEED = 0x67726176; // 'grav'

// warstone stone-body emissive while alive (setStructureAlive restores it);
// kept modest so the monolith reads soul-lit, not an orange slab up close
const WARSTONE_EMISSIVE = 0.2;

// ---------------------------------------------------------------------------
// Team look. Ember (A) burns warm red-orange, Pale (B) burns cold blue: the
// same per-variant flame/emissive/light pattern the dungeon interiors use.
// ---------------------------------------------------------------------------
interface TeamLook {
  flame: number;
  flameEmissive: number;
  light: number;
  glowBright: number;
  glowDim: number;
  ember1: [number, number, number];
  ember2: [number, number, number];
  bannerWide: string;
  bannerTall: string;
  bannerShield: string;
}

const TEAM_LOOK: Record<BgTeam, TeamLook> = {
  A: {
    flame: 0xffa24a,
    flameEmissive: 0xe04a18,
    light: 0xff7a3c,
    glowBright: 0xff5a26,
    glowDim: 0x401008,
    ember1: [1.0, 0.22, 0.08],
    ember2: [1.0, 0.55, 0.2],
    bannerWide: 'banner_patterna_red',
    bannerTall: 'banner_triple_red',
    bannerShield: 'banner_shield_red',
  },
  B: {
    flame: 0x9fd8ff,
    flameEmissive: 0x2b7fd0,
    light: 0x5f9fff,
    glowBright: 0x3f86ff,
    glowDim: 0x0a1a40,
    ember1: [0.2, 0.45, 1.0],
    ember2: [0.6, 0.82, 1.0],
    bannerWide: 'banner_patterna_blue',
    bannerTall: 'banner_triple_blue',
    bannerShield: 'banner_shield_blue',
  },
};

// the Knell chapel keeps a neutral grave-light: pale ghost green
const CHAPEL_FLAME: TeamLook = {
  ...TEAM_LOOK.A,
  flame: 0xa8e8c0,
  flameEmissive: 0x2f8f5f,
  light: 0x6fd89a,
  glowBright: 0x4fbf7f,
  glowDim: 0x0a2a1a,
  ember1: [0.35, 0.9, 0.55],
  ember2: [0.7, 1.0, 0.8],
};

// ---------------------------------------------------------------------------
// Assets: real CC0 GLBs, loaded once at import and folded into the boot
// preload (tier-INDEPENDENT, the v0.16 lesson), geometry merged per source
// material so build reads resolved caches synchronously.
// ---------------------------------------------------------------------------

const MODEL_URLS: Record<string, string> = {
  wall: '/models/dungeon/wall.glb',
  wall_cracked: '/models/dungeon/wall_cracked.glb',
  wall_broken: '/models/dungeon/wall_broken.glb',
  wall_half: '/models/dungeon/wall_half.glb',
  wall_corner: '/models/dungeon/wall_corner.glb',
  arch_gate: '/models/dungeon/arch_gate.glb',
  pillar: '/models/dungeon/pillar.glb',
  post: '/models/dungeon/post.glb',
  rubble_large: '/models/dungeon/rubble_large.glb',
  rubble_half: '/models/dungeon/rubble_half.glb',
  banner_patterna_red: '/models/dungeon/banner_patterna_red.glb',
  banner_triple_red: '/models/dungeon/banner_triple_red.glb',
  banner_thin_red: '/models/dungeon/banner_thin_red.glb',
  banner_shield_red: '/models/dungeon/banner_shield_red.glb',
  banner_patterna_blue: '/models/dungeon/banner_patterna_blue.glb',
  banner_triple_blue: '/models/dungeon/banner_triple_blue.glb',
  banner_thin_blue: '/models/dungeon/banner_thin_blue.glb',
  banner_shield_blue: '/models/dungeon/banner_shield_blue.glb',
  banner_thin_white: '/models/dungeon/banner_thin_white.glb',
  banner_thin_brown: '/models/dungeon/banner_thin_brown.glb',
  gravestone: '/models/dungeon/gravestone.glb',
  grave_b: '/models/dungeon/grave_B.glb',
  gravemarker_a: '/models/dungeon/gravemarker_A.glb',
  ribcage: '/models/dungeon/ribcage.glb',
  skull: '/models/dungeon/skull.glb',
  bone_a: '/models/dungeon/bone_A.glb',
  candle_triple: '/models/dungeon/candle_triple.glb',
  fence_broken: '/models/dungeon/fence_broken.glb',
  hex_castle: '/models/biome/hex_castle.glb',
  hex_tower: '/models/biome/hex_tower.glb',
  bell_tower: '/models/props/bell_tower.glb',
  spear: '/models/weapons/spear_a.glb',
  halberd: '/models/weapons/halberd.glb',
  tree_dead_a: '/models/foliage/dead_1.glb',
  tree_dead_b: '/models/foliage/dead_2.glb',
  rock_a: '/models/foliage/rock_1.glb',
  rock_b: '/models/foliage/rock_2.glb',
};

interface BgModelPart {
  geo: THREE.BufferGeometry;
  srcMat: THREE.Material | null;
}

interface BgModel {
  parts: BgModelPart[];
  size: THREE.Vector3;
  minY: number;
}

const bgModels = new Map<string, BgModel>();
let bgAssetsPromise: Promise<void> | null = null;
const BG_TEX: Record<string, THREE.Texture> = {};

// Meshopt-quantized attributes are normalized ints; bake to plain floats so
// applyMatrix4/merge cannot clamp world-space values (dungeon.ts precedent).
function attributeToFloat(geo: THREE.BufferGeometry, name: string): void {
  const attr = geo.getAttribute(name);
  if (!attr || (attr.array instanceof Float32Array && !attr.normalized)) return;
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
  }
  geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
}

function extractModel(name: string, gltf: GLTF): void {
  const byMat = new Map<THREE.Material | null, THREE.BufferGeometry[]>();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = (mesh.geometry as THREE.BufferGeometry).clone();
    for (const attr of Object.keys(geo.attributes)) {
      if (attr !== 'position' && attr !== 'normal' && attr !== 'uv' && attr !== 'color') {
        geo.deleteAttribute(attr);
      }
    }
    attributeToFloat(geo, 'position');
    attributeToFloat(geo, 'normal');
    attributeToFloat(geo, 'uv');
    attributeToFloat(geo, 'color');
    geo.applyMatrix4(mesh.matrixWorld);
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const key = (mat as THREE.Material) ?? null;
    const list = byMat.get(key);
    if (list) list.push(geo);
    else byMat.set(key, [geo]);
  });
  const parts: BgModelPart[] = [];
  const box = new THREE.Box3();
  for (const [mat, geos] of byMat) {
    // mergeGeometries requires a consistent attribute set across the group
    const hasColor = geos.every((g) => g.getAttribute('color'));
    for (const g of geos) if (!hasColor && g.getAttribute('color')) g.deleteAttribute('color');
    const hasUv = geos.every((g) => g.getAttribute('uv'));
    for (const g of geos) if (!hasUv && g.getAttribute('uv')) g.deleteAttribute('uv');
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) continue;
    merged.computeBoundingBox();
    if (merged.boundingBox) box.union(merged.boundingBox);
    parts.push({ geo: merged, srcMat: mat });
  }
  if (!parts.length) throw new Error(`battleground model has no meshes: ${name}`);
  const size = new THREE.Vector3();
  box.getSize(size);
  bgModels.set(name, { parts, size, minY: box.min.y });
}

export function ensureBattlegroundAssets(): Promise<void> {
  bgAssetsPromise ??= Promise.all([
    ...Object.entries(MODEL_URLS).map(([name, url]) =>
      loadGltf(url).then((g) => {
        extractModel(name, g);
        releaseGltf(url);
      }),
    ),
    // ground + road PBR sets (ambientCG, shipped): unconditional so the
    // preload key set stays tier-independent (the low tier simply ignores
    // the normal maps).
    ...(
      [
        ['gravelC', '/textures/terrain/Gravel024_Color.jpg', true],
        ['gravelN', '/textures/terrain/Gravel024_NormalGL.jpg', false],
        ['pavingC', '/textures/terrain/PavingStones046_Color.jpg', true],
        ['pavingN', '/textures/terrain/PavingStones046_NormalGL.jpg', false],
      ] as const
    ).map(([key, url, srgb]) =>
      loadTexture(url, { srgb, repeat: true }).then((tex) => {
        tex.anisotropy = srgb ? 8 : 4;
        BG_TEX[key] = tex;
      }),
    ),
  ]).then(() => undefined);
  return bgAssetsPromise;
}

if (typeof window !== 'undefined') registerPreload(ensureBattlegroundAssets());

// ---------------------------------------------------------------------------
// Pure placement math (Node-testable; no THREE state).
// ---------------------------------------------------------------------------

/**
 * The full road polyline of a lane, warstone to warstone, derived from the
 * layout's team-A waypoints plus the short in-base approach the waypoints
 * leave implicit (they start AT the gate).
 */
export function bgRoadPolyline(lane: BgLane): BgPoint[] {
  const way = bgLaneWaypoints('A', lane);
  const gate = way[0];
  return [{ x: 0, z: -BG_WARSTONE_Z }, { x: gate.x, z: gate.z - 4 }, ...way];
}

export interface BgScatterPlacement {
  kind: BgScatterKind;
  x: number;
  z: number;
  yaw: number;
  /** 0..1 deterministic variant pick */
  variant: number;
  /** 0..1 deterministic size jitter */
  size: number;
}

/** Expand the layout's scatter records into deterministic transforms. */
export function bgScatterPlacements(): BgScatterPlacement[] {
  return BG_SCATTER.map((s) => ({
    kind: s.kind,
    x: s.x,
    z: s.z,
    yaw: hash2(s.seed, 1, SEED) * Math.PI * 2,
    variant: hash2(s.seed, 2, SEED),
    size: hash2(s.seed, 3, SEED),
  }));
}

// smoothed value noise on a grid (for the ground's large-scale mottling)
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function vnoise(x: number, z: number, cell: number, seed: number): number {
  const gx = Math.floor(x / cell);
  const gz = Math.floor(z / cell);
  const fx = smooth(x / cell - gx);
  const fz = smooth(z / cell - gz);
  const a = hash2(gx, gz, seed);
  const b = hash2(gx + 1, gz, seed);
  const c = hash2(gx, gz + 1, seed);
  const d = hash2(gx + 1, gz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

// distance from a point to a polyline (used to wear the ground under roads)
function polylineDistance(px: number, pz: number, line: BgPoint[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const ax = line[i].x;
    const az = line[i].z;
    const bx = line[i + 1].x;
    const bz = line[i + 1].z;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
    const qx = ax + dx * t;
    const qz = az + dz * t;
    best = Math.min(best, Math.hypot(px - qx, pz - qz));
  }
  return best;
}

// ---------------------------------------------------------------------------
// Shaders: the warstone soul-glow (delve portal precedent: uTime + HDR boost)
// and the self-animating grave-mist / ember point clouds.
// ---------------------------------------------------------------------------

const WARSTONE_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWPos;
  varying float vY;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWPos = wp.xyz;
    vY = position.y;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const WARSTONE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uHdr;
  uniform float uAlive;
  uniform vec3 uBright;
  uniform vec3 uDim;
  varying vec3 vNormal;
  varying vec3 vWPos;
  varying float vY;
  void main() {
    vec3 V = normalize(cameraPosition - vWPos);
    float fres = pow(1.0 - clamp(abs(dot(normalize(vNormal), V)), 0.0, 1.0), 1.6);
    // slow soul-bands crawling up the stone + a heartbeat pulse
    float bands = 0.5 + 0.5 * sin(vY * 2.4 - uTime * 1.4);
    float pulse = 0.72 + 0.28 * sin(uTime * 1.7);
    vec3 col = mix(uDim, uBright, bands * 0.55 + fres * 0.75) * pulse * uHdr;
    float alpha = clamp(fres * 0.85 + bands * 0.28, 0.0, 1.0) * (0.25 + 0.75 * uAlive);
    // temper the glow point-blank: full strength reads as an orange slab at
    // the dais, so brightness ramps back in with camera distance and the
    // across-the-field landmark read (>30u) keeps the old intensity
    float nearTemper = mix(0.28, 1.0, smoothstep(9.0, 30.0, length(cameraPosition - vWPos)));
    col *= nearTemper;
    alpha *= mix(0.75, 1.0, nearTemper);
    col *= (0.2 + 0.8 * uAlive);
    gl_FragColor = vec4(col, alpha * 0.9);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const EMBER_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uRise;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aDrift;
  varying float vLife;
  void main() {
    float t = fract(uTime * aSpeed + aPhase);
    vLife = t;
    vec3 pos = position;
    pos.y += t * uRise;
    pos.x += sin((t + aPhase) * 6.2831) * aDrift;
    pos.z += cos((t + aPhase * 1.7) * 6.2831) * aDrift * 0.6;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = (85.0 / max(-mv.z, 1.0)) * (0.4 + 0.6 * sin(t * 3.14159));
    gl_Position = projectionMatrix * mv;
  }
`;
const EMBER_FRAG = /* glsl */ `
  uniform float uHdr;
  uniform vec3 uCol1;
  uniform vec3 uCol2;
  varying float vLife;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, d);
    float fade = sin(vLife * 3.14159);
    gl_FragColor = vec4(mix(uCol1, uCol2, vLife) * uHdr, soft * fade * 0.85);
  }
`;

// Grave-mist: broad soft points hugging the ground, breathing and drifting on
// uTime so they need no per-frame JS at all.
const MIST_VERT = /* glsl */ `
  uniform float uTime;
  attribute float aPhase;
  attribute float aScale;
  varying float vPhase;
  void main() {
    vPhase = aPhase;
    vec3 pos = position;
    pos.x += sin(uTime * 0.05 + aPhase * 6.2831) * 2.6;
    pos.z += cos(uTime * 0.04 + aPhase * 9.4) * 2.2;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = (aScale * 330.0) / max(-mv.z, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const MIST_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCol;
  varying float vPhase;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.05, d);
    float breathe = 0.7 + 0.3 * sin(uTime * 0.23 + vPhase * 6.2831);
    gl_FragColor = vec4(uCol, soft * breathe * 0.16);
  }
`;

// ---------------------------------------------------------------------------
// Instance batching: transforms accumulate per (model, tint), then emit as one
// InstancedMesh per model part. Structure pieces keep their (mesh, index,
// matrix) handles so destruction can zero them without a rebuild.
// ---------------------------------------------------------------------------

// Tint variants applied to cloned materials at emit time. The KayKit hex pack
// bakes its toy palette (bright green roofs, cyan gems) into ONE atlas
// texture, so like props.ts drownVeilMaterial the recolor is a shader gate on
// hue, not a material-name override: 'soot' ages everything toward ash and
// mutes greens, 'ember'/'pale' additionally steer green-dominant texels
// (roofs and trims baked into the hex models) toward the team color, 'aged'
// is the heavier grey wash for the 200-year war litter.
type Tint = 'none' | 'soot' | 'ember' | 'pale' | 'aged';

function tintGlsl(tint: Exclude<Tint, 'none'>): string {
  if (tint === 'aged') {
    return /* glsl */ `
      {
        float grey = dot(diffuseColor.rgb, vec3(0.333));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(grey), 0.45) * vec3(0.62, 0.58, 0.52);
      }
    `;
  }
  // team targets sit deliberately desaturated and dark (dried banner cloth,
  // not fresh paint) so the hex roofs read in-palette point-blank while the
  // red/blue split still carries across the fogged field
  const green =
    tint === 'ember'
      ? 'vec3(0.42, 0.13, 0.10)'
      : tint === 'pale'
        ? 'vec3(0.12, 0.20, 0.42)'
        : 'vec3(0.27, 0.27, 0.22)';
  return /* glsl */ `
      {
        float gDom = diffuseColor.g - max(diffuseColor.r, diffuseColor.b);
        float greenMask = smoothstep(0.02, 0.14, gDom);
        diffuseColor.rgb = mix(diffuseColor.rgb, ${green} * (0.45 + diffuseColor.g), greenMask);
        float cDom = min(diffuseColor.g, diffuseColor.b) - diffuseColor.r;
        float cyanMask = smoothstep(0.05, 0.16, cDom) * (1.0 - greenMask);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.19, 0.20) * (0.5 + diffuseColor.b), cyanMask);
        diffuseColor.rgb *= vec3(0.76, 0.72, 0.68);
      }
  `;
}

interface PendingRef {
  key: string;
  index: number;
  matrix: THREE.Matrix4;
}

interface InstRef {
  meshes: THREE.InstancedMesh[];
  index: number;
  matrix: THREE.Matrix4;
}

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

class Batcher {
  readonly byKey = new Map<string, THREE.Matrix4[]>();
  readonly procModels = new Map<
    string,
    { geo: THREE.BufferGeometry; mat: THREE.Material; castShadow: boolean }
  >();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scl = new THREE.Vector3();
  private readonly euler = new THREE.Euler();

  registerProc(name: string, geo: THREE.BufferGeometry, mat: THREE.Material, castShadow: boolean) {
    this.procModels.set(name, { geo, mat, castShadow });
  }

  add(
    model: string,
    x: number,
    y: number,
    z: number,
    ry = 0,
    scale: number | [number, number, number] = 1,
    opts?: { tint?: Tint; rx?: number; rz?: number },
  ): PendingRef {
    const key = `${model} ${opts?.tint ?? 'none'}`;
    const m = new THREE.Matrix4();
    this.pos.set(x, y, z);
    this.quat.setFromEuler(this.euler.set(opts?.rx ?? 0, ry, opts?.rz ?? 0));
    if (typeof scale === 'number') this.scl.set(scale, scale, scale);
    else this.scl.set(scale[0], scale[1], scale[2]);
    m.compose(this.pos, this.quat, this.scl);
    let list = this.byKey.get(key);
    if (!list) {
      list = [];
      this.byKey.set(key, list);
    }
    list.push(m);
    return { key, index: list.length - 1, matrix: m };
  }
}

// models that throw sun shadows (the battleground keeps the daylight rig)
const CASTER_MODELS = new Set([
  'wall',
  'wall_cracked',
  'wall_broken',
  'wall_half',
  'wall_corner',
  'arch_gate',
  'pillar',
  'rubble_large',
  'rubble_half',
  'hex_castle',
  'hex_tower',
  'bell_tower',
  'tree_dead_a',
  'tree_dead_b',
  'rock_a',
  'rock_b',
  'grave_b',
  'gravestone',
]);

// ---------------------------------------------------------------------------

interface StructureVis {
  def: BgStructureDef;
  alive: boolean;
  intact: InstRef[];
  rubble: InstRef[];
  flame: THREE.Mesh | null;
  light: THREE.PointLight | null;
  lightBase: number;
  glow: THREE.Mesh | null;
  warstoneShell: THREE.ShaderMaterial | null;
  warstoneMat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | null;
  embers: THREE.Points | null;
}

interface SlotState {
  ox: number;
  oz: number;
  group: THREE.Group;
  structures: Map<string, StructureVis>;
}

export class BattlegroundView {
  private slots = new Map<number, SlotState>();
  private building = new Set<number>();
  private matCache = new Map<string, THREE.Material>();
  private flameGeo: THREE.BufferGeometry | null = null;
  private glowGeo: THREE.BufferGeometry | null = null;
  private glowTex: THREE.Texture | null = null;
  private glowMats = new Map<number, THREE.MeshBasicMaterial>();

  constructor(
    private scene: THREE.Scene,
    private sim: IWorld,
    private lowGfx: boolean,
    private flames: THREE.Mesh[],
    private fireLights: THREE.PointLight[],
    private vfx: Vfx,
  ) {}

  buildSlot(slot: number, ox: number, oz: number): void {
    if (this.slots.has(slot) || this.building.has(slot)) return;
    this.building.add(slot);
    void ensureBattlegroundAssets()
      .then(() => {
        this.building.delete(slot);
        if (this.slots.has(slot)) return;
        this.buildNow(slot, ox, oz);
      })
      .catch((err) => {
        this.building.delete(slot);
        console.error('Failed to build battleground:', err);
      });
  }

  /** Sync structure visuals with the live match state (null-safe: the sim /
   *  wire implementations land in parallel, so bgInfo may be missing). */
  update(): void {
    if (!this.slots.size) return;
    const match = this.sim.bgInfo?.match ?? null;
    for (const st of this.slots.values()) {
      const isThisSlot =
        match != null &&
        Math.abs(match.origin.x - st.ox) < 1 &&
        Math.abs(match.origin.z - st.oz) < 1;
      for (const vis of st.structures.values()) {
        let alive = true;
        if (isThisSlot && match) {
          const rec = match.structures.find((r) => r.id === vis.def.id);
          if (rec) alive = rec.alive;
        }
        if (alive !== vis.alive) this.setStructureAlive(st, vis, alive, isThisSlot);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------

  private buildNow(slot: number, ox: number, oz: number): void {
    const group = new THREE.Group();
    group.name = `battleground:${slot}`;
    const st: SlotState = { ox, oz, group, structures: new Map() };
    const b = new Batcher();
    this.registerProcModels(b);

    this.placeGround(group);
    this.placeRoads(group);
    this.placeWalls(b);
    this.placeGates(group, b);
    for (const team of ['A', 'B'] as const) this.placeBase(group, b, team);
    this.placeBulwarks(group, b, st);
    this.placeChapel(group, b);
    this.placeScatter(b);
    this.placeMist(group);

    const emitted = this.emit(group, b);
    this.resolveStructureRefs(st, emitted);

    group.position.set(ox, 0, oz);
    this.scene.add(group);
    this.slots.set(slot, st);
  }

  private registerProcModels(b: Batcher): void {
    const stone = surfaceMat({ color: 0x4a4744, roughness: 0.95, flatShading: true });
    const darkStone = surfaceMat({ color: 0x37342f, roughness: 1, flatShading: true });
    const charWood = surfaceMat({ color: 0x2a2622, roughness: 1 });
    const bowlIron = surfaceMat({ color: 0x191512, roughness: 0.9 });
    const earth = surfaceMat({ color: 0x3b332b, roughness: 1, flatShading: true });

    b.registerProc('dais_low', new THREE.CylinderGeometry(1, 1.08, 0.3, 24), stone, false);
    b.registerProc('dais_high', new THREE.CylinderGeometry(1, 1.06, 0.75, 20), stone, true);
    b.registerProc('plinth', new THREE.CylinderGeometry(1, 1.14, 0.9, 8), darkStone, true);
    b.registerProc('brazier_post', new THREE.CylinderGeometry(0.2, 0.34, 2.0, 8), charWood, true);
    b.registerProc('brazier_bowl', new THREE.CylinderGeometry(0.52, 0.26, 0.4, 10), bowlIron, true);
    const mound = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    b.registerProc('mound', mound, earth, true);
    b.registerProc('beam', new THREE.BoxGeometry(1, 0.32, 0.32), charWood, true);
    // the Knell: a bronze bell composed from a lathe profile (narrow crown,
    // slight waist, flared lip; the first cut read as a glowing cone tent)
    const bellPts: THREE.Vector2[] = [new THREE.Vector2(0.001, 0.06)];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const r = 0.3 + 0.05 * t + 0.3 * t ** 4 + (t > 0.9 ? (t - 0.9) * 1.2 : 0);
      bellPts.push(new THREE.Vector2(r, -t));
    }
    const bell = new THREE.LatheGeometry(bellPts, 16).translate(0, 1, 0);
    // low metalness: metallic + daylight IBL turned the whole bell lime-green
    const bronze = surfaceMat({ color: 0x5f4c2a, roughness: 0.5, metalness: 0.18 });
    b.registerProc('bell', bell, bronze, true);
  }

  // ---- ground: scorched ash field with mud patches and sparse dead grass ---
  private placeGround(group: THREE.Group): void {
    const W = (BG_HALF_X + 18) * 2;
    const D = (BG_HALF_Z + 18) * 2;
    const segX = 100;
    const segZ = 132;
    const geo = new THREE.PlaneGeometry(W, D, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const roads = [bgRoadPolyline('west'), bgRoadPolyline('east')];
    const scorches: { x: number; z: number; r: number }[] = [];
    for (const s of BG_STRUCTURES)
      scorches.push({ x: s.x, z: s.z, r: s.kind === 'warstone' ? 7.5 : 5 });
    for (let i = 0; i < 26; i++) {
      // old shell-burns across the barrows, mirrored so the field stays fair
      const sx = (hash2(i, 11, SEED) - 0.5) * 2 * (BG_HALF_X - 12);
      const sz = (hash2(i, 12, SEED) - 0.5) * 2 * (BG_HALF_Z - 18);
      scorches.push({ x: sx, z: sz, r: 1.6 + hash2(i, 13, SEED) * 3.4 });
    }
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // ashen base with two octaves of mottling (cool grey: the gravel albedo
      // underneath carries the warmth, so the tint must not read as dirt)
      const n1 = vnoise(x, z, 9, 21);
      const n2 = vnoise(x, z, 27, 22);
      let r = 0.56 + n1 * 0.12 + n2 * 0.1;
      let g = 0.55 + n1 * 0.12 + n2 * 0.1;
      let bl = 0.54 + n1 * 0.11 + n2 * 0.1;
      // mud patches (wet brown sinks)
      const mud = Math.max(0, vnoise(x + 400, z, 16, 31) - 0.58) * 2.6;
      if (mud > 0) {
        r = r * (1 - mud) + 0.4 * mud;
        g = g * (1 - mud) + 0.31 * mud;
        bl = bl * (1 - mud) + 0.22 * mud;
      }
      // sparse dead-grass drifts (dry olive)
      const grass = Math.max(0, vnoise(x - 300, z + 200, 13, 41) - 0.6) * 2.4;
      if (grass > 0) {
        r = r * (1 - grass) + 0.5 * grass;
        g = g * (1 - grass) + 0.5 * grass;
        bl = bl * (1 - grass) + 0.33 * grass;
      }
      // pale trampled halo inside the chapel ring
      const dc = Math.hypot(x - BG_KNELL_POS.x, z - BG_KNELL_POS.z);
      if (dc < BG_CHAPEL_R + 4) {
        const t = 1 - Math.min(1, dc / (BG_CHAPEL_R + 4));
        r += t * 0.16;
        g += t * 0.15;
        bl += t * 0.14;
      }
      // worn verge under the roads (the strips render on top)
      let roadD = Infinity;
      for (const line of roads) roadD = Math.min(roadD, polylineDistance(x, z, line));
      if (roadD < BG_LANE_ROAD_HALF_W + 3.5) {
        const t = 1 - Math.min(1, roadD / (BG_LANE_ROAD_HALF_W + 3.5));
        const wear = 0.75 - t * 0.25;
        r *= wear + 0.25;
        g *= wear + 0.24;
        bl *= wear + 0.22;
      }
      // scorch rings near structures + shell-burns
      for (const s of scorches) {
        const d = Math.hypot(x - s.x, z - s.z);
        if (d < s.r) {
          const t = 1 - d / s.r;
          const k = Math.min(0.85, t * 1.4);
          r = r * (1 - k) + 0.14 * k;
          g = g * (1 - k) + 0.13 * k;
          bl = bl * (1 - k) + 0.12 * k;
        }
      }
      col.setRGB(Math.min(1, r), Math.min(1, g), Math.min(1, bl));
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
      uv.setXY(i, x / 5.5, z / 5.5);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = GFX.standardMaterials
      ? new THREE.MeshStandardMaterial({
          map: BG_TEX.gravelC ?? null,
          normalMap: BG_TEX.gravelN ?? null,
          vertexColors: true,
          roughness: 0.97,
          metalness: 0,
        })
      : new THREE.MeshLambertMaterial({ map: BG_TEX.gravelC ?? null, vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -0.02;
    mesh.receiveShadow = !this.lowGfx;
    group.add(mesh);
  }

  // ---- roads: worn paved strips following the lane waypoints ---------------
  private placeRoads(group: THREE.Group): void {
    const mat = GFX.standardMaterials
      ? new THREE.MeshStandardMaterial({
          map: BG_TEX.pavingC ?? null,
          normalMap: BG_TEX.pavingN ?? null,
          vertexColors: true,
          roughness: 0.92,
          metalness: 0,
        })
      : new THREE.MeshLambertMaterial({ map: BG_TEX.pavingC ?? null, vertexColors: true });
    for (const lane of ['west', 'east'] as const) {
      const line = bgRoadPolyline(lane);
      const geo = this.roadRibbon(line, BG_LANE_ROAD_HALF_W);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 0.045;
      mesh.receiveShadow = !this.lowGfx;
      group.add(mesh);
    }
  }

  private roadRibbon(line: BgPoint[], halfW: number): THREE.BufferGeometry {
    const n = line.length;
    const positions: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let v = 0;
    for (let i = 0; i < n; i++) {
      const prev = line[Math.max(0, i - 1)];
      const next = line[Math.min(n - 1, i + 1)];
      let dx = next.x - prev.x;
      let dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const px = -dz;
      const pz = dx;
      if (i > 0) v += Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z);
      for (const side of [-1, 1]) {
        positions.push(line[i].x + px * halfW * side, 0, line[i].z + pz * halfW * side);
        uvs.push(side < 0 ? 0 : halfW / 4, v / 8);
        // worn pale center, darker crumbled edges, mottled along the length
        const wear = 0.82 - 0.2 * Math.abs(side) + (hash2(i, side * 7, SEED) - 0.5) * 0.16;
        colors.push(0.72 * wear, 0.69 * wear, 0.65 * wear);
      }
      if (i > 0) {
        const a = (i - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  // ---- walls: the 200-year siege line, ruined at intervals -----------------
  private placeWalls(b: Batcher): void {
    // perimeter (matches the four perimeter OBBs)
    this.wallRun(b, -BG_HALF_X, 0, BG_HALF_Z * 2, Math.PI / 2, 0.9);
    this.wallRun(b, BG_HALF_X, 0, BG_HALF_Z * 2, Math.PI / 2, 0.9);
    this.wallRun(b, 0, -BG_HALF_Z, BG_HALF_X * 2, 0, 0.9);
    this.wallRun(b, 0, BG_HALF_Z, BG_HALF_X * 2, 0, 0.9);
    // corner watch ruins (sooted: the toy hex palette must not survive here)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.add(
          'hex_tower',
          sx * (BG_HALF_X - 1.2),
          0,
          sz * (BG_HALF_Z - 1.2),
          hash2(sx, sz, SEED) * Math.PI,
          [2.6, 2.4, 2.25],
          { tint: 'soot' },
        );
      }
    }
    // base walls with gate openings (mirror battlegroundColliders exactly)
    const gateHw = 8;
    const gx = BG_LANE_GATE_X;
    const outerHw = (BG_HALF_X - (gx + gateHw)) / 2;
    const outerCx = gx + gateHw + outerHw;
    for (const sign of [-1, 1]) {
      const z = BG_BASE_WALL_Z * sign;
      this.wallRun(b, -outerCx, z, outerHw * 2, 0, 0.55);
      this.wallRun(b, outerCx, z, outerHw * 2, 0, 0.55);
      this.wallRun(b, 0, z, (gx - gateHw) * 2, 0, 0.55);
    }
  }

  /**
   * A ruined battlement line centered at (cx, cz), `length` long, rotY `rot`
   * (three.js yaw: local +x maps to world (cos, -sin)). `ruin` 0..1 sets how
   * broken the run reads. Kit walls are 4u long and 1u thick at scale 1.
   */
  private wallRun(
    b: Batcher,
    cx: number,
    cz: number,
    length: number,
    rot: number,
    ruin: number,
  ): void {
    const segLen = 6;
    const count = Math.max(1, Math.round(length / segLen));
    const dirX = Math.cos(rot);
    const dirZ = -Math.sin(rot);
    for (let s = 0; s < count; s++) {
      const t = (s + 0.5) / count - 0.5;
      const x = cx + dirX * t * length;
      const z = cz + dirZ * t * length;
      const h1 = hash2(Math.round(x * 7), Math.round(z * 7), SEED);
      const h2 = hash2(Math.round(z * 13), Math.round(x * 5), SEED);
      const ySc = (BG_WALL_H / 4) * (0.82 + h2 * 0.32);
      if (h1 < 0.16 * ruin) {
        // breached: tumbled rubble in the gap
        b.add('rubble_half', x, 0, z, rot + (h2 - 0.5) * 0.8, [1.05, 0.65 + h2 * 0.35, 1.1], {
          tint: 'soot',
        });
        continue;
      }
      let kind = 'wall';
      if (h1 < 0.3 * ruin + 0.16) kind = 'wall_broken';
      else if (h1 < 0.42 * ruin + 0.24) kind = 'wall_cracked';
      else if (h1 < 0.5 * ruin + 0.28) kind = 'wall_half';
      const yScale = kind === 'wall_broken' ? ySc * 0.7 : kind === 'wall_half' ? ySc * 0.85 : ySc;
      b.add(kind, x, 0, z, rot, [segLen / 4, yScale, 2], { tint: 'soot' });
      // buttress pillars at intervals keep the long runs from reading extruded
      if (s % 5 === 2) b.add('pillar', x, 0, z, rot, [1.1, ySc * 1.12, 1.1], { tint: 'soot' });
    }
  }

  // ---- gates: arches over the lane openings + team banners -----------------
  private placeGates(group: THREE.Group, b: Batcher): void {
    for (const sign of [-1, 1] as const) {
      const team: BgTeam = sign < 0 ? 'A' : 'B';
      const look = TEAM_LOOK[team];
      const z = BG_BASE_WALL_Z * sign;
      for (const sx of [-1, 1]) {
        const x = BG_LANE_GATE_X * sx;
        b.add('arch_gate', x, 0, z, 0, [3.9, 1.75, 2.2], { tint: 'soot' });
        // team banners on the flanking wall faces, hung toward the field
        const off = sign < 0 ? -1.3 : 1.3;
        b.add(look.bannerWide, x - 9.4, 2.4, z + off, sign < 0 ? Math.PI : 0, 1.5);
        b.add(look.bannerWide, x + 9.4, 2.4, z + off, sign < 0 ? Math.PI : 0, 1.5);
      }
    }
  }

  // ---- bases: ruined keep, warstone monolith, spawn dais, braziers ---------
  private placeBase(group: THREE.Group, b: Batcher, team: BgTeam): void {
    const sign = team === 'A' ? -1 : 1;
    const look = TEAM_LOOK[team];
    const wz = BG_WARSTONE_Z * sign;
    const face = team === 'A' ? 0 : Math.PI; // face the field

    // the ruined keep looms behind the muster ground, merged into the back
    // line; the hue-gated team tint turns its baked green roofs to the
    // company color and its gem trim to slate
    const teamTint: Tint = team === 'A' ? 'ember' : 'pale';
    b.add('hex_castle', 0, 0, (BG_HALF_Z - 3.5) * sign, face, [6.6, 5.2, 4.6], { tint: teamTint });
    // flanking ruin towers frame the spawn, banners hung flush on their faces
    for (const sx of [-1, 1]) {
      const tx = 26 * sx;
      const tz = (BG_HALF_Z - 8) * sign;
      b.add('hex_tower', tx, 0, tz, face, [3.0, 2.7, 2.6], { tint: teamTint });
      b.add(look.bannerWide, tx, 3.1, tz - sign * 1.6, face, 1.6);
    }

    // warstone dais (r 6 walkable, deliberately no collider)
    b.add('dais_low', 0, 0.15, wz, 0, [BG_WARSTONE_DAIS_R, 1, BG_WARSTONE_DAIS_R]);
    b.add('dais_high', 0, 0.4, wz, 0, [BG_WARSTONE_DAIS_R - 1.9, 1, BG_WARSTONE_DAIS_R - 1.9]);

    // banner ring on the dais arc (shield banners on posts, facing outward)
    for (let i = -2; i <= 2; i++) {
      const ang = face + Math.PI + i * 0.5; // arc opens toward the field
      const bx = Math.sin(ang) * (BG_WARSTONE_DAIS_R + 1.2);
      const bz = wz + Math.cos(ang) * (BG_WARSTONE_DAIS_R + 1.2);
      if (i % 2 === 0) {
        b.add('post', bx, 0, bz, ang, [1.2, 1.45, 1.2]);
        b.add(look.bannerShield, bx, 2.1, bz, ang + Math.PI, 1.35);
      }
    }

    // the warstone itself: a soul-lit monolith (delve portal shader pattern)
    this.buildWarstone(group, team, 0, wz);

    // two team braziers flank the dais approach
    for (const sx of [-1, 1]) {
      this.buildBrazier(group, b, sx * (BG_WARSTONE_DAIS_R + 2.6), wz - sign * 4.5, look, null);
    }
  }

  private buildWarstone(group: THREE.Group, team: BgTeam, x: number, z: number): void {
    const look = TEAM_LOOK[team];
    // basalt monolith: a foursided tapered prism, flat-shaded, TALL enough to
    // clear the 6u base walls so the objective silhouettes across the field,
    // with a faint team emissive so the stone itself reads soul-lit
    const stoneGeo = new THREE.CylinderGeometry(1.0, 1.7, 10.5, 4, 1);
    // opaque team emissive on the stone body: the additive shell disappears
    // against the pale fog horizon, but an emissive surface still reads.
    // Cloned per warstone (surfaceMat caches by opts) so the destroyed state
    // can dim THIS stone without dimming the same team's stone in other slots.
    const stoneMat = surfaceMat({
      color: 0x2c2a30,
      emissive: look.glowBright,
      emissiveIntensity: WARSTONE_EMISSIVE,
      roughness: 0.85,
      flatShading: true,
    }).clone() as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
    const stone = new THREE.Mesh(stoneGeo, stoneMat);
    stone.position.set(x, 0.75 + 5.25, z);
    stone.rotation.y = Math.PI / 4;
    stone.castShadow = !this.lowGfx;
    group.add(stone);

    // soul-glow shell riding the same silhouette
    const shellMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: sharedUniforms.uTime,
        uHdr: { value: GFX.composer ? 2.4 : 1.15 },
        uAlive: { value: 1 },
        uBright: { value: new THREE.Color(look.glowBright) },
        uDim: { value: new THREE.Color(look.glowDim) },
      },
      vertexShader: WARSTONE_VERT,
      fragmentShader: WARSTONE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });
    const shell = new THREE.Mesh(stoneGeo, shellMat);
    shell.position.copy(stone.position);
    shell.rotation.copy(stone.rotation);
    shell.scale.setScalar(1.05);
    shell.renderOrder = 2;
    group.add(shell);

    // rising soul-embers around the stone
    const embers = this.buildEmbers(x, 0.9, z, 2.0, 11, look.ember1, look.ember2);
    group.add(embers);

    // steady team light over the dais (fireLights so the budget ranks it)
    const light = new THREE.PointLight(look.light, 12, 40, 2);
    light.position.set(x, 7, z);
    light.userData.baseIntensity = 40;
    group.add(light);
    this.fireLights.push(light);
    // no ground glow decal here: at warstone scale the additive pool floods
    // the whole dais red/blue (the shader shell + light carry the glow)

    const vis = this.structureVis(`${team === 'A' ? 'a' : 'b'}_warstone`);
    if (vis) {
      vis.warstoneShell = shellMat;
      vis.warstoneMat = stoneMat;
      vis.embers = embers;
      vis.light = light;
      vis.lightBase = 40;
    }
  }

  // pending structure records are created lazily on first touch
  private pendingStructures = new Map<string, StructureVis>();

  private structureVis(id: string): StructureVis | null {
    const def = BG_STRUCTURES.find((s) => s.id === id) ?? null;
    if (!def) return null;
    let vis = this.pendingStructures.get(id);
    if (!vis) {
      vis = {
        def,
        alive: true,
        intact: [],
        rubble: [],
        flame: null,
        light: null,
        lightBase: 0,
        glow: null,
        warstoneShell: null,
        warstoneMat: null,
        embers: null,
      };
      this.pendingStructures.set(id, vis);
    }
    return vis;
  }

  private pendingIntact = new Map<string, PendingRef[]>();
  private pendingRubble = new Map<string, PendingRef[]>();

  private recordIntact(id: string, ref: PendingRef): void {
    let list = this.pendingIntact.get(id);
    if (!list) {
      list = [];
      this.pendingIntact.set(id, list);
    }
    list.push(ref);
  }

  private recordRubble(id: string, ref: PendingRef): void {
    let list = this.pendingRubble.get(id);
    if (!list) {
      list = [];
      this.pendingRubble.set(id, list);
    }
    list.push(ref);
  }

  // ---- bulwarks: watch towers with a team banner + brazier, plus a hidden
  // collapsed-rubble state driven by the live match ---------------------------
  private placeBulwarks(group: THREE.Group, b: Batcher, st: SlotState): void {
    for (const s of BG_STRUCTURES) {
      if (s.kind !== 'bulwark') continue;
      const look = TEAM_LOOK[s.team];
      const vis = this.structureVis(s.id);
      if (!vis) continue;
      // face the lane's mid-point so both roads feel watched
      const yaw = Math.atan2(Math.sign(s.x) * 56 - s.x, 0 - s.z) + Math.PI;
      // stone plinth survives destruction (the collider keeps blocking)
      b.add('plinth', s.x, 0.45, s.z, 0, [2.4, 1, 2.4]);
      const teamTint: Tint = s.team === 'A' ? 'ember' : 'pale';
      this.recordIntact(
        s.id,
        b.add('hex_tower', s.x, 0.82, s.z, yaw, [3.3, 3.8, 3.0], { tint: teamTint }),
      );
      this.recordIntact(
        s.id,
        b.add(
          look.bannerWide,
          s.x + Math.sin(yaw) * 1.75,
          3.4,
          s.z + Math.cos(yaw) * 1.75,
          yaw,
          1.5,
        ),
      );
      // collapsed state: tumbled rubble + old bones, hidden while intact
      const h = hash2(s.x, s.z, SEED);
      this.recordRubble(
        s.id,
        b.add('rubble_large', s.x, 0.7, s.z, h * Math.PI, [0.62, 0.75, 0.7], { tint: 'soot' }),
      );
      this.recordRubble(
        s.id,
        b.add('rubble_half', s.x + 1.6, 0.75, s.z + 1.1, h * 5, [0.9, 0.8, 0.9], { tint: 'soot' }),
      );
      this.recordRubble(s.id, b.add('skull', s.x - 1.4, 0.9, s.z - 1.2, h * 9, 1.2));
      // team brazier at the tower foot, toward the road
      const bx = s.x + Math.sin(yaw) * 3.3;
      const bz = s.z + Math.cos(yaw) * 3.3;
      this.buildBrazier(group, b, bx, bz, look, vis);
      st.structures.set(s.id, vis);
    }
    // register the warstones too (their vis records fill in buildWarstone)
    for (const s of BG_STRUCTURES) {
      if (s.kind !== 'warstone') continue;
      const vis = this.structureVis(s.id);
      if (vis) st.structures.set(s.id, vis);
    }
  }

  // ---- the chapel of the Knell: broken ring + hanging bell -----------------
  private placeChapel(group: THREE.Group, b: Batcher): void {
    // paved chapel floor, cracked and worn
    const floorGeo = new THREE.CircleGeometry(BG_CHAPEL_R - 0.6, 40);
    floorGeo.rotateX(-Math.PI / 2);
    const fPos = floorGeo.getAttribute('position') as THREE.BufferAttribute;
    const fUv = floorGeo.getAttribute('uv') as THREE.BufferAttribute;
    const fCol = new Float32Array(fPos.count * 3);
    for (let i = 0; i < fPos.count; i++) {
      const x = fPos.getX(i);
      const z = fPos.getZ(i);
      fUv.setXY(i, x / 4.4, z / 4.4);
      const w = 0.55 + vnoise(x + 90, z - 90, 5, 71) * 0.4;
      fCol[i * 3] = 0.72 * w;
      fCol[i * 3 + 1] = 0.7 * w;
      fCol[i * 3 + 2] = 0.66 * w;
    }
    floorGeo.setAttribute('color', new THREE.BufferAttribute(fCol, 3));
    const floorMat = GFX.standardMaterials
      ? new THREE.MeshStandardMaterial({
          map: BG_TEX.pavingC ?? null,
          normalMap: BG_TEX.pavingN ?? null,
          vertexColors: true,
          roughness: 0.94,
        })
      : new THREE.MeshLambertMaterial({ map: BG_TEX.pavingC ?? null, vertexColors: true });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(BG_KNELL_POS.x, 0.035, BG_KNELL_POS.z);
    floor.receiveShadow = !this.lowGfx;
    group.add(floor);

    // ring stubs: broken chapel walls exactly on the collider OBBs
    for (const s of BG_CHAPEL_STUBS) {
      const dirX = Math.cos(s.rot);
      const dirZ = -Math.sin(s.rot);
      const segs = Math.max(1, Math.round((s.hw * 2) / 4.2));
      for (let i = 0; i < segs; i++) {
        const t = (i + 0.5) / segs - 0.5;
        const x = s.x + dirX * t * s.hw * 2;
        const z = s.z + dirZ * t * s.hw * 2;
        const h = hash2(Math.round(x * 17), Math.round(z * 17), SEED);
        const kind = h < 0.34 ? 'wall_broken' : h < 0.6 ? 'wall_cracked' : 'wall';
        const ySc = kind === 'wall_broken' ? 0.55 + h * 0.4 : 0.85 + h * 0.55;
        b.add(kind, x, 0, z, s.rot, [(s.hw * 2) / segs / 4, ySc, s.hd * 2], { tint: 'soot' });
      }
      // candle clusters where the walls broke
      if (hash2(s.x, s.z, SEED) > 0.4) {
        b.add('candle_triple', s.x + dirZ * 1.4, 0, s.z - dirX * 1.4, s.rot, 1.3);
      }
    }

    // the Knell: a bronze bell hung from a charred gallows frame at the heart
    const kx = BG_KNELL_POS.x;
    const kz = BG_KNELL_POS.z;
    b.add('post', kx - 2.1, 0, kz, 0, [1.3, 1.7, 1.3], { tint: 'soot' });
    b.add('post', kx + 2.1, 0, kz, 0, [1.3, 1.7, 1.3], { tint: 'soot' });
    b.add('beam', kx, 6.55, kz, 0, [5.1, 1, 1]);
    b.add('bell', kx, 4.6, kz, 0, [1.35, 1.5, 1.35]);
    // ghost-light braziers flanking the openings
    this.buildBrazier(group, b, kx - BG_CHAPEL_R - 1.6, kz, CHAPEL_FLAME, null);
    this.buildBrazier(group, b, kx + BG_CHAPEL_R + 1.6, kz, CHAPEL_FLAME, null);
    // faint corpse-light over the Knell (kept soft so the bronze bell still
    // reads as metal, not a green lantern)
    const glow = new THREE.PointLight(CHAPEL_FLAME.light, 6, 20, 2);
    glow.position.set(kx, 6.8, kz);
    glow.userData.baseIntensity = 8;
    group.add(glow);
    this.fireLights.push(glow);
  }

  // ---- barrow scatter -------------------------------------------------------
  private placeScatter(b: Batcher): void {
    for (const p of bgScatterPlacements()) {
      const { kind, x, z, yaw, variant, size } = p;
      switch (kind) {
        case 'mound': {
          const mh = 1.05 + variant * 0.3;
          b.add('mound', x, 0, z, yaw, [2.6 + size * 0.5, mh, 2.6 + size * 0.5]);
          b.add('gravemarker_a', x, mh * 0.92, z, yaw + 0.4, 1.9, { rz: 0.2, tint: 'soot' });
          b.add('ribcage', x + Math.sin(yaw) * 2.2, 0.15, z + Math.cos(yaw) * 2.2, yaw * 3, 1.5);
          b.add(
            'skull',
            x + Math.sin(yaw + 2.1) * 2.5,
            0.05,
            z + Math.cos(yaw + 2.1) * 2.5,
            yaw * 5,
            1.15,
          );
          if (variant > 0.5)
            b.add('bone_a', x - Math.sin(yaw) * 2.4, 0.02, z - Math.cos(yaw) * 2.4, yaw * 7, 1.6);
          break;
        }
        case 'tree':
          b.add(variant < 0.5 ? 'tree_dead_a' : 'tree_dead_b', x, 0, z, yaw, 0.8 + size * 0.3, {
            tint: 'soot',
          });
          break;
        case 'rock':
          // soot also mutes the teal moss baked onto the Quaternius rocks
          b.add(variant < 0.5 ? 'rock_a' : 'rock_b', x, 0, z, yaw, 0.8 + size * 0.35, {
            tint: 'soot',
          });
          break;
        case 'ruin': {
          b.add('wall_broken', x, 0, z, yaw, [1.0, 0.7 + variant * 0.5, 1.6], { tint: 'soot' });
          b.add(
            'rubble_half',
            x + Math.sin(yaw + 1.7) * 2.2,
            0,
            z + Math.cos(yaw + 1.7) * 2.2,
            yaw * 2,
            0.8,
            { tint: 'soot' },
          );
          if (variant > 0.55)
            b.add('skull', x + Math.sin(yaw) * 1.6, 0, z + Math.cos(yaw) * 1.6, yaw * 5, 1.1);
          break;
        }
        case 'grave': {
          const kind2 = variant < 0.4 ? 'gravestone' : variant < 0.75 ? 'grave_b' : 'gravemarker_a';
          b.add(kind2, x, 0, z, yaw, 1.05 + size * 0.3, { rz: (variant - 0.5) * 0.2 });
          if (size > 0.6)
            b.add('candle_triple', x + Math.sin(yaw) * 1.1, 0, z + Math.cos(yaw) * 1.1, yaw, 1.1);
          break;
        }
        case 'spears': {
          // a broken shield-line: 4-6 pikes planted at angles along a row
          const count = 4 + Math.floor(variant * 3);
          const dirX = Math.cos(yaw);
          const dirZ = -Math.sin(yaw);
          for (let i = 0; i < count; i++) {
            const t = i - (count - 1) / 2;
            const jx = (hash2(i, x, SEED) - 0.5) * 0.7;
            const jz = (hash2(i, z, SEED) - 0.5) * 0.7;
            const sx = x + dirX * t * 1.15 + jx;
            const sz = z + dirZ * t * 1.15 + jz;
            const lean = 0.14 + hash2(i * 3, x + z, SEED) * 0.3;
            const leanDir = hash2(i * 5, x - z, SEED) * Math.PI * 2;
            const model = hash2(i * 7, x * z, SEED) < 0.22 ? 'halberd' : 'spear';
            b.add(model, sx, 1.15, sz, leanDir, 1.35, { rx: lean, tint: 'aged' });
          }
          break;
        }
        case 'banner': {
          // a torn standard of the buried vanguard, leaning where it was planted
          const model = variant < 0.5 ? 'banner_thin_white' : 'banner_thin_brown';
          b.add('post', x, 0, z, yaw, [1.1, 1.3, 1.1], { rz: 0.08, tint: 'aged' });
          b.add(model, x, 1.7, z, yaw, 1.25, { rz: 0.08, tint: 'aged' });
          if (size > 0.55)
            b.add(
              'fence_broken',
              x + Math.sin(yaw) * 1.8,
              0,
              z + Math.cos(yaw) * 1.8,
              yaw + 1.2,
              1.1,
              { tint: 'aged' },
            );
          break;
        }
      }
    }
  }

  // ---- grave-mist: one self-animating point cloud over the barrows ---------
  private placeMist(group: THREE.Group): void {
    const spots: { x: number; z: number }[] = [];
    for (const s of BG_SCATTER) {
      if (s.kind === 'mound' || s.kind === 'grave') spots.push({ x: s.x, z: s.z });
    }
    spots.push({ x: 0, z: 0 }, { x: -30, z: 0 }, { x: 30, z: 0 });
    const N = this.lowGfx ? Math.min(spots.length, 18) : spots.length;
    const positions = new Float32Array(N * 3);
    const phase = new Float32Array(N);
    const scale = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const s = spots[i];
      positions[i * 3] = s.x + (hash2(i, 1, SEED) - 0.5) * 4;
      positions[i * 3 + 1] = 0.8 + hash2(i, 2, SEED) * 0.7;
      positions[i * 3 + 2] = s.z + (hash2(i, 3, SEED) - 0.5) * 4;
      phase[i] = hash2(i, 4, SEED);
      scale[i] = 7 + hash2(i, 5, SEED) * 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aScale', new THREE.BufferAttribute(scale, 1));
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, 1, 0),
      Math.hypot(BG_HALF_X, BG_HALF_Z) + 10,
    );
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: sharedUniforms.uTime,
        uCol: { value: new THREE.Color(0xb6b2ac) },
      },
      vertexShader: MIST_VERT,
      fragmentShader: MIST_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = 3;
    group.add(pts);
  }

  // ---- shared little builders ----------------------------------------------

  private buildBrazier(
    group: THREE.Group,
    b: Batcher,
    x: number,
    z: number,
    look: TeamLook,
    vis: StructureVis | null,
  ): void {
    const postRef = b.add('brazier_post', x, 1.0, z, 0, 1);
    const bowlRef = b.add('brazier_bowl', x, 2.1, z, 0, 1);
    if (vis) {
      this.recordIntact(vis.def.id, postRef);
      this.recordIntact(vis.def.id, bowlRef);
    }
    this.flameGeo ??= new THREE.ConeGeometry(0.24, 0.66, 6);
    const flame = new THREE.Mesh(
      this.flameGeo,
      new THREE.MeshLambertMaterial({
        color: look.flame,
        emissive: look.flameEmissive,
        emissiveIntensity: this.lowGfx ? 1.6 : 2.2,
        transparent: true,
        opacity: 0.92,
      }),
    );
    flame.position.set(x, 2.5, z);
    flame.scale.setScalar(0.85);
    group.add(flame);
    this.flames.push(flame);
    const light = new THREE.PointLight(look.light, 9, this.lowGfx ? 16 : 24, 2);
    light.position.set(x, 3.1, z);
    light.userData.baseIntensity = 15;
    group.add(light);
    this.fireLights.push(light);
    this.addGlowDecal(group, x, z, look.light, 0.07, 0.65);
    if (vis) {
      vis.flame = flame;
      vis.light = light;
      vis.lightBase = 15;
    }
  }

  // additive light-pool decal (the point-light budget keeps few lights live,
  // so the warm pools are baked in; dungeon.ts precedent)
  private addGlowDecal(
    group: THREE.Group,
    x: number,
    z: number,
    colorHex: number,
    y: number,
    scale: number,
  ): void {
    if (this.lowGfx) return;
    this.glowGeo ??= new THREE.CircleGeometry(6.6, 20).rotateX(-Math.PI / 2);
    this.glowTex ??= radialGlowTexture();
    let mat = this.glowMats.get(colorHex);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        map: this.glowTex,
        color: colorHex,
        transparent: true,
        // fainter than the dungeon decals (0.46): outdoors under a live sun
        // an additive pool reads like spilled paint at interior strength
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.glowMats.set(colorHex, mat);
    }
    const glow = new THREE.Mesh(this.glowGeo, mat);
    glow.position.set(x, y, z);
    glow.scale.setScalar(scale);
    glow.renderOrder = 1;
    group.add(glow);
  }

  private buildEmbers(
    cx: number,
    baseY: number,
    cz: number,
    halfW: number,
    riseY: number,
    col1: [number, number, number],
    col2: [number, number, number],
  ): THREE.Points {
    const N = GFX.standardMaterials ? 40 : 22;
    const positions = new Float32Array(N * 3);
    const phase = new Float32Array(N);
    const speed = new Float32Array(N);
    const drift = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      positions[i * 3] = (hash2(i * 1.7, cx, SEED) - 0.5) * halfW * 2;
      positions[i * 3 + 1] = hash2(i * 2.3, cz, SEED) * 1.2;
      positions[i * 3 + 2] = (hash2(i * 3.1, cx + cz, SEED) - 0.5) * halfW * 2;
      phase[i] = hash2(i * 4.5, cx, SEED);
      speed[i] = 0.05 + hash2(i * 5.9, cz, SEED) * 0.08;
      drift[i] = 0.25 + hash2(i * 6.7, cx, SEED) * 0.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    geo.setAttribute('aDrift', new THREE.BufferAttribute(drift, 1));
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, riseY / 2, 0),
      Math.max(halfW, riseY) + 1.5,
    );
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: sharedUniforms.uTime,
        uRise: { value: riseY },
        uHdr: { value: GFX.composer ? 2.0 : 1.0 },
        uCol1: { value: new THREE.Vector3(...col1) },
        uCol2: { value: new THREE.Vector3(...col2) },
      },
      vertexShader: EMBER_VERT,
      fragmentShader: EMBER_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.position.set(cx, baseY, cz);
    pts.renderOrder = 4;
    return pts;
  }

  // -------------------------------------------------------------------------
  // Emission + destruction state
  // -------------------------------------------------------------------------

  private displayMat(
    src: THREE.Material | null,
    tint: Tint,
    hasColorAttr: boolean,
  ): THREE.Material {
    const key = `${src?.uuid ?? 'none'}|${tint}|${hasColorAttr ? 'vc' : ''}`;
    const cached = this.matCache.get(key);
    if (cached) return cached;
    const s = src as THREE.MeshStandardMaterial | null;
    let mat: THREE.Material;
    if (this.lowGfx) {
      mat = new THREE.MeshLambertMaterial({
        map: s?.map ?? null,
        color: s?.color?.clone() ?? new THREE.Color(0x8a8a8a),
        vertexColors: hasColorAttr,
      });
    } else if (s?.isMeshStandardMaterial) {
      const std = s.clone();
      std.vertexColors = hasColorAttr;
      std.metalness = Math.min(std.metalness, 0.2);
      std.roughness = Math.max(0.82, std.roughness);
      mat = std;
    } else {
      mat = new THREE.MeshStandardMaterial({ color: 0x777788, roughness: 0.95 });
    }
    if (tint !== 'none') {
      // hue-gated recolor injected after the texture sample (works for both
      // the Standard and the low-tier Lambert program; map_fragment exists in
      // both chunk sets). A distinct program cache key per tint keeps three
      // from reusing the un-injected program.
      const glsl = tintGlsl(tint);
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace(
          '#include <map_fragment>',
          `#include <map_fragment>\n${glsl}`,
        );
      };
      mat.customProgramCacheKey = () => `bgTint:${tint}`;
    }
    this.matCache.set(key, mat);
    return mat;
  }

  private emit(group: THREE.Group, b: Batcher): Map<string, THREE.InstancedMesh[]> {
    const emitted = new Map<string, THREE.InstancedMesh[]>();
    for (const [key, mats] of b.byKey) {
      const [model, tint] = key.split(' ') as [string, Tint];
      const meshes: THREE.InstancedMesh[] = [];
      const proc = b.procModels.get(model);
      if (proc) {
        const mesh = new THREE.InstancedMesh(proc.geo, proc.mat, mats.length);
        for (let i = 0; i < mats.length; i++) mesh.setMatrixAt(i, mats[i]);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = !this.lowGfx && proc.castShadow;
        group.add(mesh);
        meshes.push(mesh);
      } else {
        const asset = bgModels.get(model);
        if (!asset) {
          console.warn(`battleground: unknown model '${model}'`);
          continue;
        }
        for (const part of asset.parts) {
          const mat = this.displayMat(part.srcMat, tint, Boolean(part.geo.getAttribute('color')));
          const mesh = new THREE.InstancedMesh(part.geo, mat, mats.length);
          for (let i = 0; i < mats.length; i++) mesh.setMatrixAt(i, mats[i]);
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
          mesh.castShadow = !this.lowGfx && CASTER_MODELS.has(model);
          group.add(mesh);
          meshes.push(mesh);
        }
      }
      emitted.set(key, meshes);
    }
    return emitted;
  }

  private resolveStructureRefs(st: SlotState, emitted: Map<string, THREE.InstancedMesh[]>): void {
    const resolve = (refs: PendingRef[] | undefined): InstRef[] => {
      const out: InstRef[] = [];
      for (const r of refs ?? []) {
        const meshes = emitted.get(r.key);
        if (meshes?.length) out.push({ meshes, index: r.index, matrix: r.matrix });
      }
      return out;
    };
    for (const vis of st.structures.values()) {
      vis.intact = resolve(this.pendingIntact.get(vis.def.id));
      vis.rubble = resolve(this.pendingRubble.get(vis.def.id));
      // rubble starts hidden
      for (const ref of vis.rubble) {
        for (const mesh of ref.meshes) mesh.setMatrixAt(ref.index, ZERO_MATRIX);
        for (const mesh of ref.meshes) mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.pendingIntact.clear();
    this.pendingRubble.clear();
    this.pendingStructures.clear();
  }

  private setStructureAlive(st: SlotState, vis: StructureVis, alive: boolean, live: boolean): void {
    vis.alive = alive;
    for (const ref of vis.intact) {
      for (const mesh of ref.meshes) {
        mesh.setMatrixAt(ref.index, alive ? ref.matrix : ZERO_MATRIX);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    for (const ref of vis.rubble) {
      for (const mesh of ref.meshes) {
        mesh.setMatrixAt(ref.index, alive ? ZERO_MATRIX : ref.matrix);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    if (vis.flame) vis.flame.visible = alive;
    if (vis.light) {
      vis.light.userData.baseIntensity = alive ? vis.lightBase : 0;
      if (!alive) vis.light.intensity = 0;
    }
    if (vis.warstoneShell) vis.warstoneShell.uniforms.uAlive.value = alive ? 1 : 0;
    if (vis.warstoneMat) vis.warstoneMat.emissiveIntensity = alive ? WARSTONE_EMISSIVE : 0.05;
    if (vis.embers) vis.embers.visible = alive;
    if (!alive && live) {
      // collapse burst at the structure's world position
      const at = new THREE.Vector3(st.ox + vis.def.x, 2.4, st.oz + vis.def.z);
      this.vfx.burst(at, 'fire', 30, 1.6);
      this.vfx.burst(at, 'physical', 18, 1.2);
    }
  }
}
