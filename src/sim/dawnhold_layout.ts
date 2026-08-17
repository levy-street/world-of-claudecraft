// Dawnhold Castle: the Evergarden's garden keep, rebuilt from the old
// decor shell into real grounds the player can walk (the Last Keep idiom
// at a smaller, gentler scale). One authored plan drives every consumer:
// the graded pad (world.ts applyDawnholdPad), the walkable lift field
// (dawnholdLift, added into groundHeight beside castleLift), the garden
// scatter clearance, the bailey buildings (content decorProps), and the
// render assembly (render/dawnhold_features.ts). The curtain walls are
// TERRAIN (sheer risers the climb gate refuses, flat tops as the walk);
// gates are module-aligned gaps whose lift spans sit INSIDE the rendered
// arch openings; the walk leaves a mouth open over every gate. Unlike the
// Last Keep there is no terraced ward: one paved garrison bailey with the
// keep composed against its hall wing on the north side. The flowers live
// in the walled flower court off the south wall (the garden postern opens
// into it), five planted fields around a leafy fox statue.
// Pure leaf: deterministic, no rng, no SimContext.

export const DAWNHOLD = {
  // the graded grounds (the skirt blends into the garden hills and yields
  // to the coast lobes west of the walls; the south reach carries the
  // walled flower court)
  pad: { x0: 232, x1: 300, z0: 854, z1: 944, h: 3.2 },
  // the curtain wall square: wall centerlines
  wx0: 240,
  wx1: 292,
  wz0: 864,
  wz1: 922,
  /** wall module length (KayKit wall is 4 units at scale 1.75) */
  module: 7,
  /** wall thickness (walkable strip; both faces skinned with modules) */
  wallTh: 3.0,
  /** the wall-walk's ABSOLUTE height */
  walkAbs: 9.7,
  /** the tall northeast watchtower's ABSOLUTE platform height */
  watchAbs: 14.2,
  /** corner tower half-width */
  towerHw: 3.0,
} as const;

// The ways in. Spans are in the wall's run coordinate; every span is the
// visual opening of the doorway module that renders there.
export const DAWNHOLD_GATES = {
  /** the main gate: east wall, facing the Hedgewick road (which runs down
   *  the OUTSIDE of this curtain and ends at 294,887, square on the arch);
   *  the doorway module at scale 1.75 opens 3.4yd */
  main: { a0: 885.3, a1: 888.7 },
  /** the garden postern: a narrow south door out of the bailey and straight
   *  into the flower court (centered on the south wall's module at 281.5) */
  postern: { a0: 280.2, a1: 282.8 },
} as const;

// The walled flower court off the castle's south wall: the curtain closes
// its north side, three lower garden walls (sheer both faces, no walk)
// close the rest, and a south doorway opens onto the parterre lawn. Inside:
// five round flower fields around the leafy fox statue.
// The x span is three wall modules wide so the court's own centre (274.5)
// lands on a module CENTRE: the south doorway renders as a real arch there
// and the statue stands on that axis. The west wall stops at x 264, clear
// of the maze forecourt bed group whose pad pulls the ground down west of
// there (the court floor stays dead flat on the castle pad).
export const DAWNHOLD_COURT = {
  /** garden wall centerlines (north side is the castle wall itself) */
  x0: 264,
  x1: 285,
  z1: 940,
  /** garden wall thickness */
  th: 1.6,
  /** the garden walls' ABSOLUTE top height */
  hAbs: 6.4,
} as const;

/** the court's south doorway span (x), on its wall's own module centre */
export const DAWNHOLD_COURT_GATE = { a0: 273.2, a1: 275.8 } as const;

/** the leafy fox statue, on the court's centre and its doorway axis */
export const DAWNHOLD_COURT_STATUE = { x: 274.5, z: 931 } as const;

export interface DawnholdTower {
  x: number;
  z: number;
  hAbs: number;
  hw: number;
  tall: boolean;
}
export const DAWNHOLD_TOWERS: readonly DawnholdTower[] = [
  { x: DAWNHOLD.wx0, z: DAWNHOLD.wz0, hAbs: DAWNHOLD.walkAbs, hw: DAWNHOLD.towerHw, tall: false },
  // NE: the tall watch, looking over Hedgewick and the road
  { x: DAWNHOLD.wx1, z: DAWNHOLD.wz0, hAbs: DAWNHOLD.watchAbs, hw: DAWNHOLD.towerHw, tall: true },
  { x: DAWNHOLD.wx0, z: DAWNHOLD.wz1, hAbs: DAWNHOLD.walkAbs, hw: DAWNHOLD.towerHw, tall: false },
  { x: DAWNHOLD.wx1, z: DAWNHOLD.wz1, hAbs: DAWNHOLD.walkAbs, hw: DAWNHOLD.towerHw, tall: false },
] as const;

