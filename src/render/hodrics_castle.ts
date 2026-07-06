// Hodric's Castle course: built from the SAME plain-data layout the sim
// derives its colliders from (src/sim/hodrics_layout.ts), so what you see is
// what you collide with, plus the animated obstacles.
//
// LOOK: a bright gameshow castle (the Fall Guys reference in the PRD): candy
// pink crenellated walls, cyan cone-roofed towers, striped hammer pendulums
// on rigid arms under A-frame gantries, barber-pole log rotors, beach-ball
// boulders that visibly roll, pennant strings, drifting cartoon clouds, and
// confetti on the finish keep. Everything is procedural geometry + canvas
// textures except a handful of CC0 GLB set pieces (arch gates, the finish
// castle bulk, banners, torches).
//
// Obstacles are POSED, never simulated here: every frame calls the exact same
// pure pose functions the sim's race physics reads (hcFlailBob, hcAxeHead,
// hcRotorAngle, hcDrawspanX, hcLaneBoulders), evaluated at the renderer's
// interpolated clock (`this.time` on Renderer, passed in as `t`). That is the
// whole "what you see is what you collide with" contract for a moving part:
// sim and render read one function, never two. Clouds, flag flutter, and
// boulder roll are pure functions of the same t (cosmetic, no collision).
//
// Built once per race slot (on approach) and left in the scene for the
// session, the DungeonInteriors precedent (builtInteriors never tears down).

import * as THREE from 'three';
import {
  HC_AXES,
  HC_BOULDER_LANES,
  HC_CHASM_Y,
  HC_DRAWSPANS,
  HC_FLAILS,
  HC_ROTORS,
  HC_SURFACES,
  type HcSurface,
  hcAxeHead,
  hcDrawspanX,
  hcFlailBob,
  hcLaneBoulders,
  hcPendulumAngle,
  hcRotorAngle,
  hodricsColliders,
  hodricsGroundLocal,
} from '../sim/hodrics_layout';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { surfaceMat } from './gfx';

// ---------------------------------------------------------------------------
// Asset preload: a handful of CC0 GLB set pieces, cloned (not instanced) —
// the course builds once per slot (at most HODRICS_SLOT_COUNT = 2), so a few
// dozen extra draw calls per build costs nothing worth an InstancedMesh
// pipeline. Obstacles and towers are procedural (see below), no GLBs.
// ---------------------------------------------------------------------------

const CASTLE_MODELS = {
  bannerBlue: 'models/dungeon/banner_blue.glb',
  bannerRed: 'models/dungeon/banner_red.glb',
  torchLit: 'models/dungeon/torch_lit.glb',
} as const;

type CastleModelKey = keyof typeof CASTLE_MODELS;

const modelCache = new Map<CastleModelKey, THREE.Object3D>();
let assetsPromise: Promise<void> | null = null;

export function ensureHodricsAssets(): Promise<void> {
  assetsPromise ??= Promise.all(
    (Object.keys(CASTLE_MODELS) as CastleModelKey[]).map((key) =>
      loadGltf(CASTLE_MODELS[key]).then((gltf) => {
        modelCache.set(key, gltf.scene);
      }),
    ),
  ).then(() => undefined);
  return assetsPromise;
}

if (typeof window !== 'undefined') registerPreload(ensureHodricsAssets());

// A static prop is a plain recursive clone (no skinning to preserve) —
// consumers must not mutate the cached source scene.
function cloneModel(key: CastleModelKey): THREE.Object3D {
  const src = modelCache.get(key);
  if (!src) throw new Error(`hodrics castle asset not preloaded: ${key}`);
  return src.clone(true);
}

// ---------------------------------------------------------------------------
// Palette: saturated gameshow candy. Every course material carries a small
// emissive lift of its own hue so shadow faces read as a deeper tone of the
// same color, never mud — the flat-lit cartoon look under a single sun.
// ---------------------------------------------------------------------------

const PINK_WALL = 0xe878b0;
const PINK_LIGHT = 0xf7aed2;
const CYAN_ROOF = 0x35b3e6;
const GOLD = 0xf2b13c;
const STEEL = 0x8f96a6;
const RED_STRIPE = '#e8344a';
const YELLOW_STRIPE = '#ffc93c';
const ORANGE_STRIPE = '#ff9438';
const CREAM = '#f6efdc';

const WALL_HEIGHT = 4;
const POST_HEIGHT = 7.4;
const HC_FINISH_ARCH_Z = 119;

