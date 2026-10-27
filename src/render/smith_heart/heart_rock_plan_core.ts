// Pure plan of the Smith's Heart's mountain rock (phase 2E, calmed in 2G:
// a few great faces with long beds and deep clefts, where 2F's eleven
// hundred small plated pieces read as crumpled paper): the sculpted
// faces of the rock kit (docs/design/raid/kit/build_smith_heart_rock_kit.py,
// painted by heart_rock.ts) stacked up the mountain in bands, so its walls
// read as rock and never as the heightfield's flat facets.
//
// Why bands on the heightfield and not a mountain rebuilt from the kit: the
// heightfield (heart_mountain_core.ts) is the single source the clearance,
// the open air and the sightline pins already rest on, and it stays the dark
// mass BEHIND the rock (a gap between two pieces opens onto rock in shadow,
// never onto the void). 2D's sculpted walls were buried because they stood
// at the walk's edge at a fixed height while the mountain climbed a hundred
// yards behind them; here every band follows one contour of the mountain
// (`back`, the yards past a floor's clearance), each piece stands with its
// FRONT plane on that contour facing its floor, its foot sunk into the slope
// under it and its height fitted (`rise`) to reach past the slope behind it
// to the next band up. A piece's front face therefore stands proud of the
// slope it covers: the heightfield can only ever show behind it.
//
// Phase 2G: every piece is drawn at the beds' one height scale on a foot
// sunk to the world's bed grid (`HEART_ROCK_STRATA`), so the ledges run on
// from piece to piece round the mountain; where the slope climbs past one
// face a second stands on its upper beds a step back (two storeys); a
// buttress stands where the eye goes (`heartRockFocus`); the walks high
// over the chasm stand on great faces of their own (`planHeartUnderCliffs`).
//
// Rules the plan keeps (pinned by tests/smith_heart_rock_kit.test.ts):
//   - no piece stands nearer a walkable floor than the mountain itself does
//     (HEART_WALL_CLEAR, HEART_WALL_PATH_CLEAR beside a path): its front plane
//     is on a contour at or past the clearance, its ends turned back;
//   - nothing enters the open air (the chasm round the Seal Dais, the Wind
//     Bridge's gulf, the hearth's mouth, the Heart's chasm);
//   - the first band falls from its floor's lip deep into the chasm (the
//     wall under every walk); the upper bands sit on the slope;
//   - the bands past the second are cosmetic (the low tier keeps the
//     mountain's first two bands and the heightfield behind them);
//   - the lips under the walks (`planHeartLips`) hang from the lip line,
//     their brink under the lowest floor along them, leaning out over the
//     void, never standing through another floor;
//   - the camera never meets a wall of it (heart_rock_cutaway.ts).
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import {
  HEAT,
  SMITH_HEART_FIELD,
  SMITH_HEART_FLOATING_SURFACES,
} from '../../sim/content/smith_heart_layout';
import {
  authoredFieldCliffRuns,
  authoredFieldHeight,
  authoredFieldSurfaceAt,
  type FieldCliffRun,
} from '../../sim/instances/authored_field';
import { BREATH_KIT_SHALLOW } from './breath_kit_plan_core';
import type { HeartKitPlacement } from './heart_kit_core';
import {
  HEART_MOUNTAIN_CHASM,
  heartMountainGrid,
  heartMountainSample,
} from './heart_mountain_core';
import { heartHash } from './heart_plan_core';
import {
  HEART_WALL_CLEAR,
  HEART_WALL_PATH_CLEAR,
  heartFloorClearance,
  heartOpenAir,
} from './heart_walls_core';
import { HEAT_KIT_SHALLOW } from './heat_kit_plan_core';
import { RING_KIT_FASCIA_DEPTH, RING_KIT_FASCIA_SURFACES } from './ring_kit_plan_core';

/** A rock piece's measures (game yards, unscaled): `half` the half width of
 *  its true front (the ends past it turn back into the mountain), `reach`
 *  its whole half width, `depth` how far its body runs back from the front
 *  plane, `height` its foot to its crest. Read off the Blender build and
 *  pinned against the shipped GLB. */
export interface HeartRockPiece {
  half: number;
  reach: number;
  depth: number;
  height: number;
}

export const HEART_ROCK_PIECES: Readonly<Record<string, HeartRockPiece>> = {
  Kit_RockWallA: { half: 18.5, reach: 27.0, depth: 30.6, height: 64.7 },
  Kit_RockWallB: { half: 15.5, reach: 23.2, depth: 28.6, height: 52.2 },
  Kit_RockWallC: { half: 21.5, reach: 31.1, depth: 32.7, height: 83.2 },
  Kit_RockMassA: { half: 24.5, reach: 35.2, depth: 41.0, height: 45.9 },
  Kit_RockMassB: { half: 20, reach: 29.2, depth: 36.0, height: 56.3 },
  Kit_RockProw: { half: 11.5, reach: 17.5, depth: 24.9, height: 67.6 },
};