// The one stair flight onto the walk: along the east wall's inner face,
// south of the main gate, landing on the SE bastion (ABS heights; the
// band tucks into the wall strip so no crack opens at the top).
export interface DawnholdRamp {
  axis: 'x' | 'z';
  b0: number;
  b1: number;
  a0: number;
  a1: number;
  h0: number;
  h1: number;
}
export const DAWNHOLD_RAMPS: readonly DawnholdRamp[] = [
  { axis: 'z', b0: 288.7, b1: 291.5, a0: 896, a1: 910, h0: DAWNHOLD.pad.h, h1: DAWNHOLD.walkAbs },
  {
    axis: 'z',
    b0: 288.7,
    b1: 291.5,
    a0: 910,
    a1: 919.6,
    h0: DAWNHOLD.walkAbs,
    h1: DAWNHOLD.walkAbs,
  },
] as const;

// The bailey buildings, all the GREEN colorway. The keep and its hall
// wing compose one palace mass on the north side (door faces +z, south
// into the courtyard); the yard below is a garrison: a tower, a standalone
// barracks, and a catapult tower ring the paved parade ground.
export interface DawnholdBuilding {
  key: string;
  x: number;
  z: number;
  rot: number;
  scale: number;
  r: number;
  h: number;
  keepComplex?: boolean;
}
export const DAWNHOLD_BUILDINGS: readonly DawnholdBuilding[] = [
  { key: 'hexCastle', x: 258, z: 878, rot: 0, scale: 7.5, r: 7.2, h: 28, keepComplex: true },
  {
    key: 'hexBarracks',
    x: 270.5,
    z: 878,
    rot: Math.PI / 2,
    scale: 6.5,
    r: 5.2,
    h: 11,
    keepComplex: true,
  },
  { key: 'hexTower', x: 246.5, z: 906, rot: Math.PI / 2, scale: 8, r: 4, h: 17 },
  { key: 'hexBarracks', x: 283, z: 908.5, rot: -Math.PI / 2, scale: 6.5, r: 5.2, h: 11 },
  { key: 'hexTowerCatapult', x: 268, z: 915, rot: Math.PI, scale: 7, r: 3.8, h: 12 },
] as const;

/**
 * An OUTSIDE way up: corbelled shelves climbing the north curtain to the
 * wall-walk. Tops are ABSOLUTE (the pad is 3.2, the walk 9.7): a 1.3 vault
 * off the pad, two 2.0 ledge climbs, then a 1.2 vault onto the walk.
 */
export interface DawnholdWallLedge {
  x: number;
  z: number;
  hw: number;
  hd: number;
  /** absolute shelf height */
  top: number;
}
// The wall-walk's OUTER parapet, the twin of the Last Keep's (see
// castle_layout castleParapetSegments for why the curtain gives a body no
// standoff at a down edge, and why this is the outer lip only). Gaps at both
// gates, and across the north climbing shelves: fitsOn vetoes a ledge grab
// landing inside anything with a movement top, standable or not, so a parapet
// over their approach would kill the outside climb.
export const DAWNHOLD_PARAPET_INSET = 1.2;
export const DAWNHOLD_PARAPET_HALF = 0.2;
export const DAWNHOLD_PARAPET_RISE = 1.56;

export interface DawnholdParapet {
  axis: 'x' | 'z';
  line: number;
  a0: number;
  a1: number;
  top: number;
}

