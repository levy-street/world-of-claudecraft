// The Ashen Bulwark: the Drakelands' walled barracks on the west headland,
// authored on the same plan idiom as the Last Keep and Dawnhold. One leaf
// drives every consumer: the graded pad (world.ts applyBulwarkPad), the
// walkable lift field (bulwarkLift, added into groundHeight beside
// castleLift), the scatter clearance, the yard buildings (content
// decorProps), and the render assembly (render/bulwark_features.ts).
//
// The curtain walls are TERRAIN (sheer risers the climb gate refuses, flat
// tops as the walk); gates are module-aligned gaps whose lift spans sit
// INSIDE the rendered arch openings, and the walk leaves a mouth open over
// every gate.
//
// SITE. The ground here is a headland, not open coast: sea west of x 192
// behind a ridge cresting at x 200, a bay across z 2280 to 2302, a lagoon
// arm reaching south to z 2348 across x 256 to 286, and a flooded trough at
// z 2364. The only fully dry shelf is x 204 to 252 by z 2304 to 2362, and
// the one walk-in approach is the dry isthmus running east at z 2350 to
// 2358. The compound therefore sits on that shelf with its muster gate
// facing the isthmus.
//
// Pure leaf: deterministic, no rng, no SimContext.

export const BULWARK = {
  /** the graded shelf (natural -2.55 to 3.46 here, so 1.6 cuts 1.86 at
   *  worst and fills 4.15, and leaves 6.10 of freeboard over the water) */
  pad: { x0: 208, x1: 252, z0: 2306, z1: 2356, h: 1.6 },
  /** curtain wall centrelines */
  wx0: 216,
  wx1: 244,
  wz0: 2314,
  wz1: 2349,
  /** wall module length (the KayKit wall is 4 units at scale 1.75) */
  module: 7,
  /** wall thickness (walkable strip; both faces skinned with modules) */
  wallTh: 3.0,
  /** the wall-walk's ABSOLUTE height: the pad plus exactly one module, the
   *  same relation the Last Keep uses (6 + 7 = 13) */
  walkAbs: 8.6,
  /** the tall northwest Sea Watch's ABSOLUTE platform height */
  watchAbs: 15.6,
  /** corner tower half-width: half a module, so a tower square is exactly
   *  one module and every wall run divides with zero slack */
  towerHw: 3.5,
} as const;

// The ways in. Spans are in the wall's run coordinate, and every span is
// the visual opening of the doorway module that renders there.
export const BULWARK_GATES = {
  /** the muster gate: east wall, facing the isthmus approach */
  muster: { a0: 2340.3, a1: 2343.7 },
  /** the sea postern: a narrow west door under the Sea Watch, opening on
   *  the ridge and the ocean beyond it */
  postern: { a0: 2319.7, a1: 2322.3 },
} as const;

export interface BulwarkTower {
  x: number;
  z: number;
  hAbs: number;
  hw: number;
  tall: boolean;
}
export const BULWARK_TOWERS: readonly BulwarkTower[] = [
  // NW: the Sea Watch, looking down the coastal ridge
  { x: BULWARK.wx0, z: BULWARK.wz0, hAbs: BULWARK.watchAbs, hw: BULWARK.towerHw, tall: true },
  { x: BULWARK.wx1, z: BULWARK.wz0, hAbs: BULWARK.walkAbs, hw: BULWARK.towerHw, tall: false },
  { x: BULWARK.wx0, z: BULWARK.wz1, hAbs: BULWARK.walkAbs, hw: BULWARK.towerHw, tall: false },
  { x: BULWARK.wx1, z: BULWARK.wz1, hAbs: BULWARK.walkAbs, hw: BULWARK.towerHw, tall: false },
] as const;

// Two flights, not one, so the whole circuit is reachable rather than a
// single quadrant. Each band tucks INTO its wall strip at the top so no
// crack opens where the ramp meets the walk.
export interface BulwarkRamp {
  axis: 'x' | 'z';
  b0: number;
  b1: number;
  a0: number;
  a1: number;
  h0: number;
  h1: number;
}
export const BULWARK_RAMPS: readonly BulwarkRamp[] = [
  // the west flight, climbing south to the SW bastion
  { axis: 'z', b0: 216.5, b1: 219.3, a0: 2331, a1: 2345, h0: BULWARK.pad.h, h1: BULWARK.walkAbs },
  {
    axis: 'z',
    b0: 216.5,
    b1: 219.3,
    a0: 2345,
    a1: 2348,
    h0: BULWARK.walkAbs,
    h1: BULWARK.walkAbs,
  },
  // the east flight, climbing north to the NE bastion
  { axis: 'z', b0: 240.7, b1: 243.5, a0: 2332, a1: 2318, h0: BULWARK.pad.h, h1: BULWARK.walkAbs },
  {
    axis: 'z',
    b0: 240.7,
    b1: 243.5,
    a0: 2318,
    a1: 2316,
    h0: BULWARK.walkAbs,
    h1: BULWARK.walkAbs,
  },
  // the watch flight: the north walk itself climbing to the Sea Watch
  {
    axis: 'x',
    b0: 2312.5,
    b1: 2315.5,
    a0: 230,
    a1: 219.5,
    h0: BULWARK.walkAbs,
    h1: BULWARK.watchAbs,
  },
] as const;