/** A placed piece's measures (a far build shares its near build's). */
export function heartRockPieceOf(piece: string): HeartRockPiece {
  const m = HEART_ROCK_PIECES[piece.endsWith('Far') ? piece.slice(0, -3) : piece];
  if (!m) throw new Error(`no rock piece ${piece}`);
  return m;
}

/** One band of the mountain: its contour (`back`, yards past the floor's
 *  clearance), the pieces it draws from (`pieces` hashed, `fallback` tried
 *  in order when the hashed one will not fit: too wide for a bend, too
 *  short for the slope), the range its pieces scale in, and how far apart
 *  their middles stand along the contour (yards at the band's smallest
 *  scale: under its widest piece, so neighbours overlap; a narrower piece
 *  in a slot is still overlapped by both its neighbours). */
export interface HeartRockBand {
  back: number;
  pieces: readonly string[];
  fallback: readonly string[];
  scale: readonly [number, number];
  spacing: number;
  cosmetic: boolean;
}

const WALLS = ['Kit_RockWallA', 'Kit_RockWallC', 'Kit_RockWallB'];
const MASSES = ['Kit_RockMassA', 'Kit_RockMassB'];

/** The bands (phase 2G, the calm mountain): few and broad. The first two
 *  are the great faces the walks see (a buttress where the eye goes, see
 *  `HEART_ROCK_FOCUS`); higher up the mountain's upper body in a few huge
 *  masses. 2F's eight bands of small plates read as crumpled paper. */
export const HEART_ROCK_BANDS: readonly HeartRockBand[] = [
  {
    back: 0,
    pieces: ['Kit_RockWallA', 'Kit_RockWallC', 'Kit_RockWallC', 'Kit_RockWallA'],
    fallback: [...WALLS, 'Kit_RockProw'],
    scale: [0.85, 1.5],
    spacing: 30,
    cosmetic: false,
  },
  {
    back: 18,
    pieces: ['Kit_RockWallC', 'Kit_RockWallA', 'Kit_RockMassB', 'Kit_RockWallC'],
    fallback: [...WALLS, ...MASSES, 'Kit_RockProw'],
    scale: [0.9, 1.55],
    spacing: 28,
    cosmetic: false,
  },
  {
    back: 44,
    pieces: ['Kit_RockMassA', 'Kit_RockWallC', 'Kit_RockMassB'],
    fallback: [...MASSES, ...WALLS],
    scale: [1.0, 1.6],
    spacing: 38,
    cosmetic: true,
  },
  ...[72, 104].map(
    (back): HeartRockBand => ({
      back,
      // High up the mountain the rock is seen from fifty yards and more:
      // a few huge masses, never a skyline of teeth.
      pieces: ['Kit_RockMassA', 'Kit_RockMassB'],
      fallback: [...MASSES, 'Kit_RockWallC'],
      scale: [1.2, 1.64],
      spacing: 44,
      cosmetic: true,
    }),
  ),
];

/** The upper storey of a cliff where the mountain climbs past one face
 *  (phase 2G): the pieces it draws from and how far back it stands (yards
 *  at scale 1). */
const HEART_ROCK_STACK = ['Kit_RockWallA', 'Kit_RockMassB', 'Kit_RockWallC'] as const;
export const HEART_ROCK_STACK_BACK = 5;

/** The world's beds (phase 2G): every wall piece is drawn at the same
 *  height scale (`scale`, so its lifts, ROCK_LIFT yards apart in the kit,
 *  stand `lift` apart in the world) on a foot sunk to the grid (`zero` plus
 *  a whole number of lifts): the beds' ledges run on from piece to piece
 *  round the whole mountain, and the rock's paint lays its bed tones on the
 *  same grid (heart_rock_cutaway.ts). */
export const HEART_ROCK_STRATA = { kitLift: 12, scale: 1.15, lift: 13.8, zero: -7.3 } as const;

/** The world height of a bed line at or under `y`. */
export function heartRockBedFloor(y: number): number {
  const S = HEART_ROCK_STRATA;
  return S.zero + Math.floor((y - S.zero) / S.lift + 1e-9) * S.lift;
}

/** Where the eye goes (phase 2G, R2): the vein mouths, the stair heads and
 *  the ways into the arenas (both ends of these walks, and the Heat's mouth
 *  at the forge hall's east end). Within `HEART_ROCK_FOCUS_R` of one the
 *  first two bands stand a buttress (`Kit_RockProw`, the detail clustered on
 *  it) before their plain faces; everywhere else the faces stay quiet. */
export const HEART_ROCK_FOCUS_R = 30;
const FOCUS_PATHS = new Set([
  'breath_mouth',
  'quench_mouth',
  'grand_stair',
  'north_stair',
  'balcony_stair_east',
  'balcony_stair_west',
  'slab_stair',
  'pit_descent',
  'breath_chimney',
  'wind_bridge',
  'cornice_climb',
  'quench_stair',
  'lake_descent',
]);
let focus: { x: number; z: number }[] | null = null;
export function heartRockFocus(): readonly { x: number; z: number }[] {
  if (!focus) {
    focus = [{ x: HEAT.hall.x1, z: 0 }];
    for (const s of SMITH_HEART_FIELD.surfaces) {
      if (s.kind !== 'path' || !FOCUS_PATHS.has(s.id)) continue;
      for (const q of [s.points[0], s.points[s.points.length - 1]])
        focus.push({ x: q[0], z: q[1] });
    }
  }
  return focus;
}