// Emissive-lifted candy material (cached by surfaceMat).
function candyMat(color: number, opts: { map?: THREE.Texture; flatShading?: boolean } = {}) {
  return surfaceMat({
    color,
    map: opts.map,
    flatShading: opts.flatShading ?? false,
    roughness: 0.8,
    emissive: color,
    emissiveIntensity: 0.22,
  });
}

// ---------------------------------------------------------------------------
// Procedural canvas textures: stripes and checkers, built lazily per style
// (the module loads under Node in vitest transforms; no document at import).
// ---------------------------------------------------------------------------

const texCache = new Map<string, THREE.CanvasTexture>();

function bandsTex(key: string, colors: string[], bands: number, horizontal: boolean) {
  const cached = texCache.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const step = 256 / bands;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = colors[i % colors.length];
    if (horizontal) ctx.fillRect(0, i * step, 256, step + 1);
    else ctx.fillRect(i * step, 0, step + 1, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}

function checkerTex(key: string, a: string, b: string, n: number) {
  const cached = texCache.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const step = 256 / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? a : b;
      ctx.fillRect(i * step, j * step, step + 1, step + 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}

// Deterministic scatter hash (render-side dressing only; the sim never reads
// this). Keeps screenshots stable run to run, unlike Math.random.
function hash01(i: number, salt: number): number {
  let h = (i * 2654435761 + salt * 340573321) >>> 0;
  h ^= h >> 15;
  h = (h * 2246822519) >>> 0;
  h ^= h >> 13;
  return (h >>> 8) / 0xffffff;
}

// ---------------------------------------------------------------------------
// Floors: candy-coded per section from HC_SURFACES.
// ---------------------------------------------------------------------------

function floorMaterial(s: HcSurface): THREE.Material {
  switch (s.kind) {
    case 'grass':
      return candyMat(0x8ccb4a);
    case 'wood': {
      // The Flail Bridge: bold yellow/orange bands across the walk.
      const bands = Math.max(4, Math.round((s.z1 - s.z0) / 2));
      return candyMat(0xffffff, {
        map: bandsTex(`bridge${bands}`, [YELLOW_STRIPE, ORANGE_STRIPE], bands, true),
      });
    }
    case 'stone':
      return candyMat(0xd9d2ea, { flatShading: s.y1 !== undefined });
    case 'plaza':
      return candyMat(0xffffff, { map: checkerTex('plaza', CREAM, '#f2b7cf', 8) });
    case 'carpet':
      return candyMat(0xd8344a);
    case 'keep':
      return candyMat(0xffffff, { map: checkerTex('keep', '#f6e6b8', '#e8b64c', 8) });
  }
}

function buildFlatFloor(s: HcSurface): THREE.Mesh {
  const geo = new THREE.BoxGeometry(s.x1 - s.x0, 0.4, s.z1 - s.z0);
  const mesh = new THREE.Mesh(geo, floorMaterial(s));
  mesh.position.set((s.x0 + s.x1) / 2, s.y0 - 0.2, (s.z0 + s.z1) / 2);
  mesh.receiveShadow = true;
  return mesh;
}

// A sloped surface (y varies linearly with z): an explicit 8-vertex prism so
// the top face lands exactly on the two collision endpoints, no rotation math
// to get subtly wrong.
function buildRampFloor(s: HcSurface): THREE.Mesh {
  const y1v = s.y1 as number;
  const thickness = 0.6;
  // Overshoot both z ends a touch (slope continued) so the coplanar seam
  // faces tuck inside the neighboring slabs instead of z-fighting them.
  const slope = (y1v - s.y0) / (s.z1 - s.z0);
  const over = 0.06;
  const z0 = s.z0 - over;
  const z1 = s.z1 + over;
  const y0 = s.y0 - slope * over;
  const y1 = y1v + slope * over;
  const p = (x: number, y: number, z: number) => [x, y, z];
  const A = p(s.x0, y0, z0),
    B = p(s.x1, y0, z0),
    C = p(s.x1, y1, z1),
    D = p(s.x0, y1, z1);
  const A2 = p(s.x0, y0 - thickness, z0),
    B2 = p(s.x1, y0 - thickness, z0),
    C2 = p(s.x1, y1 - thickness, z1),
    D2 = p(s.x0, y1 - thickness, z1);
  // Six quads (top, bottom, +z end, -z end, +x side, -x side), each as two
  // triangles with its own vertices so flat shading reads clean per face.
  const quads: number[][][] = [
    [A, B, C, D], // top
    [D2, C2, B2, A2], // bottom (winding flipped)
    [D, C, C2, D2], // +z end
    [B, A, A2, B2], // -z end
    [C, B, B2, C2], // +x side
    [A, D, D2, A2], // -x side
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const [v0, v1, v2, v3] of quads) {
    positions.push(...v0, ...v1, ...v2, ...v0, ...v2, ...v3);
    // Planar top-down UVs so the ramp can take a banded map like flat floors.
    for (const v of [v0, v1, v2, v0, v2, v3]) {
      uvs.push((v[0] - s.x0) / (s.x1 - s.x0), (v[2] - s.z0) / (s.z1 - s.z0));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, floorMaterial(s));
  mesh.receiveShadow = true;
  return mesh;
}

function buildFloors(group: THREE.Group): void {
  for (const s of HC_SURFACES) {
    group.add(s.y1 === undefined ? buildFlatFloor(s) : buildRampFloor(s));
  }
}

// ---------------------------------------------------------------------------
// Walls + crenellations + towers, from the same hodricsColliders() the sim
// resolves movement against.
// ---------------------------------------------------------------------------

// Ground height under a wall element. Anything probing the chasm (a gantry
// post beside the open bridge deck) roots at the course base instead.
function wallBaseAt(lx: number, lz: number): number {
  const g = hodricsGroundLocal(lx, lz);
  return g <= HC_CHASM_Y + 1 ? 0 : g;
}

function buildWalls(group: THREE.Group): void {
  const wallMat = candyMat(PINK_WALL);
  const merlonPlacements: { x: number; z: number; y: number; alongX: boolean }[] = [];

  // One wall box based at baseY, with its merlon row queued for instancing.
  const addWallBox = (cx: number, cz: number, hw: number, hd: number, baseY: number) => {
    const geo = new THREE.BoxGeometry(hw * 2, WALL_HEIGHT, hd * 2);
    const mesh = new THREE.Mesh(geo, wallMat);
    mesh.position.set(cx, baseY + WALL_HEIGHT / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const alongX = hw >= hd;
    const half = alongX ? hw : hd;
    const count = Math.floor((half * 2) / 1.9);
    for (let i = 0; i < count; i++) {
      const off = -half + 0.95 + i * 1.9;
      merlonPlacements.push({
        x: cx + (alongX ? off : 0),
        z: cz + (alongX ? 0 : off),
        y: baseY + WALL_HEIGHT + 0.4,
        alongX,
      });
    }
  };

  // Walls rise from the LOCAL course height (the keep terrace sits at y 14,
  // the alley climbs 0 to 8): a flat base under level ground, stepped
  // battlement segments where the ground slopes underneath.
  for (const c of hodricsColliders()) {
    if (c.type === 'obb') {
      const alongX = c.hw >= c.hd;
      const half = alongX ? c.hw : c.hd;
      const end0 = wallBaseAt(alongX ? c.x - half + 0.1 : c.x, alongX ? c.z : c.z - half + 0.1);
      const end1 = wallBaseAt(alongX ? c.x + half - 0.1 : c.x, alongX ? c.z : c.z + half - 0.1);
      if (Math.abs(end1 - end0) < 0.5) {
        addWallBox(c.x, c.z, c.hw, c.hd, Math.min(end0, end1));
      } else {
        const steps = Math.max(3, Math.round(Math.abs(end1 - end0) / 2));
        const stepLen = (half * 2) / steps;
        for (let i = 0; i < steps; i++) {
          const offC = -half + stepLen * (i + 0.5);
          const sx = c.x + (alongX ? offC : 0);
          const sz = c.z + (alongX ? 0 : offC);
          addWallBox(
            sx,
            sz,
            alongX ? stepLen / 2 : c.hw,
            alongX ? c.hd : stepLen / 2,
            wallBaseAt(sx, sz),
          );
        }
      }
    } else {
      buildTowerPost(group, c.x, c.z, c.r);
    }
  }

  // All merlons in one instanced draw.
  const geo = new THREE.BoxGeometry(1, 0.8, 1);
  const inst = new THREE.InstancedMesh(geo, candyMat(PINK_LIGHT), merlonPlacements.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  for (let i = 0; i < merlonPlacements.length; i++) {
    const pl = merlonPlacements[i];
    scl.set(pl.alongX ? 1.0 : 0.9, 1, pl.alongX ? 0.9 : 1.0);
    m.compose(new THREE.Vector3(pl.x, pl.y, pl.z), q, scl);
    inst.setMatrixAt(i, m);
  }
  inst.castShadow = true;
  group.add(inst);
}

// Collider posts become festive turret poles: the flail gantry pair (r 0.45)
// reads as steel A-frame uprights, the arch posts as gold-capped pink poles.
function buildTowerPost(group: THREE.Group, x: number, z: number, r: number): void {
  const gantry = r < 0.5;
  const base = wallBaseAt(x, z);
  const h = gantry ? HC_FLAILS[0].pivotY + 0.6 : POST_HEIGHT;
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 1.15, h, 10),
    gantry ? candyMat(STEEL) : candyMat(PINK_WALL),
  );
  pole.position.set(x, base + h / 2, z);
  pole.castShadow = true;
  group.add(pole);
  if (!gantry) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.35, 12, 10), candyMat(GOLD));
    cap.position.set(x, base + h + r * 0.9, z);
    group.add(cap);
  }
}