export function dawnholdParapetSegments(): DawnholdParapet[] {
  const hw = DAWNHOLD.towerHw;
  const top = DAWNHOLD.walkAbs + DAWNHOLD_PARAPET_RISE;
  const ledgeGap = { a0: 251, a1: 267 }; // DAWNHOLD_WALL_LEDGES climb x 255..263
  const out: DawnholdParapet[] = [];
  const add = (
    axis: 'x' | 'z',
    line: number,
    outward: -1 | 1,
    a0: number,
    a1: number,
    gaps: { a0: number; a1: number }[],
  ): void => {
    let spans: [number, number][] = [[a0, a1]];
    for (const g of gaps) {
      const next: [number, number][] = [];
      for (const [s0, s1] of spans) {
        if (g.a1 <= s0 || g.a0 >= s1) {
          next.push([s0, s1]);
          continue;
        }
        if (g.a0 > s0) next.push([s0, g.a0]);
        if (g.a1 < s1) next.push([g.a1, s1]);
      }
      spans = next;
    }
    for (const [s0, s1] of spans) {
      if (s1 - s0 <= 1) continue;
      out.push({ axis, line: line + outward * DAWNHOLD_PARAPET_INSET, a0: s0, a1: s1, top });
    }
  };
  add('z', DAWNHOLD.wx0, -1, DAWNHOLD.wz0 + hw, DAWNHOLD.wz1 - hw, []);
  add('z', DAWNHOLD.wx1, 1, DAWNHOLD.wz0 + hw, DAWNHOLD.wz1 - hw, [DAWNHOLD_GATES.main]);
  add('x', DAWNHOLD.wz0, -1, DAWNHOLD.wx0 + hw, DAWNHOLD.wx1 - hw, [ledgeGap]);
  add('x', DAWNHOLD.wz1, 1, DAWNHOLD.wx0 + hw, DAWNHOLD.wx1 - hw, [DAWNHOLD_GATES.postern]);
  return out;
}

export const DAWNHOLD_WALL_LEDGES: readonly DawnholdWallLedge[] = [
  // inner faces FLUSH on the curtain's outer face (862.5): standing a shelf
  // off the wall leaves a strip of ground behind it too narrow to turn around
  // in, and a corbel grows out of the wall it is cut into anyway
  { x: 255, z: 861.1, hw: 1.5, hd: 1.4, top: 4.5 },
  { x: 259, z: 861.1, hw: 1.4, hd: 1.4, top: 6.55 },
  { x: 263, z: 861.1, hw: 1.4, hd: 1.4, top: 8.6 },
] as const;

export interface DawnholdField {
  x: number;
  z: number;
  /** planted radius */
  r: number;
}

/**
 * The flower court's planted fields, arranged around the leafy fox: two
 * majors flanking it on the cross axis, a crescent under the curtain, and
 * a smaller pair in the south corners. These are procedural FIELDS
 * (garden_parterre_core paints their ground), not modeled parterre beds:
 * they carry no bed model, no collider, and no level pad, because the
 * castle pad already holds this ground dead flat.
 *
 * The two majors keep indices 0 and 1 so their authored colourways do not
 * shift when a field is appended. Packing is pinned by
 * tests/dawnhold_grounds.ts: every field clears the walls, both doorway
 * lanes, and each other.
 */
export const DAWNHOLD_BEDS: readonly DawnholdField[] = [
  { x: 269.1, z: 931, r: 3.4 },
  { x: 279.9, z: 931, r: 3.4 },
  { x: 274.5, z: 926.3, r: 2.4 },
  { x: 267.5, z: 936.7, r: 2.2 },
  { x: 281.5, z: 936.7, r: 2.2 },
] as const;

/**
 * True inside the curtain walls: the paved garrison bailey. The parade
 * ground is flagstone from wall to wall, so no lawn flower, meadow drift,
 * or clipped bush grows there; the castle's flowers live in the court.
 */
export function inDawnholdBailey(x: number, z: number, margin = 0): boolean {
  const t = DAWNHOLD.wallTh / 2 + margin;
  return (
    x > DAWNHOLD.wx0 - t && x < DAWNHOLD.wx1 + t && z > DAWNHOLD.wz0 - t && z < DAWNHOLD.wz1 + t
  );
}

/**
 * True inside the flower court's walled interior. `inset` shrinks the
 * region inward from the wall faces (0 is the exact swept floor).
 */
export function inDawnholdCourt(x: number, z: number, inset = 0): boolean {
  const h = DAWNHOLD_COURT.th / 2;
  return (
    x > DAWNHOLD_COURT.x0 + h + inset &&
    x < DAWNHOLD_COURT.x1 - h - inset &&
    z > DAWNHOLD.wz1 + DAWNHOLD.wallTh / 2 + inset &&
    z < DAWNHOLD_COURT.z1 - h - inset
  );
}