/** How far a piece's foot sinks into the slope under its front (yards per
 *  unit scale), how far it reaches past the slope behind it, and how deep
 *  the first band's wall falls under its floor. */
export const HEART_ROCK_SINK = 3;
export const HEART_ROCK_OVERLAP = 3;
export const HEART_ROCK_FIRST_DROP = 22;
/** How far inside its contour a piece's front may reach (the first band,
 *  an upper band). */
export const HEART_ROCK_FIRST_SLACK = 1;
export const HEART_ROCK_UPPER_SLACK = 3;
/** The vertical stretch a piece takes either way (its beds stay beds: a
 *  plate stretched further reads as a shard), and the stretch a piece is
 *  scaled toward (a breath taller than built). */
export const HEART_ROCK_RISE: readonly [number, number] = [0.7, 1.55];

/** The rock is cut away round the camera (heart_rock_cutaway.ts): gone
 *  within NEAR yards of it, dithered back in by FAR. */
export const HEART_ROCK_CUT_NEAR = 3.5;
export const HEART_ROCK_CUT_FAR = 7;

/** The mountain's grid the plan reads (the high tier's: the low tier draws
 *  a coarser grid of the same mountain, under the same pieces). */
export const HEART_ROCK_GRID = 3;
/** The bands from this one up draw their pieces' far builds (seen from
 *  fifty yards and more). */
export const HEART_ROCK_FAR_FROM = 2;
/** The candidate grid (yards) and how far off its contour a candidate may
 *  lie before it is pulled onto it. */
const GRID = 2;
const BAND_TOL = 1.1;
/** How far past the field's bounds the bands reach. */
const PAD = 120;

function clearOf(x: number, z: number): { back: number; floor: number; toX: number; toZ: number } {
  const c = heartFloorClearance(x, z);
  const clear = c.path ? HEART_WALL_PATH_CLEAR : HEART_WALL_CLEAR;
  return { back: c.d - clear, floor: c.floor, toX: c.toX, toZ: c.toZ };
}

/** The bearing (three's rotation.y) that turns a piece's front square to
 *  the contour at (x, z), toward its floor: down the clearance's slope. */
export function contourFacing(x: number, z: number): number {
  const e = 4;
  const gx = clearOf(x + e, z).back - clearOf(x - e, z).back;
  const gz = clearOf(x, z + e).back - clearOf(x, z - e).back;
  if (Math.hypot(gx, gz) < 1e-6) {
    const c = clearOf(x, z);
    return Math.atan2(c.toX, c.toZ);
  }
  return Math.atan2(-gx, -gz);
}

/** A point `lx` across and `lz` ahead of a placement (its front is +Z). */
function at(p: { x: number; z: number; rot: number }, lx: number, lz: number) {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c };
}

/** The points of a piece's footprint the plan tests its clearance on: its
 *  true front (the middle and both ends) and its turned-back ends. */
export function heartRockFrontPoints(
  p: { x: number; z: number; rot: number; scale?: number },
  piece: HeartRockPiece,
): { x: number; z: number }[] {
  const k = p.scale ?? 1;
  return [
    at(p, 0, 0),
    at(p, -piece.half * k, 0),
    at(p, piece.half * k, 0),
    at(p, -piece.reach * k, -3 * k),
    at(p, piece.reach * k, -3 * k),
  ];
}

/** The mountain under a piece's footprint, as drawn (the painter's grid):
 *  the lowest height along its front, the highest anywhere under it (a
 *  cell's highest corner: nothing of the slope stands above it). */
function slopeUnder(
  p: { x: number; z: number; rot: number },
  piece: HeartRockPiece,
  k: number,
): { front: number; high: number; near: number } {
  const g = heartMountainGrid(HEART_ROCK_GRID);
  let front = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  let near = Number.NEGATIVE_INFINITY;
  for (let i = -2; i <= 2; i++) {
    for (let j = 0; j <= 4; j++) {
      const q = at(p, (i / 2) * piece.half * k, (-j / 4) * piece.depth * k);
      const h = heartMountainSample(g, q.x, q.z);
      if (j === 0) front = Math.min(front, h.mid);
      if (j <= 2) near = Math.max(near, h.high);
      high = Math.max(high, h.high);
    }
  }
  return { front, high, near };
}

/** Does a piece's body (back to its depth, across its reach) stand over a
 *  walked floor between its foot and its crest? */
