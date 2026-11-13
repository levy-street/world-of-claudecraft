// Pure plan of the Ring's Blender kit (phase 2F: docs/design/raid/kit/
// build_smith_heart_ring_kit.py, painted by ring_kit.ts and heart_seal.ts):
// where every Kit_* piece of the Ring, the two stairs down to the seal, the
// Seal Dais and the vein mouths stands.
//
//   - the Ring's paving: a sector module every 6 degrees round its arc (the
//     two ends closed square), over the field's own walk (a breath above it,
//     so the field stays the fallback and the depth test never fights);
//   - the light-rivers' channels where they cross the Ring (the Breath, the
//     Quench, the Heat), inlaid over the paving;
//   - the edges: the curb and its carved fascia along the Ring's lip over the
//     chasm, the gutter and scree against the mountain along its outer rim,
//     the stringers and low parapets along every stair's sides;
//   - the Grand Stair and the North Stair: their treads (straddling the walked
//     ramp, half a riser either way), the river's chute down the middle; the
//     field draws neither stair's top (`RING_KIT_OMIT_TOPS`) once the kit has
//     landed, and the dais's piece paves their landings;
//   - the dais, the standing stones, the cairns and the crystal spires on the
//     layout's props, the vein mouths' jambs and sills.
// The seal (its quarters, its heart, the shards) moves, so heart_seal.ts
// places it itself; the spires' crystal lights per vein, so their placements
// carry their vein.
//
// Nothing render-only stands over a walked floor beyond a hand (the paving,
// the channels, the sills and the curbs are flat dressing), the parapets,
// fascias, feet and jambs stand past the lips, and every solid a body can
// touch stands on a layout collider. Three-free, DOM-free, deterministic.

import {
  BALCONY,
  RING,
  RING_ARC,
  ringPoint,
  SEAL_DAIS,
  SMITH_HEART_FIELD,
  type SmithHeartVein,
} from '../../sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../../sim/instances/authored_field';
import type { FieldPathSurface } from '../../sim/instances/authored_field/types';
import { planFieldEdgePieces } from '../authored_field/field_edge_plan_core';
import type { HeartKitPlacement } from './heart_kit_core';
import { heartHash, heartPropBase } from './heart_plan_core';

/** The two stairs the kit draws step by step (their field tops are omitted
 *  once the kit has landed). */
export const RING_KIT_STAIRS: readonly string[] = ['grand_stair', 'north_stair'];
/** The field tops the kit draws in their place once it has landed: the two
 *  stairs, the Ring's walk and the dais (their paving's joints then show the
 *  kit's own grit, never the field's slate). */
export const RING_KIT_OMIT_TOPS: ReadonlySet<string> = new Set([
  ...RING_KIT_STAIRS,
  'ring',
  'seal_dais',
]);
/** Every stair the kit rails (the Balcony Stairs keep their field ramp). */
export const RING_KIT_RAILED: ReadonlySet<string> = new Set([
  ...RING_KIT_STAIRS,
  'balcony_stair_east',
  'balcony_stair_west',
]);
/** The surfaces whose lips the kit faces with carved stone (the Ring's curb
 *  and foot, the stairs' stringers) down to `RING_KIT_FASCIA_DEPTH` under the
 *  walk: the mountain's hanging lips start under it. */
export const RING_KIT_FASCIA_SURFACES: ReadonlySet<string> = new Set(['ring', ...RING_KIT_RAILED]);
export const RING_KIT_FASCIA_DEPTH = 3.3;

/** The layout prop kinds the kit draws (their placeholders step aside). */
export const RING_KIT_KINDS: ReadonlySet<string> = new Set([
  'sh_ring_pillar',
  'sh_ring_cairn',
  'sh_hammer_jamb',
  'sh_portal_tine',
]);

/** The kit's measures (yards at scale 1; pinned against the shipped GLB by
 *  tests/smith_heart_ring_kit.test.ts). */
export const RING_KIT_SIZES = {
  /** A paving module's arc (degrees). */
  sector: 6,
  /** An edge module's half length. */
  edgeHalf: 3,
  /** A short tread's run and rise, a long tread's, a side module's width
   *  (from the chute's lip to the stair's edge), the chute's half width. */
  treadRun: 0.55,
  treadRise: 0.36,
  longRun: 2.4,
  longRise: 0.25,
  sideWidth: 6.8,
  chuteHalf: 1.2,
  /** A chute module's length at stretch 1. */
  chuteLength: 4,
  /** A channel's length (along its radius) and a sill's length. */
  channel: 17,
  sill: 6,
  /** How far out from the seal the dais's piece paves the stairs' landings. */
  apron: 23,
} as const;

