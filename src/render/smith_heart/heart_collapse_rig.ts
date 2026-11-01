// The Anvil's real pieces, each quarter's own (Mythic's hidden phase, design doc section
// 7.5): the kit's platform cut along the sim's exact quarters
// (docs/design/raid/kit/quarter_split.py), drawn here whole and, when its quarter falls,
// as break cells that give, tip and drop into the void.
//
//   - whole: each piece's surface (class 0) on its one draw, the same material and order
//     the room always gave it, broken rock not drawn at all;
//   - a neighbour fallen: the rock left showing on this quarter's cut (classes 2 and 3);
//   - falling: one group per break cell (a cell's floor, rim and ridge go as one, its
//     altar with it), the keel's three masses, and chunk 0, what stays on the ring.
//
// GPU preparation: built with the interior (the compile gate links every material; the
// kit's slot warmers carry the plain stone, spine and glow programs). Every mesh here
// draws a run of its piece's one index buffer on its piece's shared attributes, so a
// fall uploads nothing and links nothing. The per-frame update writes matrices only for
// a quarter in motion, without allocating.

import * as THREE from 'three';
import { HEART_ROOM, type SmithHeartVein } from '../../sim/content/smith_heart_layout';
import { HEART_QUARTER_ORDER } from '../../sim/content/smith_heart_quarters';
import { markSharedGeometry } from '../shared_resource';
import {
  type HeartChunkPose,
  type HeartFallRanges,
  heartCellPose,
  heartFallChunk,
  heartFallClass,
  heartFallRanges,
  heartKeelPose,
} from './heart_collapse_core';
import {
  type HeartKitSlot,
  heartKitPiece,
  heartKitSlotMaterial,
  SMITH_HEART_HEART_KIT_URL,
} from './heart_kit';
import { heartHash } from './heart_plan_core';
import { HEART_PLATFORM_ORDER } from './heart_quarters_core';

const Vein = (v: SmithHeartVein) => v.charAt(0).toUpperCase() + v.slice(1);

/** Every cut piece a quarter owns (kit node names), for the shipped kit's pins. */
export function heartFallPieces(vein: SmithHeartVein): string[] {
  return [
    `Kit_Quarter${Vein(vein)}`,
    `Kit_AnvilFloor${Vein(vein)}`,
    `Kit_HeartDaisFoot${Vein(vein)}`,
    `Kit_AnvilKeel${Vein(vein)}`,
  ];
}

/** A ridge's two halves (ridge 0 between quarters 0 and 1, the runtime turns them):
 *  A is the side of the ridge's own quarter k, B the side of quarter k + 1. */
export const HEART_RIDGE_HALVES = { a: 'Kit_HeartRidgeA', b: 'Kit_HeartRidgeB' } as const;

/** What the room's own painter hands the rig: its materials. */
export interface HeartFallMaterials {
  floor: THREE.Material;
  quarterGlow(vein: SmithHeartVein): THREE.Material;
  /** Ridge k's spine light. */
  ridgeGlow(k: number): THREE.Material;
  daisGlow: THREE.Material;
}

/** An altar that goes with its quarter (heart_room_kit.ts holds it). */
export interface HeartFallAltar {
  holder: THREE.Object3D;
  /** Its resting placement. */
  rest: THREE.Matrix4;
  x: number;
  z: number;
}

interface PartDef {
  piece: string;
  turn: number;
  /** How it draws whole: its stone, its order; falling it draws lit stone. */
  stone: THREE.Material;
  glow: THREE.Material;
  stoneOrder: number;
  glowOrder: number;
  casts: boolean;
  keel: boolean;
}

interface Chunk {
  group: THREE.Group;
  /** Room-local pivot. */
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
  keelMass: number;
  axisX: number;
  axisZ: number;
}

interface QuarterRig {
  whole: THREE.Group;
  stay: THREE.Group;
  capCcw: THREE.Group;
  capCw: THREE.Group;
  chunks: Chunk[];
  altar: HeartFallAltar | null;
  altarChunk: Chunk | null;
  written: number;
}

const rangesOf = new WeakMap<THREE.BufferGeometry, HeartFallRanges>();