function backOverFloor(
  p: { x: number; z: number; rot: number; scale?: number },
  piece: HeartRockPiece,
  foot: number,
  height: number,
): boolean {
  const F = SMITH_HEART_FIELD;
  const k = p.scale ?? 1;
  for (let i = -4; i <= 4; i++) {
    for (let j = 1; j <= 6; j++) {
      const q = at(p, (i / 4) * piece.reach * k, (-j / 6) * (piece.depth + 0.5) * k);
      if (!authoredFieldSurfaceAt(F, q.x, q.z)) continue;
      const floor = authoredFieldHeight(F, q.x, q.z);
      if (floor > foot - 2.6 && floor < foot + height) return true;
    }
  }
  return false;
}

interface Candidate {
  x: number;
  z: number;
  back: number;
  floor: number;
  toX: number;
  toZ: number;
}

/** The candidate points of every band, in one scan of the grid (in scan
 *  order: the greedy spacing below is deterministic). */
function bandCandidates(): Candidate[][] {
  const b = SMITH_HEART_FIELD.bounds;
  const out: Candidate[][] = HEART_ROCK_BANDS.map(() => []);
  for (let z = Math.floor((b.minZ - PAD) / GRID) * GRID; z <= b.maxZ + PAD; z += GRID) {
    for (let x = Math.floor((b.minX - PAD) / GRID) * GRID; x <= b.maxX + PAD; x += GRID) {
      const c = clearOf(x, z);
      if (!Number.isFinite(c.back)) continue;
      for (let i = 0; i < HEART_ROCK_BANDS.length; i++) {
        if (Math.abs(c.back - HEART_ROCK_BANDS[i].back) <= BAND_TOL) {
          out[i].push({ x, z, ...c });
          break;
        }
      }
    }
  }
  return out;
}

/** Is (x, z) inside a placed piece's footprint (its true front, back to its
 *  depth)? */
function covered(list: readonly HeartKitPlacement[], x: number, z: number): boolean {
  for (const p of list) {
    const m = heartRockPieceOf(p.piece);
    const k = p.scale ?? 1;
    const dx = x - p.x;
    const dz = z - p.z;
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) <= m.half * k && lz <= 0.5 && lz >= -m.depth * k) return true;
  }
  return false;
}

/** One band's placements: a pass of its pieces at the band's spacing, then a
 *  pass filling what the first left bare (a bend too sharp for a broad face)
 *  with its narrower pieces, closer together. */
