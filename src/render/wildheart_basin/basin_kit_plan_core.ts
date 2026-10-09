// Pure placement plan for the Wildheart Basin kit (docs/design/dungeon-rework/
// wildheart_basin.md, sections 3 and 7): which Kit_* piece every sim prop of
// the layout draws, the edge dressing along the generated cliffs, and the
// render-only dressing outside the walkable field (the caldera ring of basalt
// walls with the waterfall notches, the jungle on the gorge floor, the stepped
// pyramid under the shrine, the colossal jaguar head in the north rim, the
// Sunken Idol's maw round the landing), in one list the painter
// (basin_kit.ts) instances.
//
// The contract: nothing floats, and nothing taller than a knee stands in a
// walkway's head room without a sim collider under it. A piece stands on the
// floor under its own footprint, rises from the gorge floor, steps on the tier
// below it, or hangs from a lip; dressing in the void stays out of every
// walkway's vertical space (tests/wildheart_basin_kit.test.ts audits the
// shipped GLB against the real floor).
//
// Three-free, DOM-free, deterministic.

import {
  IDOL_LANDING,
  JAGUAR_HEAD,
  RIM_FALLS,
  RIVER_COURSE,
  WEEPING_FALLS,
  WILDHEART_BASIN_FIELD,
  WILDHEART_BASIN_VOID_HEIGHT,
} from '../../sim/content/wildheart_basin_layout';
import {
  authoredFieldHeight,
  type FieldProp,
  type FieldSurface,
} from '../../sim/instances/authored_field';
import { type FieldEdgeKind, planFieldEdgePieces } from '../authored_field/field_edge_plan_core';

export interface BasinKitPlacement {
  piece: string;
  x: number;
  z: number;
  rot: number;
  scale: number;
  /** Absolute instance-local height (else the ground under x, z). */
  y?: number;
  /** Extra lift above the ground. */
  lift?: number;
  /** Stretch along the piece's local x (edge segments fit their run). */
  stretch?: number;
  /** Rise per yard along the piece's local x (a sheared rail on a stair). */
  shear?: number;
  /** Sheds on the low graphics tier (cosmetic density only). */
  cosmetic?: boolean;
}

const FIELD = WILDHEART_BASIN_FIELD;
const VOID = WILDHEART_BASIN_VOID_HEIGHT;
const ground = (x: number, z: number): number => authoredFieldHeight(FIELD, x, z);
const walkable = (x: number, z: number): boolean => ground(x, z) > VOID + 1;