// A candy gate arch: a half-torus rainbow of pink spanning its collider
// posts, crowned with a gold ball. The posts themselves come from
// hodricsColliders() via buildTowerPost.
function buildCandyArch(group: THREE.Group, halfSpan: number, z: number, baseY: number): void {
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(halfSpan, 0.55, 10, 28, Math.PI),
    candyMat(PINK_LIGHT),
  );
  arch.position.set(0, baseY + POST_HEIGHT, z);
  arch.castShadow = true;
  group.add(arch);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 10), candyMat(GOLD));
  ball.position.set(0, baseY + POST_HEIGHT + halfSpan + 0.4, z);
  group.add(ball);
}

// The finish backdrop: a broad pink keep block behind the terrace wall with
// three cone-roofed turrets, the reference image's skyline. Extends well
// below the terrace so the chasm never peeks through behind the finish.
function buildKeepBackdrop(group: THREE.Group): void {
  const bulk = new THREE.Mesh(new THREE.BoxGeometry(24, 16, 6), candyMat(PINK_WALL));
  bulk.position.set(0, 10, 136);
  bulk.castShadow = true;
  bulk.receiveShadow = true;
  group.add(bulk);
  buildTurret(group, -9, 136, 14, 1.2);
  buildTurret(group, 9, 136, 14, 1.2);
  buildTurret(group, 0, 137, 14, 1.7);
}