function planBand(
  band: HeartRockBand,
  index: number,
  candidates: Candidate[],
): HeartKitPlacement[] {
  const out: HeartKitPlacement[] = [];
  // The first band keeps the clearance to within the distance field's
  // grain (the clearance is itself conservative by a cell and a half);
  // an upper band only has to stay behind the band under it.
  const slack = index === 0 ? HEART_ROCK_FIRST_SLACK : HEART_ROCK_UPPER_SLACK;
  const S = HEART_ROCK_STRATA;
  const tryPiece = (
    c: Candidate,
    order: readonly string[],
    px: number,
    pz: number,
    rot: number,
    k0: number,
  ) => {
    for (const name of order) {
      const piece = HEART_ROCK_PIECES[name];
      // Every piece at the beds' one height scale (its lifts on the world's
      // grid); its width scaled within the band (a size smaller for a bend),
      // so its rise is the beds' scale over its width's.
      for (const shrink of [1, 0.8]) {
        const k = Math.max(band.scale[0], Math.min(band.scale[1], k0 * shrink));
        const rise = S.scale / k;
        if (rise < HEART_ROCK_RISE[0] - 1e-9 || rise > HEART_ROCK_RISE[1] + 1e-9) continue;
        const slope = slopeUnder({ x: px, z: pz, rot }, piece, k);
        if (!Number.isFinite(slope.high) || slope.high <= HEART_MOUNTAIN_CHASM) return null;
        // The foot: sunk into the slope under the front (the first band
        // falls deep into the chasm under its floor), then down to a bed
        // line of the world's grid.
        const raw =
          index === 0
            ? Math.min(slope.front, c.floor) - HEART_ROCK_FIRST_DROP
            : Math.max(HEART_MOUNTAIN_CHASM, slope.front) - HEART_ROCK_SINK;
        const foot = heartRockBedFloor(raw);
        const tall = piece.height * S.scale;
        const q = { x: px, z: pz, rot, scale: k };
        // Its crest reaches past the slope over the front half of its body
        // (the band behind covers the rest); where the mountain climbs past
        // it, a second face stands on its upper beds a step back (the cliff
        // in two great storeys, its beds on the same grid), never a piece
        // stretched past its beds.
        const need = slope.near + HEART_ROCK_OVERLAP;
        let upper: HeartKitPlacement | null = null;
        if (foot + tall < need) {
          const name2 =
            HEART_ROCK_STACK[Math.floor(heartHash(Math.round(px), Math.round(pz) + 3) * 3) % 3];
          const piece2 = HEART_ROCK_PIECES[name2];
          const foot2 = heartRockBedFloor(foot + tall - 2 * S.lift);
          if (foot2 + piece2.height * S.scale < need) continue;
          const back = HEART_ROCK_STACK_BACK * k;
          const q2 = { x: px - Math.sin(rot) * back, z: pz - Math.cos(rot) * back, rot, scale: k };
          if (!Number.isFinite(clearOf(q2.x, q2.z).back)) continue;
          if (heartOpenAir(q2.x, q2.z, piece2.reach * k)) continue;
          if (backOverFloor(q2, piece2, foot2, piece2.height * S.scale)) continue;
          if (
            heartRockFrontPoints(q2, piece2).some((f) => clearOf(f.x, f.z).back < band.back - slack)
          )
            continue;
          upper = {
            piece: index >= HEART_ROCK_FAR_FROM ? `${name2}Far` : name2,
            x: q2.x,
            y: foot2,
            z: q2.z,
            rot,
            scale: k,
            rise,
            noShadow: true,
            cosmetic: band.cosmetic,
          };
        }
        if (heartRockFrontPoints(q, piece).some((f) => clearOf(f.x, f.z).back < band.back - slack))
          continue;
        if (heartOpenAir(px, pz, piece.reach * k)) continue;
        // Its back never reaches over a walk behind it (a floor higher up
        // the mountain under its crest).
        if (backOverFloor(q, piece, foot, piece.height * S.scale)) continue;
        const placed: HeartKitPlacement = {
          piece: index >= HEART_ROCK_FAR_FROM ? `${name}Far` : name,
          x: px,
          y: foot,
          z: pz,
          rot,
          scale: k,
          rise,
          noShadow: true,
          cosmetic: band.cosmetic,
        };
        return upper ? [placed, upper] : [placed];
      }
    }
    return null;
  };
  // The filling pass: the narrower faces first, the buttress only last
  // (its detail belongs where the eye goes, never everywhere a bend is).
  const narrow = [...new Set(band.fallback)]
    .filter((n) => n !== 'Kit_RockProw')
    .sort((a, b) => HEART_ROCK_PIECES[a].half - HEART_ROCK_PIECES[b].half);
  if (band.fallback.includes('Kit_RockProw')) narrow.push('Kit_RockProw');
  for (const pass of [0, 1]) {
    const taken: { x: number; z: number }[] = out.map((p) => ({ x: p.x, z: p.z }));
    // The band's spacing at its smallest scale (a slot is a slot); the
    // filling pass packs closer.
    const gap = band.spacing * band.scale[0] * (pass === 0 ? 1 : 0.32);
    for (const c of candidates) {
      // Pulled onto the contour, away from the floor (its front then sits
      // exactly `band.back` past the clearance).
      const px = c.x - c.toX * (band.back - c.back);
      const pz = c.z - c.toZ * (band.back - c.back);
      if (taken.some((t) => Math.hypot(t.x - px, t.z - pz) < gap)) continue;
      // The filling pass only where the mountain behind is still bare.
      const rot0 = contourFacing(px, pz);
      if (pass === 1 && covered(out, px - Math.sin(rot0) * 3, pz - Math.cos(rot0) * 3)) continue;
      const h1 = heartHash(Math.round(px * 7) + index * 9973, Math.round(pz * 7));
      const h2 = heartHash(Math.round(pz * 5) - index * 31, Math.round(px * 5) + 17);
      // Square to the contour (the clearance's slope, read across a few
      // yards: the nearest floor cell's bearing is too grainy for a piece
      // twenty yards wide), turned a little either way.
      const rot = rot0 + (h1 - 0.5) * 0.2;
      const near =
        index <= 1 &&
        heartRockFocus().some((f) => Math.hypot(f.x - px, f.z - pz) < HEART_ROCK_FOCUS_R);
      const first = near
        ? 'Kit_RockProw'
        : band.pieces[Math.floor(h1 * band.pieces.length) % band.pieces.length];
      const order = pass === 0 ? [first, ...band.fallback.filter((n) => n !== first)] : narrow;
      const k0 = band.scale[0] + (band.scale[1] - band.scale[0]) * h2 * 0.4;
      const placed = tryPiece(c, order, px, pz, rot, k0);
      if (!placed) continue;
      taken.push({ x: px, z: pz });
      out.push(...placed);
    }
  }
  return out;
}

// ---- the walks' sides --------------------------------------------------------------

/** A lip module's half length (yards at stretch 1), its drop, how far its
 *  body runs back under the walk and how far its face leans out over the
 *  void per yard of drop (pinned against the GLB). */
export const HEART_ROCK_LIP = {
  half: 6,
  drop: 40,
  depth: 4,
  out: 0.38,
  // Phase 2G: a module every 15 yards (at 10 the chasm's walls read as a
  // fence of narrow stripes).
  segment: 15,
  overlap: 1.6,
  /** How far out past the lip line a module's brink is set: the field's
   *  own face under a lip flares out a fifth of a yard per yard of drop and
   *  jags up to two yards more, and the lip must stand in front of it. */
  push: 1.8,
  /** The steepest slope a lip follows (rise per yard). */
  maxShear: 1,
} as const;

