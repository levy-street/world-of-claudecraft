// The Sowfield: render dressing for the Vale Cup boarball ground in southern
// Eastbrook Vale (docs/prd/vale-cup.md). Modeled end to end on impact_site.ts:
// built once in the renderer ctor, distance-culled by update(), every mesh
// seated on terrainHeight()+lift so the sim heightfield stays authoritative.
// All positions come from src/sim/vale_cup_layout.ts (the single source the
// terrain flatten, colliders, and ball physics also read), so what you see is
// exactly what the ball banks off.
//
// Dressing mix: procedural harvest-festival timber (pitch boards, goal frames,
// banner poles, braziers, the Copper Pail plinth, chalk lines, bunting) plus
// shipped CC0 KayKit dungeon-kit GLBs (benches, foundations, crates, barrels,
// hay bales, the gate arch) extracted with the dungeon.ts recipe. Nation flags
// are procedural CanvasTextures from vale_cup_flags.ts on wind-swayed cloth
// planes (sharedUniforms.uTime).
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VC_NATIONS } from '../sim/content/vale_cup';
import { DUNGEON_X_THRESHOLD } from '../sim/data';
import { hash2 } from '../sim/rng';
import {
  BANNER_POLES,
  BOARD_H,
  BRAZIERS,
  GATE,
  GOAL_BOX_DEPTH,
  GOAL_BOX_HALF_W,
  GOAL_DEPTH,
  GOAL_HALF_W,
  GOAL_Z_MAX,
  GOAL_Z_MIN,
  MATCH_FLAG_POLES,
  PITCH,
  PITCH_CENTER,
  PLINTH_POS,
  SOWFIELD_CENTER,
  SOWFIELD_FLAT,
  STAND_NORTH,
  STAND_SOUTH,
  VC_STAND_TIER_DEPTH,
  VC_STAND_TIER_HEIGHTS,
} from '../sim/vale_cup_layout';
import { terrainHeight } from '../sim/world';
import type { CupInfo } from '../world_api/vale_cup';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX, sharedUniforms } from './gfx';
import { groundSplatMaps } from './textures';
import { flagTexture } from './vale_cup_flags';

export const VALE_CUP_STADIUM = {
  x: SOWFIELD_CENTER.x,
  z: SOWFIELD_CENTER.z,
  cullRadius: 300,
} as const;

const VISUAL_LIFT = 0.05;

// palette (Lambert-safe: mid-value hues that read without PBR)
const WOOD_A = 0x9b7748;
const WOOD_B = 0x86653c;
const WOOD_DARK = 0x6b4f2f;
const WOOD_PALE = 0xb08a58;
const STONE = 0xa8a29a;
const STONE_DARK = 0x8f8b82;
const IRON = 0x45464c;
const COAL = 0xff5a1a;
const CHALK = 0xf4efdd;
const GOAL_WOOD = 0xe6dfd2;

export interface ValeCupStadiumView {
  group: THREE.Group;
  /** A translated copy of the whole stadium (plus a grass pad) shown at a private
   *  practice instance's pitch, which sits far past the instance threshold where
   *  no terrain is drawn. The renderer adds this to the scene alongside `group`;
   *  update() positions and toggles it. */
  practiceGroup: THREE.Group;
  /** Brazier flames for the renderer's campfire flicker + ember pass. */
  flames: THREE.Mesh[];
  /** Brazier lights, owned by the renderer's constant point-light budget
   *  (never inside the cull-toggled group, the impact-site light rule). */
  lights: THREE.PointLight[];
  update(px: number, pz: number, dt: number, cup: CupInfo | null): void;
}

// ---------------------------------------------------------------------------
// CC0 kit pieces (KayKit Dungeon Remastered), extracted with the dungeon.ts
// recipe: merged float-attribute geometry + the pack's shared atlas material.
// registerPreload() folds the fetches into the boot gate so buildValeCupStadium
// can read the cache synchronously in the renderer ctor.
// ---------------------------------------------------------------------------

const KIT_PIECES = [
  'bench',
  'crate_large',
  'barrel_large',
  'haybale',
  'wagon_hay',
  'banner_green',
  'banner_patterna_yellow',
] as const;
type KitPiece = (typeof KIT_PIECES)[number];

interface KitAsset {
  geo: THREE.BufferGeometry;
  size: THREE.Vector3;
}

const kitAssets = new Map<string, KitAsset>();
let kitSourceMaterial: THREE.MeshStandardMaterial | null = null;

function attributeToFloat(geo: THREE.BufferGeometry, name: string): void {
  const attr = geo.getAttribute(name);
  if (!attr || (attr.array instanceof Float32Array && !attr.normalized)) return;
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
  }
  geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
}

function extractKitPiece(name: string, gltf: GLTF): void {
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
    if (!kitSourceMaterial) {
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        kitSourceMaterial = mat as THREE.MeshStandardMaterial;
      }
    }
  });
  if (geos.length === 0) throw new Error(`vale cup kit piece has no meshes: ${name}`);
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (!merged) throw new Error(`vale cup kit piece merge failed: ${name}`);
  merged.computeBoundingBox();
  const size = new THREE.Vector3();
  merged.boundingBox!.getSize(size);
  kitAssets.set(name, { geo: merged, size });
}

let kitAssetsPromise: Promise<void> | null = null;

export function ensureValeCupAssets(): Promise<void> {
  kitAssetsPromise ??= Promise.all(
    KIT_PIECES.map((name) => {
      const url = `models/dungeon/${name}.glb`;
      return loadGltf(url).then((g) => {
        extractKitPiece(name, g);
        releaseGltf(url);
      });
    }),
  ).then(() => undefined);
  return kitAssetsPromise;
}

// Boot-gate the kit fetches (tier-INDEPENDENT set, the props.ts preload law);
// headless/test imports never fetch.
if (typeof window !== 'undefined') registerPreload(ensureValeCupAssets());