/** A small deterministic hash in [0, 1). */
export function basinHash(i: number, salt: number): number {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

// ---- the sim props -----------------------------------------------------------------

/** Prop kinds that are collider-only (drawn by something else). None today:
 *  every `wb_*` kind of the layout draws a kit piece. */
export const BASIN_COLLIDER_ONLY: ReadonlySet<string> = new Set();

/** The kit node a sim prop kind draws ('' for a collider-only or unknown prop). */
export function basinPieceForProp(p: FieldProp): string {
  switch (p.kind) {
    case 'wb_idol_maw':
      return 'Kit_IdolMaw';
    case 'wb_maw_pylon':
      return 'Kit_MawPylon';
    case 'wb_brazier':
      return 'Kit_Brazier';
    case 'wb_totem':
      return 'Kit_SunboneTotem';
    case 'wb_strangler_roots':
      return 'Kit_StranglerRoots';
    case 'wb_basalt_columns':
      return 'Kit_BasaltColumns';
    case 'wb_banner':
      return 'Kit_SunboneBanner';
    case 'wb_river_stones':
      return 'Kit_RiverStones';
    case 'wb_vine_anchor':
      return 'Kit_VineAnchor';
    case 'wb_bone_post':
      return 'Kit_BonePost';
    case 'wb_hide_rack':
      return 'Kit_HideRack';
    case 'wb_beast_cage':
      return 'Kit_BeastCage';
    case 'wb_bone_fence':
      return 'Kit_BoneFence';
    case 'wb_judging_stone':
      return 'Kit_JudgingStone';
    case 'wb_pool_rim':
      return 'Kit_PoolRim';
    case 'wb_ruin_arch':
      return 'Kit_RuinArch';
    case 'wb_ruin_column':
      // A tall column stands whole; a short one is a broken stump.
      return (p.h ?? 6) >= 6 ? 'Kit_RuinColumn' : 'Kit_RuinColumnBroken';
    case 'wb_ruin_wall':
      return 'Kit_RuinWall';
    case 'wb_rooted_statue':
      return 'Kit_RootedStatue';
    case 'wb_ward_post':
      return 'Kit_WardPost';
    case 'wb_shrine_altar':
      return 'Kit_ShrineAltar';
    case 'wb_sun_glyph':
      return 'Kit_SunGlyph';
    case 'wb_jungle_tree':
      return 'Kit_JungleTree';
    case 'wb_palm':
      return 'Kit_Palm';
    case 'wb_fern':
      return 'Kit_GiantFern';
    default:
      return '';
  }
}

/** The scale a prop's piece draws at: the layout's own scale, or one fitted
 *  to its collider where a single piece serves several sizes. */
function propScale(p: FieldProp, piece: string): number {
  if (piece === 'Kit_BasaltColumns' && p.r) return p.r / 2.5;
  if (piece === 'Kit_RuinColumn') return Math.min(1.1, Math.max(0.8, (p.h ?? 7.9) / 7.9));
  if (piece === 'Kit_RuinColumnBroken') return Math.min(1.1, Math.max(0.75, (p.h ?? 4.9) / 4.9));
  return p.scale ?? 1;
}

/** Every sim prop's kit placement (the pool rims stand in the plunge pool). */
export function planBasinPropPlacements(): BasinKitPlacement[] {
  const out: BasinKitPlacement[] = [];
  for (const p of FIELD.props) {
    const piece = basinPieceForProp(p);
    if (!piece) continue;
    const at: BasinKitPlacement = { piece, x: p.x, z: p.z, rot: p.rot, scale: propScale(p, piece) };
    if (p.kind === 'wb_idol_maw') at.y = IDOL_LANDING.h;
    // A prop off every walkway: the pool rims stand in the plunge pool; any
    // other (a layout slip) rises from the gorge floor rather than float.
    else if (!walkable(p.x, p.z))
      at.y = p.kind === 'wb_pool_rim' ? WEEPING_FALLS.poolY - 0.6 : VOID;
    out.push(at);
  }
  return out;
}

// ---- the cliff edges -------------------------------------------------------------------

export const BASIN_BASALT_EDGE: FieldEdgeKind = {
  piece: 'Kit_BasaltEdge',
  inset: 0.45,
  halfLength: 2.0,
  halfDepth: 0.45,
};
export const BASIN_BONE_EDGE: FieldEdgeKind = {
  piece: 'Kit_BoneEdge',
  inset: 0.35,
  halfLength: 2.0,
  halfDepth: 0.35,
};
export const BASIN_MASONRY_EDGE: FieldEdgeKind = {
  piece: 'Kit_MasonryEdge',
  inset: 0.4,
  halfLength: 2.0,
  halfDepth: 0.4,
};

/** Every edge piece: basalt lips on the rock terraces and stairs, lashed bone
 *  rails on the Sunbone works (the pits, the causeway), carved coping on the
 *  pyramid's stairs and landings. Drops under 2.5 yd stay bare. */
export function planBasinEdges(): BasinKitPlacement[] {
  return planFieldEdgePieces(FIELD, {
    minDrop: 2.5,
    segment: 5,
    kindFor: (run) => {
      if (run.style === 'bone') return BASIN_BONE_EDGE;
      if (run.style === 'masonry' || run.style === 'balustrade') return BASIN_MASONRY_EDGE;
      return BASIN_BASALT_EDGE;
    },
  }).map((e) => ({
    piece: e.piece,
    x: e.x,
    z: e.z,
    rot: e.rot,
    scale: 1,
    y: e.y,
    stretch: e.stretch,
    shear: e.shear,
  }));
}

/** Liana curtains hanging down the basalt lips that drop into the gorge (from
 *  just outside the lip, below its columns, so they never cross a walkway). */
export function planBasinLipVines(): BasinKitPlacement[] {
  const out: BasinKitPlacement[] = [];
  planBasinEdges().forEach((e, i) => {
    if (e.piece !== 'Kit_BasaltEdge' || basinHash(i, 7) < 0.6) return;
    const ox = Math.sin(e.rot) * 0.95;
    const oz = Math.cos(e.rot) * 0.95;
    const x = e.x + ox;
    const z = e.z + oz;
    if (walkable(x + ox * 2, z + oz * 2)) return;
    out.push({
      piece: 'Kit_HangingVines',
      x,
      z,
      rot: e.rot,
      scale: 0.9 + basinHash(i, 9) * 0.5,
      y: (e.y ?? 0) - 0.5,
      cosmetic: true,
    });
  });
  return out;
}

// ---- the stepped pyramid ----------------------------------------------------------------

/** One stepped block of the pyramid: a rectangle whose top is a walkable level. */
export interface PyramidBlock {
  id: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
}

/** Tier geometry: each ring steps this far out and this far down. */
export const PYRAMID_TIER_STEP = 3;
export const PYRAMID_TIER_HEIGHT = 12;
export const PYRAMID_TIER_LENGTH = 8;
/** The bay a side is split into (a tier piece stretched to fit it). */
const PYRAMID_BAY = 10;
export const PYRAMID_TIER_DEPTH = 6;
const PYRAMID_FIRST_OFFSET = 0.6;
const PYRAMID_LIP_DROP = 0.8;

const PYRAMID_SURFACES = [
  'shrine_terrace',
  'shrine_landing_1',
  'shrine_landing_2',
  'shrine_stair_1',
  'shrine_stair_2',
  'shrine_stair_3',
];

function surfaceBox(s: FieldSurface): PyramidBlock {
  if (s.kind === 'poly') {
    const xs = s.points.map((q) => q[0]);
    const zs = s.points.map((q) => q[1]);
    return {
      id: s.id,
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      z0: Math.min(...zs),
      z1: Math.max(...zs),
      top: s.h,
    };
  }
  if (s.kind === 'circle') {
    return { id: s.id, x0: s.x - s.r, x1: s.x + s.r, z0: s.z - s.r, z1: s.z + s.r, top: s.h };
  }
  const xs = s.points.map((q) => q[0]);
  const zs = s.points.map((q) => q[1]);
  return {
    id: s.id,
    x0: Math.min(...xs) - s.halfWidth,
    x1: Math.max(...xs) + s.halfWidth,
    z0: Math.min(...zs),
    z1: Math.max(...zs),
    top: Math.min(...s.points.map((q) => q[2])),
  };
}

/** The pyramid's blocks, read off the shrine's surfaces (terrace, landings,
 *  stairs), so the cladding follows any layout edit. */
export function pyramidBlocks(): PyramidBlock[] {
  return FIELD.surfaces.filter((s) => PYRAMID_SURFACES.includes(s.id)).map(surfaceBox);
}

/** Ring k of a block: its outer rectangle and its top. */
export function pyramidRing(b: PyramidBlock, k: number) {
  const o = PYRAMID_FIRST_OFFSET + PYRAMID_TIER_STEP * k;
  return {
    x0: b.x0 - o,
    x1: b.x1 + o,
    z0: b.z0 - o,
    z1: b.z1 + o,
    top: b.top - PYRAMID_LIP_DROP - PYRAMID_TIER_HEIGHT * k,
  };
}

/** How many rings a block steps down before its tiers reach the gorge floor. */
export function pyramidRingCount(b: PyramidBlock): number {
  let k = 0;
  while (pyramidRing(b, k).top - PYRAMID_TIER_HEIGHT > VOID - PYRAMID_TIER_HEIGHT) k++;
  return k;
}

/** The pyramid's solid height at (x, z): the top of the innermost ring of any
 *  block that contains it (-Infinity outside the pyramid). */
export function pyramidSolidHeight(x: number, z: number, except?: PyramidBlock): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const b of pyramidBlocks()) {
    if (except && b.id === except.id) continue;
    const n = pyramidRingCount(b);
    for (let k = 0; k < n; k++) {
      const r = pyramidRing(b, k);
      if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) {
        best = Math.max(best, r.top);
        break;
      }
    }
  }
  return best;
}