// Pure-dressing corner turrets (no collider): pink drum + cyan cone + gold
// ball, the castle silhouette of the reference image.
function buildTurret(group: THREE.Group, x: number, z: number, baseY: number, scale = 1): void {
  const drumH = 7 * scale;
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6 * scale, 1.8 * scale, drumH, 12),
    candyMat(PINK_WALL),
  );
  drum.position.set(x, baseY + drumH / 2, z);
  drum.castShadow = true;
  group.add(drum);
  const roofH = 3.2 * scale;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(2.2 * scale, roofH, 12),
    candyMat(CYAN_ROOF, { flatShading: true }),
  );
  roof.position.set(x, baseY + drumH + roofH / 2, z);
  roof.castShadow = true;
  group.add(roof);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42 * scale, 10, 8), candyMat(GOLD));
  ball.position.set(x, baseY + drumH + roofH + 0.3 * scale, z);
  group.add(ball);
}

// ---------------------------------------------------------------------------
// Dressing: GLB set pieces, corner turrets, pennant strings, confetti.
// ---------------------------------------------------------------------------

function placeProp(
  group: THREE.Group,
  key: CastleModelKey,
  x: number,
  y: number,
  z: number,
  rotY: number,
  scale = 1,
): void {
  const obj = cloneModel(key);
  obj.position.set(x, y, z);
  obj.rotation.y = rotY;
  obj.scale.setScalar(scale);
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  group.add(obj);
}

