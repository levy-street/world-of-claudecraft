// The Last Keep's castle assembly, all render-only: KayKit Dungeon
// Remastered modules (kit 'kcas') plus red Medieval Hexagon turrets, laid
// along the SAME wall lines, gate spans, tower squares, terrace edges, and
// stair ramps the sim's castle plan authors (sim/castle_layout.ts). The
// wall the player climbs is castleLift terrain; this module dresses that
// exact geometry, and every walkable lift surface gets a VISIBLE floor cap
// (walk slabs, bastion caps, the watch chamber floor), so the player never
// stands on air. The bailey buildings ride the ordinary decorProps path
// (content -> render/props.ts); this module owns the fortifications: the
// curtain, gatehouse, postern, breach, towers, the ward's retaining edge
// and steps, the keep's turret crown, parapets, stairs, banners, torches.
import * as THREE from 'three';
import {
  BARBICAN,
  CASTLE,
  CASTLE_GATES,
  CASTLE_RAMPS,
  CASTLE_TOWERS,
  GARDEN,
  WARD_STEP_RUN,
  WARD_STEPS,
} from '../sim/castle_layout';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { surfaceMat } from './gfx';
import { PROP_ASSET_DEFS } from './props';

// the castle set: every key resolves through the shared prop registry so
// the preload gate and the media manifest already cover it
const CASTLE_KEYS = [
  'kcasWall',
  'kcasWallHalf',
  'kcasWallCorner',
  'kcasWallDoorway',
  'kcasWallBroken',
  'kcasWallWindow',
  'kcasWallPillar',
  'kcasBarrier',
  'kcasBarrierHalf',
  'kcasBarrierCorner',
  'kcasBannerRedA',
  'kcasBannerRedShield',
  'kcasBannerRedTriple',
  'kcasTorch',
  'kcasTorchMounted',
  'kcasRubbleLarge',
  'kcasRubbleHalf',
  'kcasRocks',
  'kcasFloorLarge',
  'kcasFloorWeeds',
  'kcasStairsWide',
  'kcasFoundation',
  'kcasBench',
  'hexrTowerA',
] as const;
type CastleKey = (typeof CASTLE_KEYS)[number];

const castleScenes: Partial<Record<CastleKey, THREE.Group>> = {};
for (const key of CASTLE_KEYS) {
  registerPreload(
    loadGltf(PROP_ASSET_DEFS[key].url).then((gltf) => {
      castleScenes[key] = gltf.scene;
    }),
  );
}

export const castleFeaturesPreloadInternalsForTest = {
  propUrls: CASTLE_KEYS.map((k) => PROP_ASSET_DEFS[k].url),
};

/** world scale for the wall modules: the KayKit wall is 4 units long */
const S = CASTLE.module / 4; // 1.75

// How far south (+z, toward the bailey) the ward stair-cut mesh sits off the
// terrace edge so its high back does not clip into the terrace face. Cosmetic
// only: the walkable ramp wedge is unchanged.
const WARD_STEP_MESH_PUSH = 0.5;

interface Placement {
  x: number;
  y: number;
  z: number;
  rot: number;
  /** uniform scale (defaults to the wall-module scale S) */
  s?: number;
}

// Meshopt-quantized attributes are normalized ints; bake them to plain
// floats BEFORE applying a world matrix, or setXYZ clamps every vertex
// back into the normalized [-1, 1] domain and the wall modules collapse
// into 2-unit blobs (the "invisible walls" report; same guard as
// lastkeep_dressing.ts).
function attributeToFloat(geo: THREE.BufferGeometry, name: string): void {
  const attr = geo.getAttribute(name);
  if (!attr || (attr.array instanceof Float32Array && !attr.normalized)) return;
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
  }
  geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
}

// Parts to leave out of a piece when instancing: the doorway module's door
// leaf stays out so every gate renders as an OPEN archway (the lift field's
// gate gap matches the arch opening; a closed door visual over walkable
// ground reads as walking through wood).
const SKIP_PARTS: Partial<Record<CastleKey, RegExp>> = {
  kcasWallDoorway: /_door$/i,
};

