// Hodric's Castle course: built from the SAME plain-data layout the sim
// derives its colliders from (src/sim/hodrics_layout.ts), so what you see is
// what you collide with, plus the animated obstacles, dressed with CC0
// KayKit/Quaternius GLBs already bundled under public/models/.
//
// Obstacles are POSED, never simulated here: every frame calls the exact same
// pure pose functions the sim's race physics reads (hcFlailBob, hcAxeHead,
// hcRotorAngle, hcDrawspanX, hcLaneBoulders), evaluated at the renderer's
// interpolated clock (`this.time` on Renderer, passed in as `t`). That is the
// whole "what you see is what you collide with" contract for a moving part:
// sim and render read one function, never two.
//
// Built once per race slot (on approach) and left in the scene for the
// session, the DungeonInteriors precedent (builtInteriors never tears down).

import * as THREE from 'three';
import {
  HC_AXES,
  HC_BOULDER_LANES,
  HC_DRAWSPANS,
  HC_FLAILS,
  HC_ROTORS,
  HC_SURFACES,
  type HcSurface,
  hcAxeHead,
  hcDrawspanX,
  hcFlailBob,
  hcLaneBoulders,
  hcRotorAngle,
  hodricsColliders,
} from '../sim/hodrics_layout';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { surfaceMat } from './gfx';

// ---------------------------------------------------------------------------
// Asset preload: a handful of CC0 GLBs, cloned (not instanced) — the course
// builds once per slot (at most HODRICS_SLOT_COUNT = 2), so a few dozen extra
// draw calls per build costs nothing worth an InstancedMesh pipeline.
// ---------------------------------------------------------------------------