/** Can a tier piece with this top stand here? 'ok', 'hidden' (under a floor
 *  or inside a taller part of the pyramid) or 'clash' (it would rise into a
 *  walkway's head room). */
function tierSpot(
  x: number,
  z: number,
  top: number,
  self: PyramidBlock,
): 'ok' | 'hidden' | 'clash' {
  const g = ground(x, z);
  if (g > VOID + 1) return g >= top + 0.3 ? 'hidden' : 'clash';
  return pyramidSolidHeight(x, z, self) >= top + 0.5 ? 'hidden' : 'ok';
}

/** Every tier bay and corner of the stepped pyramid: each block's rings
 *  stepping out and down into the gorge, the bays a walkway would meet or a
 *  taller part of the pyramid hides left out. Tier origin: the base of its
 *  outer face; it faces out of its block. */
export function planPyramidCladding(): BasinKitPlacement[] {
  const out: BasinKitPlacement[] = [];
  for (const b of pyramidBlocks()) {
    const rings = pyramidRingCount(b);
    for (let k = 0; k < rings; k++) {
      const r = pyramidRing(b, k);
      const base = r.top - PYRAMID_TIER_HEIGHT;
      // The four sides: start corner, run direction, outward normal.
      const sides: [number, number, number, number, number, number, number][] = [
        [r.x0, r.z0, 1, 0, 0, -1, r.x1 - r.x0],
        [r.x1, r.z1, -1, 0, 0, 1, r.x1 - r.x0],
        [r.x1, r.z0, 0, 1, 1, 0, r.z1 - r.z0],
        [r.x0, r.z1, 0, -1, -1, 0, r.z1 - r.z0],
      ];
      for (const [sx, sz, ux, uz, nx, nz, len] of sides) {
        const bays = Math.max(1, Math.round(len / PYRAMID_BAY));
        const step = len / bays;
        for (let i = 0; i < bays; i++) {
          const mid = step * (i + 0.5);
          const cx = sx + ux * mid;
          const cz = sz + uz * mid;
          let clash = false;
          let open = false;
          for (const t of [-0.42, 0, 0.42]) {
            for (const d of [0.4, PYRAMID_TIER_DEPTH * 0.5, PYRAMID_TIER_DEPTH - 0.4]) {
              const px = cx + ux * step * t - nx * d;
              const pz = cz + uz * step * t - nz * d;
              const spot = tierSpot(px, pz, r.top, b);
              if (spot === 'clash') clash = true;
              else if (spot === 'ok' && d < 1) open = true;
            }
            // Clear of every walkway in front of its face too.
            const fx = cx + ux * step * t + nx * 1.2;
            const fz = cz + uz * step * t + nz * 1.2;
            const g = ground(fx, fz);
            if (g > VOID + 1 && g < r.top + 0.3) clash = true;
          }
          if (clash || !open) continue;
          out.push({
            piece: 'Kit_PyramidTier',
            x: cx,
            z: cz,
            rot: Math.atan2(nx, nz),
            scale: 1,
            y: base,
            stretch: step / PYRAMID_TIER_LENGTH,
          });
        }
      }
      // The corners, the ornament's diagonal pointing out of the block.
      const corners: [number, number, number, number][] = [
        [r.x0, r.z0, -1, -1],
        [r.x1, r.z0, 1, -1],
        [r.x1, r.z1, 1, 1],
        [r.x0, r.z1, -1, 1],
      ];
      for (const [x, z, dx, dz] of corners) {
        const inX = x - dx * 1.2;
        const inZ = z - dz * 1.2;
        if (tierSpot(inX, inZ, r.top, b) !== 'ok') continue;
        const g = ground(x + dx * 1.5, z + dz * 1.5);
        if (g > VOID + 1 && g < r.top + 0.3) continue;
        out.push({
          piece: 'Kit_PyramidCorner',
          x,
          z,
          rot: Math.atan2(dx, dz) + Math.PI / 4,
          scale: 1,
          y: base,
          cosmetic: k > 1,
        });
      }
    }
  }
  return out;
}