/** A piece's geometry with its triangles sorted by tag (once: the geometry is shared). */
function rangesFor(g: THREE.BufferGeometry): HeartFallRanges | null {
  const known = rangesOf.get(g);
  if (known) return known;
  const tags = g.userData.heartFallTags as Uint8Array | undefined;
  if (!tags || !g.index) return null;
  const r = heartFallRanges(g.index.array, tags);
  g.setIndex(new THREE.BufferAttribute(r.index, 1));
  rangesOf.set(g, r);
  return r;
}

/** A mesh drawing a run of a shared geometry. */
function runMesh(
  source: THREE.BufferGeometry,
  start: number,
  count: number,
  material: THREE.Material,
  name: string,
  turn: number,
  centre: THREE.Vector3,
  order: number,
  casts: boolean,
  receives: boolean,
): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  for (const a of ['position', 'normal', 'color'])
    g.setAttribute(a, source.getAttribute(a) as THREE.BufferAttribute);
  g.setIndex(source.index);
  g.setDrawRange(start, count);
  g.boundingSphere = source.boundingSphere;
  markSharedGeometry(g);
  const m = new THREE.Mesh(g, material);
  m.name = name;
  m.position.copy(centre);
  m.rotation.y = turn;
  m.renderOrder = order;
  m.castShadow = casts;
  m.receiveShadow = receives;
  m.updateMatrix();
  m.matrixAutoUpdate = false;
  return m;
}

const SLOTS: readonly HeartKitSlot[] = ['stone', 'glow'];

const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _toPivot = new THREE.Matrix4();
const _pose: HeartChunkPose = { drop: 0, turn: 0, gone: false };

export interface HeartFallRig {
  group: THREE.Group;
  /** Paint a quarter `t` seconds into its fall (-1 whole) with its neighbours' own. */
  paint(vein: SmithHeartVein, t: number, ccwT: number, cwT: number): void;
}