/** Does a lip module hanging from (x, y, z) (along u, leaning out along n,
 *  `half` yards either way) stand through a walked floor? At each yard `w`
 *  out past its brink its rock runs from `w / out` yards under the brink down
 *  to its foot; a floor there between those heights (a body's height above
 *  it included) would be crossed. */
function lipCrossesFloor(
  x: number,
  y: number,
  z: number,
  ux: number,
  uz: number,
  nx: number,
  nz: number,
  half: number,
  shear: number,
): boolean {
  const F = SMITH_HEART_FIELD;
  const reach = HEART_ROCK_LIP.out * HEART_ROCK_LIP.drop + 1;
  for (let i = -4; i <= 4; i++) {
    const a = (i / 4) * half;
    // The brink there (a lip on a stair follows its slope).
    const brink = y + shear * a;
    for (let w = 0.5; w <= reach; w += 1) {
      const px = x + ux * a + nx * w;
      const pz = z + uz * a + nz * w;
      if (!authoredFieldSurfaceAt(F, px, pz)) continue;
      const floor = authoredFieldHeight(F, px, pz);
      const top = brink - w / HEART_ROCK_LIP.out + 0.6;
      const foot = brink - HEART_ROCK_LIP.drop;
      if (floor + 0.02 < top && floor + 2.6 > foot && floor < brink - 0.3) return true;
    }
  }
  return false;
}

/** The cliff runs of every walk falling into the chasm (not the floating
 *  islands', nor the Wind Bridge's and the anvil bridge's, whose arches the
 *  Breath and the Heat kits draw (phases 2G, 2I), nor the hidden
 *  surfaces'), chained end to end per surface. */
function chasmChains(): FieldCliffRun[][] {
  const F = SMITH_HEART_FIELD;
  const floating = new Set([
    ...SMITH_HEART_FLOATING_SURFACES,
    ...BREATH_KIT_SHALLOW,
    ...HEAT_KIT_SHALLOW,
  ]);
  const hidden = new Set(F.surfaces.filter((x) => x.hidden).map((x) => x.id));
  // The runs into the chasm, chained end to end per surface (a disc's
  // outline is many short runs: one chain, cut into modules along it).
  const runs = authoredFieldCliffRuns(F).filter(
    (r) =>
      !floating.has(r.surface) &&
      !hidden.has(r.surface) &&
      r.low <= F.voidHeight + 1 &&
      r.high - r.low >= 8 &&
      Math.hypot(r.bx - r.ax, r.bz - r.az) > 1e-3,
  );
  const chains: FieldCliffRun[][] = [];
  for (const r of runs) {
    const last = chains[chains.length - 1];
    const tail = last?.[last.length - 1];
    if (tail && tail.surface === r.surface && Math.hypot(tail.bx - r.ax, tail.bz - r.az) < 0.05)
      last.push(r);
    else chains.push([r]);
  }
  return chains;
}

/** The rock under every walk's lip where it falls into the chasm (the
 *  field's own faces are flat strata planes): a hanging module per stretch
 *  of each cliff run (about `segment` yards, overlapping its neighbours), its
 *  brink following the walk's own slope (a stair's too) and set under the
 *  lowest of the floor along it, so no stone ever stands proud of the walk;
 *  its face leans out over the void. Not under the floating islands (their
 *  keels are theirs). */