/** The longest run a short tread takes before the stair turns to long ones. */
const SHORT_RUN_MAX = 1.4;

/** Every paving module of the Ring, Start and End closing its arc. */
export function planRingPaving(): HeartKitPlacement[] {
  const out: HeartKitPlacement[] = [];
  const S = RING_KIT_SIZES.sector;
  const n = Math.round((RING_ARC.toDeg - RING_ARC.fromDeg) / S);
  for (let k = 0; k < n; k++) {
    const deg = RING_ARC.fromDeg + S / 2 + k * S;
    const h = heartHash(k, 211);
    const piece =
      k === 0
        ? 'Kit_RingPaveStart'
        : k === n - 1
          ? 'Kit_RingPaveEnd'
          : `Kit_RingPave${'ABCD'[Math.floor(h * 4) % 4]}`;
    out.push({
      piece,
      x: RING.x,
      y: RING.h,
      z: RING.z,
      rot: (deg * Math.PI) / 180,
      noShadow: true,
    });
  }
  return out;
}

/** The bearings where a light-river crosses the Ring (the Breath from the
 *  north, the Quench from the east, the Heat from the west). */
export const RING_CHANNEL_BEARINGS = [0, 90, 270] as const;

/** The channels inlaid over the paving where the rivers cross the Ring. */
export function planRingChannels(): HeartKitPlacement[] {
  return RING_CHANNEL_BEARINGS.map((deg) => {
    const p = ringPoint(deg, RING.R);
    return {
      piece: 'Kit_RingChannel',
      x: p.x,
      y: RING.h,
      z: p.z,
      rot: (deg * Math.PI) / 180,
      noShadow: true,
    };
  });
}

/** Is (x, z) within `w` yards of a river's line across the Ring? */
function nearChannel(x: number, z: number, w: number): boolean {
  return RING_CHANNEL_BEARINGS.some((deg) => {
    const a = (deg * Math.PI) / 180;
    const along = x * Math.sin(a) + z * Math.cos(a);
    const across = Math.abs(x * Math.cos(a) - z * Math.sin(a));
    return along > RING.innerR - 6 && across < w;
  });
}

/** The curb along the Ring's lip over the chasm, the gutter and scree along
 *  its outer rim, the stringers and parapets along the stairs' sides. */