/** The cut platform, with its materials from the room's painter (instance-local). */
export function buildHeartFallRig(
  lowGfx: boolean,
  centre: THREE.Vector3,
  mats: HeartFallMaterials,
  altars: (vein: SmithHeartVein) => HeartFallAltar | null,
): HeartFallRig {
  const group = new THREE.Group();
  group.name = 'smithHeartFallRig';
  const stoneLit = heartKitSlotMaterial('stone');
  const glowLit = heartKitSlotMaterial('glow');
  const spine = heartKitSlotMaterial('spine');
  const O = HEART_PLATFORM_ORDER;
  const rigs = new Map<SmithHeartVein, QuarterRig>();

  HEART_QUARTER_ORDER.forEach((vein, i) => {
    const prev = (i + 3) % 4;
    const defs: PartDef[] = [
      {
        piece: `Kit_Quarter${Vein(vein)}`,
        turn: 0,
        stone: mats.floor,
        glow: mats.quarterGlow(vein),
        stoneOrder: O.floor,
        glowOrder: O.floor,
        casts: false,
        keel: false,
      },
      {
        piece: `Kit_AnvilFloor${Vein(vein)}`,
        turn: 0,
        stone: stoneLit,
        glow: glowLit,
        stoneOrder: O.floor,
        glowOrder: O.floor,
        casts: !lowGfx,
        keel: false,
      },
      {
        piece: `Kit_HeartDaisFoot${Vein(vein)}`,
        turn: 0,
        stone: spine,
        glow: mats.daisGlow,
        stoneOrder: O.spine,
        glowOrder: O.spineGlow,
        casts: false,
        keel: false,
      },
      {
        piece: HEART_RIDGE_HALVES.a,
        turn: (i * Math.PI) / 2,
        stone: spine,
        glow: mats.ridgeGlow(i),
        stoneOrder: O.spine,
        glowOrder: O.spineGlow,
        casts: !lowGfx,
        keel: false,
      },
      {
        piece: HEART_RIDGE_HALVES.b,
        turn: (prev * Math.PI) / 2,
        stone: spine,
        glow: mats.ridgeGlow(prev),
        stoneOrder: O.spine,
        glowOrder: O.spineGlow,
        casts: !lowGfx,
        keel: false,
      },
      {
        piece: `Kit_AnvilKeel${Vein(vein)}`,
        turn: 0,
        stone: stoneLit,
        glow: glowLit,
        stoneOrder: 0,
        glowOrder: 0,
        casts: false,
        keel: true,
      },
    ];
    const whole = new THREE.Group();
    whole.name = `heartFallWhole:${vein}`;
    const stay = new THREE.Group();
    stay.name = `heartFallStay:${vein}`;
    stay.visible = false;
    const capCcw = new THREE.Group();
    capCcw.name = `heartFallCapCcw:${vein}`;
    capCcw.visible = false;
    const capCw = new THREE.Group();
    capCw.name = `heartFallCapCw:${vein}`;
    capCw.visible = false;
    group.add(whole, stay, capCcw, capCw);
    const chunks = new Map<number, Chunk>();
    const chunkOf = (key: number, keelMass: number): Chunk => {
      let c = chunks.get(key);
      if (!c) {
        const g = new THREE.Group();
        g.name = `heartFallChunk:${vein}:${key}`;
        g.visible = false;
        g.matrixAutoUpdate = false;
        group.add(g);
        c = {
          group: g,
          x: 0,
          y: 0,
          z: 0,
          r: 0,
          h: heartHash(key * 13 + 5, i * 7 + 3),
          keelMass,
          axisX: 1,
          axisZ: 0,
        };
        chunks.set(key, c);
      }
      return c;
    };
    for (const d of defs) {
      const baked = heartKitPiece(SMITH_HEART_HEART_KIT_URL, d.piece);
      if (!baked) continue;
      for (const slot of SLOTS) {
        const source = baked[slot];
        if (!source) continue;
        const r = rangesFor(source);
        if (!r) continue;
        const wholeMat = slot === 'glow' ? d.glow : d.stone;
        const order = slot === 'glow' ? d.glowOrder : d.stoneOrder;
        const receives = slot !== 'glow';
        const casts = d.casts && slot !== 'glow';
        if (r.surface.count > 0)
          whole.add(
            runMesh(
              source,
              r.surface.start,
              r.surface.count,
              wholeMat,
              `${d.piece}:${slot}`,
              d.turn,
              centre,
              order,
              casts,
              receives,
            ),
          );
        for (const [tag, run] of r.byTag) {
          const klass = heartFallClass(tag);
          const chunk = heartFallChunk(tag);
          // Falling: lit stone with its depth, the ridge's own light on it. Standing,
          // what remains on the ring keeps the draw it had whole.
          const fallMat =
            slot === 'glow' ? d.glow : d.stone === spine && chunk !== 0 ? stoneLit : d.stone;
          const material = klass === 0 ? fallMat : stoneLit;
          const mesh = runMesh(
            source,
            run.start,
            run.count,
            material,
            `${d.piece}:${slot}:${tag}`,
            d.turn,
            centre,
            material === stoneLit ? (chunk === 0 ? order : O.floor) : order,
            false,
            receives,
          );
          if (chunk === 0) stay.add(mesh);
          else if (d.keel) chunkOf(100 + chunk, chunk).group.add(mesh);
          else chunkOf(chunk, 0).group.add(mesh);
          // The rock a neighbour's fall leaves showing.
          if (klass === 2 || klass === 3) {
            const cap = runMesh(
              source,
              run.start,
              run.count,
              stoneLit,
              `${d.piece}:cap:${tag}`,
              d.turn,
              centre,
              0,
              false,
              receives,
            );
            (klass === 2 ? capCcw : capCw).add(cap);
          }
        }
      }
    }
    // Each cell's pivot: the middle of its own paving (or a mass's rock).
    const list = [...chunks.values()];
    const floorPiece = heartKitPiece(SMITH_HEART_HEART_KIT_URL, `Kit_Quarter${Vein(vein)}`)?.stone;
    const keelPiece = heartKitPiece(SMITH_HEART_HEART_KIT_URL, `Kit_AnvilKeel${Vein(vein)}`)?.stone;
    for (const [source, keel] of [
      [floorPiece, false],
      [keelPiece, true],
    ] as const) {
      const tags = source?.userData.heartFallTags as Uint8Array | undefined;
      const pos = source?.getAttribute('position');
      if (!tags || !pos) continue;
      const sum = new Map<number, [number, number, number, number]>();
      for (let v = 0; v < pos.count; v++) {
        const chunk = heartFallChunk(tags[v]);
        if (chunk === 0 || heartFallClass(tags[v]) !== 0) continue;
        const s = sum.get(chunk) ?? [0, 0, 0, 0];
        s[0] += pos.getX(v);
        s[1] += pos.getY(v);
        s[2] += pos.getZ(v);
        s[3] += 1;
        sum.set(chunk, s);
      }
      for (const [chunk, s] of sum) {
        const c = chunks.get(keel ? 100 + chunk : chunk);
        if (!c) continue;
        c.x = s[0] / s[3];
        c.y = s[1] / s[3];
        c.z = s[2] / s[3];
        c.r = Math.hypot(c.x, c.z);
        // The wall side dips first, each its own way off the tangent.
        const yaw = (c.h - 0.5) * 1.4;
        const ax = c.z / (c.r || 1);
        const az = -c.x / (c.r || 1);
        c.axisX = ax * Math.cos(yaw) - az * Math.sin(yaw);
        c.axisZ = ax * Math.sin(yaw) + az * Math.cos(yaw);
      }
    }
    const altar = altars(vein);
    let altarChunk: Chunk | null = null;
    if (altar) {
      let best = Number.POSITIVE_INFINITY;
      for (const c of list) {
        if (c.keelMass !== 0) continue;
        const d = (c.x + HEART_ROOM.x - altar.x) ** 2 + (c.z + HEART_ROOM.z - altar.z) ** 2;
        if (d < best) {
          best = d;
          altarChunk = c;
        }
      }
    }
    rigs.set(vein, {
      whole,
      stay,
      capCcw,
      capCw,
      chunks: list,
      altar,
      altarChunk,
      written: -1,
    });
  });

  const setVisible = (o: THREE.Object3D, v: boolean) => {
    if (o.visible !== v) o.visible = v;
  };

  return {
    group,
    paint(vein, t, ccwT, cwT) {
      const r = rigs.get(vein) as QuarterRig;
      const down = t >= 0;
      setVisible(r.whole, !down);
      setVisible(r.stay, down);
      setVisible(r.capCcw, !down && ccwT >= 0);
      setVisible(r.capCw, !down && cwT >= 0);
      if (t === r.written) return;
      r.written = t;
      if (!down) {
        for (const c of r.chunks) setVisible(c.group, false);
        if (r.altar) {
          r.altar.holder.matrix.copy(r.altar.rest);
          r.altar.holder.matrixWorldNeedsUpdate = true;
          setVisible(r.altar.holder, true);
        }
        return;
      }
      for (const c of r.chunks) {
        if (c.keelMass !== 0) heartKeelPose(c.keelMass, c.h, t, _pose);
        else heartCellPose(c.r, c.h, t, _pose);
        setVisible(c.group, !_pose.gone);
        if (r.altarChunk === c && r.altar) setVisible(r.altar.holder, !_pose.gone);
        if (_pose.gone) continue;
        // T(pivot, dropped) * R * T(-pivot), in the interior's frame.
        _a.set(c.axisX, 0, c.axisZ);
        _q.setFromAxisAngle(_a, _pose.turn);
        _p.set(centre.x + c.x, centre.y + c.y - _pose.drop, centre.z + c.z);
        c.group.matrix.compose(_p, _q, _one);
        _toPivot.makeTranslation(-(centre.x + c.x), -(centre.y + c.y), -(centre.z + c.z));
        c.group.matrix.multiply(_toPivot);
        c.group.matrixWorldNeedsUpdate = true;
        if (r.altarChunk === c && r.altar) {
          r.altar.holder.matrix.multiplyMatrices(c.group.matrix, r.altar.rest);
          r.altar.holder.matrixWorldNeedsUpdate = true;
        }
      }
    },
  };
}