function buildDressing(group: THREE.Group): void {
  // Candy arches over the yard mouth and the finish line (their posts are
  // colliders, drawn by buildTowerPost), and the keep skyline behind it all.
  buildCandyArch(group, 7, -104, 0);
  buildCandyArch(group, 5, HC_FINISH_ARCH_Z, 14);
  buildKeepBackdrop(group);

  // Corner turrets: the start yard's four corners, the court gates, and the
  // finish terrace, tracing the course silhouette in pink-and-cyan.
  buildTurret(group, -16, -116, 0);
  buildTurret(group, 16, -116, 0);
  buildTurret(group, -16, -85, 0);
  buildTurret(group, 16, -85, 0);
  buildTurret(group, -14, -35, 0, 0.85);
  buildTurret(group, 14, -35, 0, 0.85);
  buildTurret(group, -14, 15, 0, 0.85);
  buildTurret(group, 14, 15, 0, 0.85);
  buildTurret(group, -13.8, 76.5, 0, 0.85);
  buildTurret(group, 13.8, 76.5, 0, 0.85);
  buildTurret(group, -14, 132, 14, 0.9);
  buildTurret(group, 14, 132, 14, 0.9);

  // Banners along the Log Court walls and the finish gate.
  const bannerSpots: [number, number, number][] = [
    [-13.5, 0, -30],
    [13.5, 0, -30],
    [-13.5, 0, 5],
    [13.5, 0, 5],
    [-13.5, 14, 118],
    [13.5, 14, 118],
  ];
  for (const [x, y, z] of bannerSpots) {
    placeProp(
      group,
      x < 0 ? 'bannerBlue' : 'bannerRed',
      x,
      y,
      z,
      x < 0 ? Math.PI / 2 : -Math.PI / 2,
      1.3,
    );
  }

  // Torches at the checkpoint landings, rooted on the local course height.
  const torchSpots: [number, number][] = [
    [-13, -40],
    [13, -40],
    [-11, 78],
    [11, 78],
    [-9, 104],
    [9, 104],
  ];
  for (const [x, z] of torchSpots) placeProp(group, 'torchLit', x, wallBaseAt(x, z), z, 0, 1.2);

  buildPennants(group);
  buildConfetti(group);
}

// Pennant strings: triangle flags on a sagging line across the course at the
// section gates. One instanced draw, per-instance festival colors.
const FLAG_COLORS = [0x35b3e6, 0xffc93c, 0xef5d8f, 0xf6efdc];

interface PennantSpan {
  x0: number;
  x1: number;
  y: number;
  z: number;
}

const PENNANT_SPANS: PennantSpan[] = [
  { x0: -16, x1: 16, y: 9.5, z: -85 },
  { x0: -14, x1: 14, y: 8.5, z: -35 },
  { x0: -14, x1: 14, y: 8.5, z: 15 },
  { x0: -12, x1: 12, y: 8.5, z: 50 },
  { x0: -12, x1: 12, y: 8.5, z: 78 },
  { x0: -14, x1: 14, y: 23, z: 118 },
];

function buildPennants(group: THREE.Group): void {
  const flagsPerSpan = PENNANT_SPANS.map((s) => Math.floor((s.x1 - s.x0) / 2.1));
  const total = flagsPerSpan.reduce((a, b) => a + b, 0);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -1.2, 0], 3),
  );
  geo.computeVertexNormals();
  // Unlit: pennants read as flat printed fabric, full candy saturation from
  // any angle (Lambert + instance colors goes muddy on the shadow side).
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const inst = new THREE.InstancedMesh(geo, mat, total);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const color = new THREE.Color();
  let i = 0;
  for (let s = 0; s < PENNANT_SPANS.length; s++) {
    const span = PENNANT_SPANS[s];
    const n = flagsPerSpan[s];
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n;
      const x = span.x0 + (span.x1 - span.x0) * f;
      // Catenary-ish sag: deepest mid-span.
      const y = span.y - Math.sin(f * Math.PI) * 1.1;
      m.compose(new THREE.Vector3(x, y, span.z), q, one);
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, color.setHex(FLAG_COLORS[(s + k) % FLAG_COLORS.length]));
      i++;
    }
  }
  group.add(inst);
}

// Confetti sprinkle on the finish keep floor: one instanced draw of tiny
// tilted quads in festival colors, deterministically scattered.
function buildConfetti(group: THREE.Group): void {
  const N = 110;
  const geo = new THREE.PlaneGeometry(0.28, 0.28);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const inst = new THREE.InstancedMesh(geo, mat, N);
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const color = new THREE.Color();
  for (let i = 0; i < N; i++) {
    pos.set(-13 + hash01(i, 1) * 26, 14.03 + hash01(i, 2) * 0.03, 119 + hash01(i, 3) * 12);
    e.set(-Math.PI / 2, 0, hash01(i, 4) * Math.PI);
    q.setFromEuler(e);
    m.compose(pos, q, one);
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, color.setHex(FLAG_COLORS[i % FLAG_COLORS.length]));
  }
  group.add(inst);
}