function kitAsset(name: KitPiece): KitAsset {
  const a = kitAssets.get(name);
  if (!a) throw new Error(`vale cup kit piece not preloaded: ${name}`);
  return a;
}

/** Debug/screenshot-script hook: the measured bounding sizes of the loaded kit
 *  pieces (scales are derived from these, so mis-scaled placements show here). */
export function valeCupKitDebugSizes(): Record<string, { x: number; y: number; z: number }> {
  const out: Record<string, { x: number; y: number; z: number }> = {};
  for (const [name, a] of kitAssets) out[name] = { x: a.size.x, y: a.size.y, z: a.size.z };
  return out;
}

let kitDisplayMat: THREE.Material | null = null;
function kitMaterial(): THREE.Material {
  if (kitDisplayMat) return kitDisplayMat;
  const map = kitSourceMaterial?.map ?? null;
  kitDisplayMat = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0 })
    : new THREE.MeshLambertMaterial({ map });
  return kitDisplayMat;
}

// ---------------------------------------------------------------------------
// Procedural geometry helpers. Structural timber/stone/iron bakes a per-vertex
// color and merges into ONE vertex-colored mesh (a handful of draws for the
// whole ground); chalk/net/cloth get their own small materials.
// ---------------------------------------------------------------------------

function tintGeo(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const count = geo.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

interface StructureBag {
  geos: THREE.BufferGeometry[];
}

function addBox(
  bag: StructureBag,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rotY: number,
  hex: number,
): void {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.rotateY(rotY);
  geo.translate(x, y, z);
  bag.geos.push(tintGeo(geo, hex));
}

function addCyl(
  bag: StructureBag,
  rTop: number,
  rBot: number,
  h: number,
  seg: number,
  x: number,
  y: number,
  z: number,
  hex: number,
  rotX = 0,
  rotZ = 0,
): void {
  const geo = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  if (rotX !== 0) geo.rotateX(rotX);
  if (rotZ !== 0) geo.rotateZ(rotZ);
  geo.translate(x, y, z);
  bag.geos.push(tintGeo(geo, hex));
}

function structureMaterial(): THREE.Material {
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.88,
        metalness: 0.04,
        flatShading: true,
      })
    : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
}