export function planHeartLips(): HeartKitPlacement[] {
  const F = SMITH_HEART_FIELD;
  const stairs = new Set(F.surfaces.filter((x) => x.kind === 'path' && x.stairs).map((x) => x.id));
  const chains = chasmChains();
  const out: HeartKitPlacement[] = [];
  let index = 0;
  for (const chain of chains) {
    const lens = chain.map((r) => Math.hypot(r.bx - r.ax, r.bz - r.az));
    const total = lens.reduce((a, b) => a + b, 0);
    if (total < 1.2) continue;
    // A point of the chain at arc length t, with its run's outward normal.
    const at = (t: number) => {
      let rest = Math.max(0, Math.min(total, t));
      for (let k = 0; k < chain.length; k++) {
        if (rest <= lens[k] || k === chain.length - 1) {
          const r = chain[k];
          const f = Math.min(1, rest / lens[k]);
          return { x: r.ax + (r.bx - r.ax) * f, z: r.az + (r.bz - r.az) * f, nx: r.nx, nz: r.nz };
        }
        rest -= lens[k];
      }
      throw new Error('unreachable');
    };
    // The floor just inside the lip at an arc length.
    const floorAt = (t: number): number => {
      const q = at(t);
      return authoredFieldHeight(F, q.x - q.nx * 0.4, q.z - q.nz * 0.4);
    };
    const surface = chain[0].surface;
    const n = Math.max(1, Math.ceil(total / HEART_ROCK_LIP.segment));
    for (let i = 0; i < n; i++) {
      const s0 = (total * i) / n;
      const s1 = (total * (i + 1)) / n;
      const A = at(s0);
      const B = at(s1);
      const chord = Math.hypot(B.x - A.x, B.z - A.z);
      if (chord < 0.8) continue;
      const ux = (B.x - A.x) / chord;
      const uz = (B.z - A.z) / chord;
      // Outward: square to the chord, on the side the runs face.
      const M = at((s0 + s1) / 2);
      let nx = uz;
      let nz = -ux;
      if (nx * M.nx + nz * M.nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      const ya = floorAt(s0 + 0.2);
      const yb = floorAt(s1 - 0.2);
      const ym = floorAt((s0 + s1) / 2);
      if (Math.min(ya, yb, ym) <= F.voidHeight + 1) continue;
      const shear = chord > 0.9 ? (yb - ya) / Math.max(0.5, chord - 0.4) : 0;
      // A run crossing floors of different heights (a terrace's end) is no
      // walk's side: no slope a stair takes is this steep.
      if (Math.abs(shear) > HEART_ROCK_LIP.maxShear) continue;
      const cx = (A.x + B.x) / 2;
      const cz = (A.z + B.z) / 2;
      // The chord's middle sits inside a bending lip: set it out onto the lip.
      const bow = (M.x - cx) * nx + (M.z - cz) * nz;
      const ox = cx + nx * (Math.max(0, bow) + HEART_ROCK_LIP.push);
      const oz = cz + nz * (Math.max(0, bow) + HEART_ROCK_LIP.push);
      const stretch = (chord + HEART_ROCK_LIP.overlap) / (HEART_ROCK_LIP.half * 2);
      const reachX = (HEART_ROCK_LIP.half + 2.6) * stretch;
      // The brink under the lowest of the floor over its whole body (its
      // ends reach past the chord; a stair's treads step under its slope).
      let over = 0;
      for (let k = -6; k <= 6; k++) {
        const a = (k / 6) * reachX;
        for (let w = -HEART_ROCK_LIP.depth; w <= -0.5; w += 0.5) {
          const px = ox + ux * a + nx * w;
          const pz = oz + uz * a + nz * w;
          if (!authoredFieldSurfaceAt(F, px, pz)) continue;
          over = Math.max(over, ym + shear * a - authoredFieldHeight(F, px, pz) + 0.05);
        }
      }
      // Under the Ring kit's carved fascias and stringers (phase 2F) the
      // rock starts below them.
      const y =
        ym -
        over -
        (stairs.has(surface) ? 0.3 : 0) -
        (RING_KIT_FASCIA_SURFACES.has(surface) ? RING_KIT_FASCIA_DEPTH : 0);
      // Not where another floor lies under its leaning face (a stair's foot
      // beside the arena it enters, a bridge's end): the rock would stand
      // through that floor.
      if (lipCrossesFloor(ox, y, oz, ux, uz, nx, nz, reachX, shear)) continue;
      out.push({
        piece: index++ % 2 ? 'Kit_RockLipB' : 'Kit_RockLipA',
        x: ox,
        y,
        z: oz,
        rot: Math.atan2(nx, nz),
        stretch,
        shear: Math.abs(shear) < 1e-6 ? 0 : shear,
        noShadow: true,
        cosmetic: false,
      });
    }
  }
  return out;
}

// ---- the walls under the high walks -------------------------------------------------

/** The great faces under the walks that stand high over the chasm (phase
 *  2G): under the lips (`planHeartLips`, forty yards) the field's own face
 *  fell flat to the mist, and from the Ring and the Balcony the Cornice and
 *  the Breath's landings stood on a smooth plinth a hundred yards tall. A
 *  wall piece per stretch of each such walk's side (`segment` yards),
 *  facing out over the void `out` yards past the lip line, its crest at
 *  least `below` under the walk, drawn on the beds' grid like the bands. */
export const HEART_ROCK_UNDER = { segment: 34, out: 12, below: 30, minDrop: 60 } as const;

let under: HeartKitPlacement[] | null = null;

export function planHeartUnderCliffs(): HeartKitPlacement[] {
  if (under) return under;
  const F = SMITH_HEART_FIELD;
  const S = HEART_ROCK_STRATA;
  const U = HEART_ROCK_UNDER;
  const out: HeartKitPlacement[] = [];
  for (const chain of chasmChains()) {
    const lens = chain.map((r) => Math.hypot(r.bx - r.ax, r.bz - r.az));
    const total = lens.reduce((a, b) => a + b, 0);
    if (total < 10) continue;
    const at = (t: number) => {
      let rest = Math.max(0, Math.min(total, t));
      for (let k = 0; k < chain.length; k++) {
        if (rest <= lens[k] || k === chain.length - 1) {
          const r = chain[k];
          const f = Math.min(1, rest / lens[k]);
          return { x: r.ax + (r.bx - r.ax) * f, z: r.az + (r.bz - r.az) * f, nx: r.nx, nz: r.nz };
        }
        rest -= lens[k];
      }
      throw new Error('unreachable');
    };
    const n = Math.max(1, Math.round(total / U.segment));
    for (let i = 0; i < n; i++) {
      const s0 = (total * i) / n;
      const s1 = (total * (i + 1)) / n;
      const A = at(s0);
      const B = at(s1);
      const M = at((s0 + s1) / 2);
      const chord = Math.hypot(B.x - A.x, B.z - A.z);
      if (chord < 6) continue;
      // The walk's lowest floor along the stretch.
      let floor = Number.POSITIVE_INFINITY;
      for (let k = 0; k <= 6; k++) {
        const q = at(s0 + ((s1 - s0) * k) / 6);
        floor = Math.min(floor, authoredFieldHeight(F, q.x - q.nx * 0.5, q.z - q.nz * 0.5));
      }
      if (floor - F.voidHeight < U.minDrop) continue;
      const ux = (B.x - A.x) / chord;
      const uz = (B.z - A.z) / chord;
      let nx = uz;
      let nz = -ux;
      if (nx * M.nx + nz * M.nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      const cx = (A.x + B.x) / 2 + nx * U.out;
      const cz = (A.z + B.z) / 2 + nz * U.out;
      if (heartOpenAir(cx, cz, 4)) continue;
      const h = heartHash(Math.round(cx * 3), Math.round(cz * 3) + 57);
      const name = h < 0.5 ? 'Kit_RockWallC' : 'Kit_RockWallA';
      const piece = HEART_ROCK_PIECES[name];
      const k = Math.max(0.85, Math.min(1.5, (chord * 1.05) / (piece.half * 2)));
      const tall = piece.height * S.scale;
      const foot = heartRockBedFloor(floor - U.below - tall);
      const q = { x: cx, z: cz, rot: Math.atan2(nx, nz), scale: k };
      // Never over another walk (a lower landing beside it).
      if (backOverFloor(q, piece, foot, tall)) continue;
      out.push({
        piece: name,
        x: cx,
        y: foot,
        z: cz,
        rot: q.rot,
        scale: k,
        rise: S.scale / k,
        noShadow: true,
        cosmetic: false,
      });
    }
  }
  under = out;
  return out;
}

// ---- the crest's needles ------------------------------------------------------------

/** A needle's measures (yards at scale 1, pinned against the GLB): its foot's
 *  half width and its height. */
export const HEART_ROCK_NEEDLES: Readonly<Record<string, { half: number; height: number }>> = {
  Kit_RockNeedleA: { half: 12.5, height: 68.6 },
  Kit_RockNeedleB: { half: 15, height: 57.5 },
};

/** Where the crest's needles may stand: round the Ring (yards from its
 *  centre), deep in the mountain (at least `back` past the clearance), at
 *  least `spacing` apart, at most `count` of them. */
export const HEART_NEEDLE_RULES = { from: 105, to: 225, back: 30, spacing: 58, count: 9 } as const;

let needles: HeartKitPlacement[] | null = null;

/** The needles on the mountain's crest round the Ring (phase 2F: the
 *  skyline's landmarks): the points deepest in the mountain, spaced round
 *  it, each sunk into the slope under it and standing tall over the bands. */
export function planHeartNeedles(): HeartKitPlacement[] {
  if (needles) return needles;
  const R = HEART_NEEDLE_RULES;
  const cands: { x: number; z: number; back: number }[] = [];
  for (let z = -R.to; z <= R.to; z += 6) {
    for (let x = -R.to; x <= R.to; x += 6) {
      const r = Math.hypot(x, z);
      if (r < R.from || r > R.to) continue;
      const c = clearOf(x, z);
      if (!Number.isFinite(c.back) || c.back < R.back) continue;
      if (heartOpenAir(x, z, 16)) continue;
      cands.push({ x, z, back: c.back });
    }
  }
  cands.sort((a, b) => b.back - a.back || a.x - b.x || a.z - b.z);
  const out: HeartKitPlacement[] = [];
  for (const c of cands) {
    if (out.length >= R.count) break;
    if (out.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < R.spacing)) continue;
    const h = heartHash(Math.round(c.x), Math.round(c.z) + 91);
    const piece = out.length % 2 ? 'Kit_RockNeedleB' : 'Kit_RockNeedleA';
    const g = heartMountainGrid(HEART_ROCK_GRID);
    const ground = heartMountainSample(g, c.x, c.z).mid;
    out.push({
      piece,
      x: c.x,
      y: ground - 6,
      z: c.z,
      rot: h * Math.PI * 2,
      scale: 1.0 + h * 0.45,
      noShadow: true,
      cosmetic: false,
    });
  }
  needles = out;
  return out;
}

let cached: HeartKitPlacement[] | null = null;

/** Every rock piece of the mountain, band by band (built once: the layout
 *  is static). */
export function planHeartRock(): HeartKitPlacement[] {
  if (!cached) {
    const candidates = bandCandidates();
    cached = HEART_ROCK_BANDS.flatMap((band, i) => planBand(band, i, candidates[i]));
  }
  return cached;
}