// ---------------------------------------------------------------------------
// Clouds: fat cartoon puffs drifting slowly over the course. Pure function of
// t (base + drift, wrapped), so every client sees the same sky.
// ---------------------------------------------------------------------------

interface CloudDef {
  x: number;
  y: number;
  z: number;
  scale: number;
  speed: number;
}

const CLOUDS: CloudDef[] = [
  { x: -34, y: 26, z: -100, scale: 1.0, speed: 0.9 },
  { x: 30, y: 32, z: -60, scale: 1.5, speed: 0.6 },
  { x: -28, y: 29, z: -10, scale: 1.2, speed: 0.75 },
  { x: 34, y: 27, z: 30, scale: 0.9, speed: 1.05 },
  { x: -30, y: 33, z: 70, scale: 1.4, speed: 0.55 },
  { x: 26, y: 30, z: 105, scale: 1.1, speed: 0.8 },
  { x: -20, y: 36, z: 132, scale: 1.3, speed: 0.65 },
];

// Each cloud is 4 overlapping puffs; one InstancedMesh total.
const PUFFS: [number, number, number, number][] = [
  [0, 0, 0, 2.6],
  [2.1, 0.5, 0.4, 1.9],
  [-2.0, 0.4, -0.3, 1.7],
  [0.6, 1.3, 0.2, 1.6],
];

const CLOUD_WRAP = 90;

function buildClouds(group: THREE.Group): THREE.InstancedMesh {
  const geo = new THREE.SphereGeometry(1, 10, 8);
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    emissive: 0xdfe9f5,
    emissiveIntensity: 0.55,
  });
  const inst = new THREE.InstancedMesh(geo, mat, CLOUDS.length * PUFFS.length);
  inst.castShadow = false;
  group.add(inst);
  return inst;
}

function poseClouds(inst: THREE.InstancedMesh, t: number): void {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  let i = 0;
  for (const c of CLOUDS) {
    // Drift in +x, wrapping across a wide window centered on the course.
    const drift =
      ((((c.x + t * c.speed + CLOUD_WRAP) % (CLOUD_WRAP * 2)) + CLOUD_WRAP * 2) %
        (CLOUD_WRAP * 2)) -
      CLOUD_WRAP;
    for (const [px, py, pz, ps] of PUFFS) {
      pos.set(drift + px * c.scale, c.y + py * c.scale, c.z + pz * c.scale);
      scl.set(ps * c.scale, ps * c.scale * 0.62, ps * c.scale * 0.8);
      m.compose(pos, q, scl);
      inst.setMatrixAt(i, m);
      i++;
    }
  }
  inst.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Obstacles: analytic pose, evaluated fresh every frame from `t`.
// ---------------------------------------------------------------------------

// Rigs store only the THREE objects; pose math re-reads the def arrays by
// index (rigs are built 1:1 from HC_FLAILS/HC_AXES/HC_ROTORS/HC_DRAWSPANS, so
// index i always means the same obstacle in both places).
interface PendulumRig {
  /** Pivots at the gantry; arm + head hang below and swing via rotation.z. */
  pivot: THREE.Group;
}

interface RotorRig {
  beam: THREE.Group;
}

interface DrawspanRig {
  mesh: THREE.Mesh;
}

interface BoulderRig {
  pool: THREE.Object3D[];
}

// The gameshow hammer: a fat yellow cylinder head with a red center band and
// gold caps, its axis along the course (z), hanging on a rigid grey arm.
function buildHammerHead(bobR: number): THREE.Group {
  const head = new THREE.Group();
  const halfLen = bobR * 1.05;
  const seg = (color: number, z0: number, z1: number) => {
    const g = new THREE.CylinderGeometry(bobR, bobR, z1 - z0, 14);
    g.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(g, candyMat(color));
    mesh.position.z = (z0 + z1) / 2;
    mesh.castShadow = true;
    head.add(mesh);
  };
  seg(0xffc93c, -halfLen, -halfLen * 0.33);
  seg(0xe8344a, -halfLen * 0.33, halfLen * 0.33);
  seg(0xffc93c, halfLen * 0.33, halfLen);
  const capGeo = new THREE.CylinderGeometry(bobR * 0.55, bobR * 0.55, 0.3, 12);
  capGeo.rotateX(Math.PI / 2);
  for (const zc of [-halfLen - 0.15, halfLen + 0.15]) {
    const cap = new THREE.Mesh(capGeo, candyMat(GOLD));
    cap.position.z = zc;
    head.add(cap);
  }
  return head;
}

// The axe pendulum: a broad gold crescent blade on a crimson arm.
function buildAxeHeadMesh(headR: number): THREE.Group {
  const head = new THREE.Group();
  const bladeGeo = new THREE.CylinderGeometry(headR, headR, 0.5, 18, 1, false, 0, Math.PI);
  bladeGeo.rotateX(Math.PI / 2);
  // Bulge the cutting arc DOWNWARD (away from the pivot) in the swing plane.
  bladeGeo.rotateZ(-Math.PI / 2);
  const blade = new THREE.Mesh(bladeGeo, candyMat(GOLD, { flatShading: true }));
  blade.castShadow = true;
  head.add(blade);
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), candyMat(0xe8344a));
  head.add(boss);
  return head;
}