const CASTLE_MODELS = {
  archGate: 'models/dungeon/arch_gate.glb',
  hexTower: 'models/biome/hex_tower.glb',
  hexCastle: 'models/biome/hex_castle.glb',
  bannerBlue: 'models/dungeon/banner_blue.glb',
  bannerRed: 'models/dungeon/banner_red.glb',
  torchLit: 'models/dungeon/torch_lit.glb',
  flailHead: 'models/weapons/hammer_a.glb',
  axeHead: 'models/weapons/axe_2handed.glb',
  boulder: 'models/biome/desert_boulder_1.glb',
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
// Palette
// ---------------------------------------------------------------------------

const SURFACE_COLOR: Record<HcSurface['kind'], number> = {
  grass: 0x4f7f3a,
  wood: 0x8a6a42,
  stone: 0x8c8c92,
  plaza: 0x9a8fae,
  carpet: 0x5a3a8a,
  keep: 0xaaa2b4,
};

const WALL_COLOR = 0x74747c;
const WALL_HEIGHT = 4;
const POST_HEIGHT = 7.4;
const HC_FINISH_ARCH_Z = 119;

// ---------------------------------------------------------------------------
// Static geometry: floors (from HC_SURFACES) + walls/posts (from the same
// hodricsColliders() the sim resolves movement against).
// ---------------------------------------------------------------------------

function buildFlatFloor(s: HcSurface): THREE.Mesh {
  const geo = new THREE.BoxGeometry(s.x1 - s.x0, 0.4, s.z1 - s.z0);
  const mesh = new THREE.Mesh(geo, surfaceMat({ color: SURFACE_COLOR[s.kind] }));
  mesh.position.set((s.x0 + s.x1) / 2, s.y0 - 0.2, (s.z0 + s.z1) / 2);
  mesh.receiveShadow = true;
  return mesh;
}

// A sloped surface (y varies linearly with z): an explicit 8-vertex prism so
// the top face lands exactly on the two collision endpoints, no rotation math
// to get subtly wrong.
function buildRampFloor(s: HcSurface): THREE.Mesh {
  const y1 = s.y1 as number;
  const thickness = 0.6;
  const p = (x: number, y: number, z: number) => [x, y, z];
  const A = p(s.x0, s.y0, s.z0),
    B = p(s.x1, s.y0, s.z0),
    C = p(s.x1, y1, s.z1),
    D = p(s.x0, y1, s.z1);
  const A2 = p(s.x0, s.y0 - thickness, s.z0),
    B2 = p(s.x1, s.y0 - thickness, s.z0),
    C2 = p(s.x1, y1 - thickness, s.z1),
    D2 = p(s.x0, y1 - thickness, s.z1);
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
  for (const [v0, v1, v2, v3] of quads) {
    positions.push(...v0, ...v1, ...v2, ...v0, ...v2, ...v3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, surfaceMat({ color: SURFACE_COLOR[s.kind], flatShading: true }));
  mesh.receiveShadow = true;
  return mesh;
}

function buildFloors(group: THREE.Group): void {
  for (const s of HC_SURFACES) {
    group.add(s.y1 === undefined ? buildFlatFloor(s) : buildRampFloor(s));
  }
}

function buildWalls(group: THREE.Group): void {
  // A touch of emissive keeps the shadow-side faces a dim slate instead of
  // dropping to near-black under a single low sun (flat box walls otherwise
  // read as one bright face + several near-black ones with only sun + hemi).
  const mat = surfaceMat({
    color: WALL_COLOR,
    roughness: 0.9,
    emissive: 0x2a2a30,
    emissiveIntensity: 0.35,
  });
  for (const c of hodricsColliders()) {
    if (c.type === 'obb') {
      const geo = new THREE.BoxGeometry(c.hw * 2, WALL_HEIGHT, c.hd * 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(c.x, WALL_HEIGHT / 2, c.z);
      mesh.rotation.y = c.rot;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    } else {
      const geo = new THREE.CylinderGeometry(c.r, c.r * 1.15, POST_HEIGHT, 8);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(c.x, POST_HEIGHT / 2, c.z);
      mesh.castShadow = true;
      group.add(mesh);
    }
  }
}

// ---------------------------------------------------------------------------
// Dressing: a handful of CC0 props, no animation.
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
  // Start arch over the yard mouth.
  placeProp(group, 'archGate', 0, 0, -104, 0, 1.6);
  // Finish keep: a castle bulk flanked by two towers, and the crowned arch.
  placeProp(group, 'hexCastle', 0, 0, 132, Math.PI, 2.2);
  placeProp(group, 'hexTower', -13, 0, 122, 0, 1.5);
  placeProp(group, 'hexTower', 13, 0, 122, 0, 1.5);
  placeProp(group, 'archGate', 0, 0, HC_FINISH_ARCH_Z, Math.PI, 1.6);

  // Banners along the Log Court walls and the finish gate.
  const bannerSpots: [number, number, number][] = [
    [-13.5, 0, -30],
    [13.5, 0, -30],
    [-13.5, 0, 5],
    [13.5, 0, 5],
    [-13.5, 0, 118],
    [13.5, 0, 118],
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

  // Torches at every checkpoint landing.
  const torchSpots: [number, number][] = [
    [-13, -40],
    [13, -40],
    [-11, 78],
    [11, 78],
    [-9, 108],
    [9, 108],
  ];
  for (const [x, z] of torchSpots) placeProp(group, 'torchLit', x, 0, z, 0, 1.2);
}

// ---------------------------------------------------------------------------
// Obstacles: analytic pose, evaluated fresh every frame from `t`.
// ---------------------------------------------------------------------------

// Rigs store only the THREE objects; pose math re-reads the def arrays by
// index (rigs are built 1:1 from HC_FLAILS/HC_AXES/HC_ROTORS/HC_DRAWSPANS, so
// index i always means the same obstacle in both places).
interface FlailRig {
  head: THREE.Object3D;
  chain: THREE.Line;
}

interface AxeRig {
  head: THREE.Object3D;
  chain: THREE.Line;
}

interface RotorRig {
  beam: THREE.Mesh;
}

interface DrawspanRig {
  mesh: THREE.Mesh;
}

interface BoulderRig {
  pool: THREE.Object3D[];
}

function buildChainLine(): THREE.Line {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x2a2420 });
  return new THREE.Line(geo, mat);
}

function setChain(
  line: THREE.Line,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): void {
  const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
  pos.setXYZ(0, ax, ay, az);
  pos.setXYZ(1, bx, by, bz);
  pos.needsUpdate = true;
}

function buildObstacles(group: THREE.Group): {
  flails: FlailRig[];
  axes: AxeRig[];
  rotors: RotorRig[];
  drawspans: DrawspanRig[];
  boulders: BoulderRig[];
} {
  const flails: FlailRig[] = HC_FLAILS.map(() => {
    const head = cloneModel('flailHead');
    head.scale.setScalar(1.1);
    head.castShadow = true;
    group.add(head);
    const chain = buildChainLine();
    group.add(chain);
    return { head, chain };
  });

  const axes: AxeRig[] = HC_AXES.map(() => {
    const head = cloneModel('axeHead');
    head.scale.setScalar(1.3);
    head.castShadow = true;
    group.add(head);
    const chain = buildChainLine();
    group.add(chain);
    return { head, chain };
  });

  const rotors: RotorRig[] = HC_ROTORS.map((r) => {
    const beamGeo = new THREE.CylinderGeometry(0.6, 0.6, r.r * 2, 10);
    beamGeo.rotateZ(Math.PI / 2);
    const beam = new THREE.Mesh(beamGeo, surfaceMat({ color: 0x6a4a2a }));
    beam.castShadow = true;
    beam.position.set(r.cx, 0.85, r.cz);
    group.add(beam);
    return { beam };
  });

  const drawspans: DrawspanRig[] = HC_DRAWSPANS.map((d) => {
    const geo = new THREE.BoxGeometry(d.halfX * 2, 0.5, d.halfZ * 2);
    const mesh = new THREE.Mesh(geo, surfaceMat({ color: 0xa88448 }));
    mesh.receiveShadow = true;
    mesh.position.set(0, d.y - 0.25, d.zCenter);
    group.add(mesh);
    return { mesh };
  });

  const boulders: BoulderRig[] = HC_BOULDER_LANES.map((lane) => {
    const travel = (lane.zTop - lane.zEnd) / lane.speed;
    const poolSize = Math.max(2, Math.ceil(travel / lane.period) + 1);
    const pool: THREE.Object3D[] = [];
    for (let i = 0; i < poolSize; i++) {
      const b = cloneModel('boulder');
      const s = (lane.r / 1.3) * 1.4;
      b.scale.setScalar(s);
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
  scene.add(group);
  return { group, update: buildUpdate(obstacles) };
}

// Real per-frame updater, closed over the same HC_FLAILS/HC_AXES/HC_ROTORS/
// HC_DRAWSPANS/HC_BOULDER_LANES defs the rig arrays were built from (indices
// line up 1:1, so no lookup is needed at update time).
function buildUpdate(obstacles: {
  flails: FlailRig[];
  axes: AxeRig[];
  rotors: RotorRig[];
  drawspans: DrawspanRig[];
  boulders: BoulderRig[];
}): (t: number) => void {
  return (t: number) => {
    for (let i = 0; i < obstacles.flails.length; i++) {
      const def = HC_FLAILS[i];
      const rig = obstacles.flails[i];
      const bob = hcFlailBob(def, t);
      rig.head.position.set(bob.x, bob.y, def.z);
      setChain(rig.chain, 0, def.pivotY, def.z, bob.x, bob.y, def.z);
    }
    for (let i = 0; i < obstacles.axes.length; i++) {
      const def = HC_AXES[i];
      const rig = obstacles.axes[i];
      const head = hcAxeHead(def, t);
      rig.head.position.set(head.x, head.y, def.z);
      setChain(rig.chain, 0, def.pivotY, def.z, head.x, head.y, def.z);
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
        } else {
          b.visible = false;
        }
      }
    }
  };
}