const G = DAWNHOLD_GATES;
const inSpan = (v: number, s: { a0: number; a1: number }): boolean => v >= s.a0 && v <= s.a1;

/** Scatter clearance: no garden specimen scatter on the pad or skirt. */
export function dawnholdClear(x: number, z: number): boolean {
  const p = DAWNHOLD.pad;
  return x < p.x0 - 4 || x > p.x1 + 4 || z < p.z0 - 4 || z > p.z1 + 4;
}

/** The pad's target height (one level; no terrace). */
export function dawnholdPadTarget(): number {
  return DAWNHOLD.pad.h;
}

/** Graded pad weight: level grounds, gentle skirt back to the garden. */
export function dawnholdPadWeight(x: number, z: number): number {
  const p = DAWNHOLD.pad;
  const dx = Math.max(p.x0 - x, 0, x - p.x1);
  const dz = Math.max(p.z0 - z, 0, z - p.z1);
  const d = Math.hypot(dx, dz);
  if (d >= 8) return 0;
  const t = 1 - d / 8;
  return t * t * (3 - 2 * t);
}

const HT = DAWNHOLD.wallTh / 2;

function wallStripAbs(
  along: number,
  across: number,
  wallLine: number,
  gate: { a0: number; a1: number } | null,
): number {
  if (Math.abs(across - wallLine) > HT) return 0;
  if (gate && inSpan(along, gate)) return 0;
  return DAWNHOLD.walkAbs;
}

/**
 * Dawnhold's walkable lift field (single-valued, ABSOLUTE surface heights
 * over the flat pad; added into groundHeight beside the Last Keep's).
 */
export function dawnholdLift(x: number, z: number): number {
  const p = DAWNHOLD.pad;
  if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) return 0;
  let abs = 0;
  if (z >= DAWNHOLD.wz0 - HT && z <= DAWNHOLD.wz1 + HT) {
    abs = Math.max(
      abs,
      wallStripAbs(z, x, DAWNHOLD.wx0, null), // west (solid)
      wallStripAbs(z, x, DAWNHOLD.wx1, G.main), // east, the main gate
    );
  }
  if (x >= DAWNHOLD.wx0 - HT && x <= DAWNHOLD.wx1 + HT) {
    abs = Math.max(
      abs,
      wallStripAbs(x, z, DAWNHOLD.wz0, null), // north (solid)
      wallStripAbs(x, z, DAWNHOLD.wz1, G.postern), // south, the garden door
    );
  }
  // the flower court's garden walls: the castle's south wall closes the
  // court's north side, so only the east/west runs and the gated south
  // wall are raised here (sheer both faces; too tall to step, no walk)
  const C = DAWNHOLD_COURT;
  const CHT = C.th / 2;
  if (z >= DAWNHOLD.wz1 && z <= C.z1 + CHT) {
    if (Math.abs(x - C.x0) <= CHT || Math.abs(x - C.x1) <= CHT) {
      abs = Math.max(abs, C.hAbs);
    }
  }
  if (Math.abs(z - C.z1) <= CHT && x >= C.x0 - CHT && x <= C.x1 + CHT) {
    if (!inSpan(x, DAWNHOLD_COURT_GATE)) abs = Math.max(abs, C.hAbs);
  }
  for (const t of DAWNHOLD_TOWERS) {
    if (Math.abs(x - t.x) <= t.hw && Math.abs(z - t.z) <= t.hw) {
      abs = Math.max(abs, t.hAbs);
    }
  }
  for (const rmp of DAWNHOLD_RAMPS) {
    const along = rmp.axis === 'z' ? z : x;
    const across = rmp.axis === 'z' ? x : z;
    if (across < rmp.b0 || across > rmp.b1) continue;
    const lo = Math.min(rmp.a0, rmp.a1);
    const hi = Math.max(rmp.a0, rmp.a1);
    if (along < lo || along > hi) continue;
    const t = (along - rmp.a0) / (rmp.a1 - rmp.a0);
    abs = Math.max(abs, rmp.h0 + (rmp.h1 - rmp.h0) * t);
  }
  if (abs <= 0) return 0;
  return Math.max(0, abs - DAWNHOLD.pad.h);
}