function buildPendulum(
  group: THREE.Group,
  z: number,
  pivotY: number,
  armLen: number,
  head: THREE.Group,
  gantryHalfX: number | null,
  uprights = false,
): PendulumRig {
  const pivot = new THREE.Group();
  pivot.position.set(0, pivotY, z);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, armLen, 8), candyMat(STEEL));
  arm.position.y = -armLen / 2;
  arm.castShadow = true;
  pivot.add(arm);
  head.position.y = -armLen;
  pivot.add(head);
  group.add(pivot);
  // Crossbeam between the gantry posts, with a gold pivot hub. The flail
  // bridge already has collider gantry posts (drawn by buildTowerPost); the
  // axe walk has none, so uprights are drawn here when asked.
  if (gantryHalfX !== null) {
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(gantryHalfX * 2 + 0.6, 0.5, 0.5),
      candyMat(STEEL),
    );
    beam.position.set(0, pivotY + 0.25, z);
    beam.castShadow = true;
    group.add(beam);
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), candyMat(GOLD));
    hub.position.set(0, pivotY, z);
    group.add(hub);
    if (uprights) {
      for (const sx of [-gantryHalfX, gantryHalfX]) {
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.28, pivotY + 0.5, 8),
          candyMat(STEEL),
        );
        pole.position.set(sx, (pivotY + 0.5) / 2, z);
        pole.castShadow = true;
        group.add(pole);
      }
    }
  }
  return { pivot };
}

// Barber-pole rotor log: alternating red/white segments plus a gold hub.
function buildRotorBeam(group: THREE.Group, cx: number, cz: number, r: number, beamHalf: number) {
  const beam = new THREE.Group();
  beam.position.set(cx, 0.85, cz);
  const segs = 8;
  const segLen = (r * 2) / segs;
  for (let i = 0; i < segs; i++) {
    const g = new THREE.CylinderGeometry(beamHalf, beamHalf, segLen, 10);
    g.rotateZ(Math.PI / 2);
    const mesh = new THREE.Mesh(g, candyMat(i % 2 === 0 ? 0xe8344a : 0xf6efdc));
    mesh.position.x = -r + segLen * (i + 0.5);
    mesh.castShadow = true;
    beam.add(mesh);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 1.9, 12), candyMat(GOLD));
  hub.position.y = 0.1;
  beam.add(hub);
  group.add(beam);
  return { beam };
}