// ---- the caldera ring ---------------------------------------------------------------------

/** The caldera wall's inner face (east half, south to north; the west half
 *  mirrors it). Far enough out that no walkway comes within reach of it. */
const RIM_EAST: readonly (readonly [number, number])[] = [
  [0, -252],
  [30, -248],
  [58, -238],
  [84, -220],
  [104, -198],
  [118, -172],
  [121, -140],
  [121, -100],
  [121, -60],
  [121, -20],
  [121, 20],
  [121, 60],
  [120, 100],
  [112, 132],
  [98, 158],
  [82, 176],
  [66, 192],
  [54, 214],
  [46, 240],
  [44, 268],
  [30, 292],
  [0, 302],
];

/** The closed ring of the caldera's inner face, from the south round by the
 *  east (counter-clockwise seen from above with x right and z up). */
export function calderaRing(): [number, number][] {
  const east = RIM_EAST.map(([x, z]): [number, number] => [x, z]);
  const west = RIM_EAST.slice(1, -1)
    .map(([x, z]): [number, number] => [-x, z])
    .reverse();
  return [...east, ...west];
}

/** Kit_BasaltCliff's authored height (base to rim cap) and width. */
export const BASALT_CLIFF_HEIGHT = 120;
export const BASALT_CLIFF_WIDTH = 32;
const RING_SPACING = 27;