// transparent white grid the goal nets sample (module-owned canvas; textures.ts
// is off-limits, its shared LCG makes generation order load-bearing)
function netTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  g.strokeStyle = 'rgba(236,231,214,0.95)';
  g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    const p = (i / 4) * size;
    g.beginPath();
    g.moveTo(0, p);
    g.lineTo(size, p);
    g.stroke();
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, size);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// the gate sign: painted boarball + the Copper Pail, deliberately TEXT-FREE so
// the renderer adds no player-visible string surface (i18n stays untouched)
function signTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 96;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  // pale sun-bleached planks so the painted marks stay readable at range
  g.fillStyle = '#c9a86e';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 === 0 ? '#d3b378' : '#bd9b63';
    g.fillRect(0, (i * h) / 4, w, h / 4 - 2);
  }
  g.strokeStyle = '#8a6a40';
  g.lineWidth = 5;
  g.strokeRect(3, 3, w - 6, h - 6);
  // the boarball: big hide-brown disc with an equator stitch
  g.fillStyle = '#8a5a33';
  g.beginPath();
  g.arc(w * 0.32, h * 0.5, h * 0.38, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#4a2d16';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(w * 0.32, h * 0.5, h * 0.38, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = '#e8d5a8';
  g.setLineDash([5, 5]);
  g.beginPath();
  g.moveTo(w * 0.32 - h * 0.36, h * 0.5);
  g.quadraticCurveTo(w * 0.32, h * 0.28, w * 0.32 + h * 0.36, h * 0.5);
  g.stroke();
  g.setLineDash([]);
  // the Copper Pail, bright and dented
  g.fillStyle = '#d98e4a';
  g.beginPath();
  g.moveTo(w * 0.56, h * 0.28);
  g.lineTo(w * 0.74, h * 0.28);
  g.lineTo(w * 0.71, h * 0.74);
  g.lineTo(w * 0.59, h * 0.74);
  g.closePath();
  g.fill();
  g.strokeStyle = '#7c4a20';
  g.lineWidth = 4;
  g.stroke();
  g.beginPath();
  g.arc(w * 0.65, h * 0.3, w * 0.05, Math.PI, 0);
  g.stroke();
  // crossed wheat sprigs behind
  g.strokeStyle = '#a67d1e';
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(w * 0.8, h * 0.78);
  g.quadraticCurveTo(w * 0.88, h * 0.45, w * 0.84, h * 0.2);
  g.stroke();
  g.beginPath();
  g.moveTo(w * 0.9, h * 0.78);
  g.quadraticCurveTo(w * 0.82, h * 0.45, w * 0.92, h * 0.24);
  g.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// cloth material with a gentle wind sway (hoist-weighted, sharedUniforms.uTime;
// one program: the onBeforeCompile source is identical across flags)
function clothMaterial(tex: THREE.Texture, phase: number): THREE.Material {
  const mat = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        map: tex,
        side: THREE.DoubleSide,
        roughness: 0.92,
        metalness: 0,
      })
    : new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
  const phaseUniform = { value: phase };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedUniforms.uTime;
    sh.uniforms.uVcPhase = phaseUniform;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform float uVcPhase;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float vcHoist = clamp(position.x / 1.9, 0.0, 1.0);
          transformed.z += sin(uTime * 2.6 + uVcPhase + position.x * 2.1) * 0.24 * vcHoist * vcHoist;
          transformed.y += sin(uTime * 1.8 + uVcPhase * 1.31 + position.x * 1.6) * 0.07 * vcHoist;
        }`,
      );
  };
  return mat;
}

// flag cloth: local x runs 0..w from the pole so the wind shader can weight by
// hoist distance
function flagGeometry(w: number, h: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(w, h, 10, 4);
  geo.translate(w / 2, 0, 0);
  return geo;
}

// ---------------------------------------------------------------------------

export function buildValeCupStadium(seed: number): ValeCupStadiumView {
  const group = new THREE.Group();
  group.name = 'sowfield-stadium';
  // measured kit sizes ride along for the screenshot script's diagnostics
  group.userData.kitSizes = valeCupKitDebugSizes();
  const flames: THREE.Mesh[] = [];
  const lights: THREE.PointLight[] = [];
  const rich = GFX.standardMaterials;

  const th = (x: number, z: number): number => terrainHeight(x, z, seed) + VISUAL_LIFT;

  const structure: StructureBag = { geos: [] };
  const chalk: StructureBag = { geos: [] };
  const nets: StructureBag = { geos: [] };
  const bunting: StructureBag = { geos: [] };

  // ---- pitch boards (per the collider runs: gate gap in the north board,
  // goal mouths open in the east/west boards) -------------------------------
  const gateL = GATE.x - GATE.halfW;
  const gateR = GATE.x + GATE.halfW;
  const boardRuns: { x1: number; z1: number; x2: number; z2: number }[] = [
    { x1: PITCH.xMin, z1: PITCH.zMax, x2: gateL, z2: PITCH.zMax },
    { x1: gateR, z1: PITCH.zMax, x2: PITCH.xMax, z2: PITCH.zMax },
    { x1: PITCH.xMin, z1: PITCH.zMin, x2: PITCH.xMax, z2: PITCH.zMin },
    { x1: PITCH.xMin, z1: PITCH.zMin, x2: PITCH.xMin, z2: GOAL_Z_MIN },
    { x1: PITCH.xMin, z1: GOAL_Z_MAX, x2: PITCH.xMin, z2: PITCH.zMax },
    { x1: PITCH.xMax, z1: PITCH.zMin, x2: PITCH.xMax, z2: GOAL_Z_MIN },
    { x1: PITCH.xMax, z1: GOAL_Z_MAX, x2: PITCH.xMax, z2: PITCH.zMax },
  ];
  let plankSalt = 0;
  for (const run of boardRuns) {
    const dx = run.x2 - run.x1;
    const dz = run.z2 - run.z1;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const yaw = Math.atan2(ux, uz); // plank faces across the run
    const plankStep = 0.62;
    const count = Math.max(1, Math.round(len / plankStep));
    for (let i = 0; i < count; i++) {
      plankSalt++;
      const t = (i + 0.5) / count;
      const px = run.x1 + ux * len * t;
      const pz = run.z1 + uz * len * t;
      const jitterH = (hash2(plankSalt, 11, seed) - 0.5) * 0.14;
      const h = BOARD_H + jitterH;
      const tone =
        hash2(plankSalt, 12, seed) < 0.34
          ? WOOD_B
          : hash2(plankSalt, 13, seed) < 0.5
            ? WOOD_A
            : WOOD_PALE;
      addBox(structure, 0.56, h, 0.24, px, th(px, pz) + h / 2 - 0.08, pz, yaw, tone);
    }
    // posts every ~3.2yd + rounded cap rail along the top
    const postCount = Math.max(2, Math.round(len / 3.2) + 1);
    for (let i = 0; i < postCount; i++) {
      const t = i / (postCount - 1);
      const px = run.x1 + ux * len * t;
      const pz = run.z1 + uz * len * t;
      addBox(
        structure,
        0.3,
        BOARD_H + 0.3,
        0.3,
        px,
        th(px, pz) + (BOARD_H + 0.3) / 2 - 0.1,
        pz,
        yaw,
        WOOD_DARK,
      );
    }
    const mx = (run.x1 + run.x2) / 2;
    const mz = (run.z1 + run.z2) / 2;
    const capY = th(mx, mz) + BOARD_H + 0.04;
    if (Math.abs(dx) > Math.abs(dz)) {
      addCyl(structure, 0.1, 0.1, len + 0.2, 8, mx, capY, mz, WOOD_DARK, 0, Math.PI / 2);
    } else {
      addCyl(structure, 0.1, 0.1, len + 0.2, 8, mx, capY, mz, WOOD_DARK, Math.PI / 2, 0);
    }
  }
  // chunky flanking posts at the players' gap in the north board
  for (const gx of [gateL, gateR]) {
    const gy = th(gx, PITCH.zMax);
    addBox(
      structure,
      0.42,
      BOARD_H + 0.7,
      0.42,
      gx,
      gy + (BOARD_H + 0.7) / 2 - 0.1,
      PITCH.zMax,
      0,
      WOOD_DARK,
    );
  }

  // ---- goals: whitewashed timber frames + net pockets ----------------------
  const netTex = netTexture();
  const goalPostH = 2.5;
  for (const side of [-1, 1] as const) {
    const lineX = side === -1 ? PITCH.xMin : PITCH.xMax;
    const backX = lineX + side * GOAL_DEPTH;
    const postY = th(lineX, GOAL_Z_MIN);
    // posts + crossbar (goal-white so the mouth reads at range on every tier)
    addCyl(
      structure,
      0.14,
      0.17,
      goalPostH,
      10,
      lineX,
      postY + goalPostH / 2,
      GOAL_Z_MIN,
      GOAL_WOOD,
    );
    addCyl(
      structure,
      0.14,
      0.17,
      goalPostH,
      10,
      lineX,
      postY + goalPostH / 2,
      GOAL_Z_MAX,
      GOAL_WOOD,
    );
    addCyl(
      structure,
      0.12,
      0.12,
      GOAL_HALF_W * 2 + 0.34,
      10,
      lineX,
      postY + goalPostH - 0.06,
      PITCH_CENTER.z,
      GOAL_WOOD,
      Math.PI / 2,
      0,
    );
    // short back posts holding the pocket
    const backH = 1.3;
    for (const gz of [GOAL_Z_MIN, GOAL_Z_MAX]) {
      addCyl(structure, 0.09, 0.11, backH, 8, backX, th(backX, gz) + backH / 2, gz, GOAL_WOOD);
    }
    // net planes: top sheet (crossbar to back rail), back sheet, two side sheets
    const quad = (
      a: THREE.Vector3,
      b: THREE.Vector3,
      c: THREE.Vector3,
      d: THREE.Vector3,
      uScale: number,
      vScale: number,
    ): void => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array([
        a.x,
        a.y,
        a.z,
        b.x,
        b.y,
        b.z,
        c.x,
        c.y,
        c.z,
        a.x,
        a.y,
        a.z,
        c.x,
        c.y,
        c.z,
        d.x,
        d.y,
        d.z,
      ]);
      const uv = new Float32Array([
        0,
        0,
        uScale,
        0,
        uScale,
        vScale,
        0,
        0,
        uScale,
        vScale,
        0,
        vScale,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.computeVertexNormals();
      nets.geos.push(geo);
    };
    const y0 = th(backX, PITCH_CENTER.z);
    const zA = GOAL_Z_MIN - 0.16;
    const zB = GOAL_Z_MAX + 0.16;
    const topBarY = postY + goalPostH - 0.08;
    const backTopY = y0 + backH - 0.05;
    const u = (GOAL_HALF_W * 2 + 0.3) / 0.42;
    // top sheet
    quad(
      new THREE.Vector3(lineX, topBarY, zA),
      new THREE.Vector3(lineX, topBarY, zB),
      new THREE.Vector3(backX, backTopY, zB),
      new THREE.Vector3(backX, backTopY, zA),
      u,
      (GOAL_DEPTH + 0.7) / 0.42,
    );
    // back sheet
    quad(
      new THREE.Vector3(backX, y0 + 0.02, zA),
      new THREE.Vector3(backX, y0 + 0.02, zB),
      new THREE.Vector3(backX, backTopY, zB),
      new THREE.Vector3(backX, backTopY, zA),
      u,
      backH / 0.42,
    );
    // side sheets
    for (const gz of [zA, zB]) {
      quad(
        new THREE.Vector3(lineX, postY + 0.02, gz),
        new THREE.Vector3(lineX, topBarY, gz),
        new THREE.Vector3(backX, backTopY, gz),
        new THREE.Vector3(backX, y0 + 0.02, gz),
        (GOAL_DEPTH + 1.2) / 0.42,
        goalPostH / 0.42,
      );
    }
  }

  // ---- chalk pitch lines (halfway line, center circle + spot, goal boxes) --
  const chalkLine = (x1: number, z1: number, x2: number, z2: number, w = 0.32): void => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / 2));
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz * (w / 2);
    const nz = ux * (w / 2);
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const ax = x1 + dx * t0;
      const az = z1 + dz * t0;
      const bx = x1 + dx * t1;
      const bz = z1 + dz * t1;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array([
        ax + nx,
        th(ax + nx, az + nz) + 0.015,
        az + nz,
        bx + nx,
        th(bx + nx, bz + nz) + 0.015,
        bz + nz,
        bx - nx,
        th(bx - nx, bz - nz) + 0.015,
        bz - nz,
        ax + nx,
        th(ax + nx, az + nz) + 0.015,
        az + nz,
        bx - nx,
        th(bx - nx, bz - nz) + 0.015,
        bz - nz,
        ax - nx,
        th(ax - nx, az - nz) + 0.015,
        az - nz,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      chalk.geos.push(geo);
    }
  };
  chalkLine(PITCH_CENTER.x, PITCH.zMin, PITCH_CENTER.x, PITCH.zMax); // halfway
  const circleSeg = 48;
  for (let i = 0; i < circleSeg; i++) {
    const a0 = (i / circleSeg) * Math.PI * 2;
    const a1 = ((i + 1) / circleSeg) * Math.PI * 2;
    chalkLine(
      PITCH_CENTER.x + Math.cos(a0) * 4.5,
      PITCH_CENTER.z + Math.sin(a0) * 4.5,
      PITCH_CENTER.x + Math.cos(a1) * 4.5,
      PITCH_CENTER.z + Math.sin(a1) * 4.5,
      0.28,
    );
  }
  chalkLine(PITCH_CENTER.x - 0.4, PITCH_CENTER.z, PITCH_CENTER.x + 0.4, PITCH_CENTER.z, 0.7); // spot
  for (const side of [-1, 1] as const) {
    const lineX = side === -1 ? PITCH.xMin : PITCH.xMax;
    const frontX = lineX + side * GOAL_BOX_DEPTH;
    chalkLine(frontX, PITCH_CENTER.z - GOAL_BOX_HALF_W, frontX, PITCH_CENTER.z + GOAL_BOX_HALF_W);
    chalkLine(lineX, PITCH_CENTER.z - GOAL_BOX_HALF_W, frontX, PITCH_CENTER.z - GOAL_BOX_HALF_W);
    chalkLine(lineX, PITCH_CENTER.z + GOAL_BOX_HALF_W, frontX, PITCH_CENTER.z + GOAL_BOX_HALF_W);
  }

  // ---- stands: foundation tiers + bench rows + crate clutter (CC0 kit) -----
  const inst = new Map<KitPiece, THREE.Matrix4[]>();
  const addInst = (
    kind: KitPiece,
    x: number,
    y: number,
    z: number,
    rotY: number,
    scale: number | [number, number, number],
  ): void => {
    const m = new THREE.Matrix4();
    const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
    m.compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
      new THREE.Vector3(s[0], s[1], s[2]),
    );
    const list = inst.get(kind);
    if (list) list.push(m);
    else inst.set(kind, [m]);
  };

  const benchAsset = kitAsset('bench');
  const tierHeights = [VC_STAND_TIER_HEIGHTS[0], VC_STAND_TIER_HEIGHTS[1]];
  const tierDepth = VC_STAND_TIER_DEPTH;
  for (const stand of [STAND_NORTH, STAND_SOUTH]) {
    const north = stand === STAND_NORTH;
    const front = north ? stand.zMin : stand.zMax;
    const dirAway = north ? 1 : -1; // +z away from the pitch for the north stand
    const width = stand.xMax - stand.xMin;
    const xMid = (stand.xMin + stand.xMax) / 2;
    for (let tier = 0; tier < 2; tier++) {
      const zC = front + dirAway * (tierDepth / 2 + tier * tierDepth);
      const frontZ = front + dirAway * tier * tierDepth;
      const hTop = tierHeights[tier];
      const prevTop = tier === 0 ? 0 : tierHeights[tier - 1];
      // Timber deck in 4 spans, each seated on its own terrain sample. The decks
      // are built on the FLAT terrain baseline (terrainHeight, not the walkable
      // groundHeight): at the real Sowfield the walkable ground ramps up to the
      // deck top (sowfieldStandLift, in groundHeight) so a player climbs the
      // tiers and the risers/posts sit buried under the ramp; at a private
      // practice-pitch copy (flat ground) the same posts/fascia visibly support
      // the decks. One geometry, correct both places.
      const spans = 4;
      const spanW = width / spans;
      for (let sIdx = 0; sIdx < spans; sIdx++) {
        const xC = stand.xMin + (sIdx + 0.5) * spanW;
        const deckY = th(xC, zC) + hTop - 0.1;
        addBox(
          structure,
          spanW + 0.04,
          0.2,
          tierDepth,
          xC,
          deckY,
          zC,
          0,
          (sIdx + tier) % 2 === 0 ? WOOD_A : WOOD_PALE,
        );
        // pitch-facing fascia: closes the step riser so the tier reads solid
        const fh = hTop - prevTop + 0.12;
        addBox(
          structure,
          spanW + 0.04,
          fh,
          0.16,
          xC,
          th(xC, frontZ) + prevTop + fh / 2 - 0.08,
          frontZ,
          0,
          WOOD_B,
        );
      }
      // support posts along the riser front
      for (let px2 = stand.xMin + 1; px2 <= stand.xMax - 0.5; px2 += 4.1) {
        addBox(
          structure,
          0.26,
          hTop + 0.1,
          0.26,
          px2,
          th(px2, frontZ) + (hTop + 0.1) / 2 - 0.08,
          frontZ + dirAway * 0.3,
          0,
          WOOD_DARK,
        );
      }
      // side skirts at both stand ends
      for (const ex of [stand.xMin, stand.xMax]) {
        addBox(structure, 0.16, hTop, tierDepth, ex, th(ex, zC) + hTop / 2 - 0.06, zC, 0, WOOD_B);
      }
      // bench rows on each tier, facing the pitch; leave the gate aisle open
      const benchStep = rich ? 2.7 : 4.1;
      const benchScale = 2.3 / Math.max(0.001, benchAsset.size.x);
      const benchZ = zC + dirAway * 0.5;
      const benchYaw = north ? Math.PI : 0;
      for (let bx = stand.xMin + 1.6; bx <= stand.xMax - 1.6; bx += benchStep) {
        if (north && Math.abs(bx - GATE.x) < 2.4) continue; // gate aisle
        const salt = Math.round(bx * 7 + zC);
        // plain benches only: bench_decorated carries a skull + lantern (crypt
        // dressing), the wrong vibe for a harvest festival
        addInst(
          'bench',
          bx,
          th(bx, benchZ) + hTop,
          benchZ,
          benchYaw + (hash2(salt, 22, seed) - 0.5) * 0.08,
          benchScale,
        );
      }
      // back rail along the top tier rear
      if (tier === 1) {
        const backZ = zC + dirAway * (tierDepth / 2);
        addCyl(
          structure,
          0.07,
          0.07,
          width,
          6,
          xMid,
          th(xMid, backZ) + hTop + 0.85,
          backZ,
          WOOD_DARK,
          0,
          Math.PI / 2,
        );
        for (let px2 = stand.xMin + 0.4; px2 <= stand.xMax; px2 += 5) {
          addBox(structure, 0.14, 1, 0.14, px2, th(px2, backZ) + hTop + 0.4, backZ, 0, WOOD_DARK);
        }
      }
    }
    // crate/barrel clutter at the stand ends (plain pieces: no skull dressing)
    const endZ = front + dirAway * 2.2;
    const crateScale = 1.5 / Math.max(0.001, kitAsset('crate_large').size.x);
    const brl = 1.0 / Math.max(0.001, kitAsset('barrel_large').size.x);
    addInst(
      'crate_large',
      stand.xMin - 1.6,
      th(stand.xMin - 1.6, endZ) - 0.02,
      endZ,
      0.6,
      crateScale,
    );
    addInst(
      'crate_large',
      stand.xMax + 1.5,
      th(stand.xMax + 1.5, endZ) - 0.02,
      endZ,
      -0.4,
      crateScale,
    );
    if (rich) {
      const bz1 = endZ + dirAway * 1.8;
      addInst('barrel_large', stand.xMin - 1.4, th(stand.xMin - 1.4, bz1) - 0.02, bz1, 1.7, brl);
      addInst('barrel_large', stand.xMax + 2.6, th(stand.xMax + 2.6, endZ) - 0.02, endZ, 0.3, brl);
    }
  }

  // ---- the gate: a timber arch (the lore's wagon gates), hung kit banners,
  // and the text-free painted sign ------------------------------------------
  const gateY = th(GATE.x, GATE.z);
  const postH = 5.2;
  const postOff = GATE.halfW + 0.5;
  for (const side of [-1, 1] as const) {
    const gx = GATE.x + side * postOff;
    addBox(structure, 0.5, postH, 0.5, gx, th(gx, GATE.z) + postH / 2 - 0.08, GATE.z, 0, WOOD_DARK);
    // squat foot so the posts read planted
    addBox(structure, 0.8, 0.5, 0.8, gx, th(gx, GATE.z) + 0.2, GATE.z, 0, WOOD_B);
  }
  addBox(structure, postOff * 2 + 1.1, 0.5, 0.55, GATE.x, gateY + postH + 0.15, GATE.z, 0, WOOD_A);
  addBox(structure, postOff * 2 + 0.5, 0.3, 0.4, GATE.x, gateY + postH - 0.75, GATE.z, 0, WOOD_B);
  const bannerScaleG = 2.4 / Math.max(0.001, kitAsset('banner_green').size.y);
  const bannerScaleY = 2.4 / Math.max(0.001, kitAsset('banner_patterna_yellow').size.y);
  addInst('banner_green', GATE.x - postOff, gateY + postH - 0.9, GATE.z + 0.32, 0, bannerScaleG);
  addInst(
    'banner_patterna_yellow',
    GATE.x + postOff,
    gateY + postH - 0.9,
    GATE.z + 0.32,
    0,
    bannerScaleY,
  );

  const signMat = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.9, metalness: 0 })
    : new THREE.MeshLambertMaterial({ map: signTexture() });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 0.14), signMat);
  sign.position.set(GATE.x, gateY + postH - 0.85, GATE.z);
  sign.castShadow = true;
  group.add(sign);

  // ---- hay bales + the hay wagon outside the boards -------------------------
  const hay = kitAsset('haybale');
  const hayScale = 1.7 / Math.max(0.001, hay.size.x);
  const haySpots: [number, number][] = [
    [PITCH.xMin - 4.5, PITCH.zMin - 4],
    [PITCH.xMin - 5.5, PITCH.zMax + 3],
    [PITCH.xMax + 4.5, PITCH.zMin - 3.5],
    [PITCH.xMax + 5, PITCH.zMax + 4],
    [PITCH.xMin - 4, PITCH_CENTER.z + 2],
    [PITCH.xMax + 4.2, PITCH_CENTER.z - 3],
    [gateL - 3, PITCH.zMax + 5],
    [gateR + 4, PITCH.zMax + 5.5],
    [PITCH.xMin - 6, PITCH_CENTER.z - 8],
    [PITCH.xMax + 6, PITCH_CENTER.z + 7],
    [GATE.x - 8, GATE.z - 1],
    [GATE.x + 9, GATE.z - 2],
  ];
  const hayCount = rich ? haySpots.length : 7;
  for (let i = 0; i < hayCount; i++) {
    const [hx, hz] = haySpots[i];
    const jx = hx + (hash2(i, 31, seed) - 0.5) * 1.6;
    const jz = hz + (hash2(i, 32, seed) - 0.5) * 1.6;
    addInst('haybale', jx, th(jx, jz) - 0.03, jz, hash2(i, 33, seed) * Math.PI * 2, hayScale);
  }
  const wagon = kitAsset('wagon_hay');
  const wagonScale = 3.4 / Math.max(0.001, wagon.size.x);
  addInst(
    'wagon_hay',
    GATE.x + 12,
    th(GATE.x + 12, GATE.z + 2) - 0.02,
    GATE.z + 2,
    -0.9,
    wagonScale,
  );

  // ---- the eight nation banner poles + cloth flags --------------------------
  const flagGeo = flagGeometry(1.9, 1.15);
  const matchFlagGeo = flagGeometry(2.4, 1.45);
  const flagYaw = -Math.PI / 4; // shared breeze direction (toward the pitch)
  const matchFlags: { mesh: THREE.Mesh; mat: THREE.Material }[] = [];
  for (let i = 0; i < BANNER_POLES.length; i++) {
    const pole = BANNER_POLES[i];
    const poleH = 7.2;
    const py = th(pole.x, pole.z);
    addCyl(structure, 0.07, 0.11, poleH, 8, pole.x, py + poleH / 2, pole.z, WOOD_B);
    addCyl(structure, 0.16, 0.16, 0.1, 8, pole.x, py + poleH + 0.05, pole.z, 0xc9a34a); // finial
    const nation = VC_NATIONS[i % VC_NATIONS.length];
    const mat = clothMaterial(flagTexture(nation.id), i * 1.37);
    const flag = new THREE.Mesh(flagGeo, mat);
    flag.position.set(pole.x, py + poleH - 0.75, pole.z);
    flag.rotation.y = flagYaw + (i % 2) * 0.12;
    flag.castShadow = rich;
    group.add(flag);
  }
  // the two match-flag poles by the gate (competing nations while live)
  for (let i = 0; i < MATCH_FLAG_POLES.length; i++) {
    const pole = MATCH_FLAG_POLES[i];
    const poleH = 8.4;
    const py = th(pole.x, pole.z);
    addCyl(structure, 0.08, 0.12, poleH, 8, pole.x, py + poleH / 2, pole.z, WOOD_DARK);
    addCyl(structure, 0.18, 0.18, 0.1, 8, pole.x, py + poleH + 0.05, pole.z, 0xc9a34a);
    const mat = clothMaterial(flagTexture('vale'), 2.4 + i * 1.7);
    const flag = new THREE.Mesh(matchFlagGeo, mat);
    flag.position.set(pole.x, py + poleH - 0.9, pole.z);
    flag.rotation.y = flagYaw + i * 0.1;
    flag.castShadow = rich;
    group.add(flag);
    matchFlags.push({ mesh: flag, mat });
  }

  // ---- bunting: pennant strings (all eight nation colors) -------------------
  const pennantColors = VC_NATIONS.map((n) => new THREE.Color(n.primary));
  let pennantIdx = 0;
  const buntingRun = (
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
  ): void => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const count = Math.max(3, Math.floor(len / 0.62));
    const sag = Math.min(0.55, len * 0.055);
    for (let i = 0; i < count; i++) {
      const t0 = (i + 0.12) / count;
      const t1 = (i + 0.82) / count;
      const droop = (t: number): number => Math.sin(t * Math.PI) * -sag;
      const ax = x1 + (x2 - x1) * t0;
      const ay = y1 + (y2 - y1) * t0 + droop(t0);
      const az = z1 + (z2 - z1) * t0;
      const bx = x1 + (x2 - x1) * t1;
      const by = y1 + (y2 - y1) * t1 + droop(t1);
      const bz = z1 + (z2 - z1) * t1;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2 - 0.42;
      const mz = (az + bz) / 2;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array([ax, ay, az, bx, by, bz, mx, my, mz]), 3),
      );
      geo.computeVertexNormals();
      bunting.geos.push(tintGeo(geo, pennantColors[pennantIdx % pennantColors.length].getHex()));
      pennantIdx++;
    }
  };
  for (let i = 0; i < BANNER_POLES.length - 1; i++) {
    const a = BANNER_POLES[i];
    const b = BANNER_POLES[i + 1];
    buntingRun(a.x, th(a.x, a.z) + 6.6, a.z, b.x, th(b.x, b.z) + 6.6, b.z);
  }
  // gate arch to the two match poles
  for (const pole of MATCH_FLAG_POLES) {
    buntingRun(GATE.x, gateY + postH + 0.3, GATE.z, pole.x, th(pole.x, pole.z) + 7.6, pole.z);
  }
  // along the north stand back rail, festival strings on short posts
  const railPosts = [STAND_NORTH.xMin, -23.5, 1.5, STAND_NORTH.xMax];
  const railZ = STAND_NORTH.zMax + 0.6;
  for (const rx of railPosts) {
    addCyl(structure, 0.06, 0.09, 3.4, 6, rx, th(rx, railZ) + 1.7, railZ, WOOD_B);
  }
  for (let i = 0; i < railPosts.length - 1; i++) {
    const a = railPosts[i];
    const b = railPosts[i + 1];
    buntingRun(a, th(a, railZ) + 3.3, railZ, b, th(b, railZ) + 3.3, railZ);
  }

  // ---- corner braziers (fireLights budget; flames flicker via the renderer) -
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
  const coalMat = new THREE.MeshBasicMaterial({ color: COAL });
  const coalGeo = new THREE.SphereGeometry(0.3, 10, 6);
  for (let i = 0; i < BRAZIERS.length; i++) {
    const b = BRAZIERS[i];
    const by = th(b.x, b.z);
    // pedestal + iron bowl
    addCyl(structure, 0.14, 0.22, 1.05, 8, b.x, by + 0.52, b.z, IRON);
    addCyl(structure, 0.55, 0.3, 0.42, 10, b.x, by + 1.22, b.z, IRON);
    addCyl(structure, 0.58, 0.58, 0.07, 10, b.x, by + 1.42, b.z, 0x303136);
    const coals = new THREE.Mesh(coalGeo, coalMat);
    coals.scale.set(1.15, 0.45, 1.15);
    coals.position.set(b.x, by + 1.4, b.z);
    group.add(coals);
    const flame = new THREE.Mesh(
      flameGeo,
      new THREE.MeshLambertMaterial({
        color: 0xffaa33,
        emissive: 0xff6600,
        emissiveIntensity: rich ? 2.2 : 1.4,
        transparent: true,
        opacity: 0.92,
      }),
    );
    flame.position.set(b.x, by + 1.42, b.z);
    group.add(flame);
    flames.push(flame);
    // NOT added to `group` (distance cull would change the visible point-light
    // count and recompile materials): the renderer owns these via fireLights.
    const light = new THREE.PointLight(0xff8830, rich ? 9 : 5, 15, 2);
    light.position.set(b.x, by + 2.3, b.z);
    light.userData.baseIntensity = rich ? 9 : 5;
    lights.push(light);
  }

  // ---- the Copper Pail on its plinth by the gate ----------------------------
  const px = PLINTH_POS.x;
  const pz = PLINTH_POS.z;
  const py = th(px, pz);
  addCyl(structure, 0.5, 0.6, 1.05, 8, px, py + 0.52, pz, STONE);
  addCyl(structure, 0.66, 0.66, 0.12, 8, px, py + 1.11, pz, STONE_DARK);
  const pailProfile = [
    [0.02, 0],
    [0.3, 0.01],
    [0.33, 0.07],
    [0.38, 0.4],
    [0.36, 0.54],
    [0.4, 0.6],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const pailGeo = new THREE.LatheGeometry(pailProfile, 14);
  {
    // the famous dents
    const pos = pailGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const dent = 1 + (hash2(i, 41, seed) - 0.5) * 0.09;
      pos.setX(i, pos.getX(i) * dent);
      pos.setZ(i, pos.getZ(i) * dent);
    }
    pailGeo.computeVertexNormals();
  }
  // bright bronzed copper with a warm ember so it reads at dusk and on Lambert
  const copperMat = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        color: 0xd98e4a,
        metalness: 0.62,
        roughness: 0.32,
        emissive: 0x351505,
        emissiveIntensity: 0.5,
      })
    : new THREE.MeshLambertMaterial({ color: 0xd9904e, emissive: 0x2a1204 });
  const pail = new THREE.Mesh(pailGeo, copperMat);
  pail.position.set(px, py + 1.17, pz);
  pail.rotation.y = 0.6;
  pail.castShadow = true;
  group.add(pail);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.03, 6, 14, Math.PI), copperMat);
  handle.position.set(px, py + 1.77, pz);
  group.add(handle);

  // ---- assemble the merged/instanced meshes ---------------------------------
  const structGeo = mergeGeometries(structure.geos, false);
  if (structGeo) {
    structGeo.computeBoundingSphere();
    const structMesh = new THREE.Mesh(structGeo, structureMaterial());
    structMesh.castShadow = true;
    structMesh.receiveShadow = true;
    group.add(structMesh);
    for (const g of structure.geos) g.dispose();
  }
  const chalkGeo = mergeGeometries(chalk.geos, false);
  if (chalkGeo) {
    chalkGeo.computeBoundingSphere();
    const chalkMesh = new THREE.Mesh(
      chalkGeo,
      new THREE.MeshBasicMaterial({
        color: CHALK,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    chalkMesh.renderOrder = 2;
    group.add(chalkMesh);
    for (const g of chalk.geos) g.dispose();
  }
  const netGeo = mergeGeometries(nets.geos, false);
  if (netGeo) {
    netGeo.computeBoundingSphere();
    const netMesh = new THREE.Mesh(
      netGeo,
      new THREE.MeshBasicMaterial({
        map: netTex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    netMesh.renderOrder = 1;
    group.add(netMesh);
    for (const g of nets.geos) g.dispose();
  }
  const buntingGeo = mergeGeometries(bunting.geos, false);
  if (buntingGeo) {
    buntingGeo.computeBoundingSphere();
    const buntingMesh = new THREE.Mesh(
      buntingGeo,
      new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    );
    group.add(buntingMesh);
    for (const g of bunting.geos) g.dispose();
  }
  for (const [kind, mats] of inst) {
    const asset = kitAsset(kind);
    const mesh = new THREE.InstancedMesh(asset.geo, kitMaterial(), mats.length);
    for (let i = 0; i < mats.length; i++) mesh.setMatrixAt(i, mats[i]);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---- private practice-pitch copy ------------------------------------------
  // A private practice bout runs on a copy of the pitch far past the instance
  // threshold (see vcPracticeOrigin), where the overworld terrain is not drawn.
  // Clone the whole stadium and add a grass pad so the practicing player sees a
  // real field with goals/boards, not a black void. The clone is shifted in Y by
  // -SOWFIELD_FLAT.height so the pitch surface (baked at the flattened Sowfield
  // height) lands on the flat instance floor (DUNGEON_FLOOR_Y = 0), matching where
  // the sim seats the players and ball.
  const practiceGroup = group.clone(true);
  practiceGroup.name = 'sowfield-practice';
  practiceGroup.visible = false;
  {
    const padW = SOWFIELD_FLAT.xMax - SOWFIELD_FLAT.xMin;
    const padD = SOWFIELD_FLAT.zMax - SOWFIELD_FLAT.zMin;
    // Real grass: reuse the shipped procedural terrain grass map (its own clone
    // so the tiling repeat is local), tiled a few yards per tile across the pad.
    const grass = groundSplatMaps().grass;
    const grassMap = grass.map.clone();
    grassMap.wrapS = THREE.RepeatWrapping;
    grassMap.wrapT = THREE.RepeatWrapping;
    grassMap.repeat.set(padW / 6, padD / 6);
    grassMap.needsUpdate = true;
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(padW, padD),
      new THREE.MeshLambertMaterial({ map: grassMap }),
    );
    pad.rotation.x = -Math.PI / 2;
    // Baked in the Sowfield frame (the clone's Y shift lifts it onto the floor).
    pad.position.set(SOWFIELD_CENTER.x, SOWFIELD_FLAT.height, SOWFIELD_CENTER.z);
    pad.receiveShadow = true;
    pad.renderOrder = -1;
    practiceGroup.add(pad);
  }

  // ---- live-match flag swap + distance cull ---------------------------------
  let matchFlagKey = 'idle';
  return {
    group,
    practiceGroup,
    flames,
    lights,
    update(px2: number, pz2: number, _dt: number, cup: CupInfo | null): void {
      // In a private practice instance: show the shifted copy at the practice
      // pitch, hide the real one. `origin` is {0,0} for the real Sowfield match.
      const origin = cup?.match?.origin ?? null;
      const inPractice =
        px2 > DUNGEON_X_THRESHOLD && origin != null && (origin.x !== 0 || origin.z !== 0);
      if (inPractice) {
        practiceGroup.position.set(origin.x, -SOWFIELD_FLAT.height, origin.z);
        practiceGroup.visible = true;
        group.visible = false;
        return;
      }
      practiceGroup.visible = false;
      if (px2 > DUNGEON_X_THRESHOLD) {
        group.visible = false;
        return;
      }
      const dx = px2 - VALE_CUP_STADIUM.x;
      const dz = pz2 - VALE_CUP_STADIUM.z;
      group.visible = dx * dx + dz * dz < VALE_CUP_STADIUM.cullRadius * VALE_CUP_STADIUM.cullRadius;
      if (!group.visible) return;
      const live = cup?.live ?? null;
      const key = live ? `${live.nationA}|${live.nationB}` : 'idle';
      if (key !== matchFlagKey) {
        matchFlagKey = key;
        const texA = live ? flagTexture(live.nationA) : flagTexture('vale');
        const texB = live
          ? flagTexture(live.nationB, live.nationA === live.nationB)
          : flagTexture('vale');
        (matchFlags[0].mat as THREE.MeshStandardMaterial).map = texA;
        (matchFlags[1].mat as THREE.MeshStandardMaterial).map = texB;
      }
    },
  };
}