function buildObstacles(group: THREE.Group): {
  flails: PendulumRig[];
  axes: PendulumRig[];
  rotors: RotorRig[];
  drawspans: DrawspanRig[];
  boulders: BoulderRig[];
} {
  const flails: PendulumRig[] = HC_FLAILS.map((f) =>
    buildPendulum(group, f.z, f.pivotY, f.chainLen, buildHammerHead(f.bobR), 6.9),
  );

  const axes: PendulumRig[] = HC_AXES.map((a) =>
    buildPendulum(group, a.z, a.pivotY, a.armLen, buildAxeHeadMesh(a.headR), 4.9, true),
  );

  const rotors: RotorRig[] = HC_ROTORS.map((r) =>
    buildRotorBeam(group, r.cx, r.cz, r.r, r.beamHalf),
  );

  const drawspans: DrawspanRig[] = HC_DRAWSPANS.map((d) => {
    const deckTex = bandsTex('drawspan', ['#7ec8ef', '#f6efdc'], 6, false);
    const geo = new THREE.BoxGeometry(d.halfX * 2, 0.5, d.halfZ * 2);
    const mesh = new THREE.Mesh(geo, candyMat(0xffffff, { map: deckTex }));
    mesh.receiveShadow = true;
    mesh.position.set(0, d.y - 0.25, d.zCenter);
    // Gold trim rails on the leading/trailing edges.
    for (const zOff of [-d.halfZ + 0.15, d.halfZ - 0.15]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(d.halfX * 2, 0.7, 0.3), candyMat(GOLD));
      rail.position.set(0, 0.35, zOff);
      mesh.add(rail);
    }
    group.add(mesh);
    return { mesh };
  });

  const boulders: BoulderRig[] = HC_BOULDER_LANES.map((lane, laneIdx) => {
    const travel = (lane.zTop - lane.zEnd) / lane.speed;
    const poolSize = Math.max(2, Math.ceil(travel / lane.period) + 1);
    const ballTex = bandsTex(
      `ball${laneIdx}`,
      [RED_STRIPE, CREAM, '#35b3e6', CREAM, YELLOW_STRIPE, CREAM],
      6,
      false,
    );
    const pool: THREE.Object3D[] = [];
    for (let i = 0; i < poolSize; i++) {
      const b = new THREE.Mesh(
        new THREE.SphereGeometry(lane.r, 16, 12),
        candyMat(0xffffff, { map: ballTex }),
      );
      b.castShadow = true;
      b.visible = false;
      group.add(b);
      pool.push(b);
    }
    return { pool };
  });

  return { flails, axes, rotors, drawspans, boulders };
}

// ---------------------------------------------------------------------------
// Public build + update
// ---------------------------------------------------------------------------

export interface HodricsCastleView {
  group: THREE.Group;
  update(t: number): void;
}

export async function buildHodricsCastle(
  scene: THREE.Scene,
  ox: number,
  oz: number,
): Promise<HodricsCastleView> {
  await ensureHodricsAssets();
  const group = new THREE.Group();
  group.position.set(ox, 0, oz);
  buildFloors(group);
  buildWalls(group);
  buildDressing(group);
  const obstacles = buildObstacles(group);
  const clouds = buildClouds(group);
  scene.add(group);
  return { group, update: buildUpdate(obstacles, clouds) };
}

// Real per-frame updater, closed over the same HC_FLAILS/HC_AXES/HC_ROTORS/
// HC_DRAWSPANS/HC_BOULDER_LANES defs the rig arrays were built from (indices
// line up 1:1, so no lookup is needed at update time).
function buildUpdate(
  obstacles: {
    flails: PendulumRig[];
    axes: PendulumRig[];
    rotors: RotorRig[];
    drawspans: DrawspanRig[];
    boulders: BoulderRig[];
  },
  clouds: THREE.InstancedMesh,
): (t: number) => void {
  return (t: number) => {
    // Pendulums swing by rotating the whole pivot group: the arm and head
    // then sit at exactly hcFlailBob/hcAxeHead's analytic position (same
    // sin/cos), while staying visually rigid.
    for (let i = 0; i < obstacles.flails.length; i++) {
      const def = HC_FLAILS[i];
      obstacles.flails[i].pivot.rotation.z = hcPendulumAngle(def.amp, def.period, def.phase, t);
    }
    for (let i = 0; i < obstacles.axes.length; i++) {
      const def = HC_AXES[i];
      obstacles.axes[i].pivot.rotation.z = hcPendulumAngle(def.amp, def.period, def.phase, t);
    }
    for (let i = 0; i < obstacles.rotors.length; i++) {
      const def = HC_ROTORS[i];
      obstacles.rotors[i].beam.rotation.y = hcRotorAngle(def, t);
    }
    for (let i = 0; i < obstacles.drawspans.length; i++) {
      const def = HC_DRAWSPANS[i];
      obstacles.drawspans[i].mesh.position.x = hcDrawspanX(def, t);
    }
    for (let i = 0; i < obstacles.boulders.length; i++) {
      const lane = HC_BOULDER_LANES[i];
      const rig = obstacles.boulders[i];
      const active = hcLaneBoulders(lane, t);
      for (let k = 0; k < rig.pool.length; k++) {
        const b = rig.pool[k];
        const live = active[k];
        if (live) {
          b.visible = true;
          b.position.set(lane.x, live.y, live.z);
          // Roll with travel: contact-point kinematics down the -z lane.
          b.rotation.x = (live.z - lane.zTop) / lane.r;
        } else {
          b.visible = false;
        }
      }
    }
    poseClouds(clouds, t);
  };
}