function pointInRing(ring: readonly (readonly [number, number])[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Is (x, z) inside the caldera, at least `margin` yards in from its wall? */
export function insideCaldera(x: number, z: number, margin = 0): boolean {
  const ring = calderaRing();
  if (!pointInRing(ring, x, z)) return false;
  if (margin <= 0) return true;
  return distanceToPolyline(ring, x, z, true) >= margin;
}

function distanceToPolyline(
  pts: readonly (readonly [number, number])[],
  x: number,
  z: number,
  closed = false,
): number {
  let best = Number.POSITIVE_INFINITY;
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % n];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

/** Every module of the caldera wall, the lowered blocks under the falls and
 *  the rock lips the water leaves from. A module's front faces the basin. */
export function planCalderaRing(): BasinKitPlacement[] {
  const out: BasinKitPlacement[] = [];
  const ring = calderaRing();
  let index = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, bz - az);
    const count = Math.max(1, Math.ceil(len / RING_SPACING));
    // Inward normal: the run turned left, toward the basin.
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const nx = -uz;
    const nz = ux;
    for (let k = 0; k < count; k++) {
      const t = (k + 0.5) / count;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const n = index++;
      const scale = 1.0 + basinHash(n, 11) * 0.1;
      const notch = RIM_FALLS.some(
        (f) => Math.hypot(f.x - x, f.z - z) < (BASALT_CLIFF_WIDTH * scale) / 2 + f.width / 2 + 2,
      );
      if (notch) continue;
      out.push({
        piece: 'Kit_BasaltCliff',
        x,
        z,
        rot: Math.atan2(nx, nz),
        scale,
        // Sunk into the gorge floor; its rim lands between about 88 and 104.
        y: VOID - 3 - basinHash(n, 13) * 4,
      });
    }
  }
  for (const f of RIM_FALLS) {
    // A lowered module under the lip (pushed back a stride so the curtain
    // falls clear of its face), its foot sunk in the gorge floor, and the lip
    // the water leaves from on top of it.
    const bx = -Math.sin(f.facing) * 2;
    const bz = -Math.cos(f.facing) * 2;
    const foot = VOID - 3;
    out.push({
      piece: 'Kit_BasaltCliff',
      x: f.x + bx,
      z: f.z + bz,
      rot: f.facing,
      scale: (f.topY - 1 - foot) / BASALT_CLIFF_HEIGHT,
      y: foot,
    });
    out.push({
      piece: 'Kit_WaterfallLip',
      x: f.x,
      z: f.z,
      rot: f.facing,
      scale: f.width / 16,
      y: f.topY,
    });
  }
  return out;
}