export function planRingEdges(): HeartKitPlacement[] {
  const F = SMITH_HEART_FIELD;
  const half = RING_KIT_SIZES.edgeHalf;
  const half0 = half;
  const edges = planFieldEdgePieces(F, {
    segment: half * 2,
    minDrop: 6,
    kindFor(run) {
      if (run.low > F.voidHeight + 1) return null;
      if (run.surface === 'ring') {
        const mx = (run.ax + run.bx) / 2 - RING.x;
        const mz = (run.az + run.bz) / 2 - RING.z;
        const inner = run.nx * mx + run.nz * mz < 0;
        return {
          piece: inner ? 'Kit_RingCurbA' : 'Kit_RingFootA',
          inset: 0,
          halfLength: half,
          halfDepth: 0.6,
        };
      }
      if (RING_KIT_RAILED.has(run.surface)) {
        return { piece: 'Kit_StairParapetA', inset: 0, halfLength: half, halfDepth: 0.5 };
      }
      return null;
    },
  });
  const props = F.props.filter((p) => p.r !== undefined);
  const out: HeartKitPlacement[] = [];
  // A module's ground past its lip (out to `far`, along its whole run): a
  // walked floor there near its own height (a stair meeting its landing, a
  // mouth's walk leaving the Ring) and it would stand on that floor.
  const overFloor = (
    e: { x: number; z: number; y: number; rot: number; stretch: number },
    far: number,
  ) => {
    const ux = Math.cos(e.rot);
    const uz = -Math.sin(e.rot);
    const nx = Math.sin(e.rot);
    const nz = Math.cos(e.rot);
    const half = half0 * e.stretch + 0.3;
    for (let k = -6; k <= 6; k++) {
      const a = (k / 6) * half;
      for (let w = 0.15; w <= far; w += 0.5) {
        const x = e.x + ux * a + nx * w;
        const z = e.z + uz * a + nz * w;
        if (!authoredFieldSurfaceAt(F, x, z)) continue;
        if (Math.abs(authoredFieldHeight(F, x, z) - e.y) < 3) return true;
      }
    }
    return false;
  };
  edges.forEach((e, i) => {
    if (e.stretch < 0.45 || e.stretch > 1.6) return;
    const h = heartHash(Math.round(e.x * 3) + 7, Math.round(e.z * 3));
    let piece = e.piece;
    if (piece !== 'Kit_RingCurbA' && overFloor(e, piece === 'Kit_RingFootA' ? 5 : 1)) return;
    if (piece === 'Kit_RingCurbA') {
      // The rivers leap the lip there: the curb stops either side.
      if (nearChannel(e.x, e.z, half * e.stretch + 1.4)) return;
      if (h < 0.24) piece = 'Kit_RingCurbB';
    } else if (piece === 'Kit_RingFootA') {
      if (h < 0.45) piece = 'Kit_RingFootB';
    } else if (h < 0.2 && i % 3 !== 0) {
      piece = 'Kit_StairParapetB';
    }
    // Not through a standing stone or a jamb standing on the edge.
    if (
      piece.startsWith('Kit_StairParapet') &&
      props.some((p) => Math.hypot(p.x - e.x, p.z - e.z) < (p.r ?? 0) + half * e.stretch)
    )
      return;
    out.push({
      piece,
      x: e.x,
      y: e.y,
      z: e.z,
      rot: e.rot,
      stretch: e.stretch,
      shear: e.shear,
      noShadow: piece.startsWith('Kit_RingCurb') || piece.startsWith('Kit_RingFoot'),
      // The paving's edges stay on every tier (the walk's own lip); the
      // scree at the mountain's foot is far dressing.
      cosmetic: piece.startsWith('Kit_RingFoot'),
    });
  });
  return out;
}

/** Is a stair's point under a landing the field or the dais's piece draws
 *  (the Balcony, the Ring, the dais and its aprons)? */
function onLanding(x: number, z: number): boolean {
  const r = Math.hypot(x - RING.x, z - RING.z);
  if (r >= RING.innerR - 0.05) return true;
  if (Math.hypot(x - SEAL_DAIS.x, z - SEAL_DAIS.z) <= RING_KIT_SIZES.apron + 0.05) return true;
  return x >= BALCONY.x0 && x <= BALCONY.x1 && z >= BALCONY.z0 && z <= BALCONY.z1 + 0.05;
}

export interface RingStairStep {
  x: number;
  z: number;
  /** The tread's top. */
  y: number;
  /** The downhill direction (unit, xz). */
  dx: number;
  dz: number;
  run: number;
  rise: number;
  long: boolean;
}

/** The steps of one stair (its ramp legs, landings excluded): each leg cut
 *  into steps of one rise, every tread's top on the walked ramp at its
 *  middle (half a riser above it at its back, half below at its nosing). */
export function planRingStairSteps(surfaceId: string): RingStairStep[] {
  const s = SMITH_HEART_FIELD.surfaces.find((x) => x.id === surfaceId) as
    | FieldPathSurface
    | undefined;
  if (!s || s.kind !== 'path') return [];
  const out: RingStairStep[] = [];
  for (let i = 0; i + 1 < s.points.length; i++) {
    let a = s.points[i];
    let b = s.points[i + 1];
    if (Math.abs(a[2] - b[2]) < 0.01) continue;
    if (a[2] < b[2]) [a, b] = [b, a];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const drop = a[2] - b[2];
    let n = Math.max(1, Math.round(drop / RING_KIT_SIZES.treadRise));
    let long = false;
    if (len / n > SHORT_RUN_MAX) {
      n = Math.max(1, Math.round(drop / RING_KIT_SIZES.longRise));
      long = true;
    }
    const dx = (b[0] - a[0]) / len;
    const dz = (b[1] - a[1]) / len;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[1] + (b[1] - a[1]) * t;
      if (onLanding(x, z)) continue;
      out.push({ x, z, y: a[2] - drop * t, dx, dz, run: len / n, rise: drop / n, long });
    }
  }
  return out;
}