// The yard buildings, all the Drakelands RED colourway (hexr*), appended to
// DRAKELANDS_PROPS.decorProps. The muster hall stands on the yard axis with
// its door facing +z; the two barrack halls flank the drill floor.
export interface BulwarkBuilding {
  key: string;
  x: number;
  z: number;
  rot: number;
  scale: number;
  r: number;
  h: number;
}
// Scales are sized off the MEASURED unit meshes (hexr_castle 1.975 by 2.256,
// hexr_barracks 1.440 by 1.566) against the 25 by 32 yard, so no mass
// punches a curtain, a flight band, or the muster lane in from the gate.
export const BULWARK_BUILDINGS: readonly BulwarkBuilding[] = [
  { key: 'hexrCastle', x: 230, z: 2323, rot: 0, scale: 5.8, r: 6.0, h: 26 },
  { key: 'hexrBarracks', x: 224.5, z: 2335, rot: Math.PI / 2, scale: 6.3, r: 4.6, h: 11 },
  { key: 'hexrBarracks', x: 235.5, z: 2335, rot: -Math.PI / 2, scale: 6.3, r: 4.6, h: 11 },
] as const;

/** measured unit footprints of the yard's models (x by z, at scale 1) */
export const BULWARK_BUILDING_UNIT: Record<string, { w: number; d: number }> = {
  hexrCastle: { w: 1.975, d: 2.256 },
  hexrBarracks: { w: 1.44, d: 1.566 },
};

const G = BULWARK_GATES;
const inSpan = (v: number, s: { a0: number; a1: number }): boolean => v >= s.a0 && v <= s.a1;

/** Scatter clearance: no wild scatter on the pad or its skirt. */
export function bulwarkClear(x: number, z: number): boolean {
  const p = BULWARK.pad;
  return x < p.x0 - 4 || x > p.x1 + 4 || z < p.z0 - 4 || z > p.z1 + 4;
}

/** The pad's target height (one level; no terrace). */
export function bulwarkPadTarget(): number {
  return BULWARK.pad.h;
}

/** Graded pad weight: level grounds, gentle skirt back to the headland. */
export function bulwarkPadWeight(x: number, z: number): number {
  const p = BULWARK.pad;
  const dx = Math.max(p.x0 - x, 0, x - p.x1);
  const dz = Math.max(p.z0 - z, 0, z - p.z1);
  const d = Math.hypot(dx, dz);
  if (d >= 9) return 0;
  const t = 1 - d / 9;
  return t * t * (3 - 2 * t);
}

/** True inside the curtain walls: the paved drill yard. */
export function inBulwarkYard(x: number, z: number, margin = 0): boolean {
  const t = BULWARK.wallTh / 2 + margin;
  return x > BULWARK.wx0 - t && x < BULWARK.wx1 + t && z > BULWARK.wz0 - t && z < BULWARK.wz1 + t;
}

const HT = BULWARK.wallTh / 2;

function wallStripAbs(
  along: number,
  across: number,
  wallLine: number,
  gate: { a0: number; a1: number } | null,
): number {
  if (Math.abs(across - wallLine) > HT) return 0;
  if (gate && inSpan(along, gate)) return 0;
  return BULWARK.walkAbs;
}

/**
 * The Bulwark's walkable lift field (single-valued, ABSOLUTE surface
 * heights over the flat pad; added into groundHeight beside castleLift).
 */
export function bulwarkLift(x: number, z: number): number {
  const p = BULWARK.pad;
  if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) return 0;
  let abs = 0;
  if (z >= BULWARK.wz0 - HT && z <= BULWARK.wz1 + HT) {
    abs = Math.max(
      abs,
      wallStripAbs(z, x, BULWARK.wx0, G.postern), // west, the sea postern
      wallStripAbs(z, x, BULWARK.wx1, G.muster), // east, the muster gate
    );
  }
  if (x >= BULWARK.wx0 - HT && x <= BULWARK.wx1 + HT) {
    abs = Math.max(
      abs,
      wallStripAbs(x, z, BULWARK.wz0, null), // north (solid)
      wallStripAbs(x, z, BULWARK.wz1, null), // south (solid)
    );
  }
  for (const t of BULWARK_TOWERS) {
    if (Math.abs(x - t.x) <= t.hw && Math.abs(z - t.z) <= t.hw) abs = Math.max(abs, t.hAbs);
  }
  for (const rmp of BULWARK_RAMPS) {
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
  return Math.max(0, abs - BULWARK.pad.h);
}