// ---- the gorge floor ----------------------------------------------------------------------

/** Half the river's clear ribbon (its water runs here, so no canopy over it). */
export const RIVER_CLEAR_HALF_WIDTH = 4;

/** Distance from (x, z) to the river's course. */
export function riverDistance(x: number, z: number): number {
  return distanceToPolyline(
    RIVER_COURSE.map(([px, pz]): [number, number] => [px, pz]),
    x,
    z,
  );
}

const CLUMP_RADIUS = 7.6;
const CLUMP_HEIGHT = 7.7;
const TALL_TREE_HEIGHT = 28.3;
const TALL_TREE_CROWN = 13;
const PALM_TALL_HEIGHT = 17;
const PALM_TALL_CROWN = 7;
const GORGE_CELL = 10;

/** The lowest walkable floor within `radius` of (x, z) (Infinity if none). */
function lowestFloorNear(x: number, z: number, radius: number): number {
  let low = Number.POSITIVE_INFINITY;
  for (let k = 0; k <= 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    for (const f of [0, 0.5, 1]) {
      if (k > 0 && f === 0) continue;
      const g = ground(x + Math.cos(a) * radius * f, z + Math.sin(a) * radius * f);
      if (g > VOID + 1) low = Math.min(low, g);
    }
  }
  return low;
}

/** Is the gorge floor at (x, z) open (not under a walkway or the pyramid)? */
function openGorge(x: number, z: number): boolean {
  return !walkable(x, z) && pyramidSolidHeight(x, z) === Number.NEGATIVE_INFINITY;
}

/** The jungle on the gorge floor: canopy mounds knitting into one roof,
 *  emergent kapoks whose crowns stop below the terraces they stand beside,
 *  tall palms, stones along the river; the river's ribbon left open. */