/** The treads (two side modules, the chute's lips between them) and the
 *  chute of every kit stair. */
export function planRingStairs(): HeartKitPlacement[] {
  const Z = RING_KIT_SIZES;
  const out: HeartKitPlacement[] = [];
  for (const id of RING_KIT_STAIRS) {
    const steps = planRingStairSteps(id);
    steps.forEach((st, k) => {
      const rot = Math.atan2(-st.dz, st.dx);
      // Across the stair (left of downhill).
      const lx = -st.dz;
      const lz = st.dx;
      const off = Z.chuteHalf + Z.sideWidth / 2;
      for (const side of [-1, 1]) {
        const h = heartHash(k * 2 + (side > 0 ? 1 : 0), id.length * 31);
        const piece = st.long
          ? `Kit_StairTreadLong${h < 0.5 ? 'A' : 'B'}`
          : `Kit_StairTread${'ABC'[Math.floor(h * 3) % 3]}`;
        out.push({
          piece,
          x: st.x + lx * off * side,
          y: st.y,
          z: st.z + lz * off * side,
          rot,
          stretch: st.run / (st.long ? Z.longRun : Z.treadRun),
          rise: st.rise / (st.long ? Z.longRise : Z.treadRise),
          noShadow: true,
        });
      }
    });
    // The chute, a module per few yards of each ramp leg, on the ramp's line.
    const s = SMITH_HEART_FIELD.surfaces.find((x) => x.id === id) as FieldPathSurface;
    for (let i = 0; i + 1 < s.points.length; i++) {
      let a = s.points[i];
      let b = s.points[i + 1];
      if (Math.abs(a[2] - b[2]) < 0.01) continue;
      if (a[2] < b[2]) [a, b] = [b, a];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const m = Math.max(1, Math.ceil(len / Z.chuteLength));
      const piece = len / m;
      for (let j = 0; j < m; j++) {
        const t = (j + 0.5) / m;
        out.push({
          piece: 'Kit_StairChute',
          x: a[0] + (b[0] - a[0]) * t,
          y: a[2] + (b[2] - a[2]) * t,
          z: a[1] + (b[1] - a[1]) * t,
          rot: Math.atan2(-(b[1] - a[1]), b[0] - a[0]),
          stretch: (piece + 0.04) / Z.chuteLength,
          shear: (b[2] - a[2]) / len,
          noShadow: true,
        });
      }
    }
  }
  return out;
}

/** The spires' veins by bearing: each burns for the vein whose quarter of
 *  the seal it stands after, clockwise. */
export const RING_SPIRE_VEINS: Readonly<Record<number, SmithHeartVein>> = {
  45: 'breath',
  134: 'quench',
  226: 'hammer',
  315: 'heat',
};

export interface RingSpireSpot {
  x: number;
  y: number;
  z: number;
  rot: number;
  vein: SmithHeartVein;
}

/** The four crystal spires (the layout's `sh_portal_tine`), each turned so
 *  its crystal leans in over the seal. */
export function ringSpireSpots(): RingSpireSpot[] {
  return SMITH_HEART_FIELD.props
    .filter((p) => p.kind === 'sh_portal_tine')
    .map((p) => {
      const deg = Math.round(((Math.atan2(p.x, p.z) * 180) / Math.PI + 360) % 360);
      return {
        x: p.x,
        y: SEAL_DAIS.h,
        z: p.z,
        rot: Math.atan2(p.x - SEAL_DAIS.x, p.z - SEAL_DAIS.z),
        vein: RING_SPIRE_VEINS[deg] ?? 'hammer',
      };
    });
}

/** The layout's props of the Ring fitted with their pieces (the spires'
 *  plinths and crystal are heart_seal.ts's), and the dais. */