// bake a loaded scene into parts, xz-centered with min-y at 0
function extractParts(
  scene: THREE.Group,
  skip?: RegExp,
): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  scene.updateMatrixWorld(true);
  const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (skip && (skip.test(mesh.name) || (mesh.parent && skip.test(mesh.parent.name)))) return;
    const geo = mesh.geometry.clone();
    attributeToFloat(geo, 'position');
    attributeToFloat(geo, 'normal');
    geo.applyMatrix4(mesh.matrixWorld);
    parts.push({ geo, mat: mesh.material as THREE.Material });
  });
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geo.computeBoundingBox();
    box.union(p.geo.boundingBox as THREE.Box3);
  }
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  for (const p of parts) {
    p.geo.translate(-cx, -box.min.y, -cz);
    p.geo.computeBoundingBox();
    p.geo.computeBoundingSphere();
  }
  return parts;
}

export interface CastleFeaturesView {
  group: THREE.Group;
  glowLights: THREE.PointLight[];
}

export function buildCastleFeatures(): CastleFeaturesView {
  const group = new THREE.Group();
  group.name = 'castle-features';
  const glowLights: THREE.PointLight[] = [];
  const padY = CASTLE.pad.h;
  const wardY = CASTLE.ward.h;
  const walkY = CASTLE.walkAbs;

  const spots = new Map<CastleKey, Placement[]>();
  const put = (key: CastleKey, p: Placement): void => {
    let list = spots.get(key);
    if (!list) {
      list = [];
      spots.set(key, list);
    }
    list.push(p);
  };

  // stone slab helper: the visible floor caps and stair masses
  const slabMat = surfaceMat({ color: 0x8a7568, roughness: 0.95 });
  // the solid wedge masses (the wall flights and the ward's stair cuts) are
  // hand-wound triangle soups, so they draw both faces
  const wedgeMat = surfaceMat({ color: 0x8a7568, roughness: 0.95 });
  wedgeMat.side = THREE.DoubleSide;
  const capMat = surfaceMat({ color: 0x97826f, roughness: 0.9 });
  const slab = (
    cx: number,
    cz: number,
    sx: number,
    sz: number,
    topY: number,
    thick = 0.36,
    mat = capMat,
  ): void => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, thick, sz), mat);
    mesh.position.set(cx, topY - thick / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  // ---- curtain walls: modules along each wall line, grid-anchored so
  // every gate is exactly one module slot; walls stand on the bailey ----
  interface WallRun {
    axis: 'x' | 'z';
    line: number;
    a0: number;
    a1: number;
    gate: { a0: number; a1: number } | null;
    gatePiece: CastleKey | null;
  }
  const hw = CASTLE.towerHw;
  const runs: WallRun[] = [
    {
      axis: 'z',
      line: CASTLE.wx0,
      a0: CASTLE.wz0 + hw,
      a1: CASTLE.wz1 - hw,
      gate: CASTLE_GATES.main,
      gatePiece: 'kcasWallDoorway',
    },
    {
      axis: 'z',
      line: CASTLE.wx1,
      a0: CASTLE.wz0 + hw,
      a1: CASTLE.wz1 - hw,
      gate: CASTLE_GATES.breach,
      gatePiece: null,
    },
    {
      axis: 'x',
      line: CASTLE.wz0,
      a0: CASTLE.wx0 + hw,
      a1: CASTLE.wx1 - hw,
      gate: CASTLE_GATES.postern,
      gatePiece: 'kcasWallDoorway',
    },
    {
      axis: 'x',
      line: CASTLE.wz1,
      a0: CASTLE.wx0 + hw,
      a1: CASTLE.wx1 - hw,
      gate: null,
      gatePiece: null,
    },
  ];
  const M = CASTLE.module;
  const place = (run: WallRun, along: number, key: CastleKey, s = S): void => {
    const x = run.axis === 'z' ? run.line : along;
    const z = run.axis === 'z' ? along : run.line;
    const rot = run.axis === 'z' ? Math.PI / 2 : 0;
    put(key, { x, y: padY, z, rot, s });
  };
  for (const run of runs) {
    const count = Math.round((run.a1 - run.a0) / M);
    for (let k = 0; k < count; k++) {
      const c = run.a0 + M / 2 + k * M;
      const gate = run.gate;
      if (gate && c > gate.a0 - 1 && c < gate.a1 + 1) {
        if (run.gatePiece) place(run, c, run.gatePiece);
        else {
          place(run, gate.a0 - 1.6, 'kcasWallBroken');
          place(run, gate.a1 + 1.6, 'kcasWallBroken');
        }
        continue;
      }
      const v = Math.abs(Math.round(c * 7 + run.line)) % 11;
      place(run, c, v === 3 ? 'kcasWallWindow' : 'kcasWall');
    }
    // parapets: a low crenellated STONE battlement along the outer edge
    // (small wall modules), a guard rail along the inner edge, both parted
    // over gates. The outer side is away from the bailey per run.
    const off = CASTLE.wallTh / 2 - 0.2;
    const outerSide: -1 | 1 = run.line === CASTLE.wx0 || run.line === CASTLE.wz0 ? -1 : 1;
    const bat = 0.4; // battlement piece scale: 1.6 long, 1.6 tall
    for (let c = run.a0 + 0.8; c <= run.a1 - 0.8; c += 4 * bat) {
      if (run.gate && c > run.gate.a0 - 1 && c < run.gate.a1 + 1) continue;
      const x = run.axis === 'z' ? run.line + outerSide * off : c;
      const z = run.axis === 'z' ? c : run.line + outerSide * off;
      put('kcasWall', { x, y: walkY - 0.04, z, rot: run.axis === 'z' ? Math.PI / 2 : 0, s: bat });
    }
    for (let c = run.a0 + 1; c <= run.a1 - 1; c += 2 * S) {
      if (run.gate && c > run.gate.a0 - 1 && c < run.gate.a1 + 1) continue;
      const x = run.axis === 'z' ? run.line - outerSide * off : c;
      const z = run.axis === 'z' ? c : run.line - outerSide * off;
      put('kcasBarrierHalf', { x, y: walkY, z, rot: run.axis === 'z' ? Math.PI / 2 : 0 });
    }
    // the VISIBLE walk floor: cap slabs over the whole strip, parted at
    // gates and tucked under the tower caps at the ends
    const segs: [number, number][] = [];
    if (run.gate) {
      segs.push([run.a0, run.gate.a0], [run.gate.a1, run.a1]);
    } else {
      segs.push([run.a0, run.a1]);
    }
    for (const [s0, s1] of segs) {
      if (s1 - s0 < 1) continue;
      const mid = (s0 + s1) / 2;
      const len = s1 - s0;
      if (run.axis === 'z') slab(run.line, mid, CASTLE.wallTh + 0.2, len, walkY - 0.02);
      else slab(mid, run.line, len, CASTLE.wallTh + 0.2, walkY - 0.02);
    }
  }

  // ---- towers: a shell of wall modules at each bastion, a visible cap on
  // every top, a second windowed storey on the SE watch ----
  for (const t of CASTLE_TOWERS) {
    const thw = t.hw;
    const faces = [
      { x: t.x, z: t.z - thw, rot: 0 },
      { x: t.x, z: t.z + thw, rot: 0 },
      { x: t.x - thw, z: t.z, rot: Math.PI / 2 },
      { x: t.x + thw, z: t.z, rot: Math.PI / 2 },
    ];
    const shellScale = (thw * 2) / 4; // face length matches the square
    for (const f of faces) put('kcasWall', { x: f.x, y: padY, z: f.z, rot: f.rot, s: shellScale });
    // a solid stone core from the pad to the cap: the lift terrain the
    // player stands on is not rendered, so without this the band between
    // the shell tops and the cap slab reads as open air from outside
    {
      const core = new THREE.Mesh(
        new THREE.BoxGeometry(thw * 2 - 0.4, t.hAbs - padY, thw * 2 - 0.4),
        slabMat,
      );
      core.position.set(t.x, padY + (t.hAbs - padY) / 2, t.z);
      core.castShadow = true;
      core.receiveShadow = true;
      group.add(core);
    }
    slab(t.x, t.z, thw * 2 + 0.5, thw * 2 + 0.5, t.hAbs - 0.02);
    if (t.tall) {
      // a windowed upper storey on all four faces, stacked flush on the
      // shell and scaled so its top meets the tower's own cap height (the
      // SE watch flight arrives at the tower TOP, above these piece tops)
      const storeyY = padY + 4 * shellScale - 0.1;
      const ws = Math.max(0.6, (t.hAbs - storeyY + 0.08) / 4);
      put('kcasWallWindow', { x: t.x, y: storeyY, z: t.z - thw, rot: 0, s: ws });
      put('kcasWallWindow', { x: t.x, y: storeyY, z: t.z + thw, rot: 0, s: ws });
      put('kcasWallWindow', { x: t.x + thw, y: storeyY, z: t.z, rot: Math.PI / 2, s: ws });
      put('kcasWallWindow', { x: t.x - thw, y: storeyY, z: t.z, rot: Math.PI / 2, s: ws });
      put('kcasBannerRedTriple', {
        x: t.x + thw - 0.4,
        y: t.hAbs + 0.1,
        z: t.z,
        rot: -Math.PI / 2,
        s: 1.4,
      });
      if (t.hAbs === CASTLE.watchAbs) {
        put('kcasTorch', { x: t.x, y: t.hAbs, z: t.z, rot: 0, s: 1.6 });
      }
    } else {
      for (const f of faces) {
        put('kcasBarrier', { x: f.x, y: t.hAbs, z: f.z, rot: f.rot, s: shellScale });
      }
      put('kcasBannerRedShield', { x: t.x, y: t.hAbs, z: t.z, rot: Math.PI / 4, s: 1.4 });
    }
  }

  // ---- the ward: a SOLID PLINTH from the bailey floor to the terrace, faced
  // with foundation blocks and cut by two stone stairs, so the keep terrace
  // reads as built masonry, not a dirt shelf ----
  //
  // The plinth is load-bearing, not dressing. The terrain mesh deliberately
  // leaves the terrace out (render/terrain_mesh_height.ts: its 0.7yd retaining
  // blend is far narrower than the vertex lattice, so a meshed terrace smeared
  // its faces out over the bailey and buried anyone walking along them). This
  // mass IS the terrace the player stands on, exactly like the wall-walk cap
  // slabs are the walk: its top sits at the ward height groundHeight reports.
  {
    const w = CASTLE.ward;
    const rise = w.h - padY;
    const fScale = rise / 2; // foundation piece is 2 units tall
    /** kcas_foundation is 2.2 units square in plan */
    const fHalf = (2.2 * fScale) / 2;
    // the terrace mass. Sunk below the flat mesh at its foot so the two never
    // z-fight, and pulled a hair inside the rect so the block facing wins.
    {
      const inset = 0.05;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w.x1 - w.x0 - inset * 2, rise + 0.4, w.z1 - w.z0 - inset * 2),
        slabMat,
      );
      mesh.position.set((w.x0 + w.x1) / 2, w.h - (rise + 0.4) / 2, (w.z0 + w.z1) / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    // The retaining facing, on all four sides. Each block is offset INWARD by
    // its own half depth so its outer face lands on the rect line: the sim's
    // cliff. Straddling the line (the old placement) put 1.4yd of stonework
    // over bailey floor the player walks on, and they walked into it.
    const edges: { x0: number; z0: number; x1: number; z1: number; cuts?: boolean }[] = [
      { x0: w.x0 + fHalf, z0: w.z0, x1: w.x0 + fHalf, z1: w.z1 }, // west edge
      { x0: w.x1 - fHalf, z0: w.z0, x1: w.x1 - fHalf, z1: w.z1 }, // east edge
      { x0: w.x0, z0: w.z0 + fHalf, x1: w.x1, z1: w.z0 + fHalf }, // north edge
      { x0: w.x0, z0: w.z1 - fHalf, x1: w.x1, z1: w.z1 - fHalf, cuts: true }, // south
    ];
    const stepGap = (v: number): boolean =>
      WARD_STEPS.some((cut) => v > cut.x0 - 1.4 && v < cut.x1 + 1.4);
    for (const e of edges) {
      const len = Math.hypot(e.x1 - e.x0, e.z1 - e.z0);
      const n = Math.ceil(len / (2.2 * fScale));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = e.x0 + (e.x1 - e.x0) * t;
        const z = e.z0 + (e.z1 - e.z0) * t;
        if (e.cuts && stepGap(x)) continue; // part at the stair cuts
        put('kcasFoundation', {
          x,
          y: padY,
          z,
          rot: e.x0 === e.x1 ? Math.PI / 2 : 0,
          s: fScale,
        });
      }
    }
    // the stair cuts: wide stone steps down from the terrace, over a solid
    // wedge whose TOP is the ramp surface castlePadTarget authors (the mesh
    // leaves the cuts out with the rest of the ward, so this carries them)
    for (const cut of WARD_STEPS) {
      const cx = (cut.x0 + cut.x1) / 2;
      // kcasStairsWide climbs toward -z at rot 0 (the wall-flight foot treads
      // below set the convention: rot PI climbs +z, -PI/2 climbs +x). This cut
      // rises from the bailey at z1+run UP to the terrace at z1, i.e. toward -z,
      // so the tread faces must point -z; the authored PI had the whole flight
      // reversed (players read the steps as leading the wrong way off the
      // terrace). The wedge below is symmetric, so only the mesh yaw was wrong.
      // Nudged a touch south (+z, toward the bailey) off the terrace edge so the
      // flight's high back no longer buries itself in the terrace face.
      put('kcasStairsWide', {
        x: cx,
        y: padY,
        z: w.z1 + WARD_STEP_RUN / 2 + WARD_STEP_MESH_PUSH,
        rot: 0,
        s: 0.62,
      });
      const z0 = w.z1;
      const z1 = w.z1 + WARD_STEP_RUN;
      const base = padY - 0.4;
      const v: number[] = [];
      const quad = (
        p0: [number, number, number],
        p1: [number, number, number],
        p2: [number, number, number],
        p3: [number, number, number],
      ): void => {
        v.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
      };
      // top (the ramp: w.h at the terrace edge down to padY at the run's end)
      quad([cut.x0, w.h, z0], [cut.x1, w.h, z0], [cut.x1, padY, z1], [cut.x0, padY, z1]);
      for (const [sx, dir] of [
        [cut.x0, -1],
        [cut.x1, 1],
      ] as const) {
        const side: [number, number, number][] = [
          [sx, w.h, z0],
          [sx, base, z0],
          [sx, base, z1],
          [sx, padY, z1],
        ];
        if (dir < 0) quad(side[0], side[1], side[2], side[3]);
        else quad(side[3], side[2], side[1], side[0]);
      }
      quad([cut.x0, w.h, z0], [cut.x0, base, z0], [cut.x1, base, z0], [cut.x1, w.h, z0]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, wedgeMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    // terrace paving: the same large tiles the bailey court is laid with, so
    // the plinth top reads as the keep's paved yard rather than bare stone
    for (let x = w.x0 + 3.5; x < w.x1 - 1; x += M) {
      for (let z = w.z0 + 3.5; z < w.z1 - 1; z += M) {
        put('kcasFloorLarge', { x, y: w.h + 0.02, z, rot: 0 });
      }
    }
  }

  // ---- the keep's turret crown: red hex tower drums rising from the keep
  // mass (the multi-storey silhouette; the keep model itself is placed by
  // the decorProps path) ----
  {
    const kx = 421;
    const kz = 2003;
    put('hexrTowerA', { x: kx - 5.5, y: wardY + 21, z: kz - 4.5, rot: 0.4, s: 5 });
    put('hexrTowerA', { x: kx + 5.5, y: wardY + 24, z: kz + 4.5, rot: 2.2, s: 5 });
    put('hexrTowerA', { x: kx, y: wardY + 29, z: kz, rot: 1.1, s: 5.5 });
    put('kcasBannerRedTriple', { x: kx, y: wardY + 41, z: kz + 1.2, rot: Math.PI, s: 1.6 });
  }

  // ---- gate dressing ----
  const gm = (CASTLE_GATES.main.a0 + CASTLE_GATES.main.a1) / 2;
  for (const side of [-1, 1] as const) {
    put('kcasWallPillar', {
      x: CASTLE.wx0,
      y: padY,
      z: gm + side * (M / 2 + 1.3),
      rot: Math.PI / 2,
    });
    put('kcasBannerRedA', {
      x: CASTLE.wx0 - 1.5,
      y: padY + 2.8,
      z: gm + side * (M / 2 + 1.5),
      rot: Math.PI / 2,
      s: 1.5,
    });
    put('kcasTorchMounted', {
      x: CASTLE.wx0 - 1.3,
      y: padY + 2.2,
      z: gm + side * 4.4,
      rot: Math.PI / 2,
      s: 1.4,
    });
  }
  const pm = (CASTLE_GATES.postern.a0 + CASTLE_GATES.postern.a1) / 2;
  put('kcasTorchMounted', {
    x: pm - 2.2,
    y: padY + 2.2,
    z: CASTLE.wz0 - 1.3,
    rot: Math.PI,
    s: 1.4,
  });
  const bm = (CASTLE_GATES.breach.a0 + CASTLE_GATES.breach.a1) / 2;
  put('kcasRubbleLarge', { x: CASTLE.wx1 + 0.6, y: padY, z: bm - 1.2, rot: 0.7, s: 1.1 });
  put('kcasRubbleHalf', { x: CASTLE.wx1 - 1.4, y: padY, z: bm + 1.8, rot: 2.3, s: 1.2 });
  put('kcasRocks', { x: CASTLE.wx1 + 2.6, y: padY, z: bm + 2.6, rot: 1.1, s: 1.3 });
  put('kcasRocks', { x: CASTLE.wx1 - 3.0, y: padY, z: bm - 2.8, rot: 4.2, s: 1.0 });

  // ---- the barbican forecourt: a lower outer work at wall scale 1 (the
  // module is 4 long and 4 tall, exactly the 6 to 10 rise), an open outer
  // doorway on the road line, cap slabs, and torch light in the yard ----
  {
    const b = BARBICAN;
    const om = (CASTLE_GATES.outer.a0 + CASTLE_GATES.outer.a1) / 2;
    // outer wall modules (4-long grid anchored at z0), doorway at the gate
    const n = Math.round((b.z1 - b.z0) / 4);
    for (let k = 0; k < n; k++) {
      const cz = b.z0 + 2 + k * 4;
      if (cz > CASTLE_GATES.outer.a0 - 2.2 && cz < CASTLE_GATES.outer.a1 + 2.2) {
        put('kcasWallDoorway', { x: b.x, y: padY, z: om, rot: Math.PI / 2, s: 1 });
        continue;
      }
      put('kcasWall', { x: b.x, y: padY, z: cz, rot: Math.PI / 2, s: 1 });
    }
    // side walls back to the curtain: four modules and a half-length end
    for (const sz of [b.z0, b.z1]) {
      for (let cx = b.x + 2; cx < CASTLE.wx0 - 2; cx += 4) {
        put('kcasWall', { x: cx, y: padY, z: sz, rot: 0, s: 1 });
      }
      put('kcasWallHalf', { x: CASTLE.wx0 - 1.6, y: padY, z: sz, rot: 0, s: 1 });
      slab((b.x + CASTLE.wx0) / 2, sz, CASTLE.wx0 - b.x, b.th + 0.2, b.hAbs - 0.02);
    }
    for (const [s0, s1] of [
      [b.z0, CASTLE_GATES.outer.a0],
      [CASTLE_GATES.outer.a1, b.z1],
    ] as const) {
      slab(b.x, (s0 + s1) / 2, b.th + 0.2, s1 - s0, b.hAbs - 0.02);
    }
    // gate dressing: banners on the outer face, torches inside the yard
    for (const side of [-1, 1] as const) {
      put('kcasBannerRedA', {
        x: b.x - 1.2,
        y: padY + 2.6,
        z: om + side * 2.6,
        rot: Math.PI / 2,
        s: 1.3,
      });
    }
    for (const [tx, tz] of [
      [b.x + 4.5, 2020.5],
      [b.x + 4.5, 2039.5],
    ] as const) {
      put('kcasTorch', { x: tx, y: padY, z: tz, rot: 0, s: 1.5 });
      const light = new THREE.PointLight(0xff7a28, 4, 13, 2);
      light.position.set(tx, padY + 2.4, tz);
      light.userData.baseIntensity = 4;
      glowLights.push(light);
      group.add(light);
    }
    // the road through the yard: weed tiles from the outer gate to the main
    for (let px = 344; px <= 358; px += M) {
      put('kcasFloorWeeds', { x: px, y: padY + 0.02, z: gm - 1.0, rot: (px * 7) % 3 });
    }
  }

  // ---- the walled garden behind the far wall: half-length wall modules
  // at a garden scale, pillar jambs and torches at the two doorways,
  // benches and weed beds inside (the crystals already seeded here glow
  // over the beds) ----
  {
    const g = GARDEN;
    const gs = 0.75; // wall piece: 1.5 long, 3 tall (tops at abs 9)
    const inGap = (v: number): boolean =>
      g.gates.some((gap) => v > gap.a0 - 0.8 && v < gap.a1 + 0.8);
    for (let cx = g.x0 + 0.75; cx <= g.x1 - 0.75; cx += 1.5) {
      if (inGap(cx)) continue;
      put('kcasWallHalf', { x: cx, y: padY, z: g.wallZ, rot: 0, s: gs });
    }
    for (const rx of [g.x0, g.x1]) {
      for (let cz = CASTLE.wz1 + 2.4; cz <= g.wallZ - 0.7; cz += 1.5) {
        put('kcasWallHalf', { x: rx, y: padY, z: cz, rot: Math.PI / 2, s: gs });
      }
    }
    for (const gap of g.gates) {
      for (const side of [-1, 1] as const) {
        put('kcasWallPillar', {
          x: side === -1 ? gap.a0 - 0.4 : gap.a1 + 0.4,
          y: padY,
          z: g.wallZ,
          rot: 0,
          s: 0.9,
        });
      }
      put('kcasTorch', {
        x: (gap.a0 + gap.a1) / 2 + 1.4,
        y: padY,
        z: g.wallZ - 1.8,
        rot: 0,
        s: 1.4,
      });
      const light = new THREE.PointLight(0xffa14a, 3.5, 12, 2);
      light.position.set((gap.a0 + gap.a1) / 2, padY + 2.2, g.wallZ - 1.6);
      light.userData.baseIntensity = 3.5;
      glowLights.push(light);
      group.add(light);
    }
    // beds and benches: quiet rows under the far wall
    for (const [bx, bz, br] of [
      [372, 2077.5, 0.3],
      [386, 2079.5, -0.2],
      [402, 2077, 0.15],
      [414, 2079.5, -0.35],
      [424, 2077, 0.1],
    ] as const) {
      put('kcasFloorWeeds', { x: bx, y: padY + 0.02, z: bz, rot: br * 4 });
      put('kcasFloorWeeds', { x: bx + 4.2, y: padY + 0.02, z: bz + 1.4, rot: br * 7 + 1 });
    }
    for (const [bx, bz, brot] of [
      [376, 2075.2, 0],
      [394, 2080.8, Math.PI],
      [410, 2075.2, 0],
      [428, 2080.8, Math.PI],
    ] as const) {
      put('kcasBench', { x: bx, y: padY, z: bz, rot: brot, s: 1.3 });
    }
  }

  // ---- the stair flights: SOLID wedge piers from their footing to the
  // sloped surface (the lift terrain is invisible, so the mass itself must
  // read as built masonry), with a stone tread at each bailey foot ----
  for (const rmp of CASTLE_RAMPS) {
    const baseY = rmp.h0 <= padY + 0.1 || rmp.h1 <= padY + 0.1 ? padY - 0.4 : CASTLE.walkAbs - 0.6;
    // 8 corners: along the run a0 -> a1, surface h0 -> h1, flat base
    const lo = { a: rmp.a0, h: rmp.h0 };
    const hi = { a: rmp.a1, h: rmp.h1 };
    const pxz = (a: number, b: number): [number, number] => (rmp.axis === 'x' ? [a, b] : [b, a]);
    const verts: number[] = [];
    const quad = (
      p0: [number, number, number],
      p1: [number, number, number],
      p2: [number, number, number],
      p3: [number, number, number],
    ): void => {
      verts.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    };
    const c = (a: number, b: number, y: number): [number, number, number] => {
      const [x, z] = pxz(a, b);
      return [x, y, z];
    };
    const b0 = rmp.b0;
    const b1 = rmp.b1;
    // top (sloped), both sides, both ends, base underside
    quad(c(lo.a, b0, lo.h), c(hi.a, b0, hi.h), c(hi.a, b1, hi.h), c(lo.a, b1, lo.h));
    quad(c(lo.a, b0, baseY), c(hi.a, b0, baseY), c(hi.a, b0, hi.h), c(lo.a, b0, lo.h));
    quad(c(lo.a, b1, lo.h), c(hi.a, b1, hi.h), c(hi.a, b1, baseY), c(lo.a, b1, baseY));
    quad(c(lo.a, b0, lo.h), c(lo.a, b1, lo.h), c(lo.a, b1, baseY), c(lo.a, b0, baseY));
    quad(c(hi.a, b0, baseY), c(hi.a, b1, baseY), c(hi.a, b1, hi.h), c(hi.a, b0, hi.h));
    quad(c(lo.a, b0, baseY), c(lo.a, b1, baseY), c(hi.a, b1, baseY), c(hi.a, b0, baseY));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, wedgeMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (rmp.h0 <= padY + 0.1) {
      const fx = rmp.axis === 'x' ? rmp.a0 - 1.2 : (rmp.b0 + rmp.b1) / 2;
      const fz = rmp.axis === 'x' ? (rmp.b0 + rmp.b1) / 2 : rmp.a0 - 1.2;
      put('kcasStairsWide', {
        x: fx,
        y: padY,
        z: fz,
        rot: rmp.axis === 'x' ? -Math.PI / 2 : Math.PI,
        s: 0.62,
      });
    }
  }

  // ---- the bailey court: a tiled plaza south of the ward steps, torches
  // at its corners, weeds tiles down the gate road ----
  for (let px = 398; px <= 429; px += M) {
    for (let pz = 2024; pz <= 2040; pz += M) {
      put('kcasFloorLarge', { x: px, y: padY + 0.02, z: pz, rot: 0 });
    }
  }
  for (let px = 366; px <= 392; px += M) {
    put('kcasFloorWeeds', { x: px, y: padY + 0.02, z: gm + 1.2, rot: (px * 13) % 3 });
  }
  for (const [tx, tz] of [
    [398, 2024],
    [429, 2024],
    [398, 2040],
    [429, 2040],
  ] as const) {
    put('kcasTorch', { x: tx, y: padY, z: tz, rot: 0, s: 1.6 });
    const light = new THREE.PointLight(0xff7a28, 4, 14, 2);
    light.position.set(tx, padY + 2.4, tz);
    light.userData.baseIntensity = 4;
    glowLights.push(light);
    group.add(light);
  }
  const gateLight = new THREE.PointLight(0xff7a28, 5, 18, 2);
  gateLight.position.set(CASTLE.wx0 - 1, padY + 3.2, gm);
  gateLight.userData.baseIntensity = 5;
  glowLights.push(gateLight);
  group.add(gateLight);

  // ---- instance every placed piece ----
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  for (const [key, list] of spots) {
    const scene = castleScenes[key];
    if (!scene || list.length === 0) continue;
    for (const part of extractParts(scene, SKIP_PARTS[key])) {
      const mesh = new THREE.InstancedMesh(part.geo, part.mat, list.length);
      list.forEach((p, i) => {
        const s = p.s ?? S;
        q.setFromAxisAngle(up, p.rot);
        v.set(p.x, p.y, p.z);
        sc.set(s, s, s);
        mesh.setMatrixAt(i, m4.compose(v, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }

  return { group, glowLights };
}