export function planGorgeJungle(): BasinKitPlacement[] {
  const out: BasinKitPlacement[] = [];
  let n = 0;
  for (let gz = -252; gz <= 300; gz += GORGE_CELL) {
    for (let gx = -126; gx <= 126; gx += GORGE_CELL) {
      const i = n++;
      const jx = gx + (basinHash(i, 21) - 0.5) * GORGE_CELL * 0.6;
      const jz = gz + (basinHash(i, 23) - 0.5) * GORGE_CELL * 0.6;
      // The jittered spot, or a nudge off a terrace's edge into a narrow gap.
      const spot = (
        [
          [0, 0],
          [4, 0],
          [-4, 0],
          [0, 4],
          [0, -4],
        ] as const
      ).find(([dx, dz]) => openGorge(jx + dx, jz + dz));
      if (!spot) continue;
      const x = jx + spot[0];
      const z = jz + spot[1];
      if (!insideCaldera(x, z, 4)) continue;
      const river = riverDistance(x, z);
      const roll = basinHash(i, 29);
      const rot = basinHash(i, 31) * Math.PI * 2;
      // An emergent kapok or a tall palm where the crown stays under every
      // floor it reaches over.
      if (roll < 0.16 && river > RIVER_CLEAR_HALF_WIDTH + 3) {
        const scale = 0.8 + basinHash(i, 37) * 0.35;
        const low = lowestFloorNear(x, z, TALL_TREE_CROWN * scale);
        if (VOID + TALL_TREE_HEIGHT * scale < low - 1.5) {
          out.push({
            piece: 'Kit_JungleTreeTall',
            x,
            z,
            rot,
            scale,
            y: VOID,
            cosmetic: i % 2 === 1,
          });
          continue;
        }
      }
      if (roll > 0.88 && river > RIVER_CLEAR_HALF_WIDTH + 1) {
        const scale = 0.85 + basinHash(i, 41) * 0.3;
        const low = lowestFloorNear(x, z, PALM_TALL_CROWN * scale);
        if (VOID + PALM_TALL_HEIGHT * scale < low - 1.5) {
          out.push({ piece: 'Kit_PalmTall', x, z, rot, scale, y: VOID, cosmetic: i % 2 === 0 });
          continue;
        }
      }
      const scale = 0.85 + basinHash(i, 43) * 0.45;
      if (river < RIVER_CLEAR_HALF_WIDTH + CLUMP_RADIUS * scale * 0.65) continue;
      const low = lowestFloorNear(x, z, CLUMP_RADIUS * scale);
      if (VOID + CLUMP_HEIGHT * scale >= low - 1) continue;
      out.push({
        piece: 'Kit_CanopyClump',
        x,
        z,
        rot,
        scale,
        y: VOID - 0.6,
        cosmetic: i % 3 === 1,
      });
    }
  }
  // Boulders along the river's banks (rooted in the gorge floor).
  RIVER_COURSE.forEach(([x, z, h], i) => {
    for (const side of [-1, 1]) {
      const [nx, nz] = RIVER_COURSE[Math.min(i + 1, RIVER_COURSE.length - 1)];
      const [px, pz] = RIVER_COURSE[Math.max(i - 1, 0)];
      const dx = nx - px;
      const dz = nz - pz;
      const l = Math.hypot(dx, dz) || 1;
      const sx = x + (-dz / l) * side * (RIVER_CLEAR_HALF_WIDTH + 1.5);
      const sz = z + (dx / l) * side * (RIVER_CLEAR_HALF_WIDTH + 1.5);
      if (!openGorge(sx, sz) || !insideCaldera(sx, sz, 2)) continue;
      out.push({
        piece: 'Kit_PoolRim',
        x: sx,
        z: sz,
        rot: Math.atan2(dx, dz) + Math.PI / 2,
        scale: 1.3,
        y: h - 0.5,
        cosmetic: true,
      });
    }
  });
  return out;
}

// ---- the hero landmarks ------------------------------------------------------------------

/** The colossal jaguar head in the north rim, its maw toward the terrace
 *  (render-only, outside the walkable field), and its eyes (their own node,
 *  lit by the render during the hunt). */
export function planJaguarHead(): BasinKitPlacement[] {
  const at = { x: JAGUAR_HEAD.x, z: JAGUAR_HEAD.z, rot: Math.PI, scale: JAGUAR_HEAD.height / 70 };
  return [
    { piece: 'Kit_JaguarHead', ...at, y: JAGUAR_HEAD.y },
    { piece: 'Kit_JaguarEyes', ...at, y: JAGUAR_HEAD.y },
  ];
}

// ---- the whole plan ------------------------------------------------------------------------

/** Every kit placement of the basin (the gate pieces, Kit_VineBridge and
 *  Kit_ThornWall, are instanced by the gates themselves). */
export function planBasinKitPlacements(): BasinKitPlacement[] {
  return [
    ...planBasinPropPlacements(),
    ...planBasinEdges(),
    ...planBasinLipVines(),
    ...planPyramidCladding(),
    ...planCalderaRing(),
    ...planGorgeJungle(),
    ...planJaguarHead(),
  ];
}

/** Pieces the plan never places but the kit ships for other painters (the
 *  gates weave the bridges and grow the thorn walls from these). */
export const BASIN_GATE_PIECES: readonly string[] = ['Kit_VineBridge', 'Kit_ThornWall'];