export function planRingProps(): HeartKitPlacement[] {
  const out: HeartKitPlacement[] = [
    { piece: 'Kit_SealDais', x: SEAL_DAIS.x, y: SEAL_DAIS.h, z: SEAL_DAIS.z, rot: 0 },
  ];
  let cairn = 0;
  for (const prop of SMITH_HEART_FIELD.props) {
    const y = heartPropBase(prop.x, prop.z);
    if (prop.kind === 'sh_ring_pillar') {
      // Turned so a face looks across the Ring, each a little its own way.
      const h = heartHash(Math.round(prop.x), Math.round(prop.z));
      out.push({
        piece: 'Kit_RingMonolith',
        x: prop.x,
        y,
        z: prop.z,
        rot: Math.atan2(RING.x - prop.x, RING.z - prop.z) + (h - 0.5) * 0.5,
      });
    } else if (prop.kind === 'sh_ring_cairn') {
      out.push({
        piece: cairn++ % 2 ? 'Kit_RingCairnB' : 'Kit_RingCairnA',
        x: prop.x,
        y,
        z: prop.z,
        rot: prop.rot,
      });
    } else if (prop.kind === 'sh_hammer_jamb') {
      out.push({ piece: 'Kit_JambHammer', x: prop.x, y, z: prop.z, rot: prop.rot });
    }
  }
  return out;
}

/** A vein mouth on the Ring: where its walk leaves the Ring's rim (the axis
 *  out into the vein), how wide its walk is, which jamb it takes. */
export interface RingMouth {
  vein: SmithHeartVein;
  x: number;
  z: number;
  /** Out along the mouth (unit, xz). */
  ax: number;
  az: number;
  halfWidth: number;
  piece: string;
}

/** The three mouths on the Ring's rim (the Hammer's is at the Balcony's tip,
 *  on the layout's own jambs). */
export const RING_MOUTHS: readonly RingMouth[] = [
  {
    vein: 'breath',
    x: 0,
    z: RING.outerR + 2.4,
    ax: 0,
    az: 1,
    halfWidth: 7,
    piece: 'Kit_JambBreath',
  },
  {
    vein: 'quench',
    x: RING.outerR + 2.4,
    z: 0,
    ax: 1,
    az: 0,
    halfWidth: 7,
    piece: 'Kit_JambQuench',
  },
  {
    vein: 'heat',
    x: -(RING.outerR + 2.4),
    z: 0,
    ax: -1,
    az: 0,
    halfWidth: 14,
    piece: 'Kit_JambHeat',
  },
];

/** How far past a mouth's walk its jambs stand. */
export const RING_JAMB_OUT = 2.7;

/** The mouths' jambs (a pair each, render-only, past the walk's sides) and
 *  sills (flush across the walk); the Hammer's sill across the Grand Stair's
 *  head between its layout jambs. */
export function planRingMouths(): HeartKitPlacement[] {
  const out: HeartKitPlacement[] = [];
  const Z = RING_KIT_SIZES;
  for (const m of RING_MOUTHS) {
    // Across the mouth.
    const lx = m.az;
    const lz = -m.ax;
    const off = m.halfWidth + RING_JAMB_OUT;
    for (const side of [-1, 1]) {
      const x = m.x + lx * off * side;
      const z = m.z + lz * off * side;
      // The stone's inner face (+X) toward the opening.
      const ix = -lx * side;
      const iz = -lz * side;
      out.push({
        piece: m.piece,
        x,
        y: heartPropBase(m.x, m.z),
        z,
        rot: Math.atan2(-iz, ix),
      });
    }
    // The sill: one module per 7 yd of walk, stretched to it.
    const n = Math.max(1, Math.round((m.halfWidth * 2) / 7));
    const len = (m.halfWidth * 2) / n;
    for (let k = 0; k < n; k++) {
      const c = -m.halfWidth + len * (k + 0.5);
      out.push({
        piece: 'Kit_RingSill',
        x: m.x + lx * c,
        y: heartPropBase(m.x, m.z),
        z: m.z + lz * c,
        rot: Math.atan2(-lz, lx),
        stretch: (len - 0.05) / Z.sill,
        noShadow: true,
      });
    }
  }
  // The Hammer's: across the Grand Stair's head on the Balcony's tip.
  for (const k of [-1, 1]) {
    out.push({
      piece: 'Kit_RingSill',
      x: k * 4,
      y: BALCONY.h,
      z: BALCONY.z1 - 2.5,
      rot: 0,
      stretch: 7.95 / Z.sill,
      noShadow: true,
    });
  }
  return out;
}

/** The kit's whole static plan (the seal and the spires are heart_seal.ts's). */
export function planRingKit(): HeartKitPlacement[] {
  return [
    ...planRingPaving(),
    ...planRingChannels(),
    ...planRingEdges(),
    ...planRingStairs(),
    ...planRingProps(),
    ...planRingMouths(),
  ];
}
