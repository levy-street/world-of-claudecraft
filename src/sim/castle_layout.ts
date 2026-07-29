// The Last Keep: the Drakelands' standing castle on the midlands plateau,
// rebuilt from the ruin ring that used to mark it. One authored plan drives
// every consumer: the terraced terrain pads (world.ts applyCastlePad), the
// walkable lift field (castleLift, added into groundHeight the beacon and
// sowfield way), the scatter clearances, the bailey buildings (content
// decorProps), and the render assembly (render/castle_features.ts draws
// wall modules, floors, stairs, towers, and parapets from these same
// lines, so the wall you see is the wall you climb). The curtain walls are
// TERRAIN, not colliders (the garden maze hedge idiom): a sheer riser the
// climb gate refuses from the ground, with its flat top the wall-walk.
// Gates are gaps in the riser aligned to the wall's module grid; the walk
// leaves a mouth open over every gate (the beacon rule: no walkable
// surface may stand over another). The grounds are TERRACED: the outer
// bailey sits at padH and the inner ward, the keep's raised terrace,
// 2.6 above it behind a retaining edge with two stair cuts. Pure leaf:
// deterministic, no rng, no SimContext.
import type { BlockerDef } from './types';

export const CASTLE = {
  // the graded grounds (terrain levels to the local pad target; the skirt
  // blends out to the waste; the west reach carries the barbican forecourt)
  pad: { x0: 334, x1: 452, z0: 1980, z1: 2085, h: 6 },
  // the inner ward: the keep's raised terrace
  ward: { x0: 398, x1: 433.4, z0: 1991.4, z1: 2018, h: 8.6 },
  // the curtain wall square: wall centerlines
  wx0: 360,
  wx1: 436.8,
  wz0: 1988,
  wz1: 2071.8,
  /** wall module length (KayKit wall is 4 units at scale 1.75) */
  module: 7,
  /** wall thickness: the lift plateau strip (the walkable wall-walk width) */
  wallTh: 2.4,
  /** the wall-walk's ABSOLUTE height (walls stand on the bailey pad) */
  walkAbs: 13,
  /** the tall southeast watchtower chamber's ABSOLUTE floor height */
  watchAbs: 20,
  /** corner tower half-width (square bastions, walkable tops) */
  towerHw: 3.4,
  /** mid-wall tower half-width */
  midTowerHw: 2.8,
} as const;

/** The ward's retaining edge blend: how far inside the ward rect the terrace
 *  reaches full height. Sheer enough for the climb gate to refuse it, but not
 *  a numeric wall. Anything that must MEET the edge (the alley flight's mass)
 *  has to reach the far side of this band or it leaves a crack. */
export const WARD_EDGE_BLEND = 0.7;

// The three ways in. Every opening is a gap in the wall riser; spans are in
// the wall's run coordinate (z for the west/east walls, x for north/south).
// Gate spans are aligned to the wall's module grid (modules anchor at each
// corner bastion's edge), so every gate is EXACTLY one module: the arch
// piece the render places is the opening the lift field leaves.
export const CASTLE_GATES = {
  /** the main gatehouse: west wall, facing the Wyrmwatch road. The span is
   *  the DOORWAY module's own visual opening (its solid flanks stay wall),
   *  so the lift never lets a walker pass through rendered stone */
  main: { a0: 2028.2, a1: 2031.6 },
  /** the rear postern: a narrow servant door (the doorway module's own
   *  opening; the module's solid flanks stay wall) */
  postern: { a0: 407.6, a1: 410.2 },
  /** the east breach: the wall the drakes brought down, a rubble climb */
  breach: { a0: 2047.4, a1: 2054.4 },
  /** the barbican's outer gate, aligned with the main gate on the road line
   *  (the outer doorway renders at wall scale 1, so its opening is narrower) */
  outer: { a0: 2028.9, a1: 2030.9 },
} as const;

// The barbican: a low-walled forecourt in front of the main gate, its own
// outer gate on the road line. The walls are lift plateaus like the curtain
// (sheer 4yd risers, no walk on top), with two round-out turrets at the
// outer corners (listed in CASTLE_TOWERS).
export const BARBICAN = {
  /** outer wall centerline */
  x: 342,
  z0: 2016,
  z1: 2044,
  /** ABSOLUTE wall-top height (a lower outer work than the curtain) */
  hAbs: 10,
  /** wall thickness */
  th: 1.8,
} as const;

// The walled garden annex: the sheltered strip between the far wall and the
// pad's south edge, behind low walls with two garden doorways. Entered from
// outside (the west road side and the breach side); the far wall-walk looks
// down into it.
export const GARDEN = {
  x0: 362,
  x1: 435,
  /** south garden wall centerline */
  wallZ: 2083,
  /** ABSOLUTE garden wall top */
  hAbs: 9,
  th: 1.6,
  /** the two doorway gaps in the south wall (x spans) */
  gates: [{ a0: 365, a1: 368.5 }],
} as const;

// Towers: four corner bastions (the SE is the tall watch) plus three
// mid-wall bastions on the long runs, all with walkable tops.
export interface CastleTower {
  x: number;
  z: number;
  /** ABSOLUTE platform height */
  hAbs: number;
  hw: number;
  tall: boolean;
}
export const CASTLE_TOWERS: readonly CastleTower[] = [
  // NW: the second tall tower, a windowed drum for skyline balance with the
  // SE watch (no stair reaches its cap; it is the garrison's sealed silo)
  { x: CASTLE.wx0, z: CASTLE.wz0, hAbs: 17, hw: CASTLE.towerHw, tall: true },
  { x: CASTLE.wx1, z: CASTLE.wz0, hAbs: CASTLE.walkAbs, hw: CASTLE.towerHw, tall: false }, // NE
  { x: CASTLE.wx0, z: CASTLE.wz1, hAbs: CASTLE.walkAbs, hw: CASTLE.towerHw, tall: false }, // SW
  { x: CASTLE.wx1, z: CASTLE.wz1, hAbs: CASTLE.watchAbs, hw: CASTLE.towerHw, tall: true }, // SE watch
  // mid-wall bastions (module-boundary aligned)
  { x: CASTLE.wx0, z: 2012.4, hAbs: CASTLE.walkAbs, hw: CASTLE.midTowerHw, tall: false }, // west
  { x: CASTLE.wx1, z: 2033.4, hAbs: CASTLE.walkAbs, hw: CASTLE.midTowerHw, tall: false }, // east
  { x: 398.4, z: CASTLE.wz1, hAbs: CASTLE.walkAbs, hw: CASTLE.midTowerHw, tall: false }, // south
  // barbican round-out turrets at the forecourt's outer corners
  { x: BARBICAN.x, z: BARBICAN.z0, hAbs: 11, hw: 1.6, tall: false },
  { x: BARBICAN.x, z: BARBICAN.z1, hAbs: 11, hw: 1.6, tall: false },
] as const;

// Stairs onto the walls: solid stone ramp masses (the sowfield grandstand
// idiom: the ramp IS the ground where it stands). Heights are ABSOLUTE.
// Every band OVERLAPS its landing strip (no crack: a sliver of low ground
// between ramp and wall reads as a sheer drop and strands the walk).
export interface CastleRamp {
  /** 'x' ramps run along x at fixed z band; 'z' ramps along z at fixed x */
  axis: 'x' | 'z';
  b0: number;
  b1: number;
  a0: number;
  a1: number;
  /** ABSOLUTE surface height at a0 / a1 */
  h0: number;
  h1: number;
}
export const CASTLE_RAMPS: readonly CastleRamp[] = [
  // west flight: bailey floor up the inner face to the west walk...
  { axis: 'z', b0: 361.0, b1: 363.6, a0: 2040, a1: 2058.6, h0: 6, h1: CASTLE.walkAbs },
  // ...and its flat landing, bridging the flight top onto the SW bastion
  { axis: 'z', b0: 361.0, b1: 363.6, a0: 2058.6, a1: 2069, h0: CASTLE.walkAbs, h1: CASTLE.walkAbs },
  // the alley flight: squeezed between the north wall and the ward's
  // retaining edge, climbing east to the NE walk. The band runs THROUGH the
  // ward's retaining blend (the overlap rule above): stopping at the rect line
  // left a sliver of bailey floor between the stair mass and the terrace that
  // a walker fell up to 6.8yd into and could not climb out of.
  {
    axis: 'x',
    b0: 1989.0,
    b1: CASTLE.ward.z0 + WARD_EDGE_BLEND,
    a0: 414,
    a1: 433.6,
    h0: 6,
    h1: CASTLE.walkAbs,
  },
  // the watch flight: the far wall-walk itself climbs to the SE chamber
  {
    axis: 'x',
    b0: CASTLE.wz1 - CASTLE.wallTh / 2,
    b1: CASTLE.wz1 + CASTLE.wallTh / 2,
    a0: 424,
    a1: 433.6,
    h0: CASTLE.walkAbs,
    h1: CASTLE.watchAbs,
  },
] as const;

// The ward's two stair cuts through its south retaining edge: bands where
// the terrace height ramps down to the bailey instead of dropping sheer.
export const WARD_STEPS = [
  { x0: 404, x1: 407.5 },
  { x0: 421, x1: 424.5 },
] as const;
/** the step ramps run from the ward edge z1 down to bailey over this run */
export const WARD_STEP_RUN = 4;

// The bailey and ward buildings. The ward pair (keep, great hall) stand on
// the raised terrace; everything else on the bailey floor. Placement honors
// the gate corridors, the stair masses, the ward edge, and each other.
export interface CastleBuilding {
  key: string;
  x: number;
  z: number;
  rot: number;
  scale: number;
  r: number;
  h: number;
}
export const CASTLE_BUILDINGS: readonly CastleBuilding[] = [
  // THE WARD: the keep (its door, the Last Keep interior, faces +z toward
  // the ward steps) and the great hall at its side
  { key: 'hexrCastle', x: 421, z: 2003, rot: 0, scale: 9, r: 8.5, h: 34 },
  { key: 'hexrTownhall', x: 405, z: 2006.5, rot: 0, scale: 7, r: 5.8, h: 15 },
  // THE BAILEY, northwest military quarter: catapult tower, archery range,
  // and the servants' house
  { key: 'hexrTowerCatapult', x: 367, z: 1995, rot: Math.PI / 2, scale: 7, r: 4, h: 14 },
  { key: 'hexrArcheryrange', x: 383, z: 1996, rot: 0, scale: 7, r: 5.5, h: 12.5 },
  { key: 'hexrHomeB', x: 366.2, z: 2006, rot: Math.PI / 2, scale: 7, r: 4.5, h: 9 },
  // the forge and market quarter by the gate road
  { key: 'hexrBlacksmith', x: 368, z: 2020, rot: Math.PI / 2, scale: 7, r: 5, h: 7 },
  { key: 'hexrMarket', x: 388, z: 2040, rot: -Math.PI / 2, scale: 6.5, r: 4.5, h: 6.5 },
  { key: 'hexrHomeA', x: 376, z: 2039, rot: Math.PI, scale: 6, r: 3.8, h: 6 },
  // the south quarter: stables, the twin barracks, chapel, and the inn
  { key: 'hexrStables', x: 370, z: 2052, rot: 0.35, scale: 7, r: 5.5, h: 4.5 },
  { key: 'hexrBarracks', x: 386, z: 2062, rot: Math.PI, scale: 7.5, r: 6, h: 12.5 },
  { key: 'hexrBarracks', x: 400, z: 2063, rot: 0, scale: 7.5, r: 6, h: 12.5 },
  { key: 'hexrChurch', x: 413, z: 2060, rot: -Math.PI / 2, scale: 7.5, r: 5.5, h: 12.5 },
  { key: 'hexrTavern', x: 421, z: 2043, rot: Math.PI, scale: 7.5, r: 5.5, h: 10.5 },
] as const;

// The keep and the great hall stand 1.2yd apart on the ward terrace, closer
// than a player body can use. Their collision circles are INSCRIBED in square
// meshes, so that slot's floor sits inside both rendered buildings: a player
// who squeezed in stood under the stonework (it reads as being underground)
// with barely room to turn around. Two invisible blocker walls close the neck
// at the point where the gap is still wide enough to stand in, so the slot can
// never be entered from either end. The terrace east of the keep (2.4yd clear)
// stays the way around to the ward's north yard.
//
// Same idiom as JAIL_BLOCKERS: fence-width, camera-ghost, never jumpable, and
// pure static data (no rng, no tick-order effect). Merged into the built-in
// world's blockers in data.ts, so all three hosts collide identically.
export const CASTLE_BLOCKERS: readonly BlockerDef[] = [
  // the slot's north mouth: from inside the great hall's circle to inside the
  // keep's, so neither end can be walked around
  { x1: 410.2, z1: 2003.9, x2: 412.6, z2: 2003.9 },
  // the slot's south mouth
  { x1: 410.2, z1: 2006.1, x2: 412.6, z2: 2006.1 },
] as const;

// Ember crystals of varying sizes around the grounds and approach (drawn by
// render/ember_features.ts with the shared crystal model).
export const CASTLE_CRYSTALS: readonly { x: number; z: number; fp: number }[] = [
  // the barbican forecourt: crystal-lit yard flanking the road
  { x: 354.5, z: 2023, fp: 5.5 },
  { x: 355, z: 2036.5, fp: 4.2 },
  { x: 347.5, z: 2038.5, fp: 2.4 },
  // outside the outer gate, marking the approach
  { x: 337.5, z: 2023.5, fp: 3.4 },
  // the bailey court
  { x: 396, z: 2026, fp: 1.8 },
  { x: 416, z: 2036, fp: 2.6 },
  { x: 431, z: 2027, fp: 3.4 },
  // the breach yard: crystals growing through the fallen stone
  { x: 440.5, z: 2050.5, fp: 4.8 },
  { x: 433, z: 2048, fp: 2.2 },
  { x: 441, z: 2056.5, fp: 3.0 },
  // outside the walls, seeded along the skirt
  { x: 357, z: 1992, fp: 3.6 },
  { x: 441.5, z: 1985.5, fp: 5.0 },
  { x: 398, z: 2077.5, fp: 3.2 },
  { x: 368, z: 2076.5, fp: 2.0 },
  { x: 444.5, z: 2014, fp: 2.8 },
] as const;

const G = CASTLE_GATES;
const inSpan = (v: number, s: { a0: number; a1: number }): boolean => v >= s.a0 && v <= s.a1;
const sstepv = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Inside the castle grounds (walls inclusive), with an optional margin. */
export function inCastleGrounds(x: number, z: number, pad = 0): boolean {
  return (
    x >= CASTLE.wx0 - pad && x <= CASTLE.wx1 + pad && z >= CASTLE.wz0 - pad && z <= CASTLE.wz1 + pad
  );
}

/** Scatter clearance: the pad plus skirt is castle ground; no wild scatter. */
export function castleClear(x: number, z: number): boolean {
  const p = CASTLE.pad;
  return x < p.x0 - 4 || x > p.x1 + 4 || z < p.z0 - 4 || z > p.z1 + 4;
}

// the Last Spring pool sits off the pad's northeast apron; the pad yields
// to the lake's graded escape shore there (the fade completes before the
// curtain wall corner, so the walls and courtyard stay dead level)
export const LAST_SPRING = { x: 456, z: 1988 } as const;

/**
 * The inner ward terrace's rise above the bailey floor: the full 2.6 inside
 * its rect, blended down over WARD_EDGE_BLEND at the retaining edge, and
 * ramping back down over WARD_STEP_RUN inside the two stair cuts. Zero
 * everywhere else.
 *
 * Split out because the RENDER has to subtract it. The retaining blend is
 * 0.7yd, far narrower than the terrain mesh's vertex lattice (1.2yd at the
 * densest LOD band, 3.0yd on the low tier), so a mesh built straight off
 * terrainHeight smears this cliff into a ramp that climbs up to 1.7yd above
 * the bailey floor the sim actually stands players on: they sink into the
 * drawn ground along the ward's faces. The terrace is therefore drawn as a
 * built mass instead (render/castle_features.ts) over a flat mesh, the same
 * way the curtain walls, bastions and stair flights already are. See
 * render/terrain_mesh_height.ts.
 */
export function wardTerraceRise(x: number, z: number): number {
  const w = CASTLE.ward;
  if (x < w.x0 || x > w.x1 || z < w.z0 || z > w.z1 + WARD_STEP_RUN) return 0;
  const rise = CASTLE.ward.h - CASTLE.pad.h;
  if (z <= w.z1) {
    // the terrace proper; a narrow blend at the rect edge keeps the riser
    // sheer enough to refuse the climb gate but not a numeric wall
    const edge = Math.min(x - w.x0, w.x1 - x, z - w.z0);
    return rise * Math.min(1, edge / WARD_EDGE_BLEND);
  }
  // south of the terrace edge: bailey, except inside a stair cut where the
  // surface ramps down over WARD_STEP_RUN
  for (const cut of WARD_STEPS) {
    if (x >= cut.x0 && x <= cut.x1) {
      const t = (z - w.z1) / WARD_STEP_RUN;
      return rise * (1 - Math.min(1, t));
    }
  }
  return 0;
}

/**
 * The local pad TARGET height: the inner ward terrace inside its rect
 * (with the two stair cuts ramping its south edge down), the bailey floor
 * everywhere else inside the pad.
 */
export function castlePadTarget(x: number, z: number): number {
  return CASTLE.pad.h + wardTerraceRise(x, z);
}

/**
 * The pad SKIRT's own reach: 1 over the graded rect, easing out to nothing
 * over the 9yd skirt, with no pool yield in it. Split out because the skirt's
 * reach is also what bounds the shore bank world.ts grades into the Last
 * Spring (applyLastSpringBank): the bank is the pad's skirt meeting the water,
 * so it must stop exactly where the skirt does and nowhere else.
 */
export function castleSkirtWeight(x: number, z: number): number {
  const p = CASTLE.pad;
  const dx = Math.max(p.x0 - x, 0, x - p.x1);
  const dz = Math.max(p.z0 - z, 0, z - p.z1);
  const d = Math.hypot(dx, dz);
  if (d >= 9) return 0;
  const t = 1 - d / 9;
  return t * t * (3 - 2 * t);
}

/** The graded pad weight: level grounds, gentle skirt back to the waste. */
export function castlePadWeight(x: number, z: number): number {
  const skirt = castleSkirtWeight(x, z);
  if (skirt <= 0) return 0;
  return skirt * sstepv(11, 18, Math.hypot(x - LAST_SPRING.x, z - LAST_SPRING.z));
}

const HT = CASTLE.wallTh / 2;

// wall strip: full ABS height across the strip, gap over each gate
function wallStripAbs(
  along: number,
  across: number,
  wallLine: number,
  gate: { a0: number; a1: number } | null,
  hAbs = CASTLE.walkAbs,
  halfTh = HT,
): number {
  if (Math.abs(across - wallLine) > halfTh) return 0;
  if (gate && inSpan(along, gate)) return 0;
  return hAbs;
}

// a bounded wall segment strip (the barbican and garden walls): ABS height
// across the strip between s0 and s1, with optional gate gaps
function segStripAbs(
  along: number,
  across: number,
  line: number,
  s0: number,
  s1: number,
  hAbs: number,
  halfTh: number,
  gates: readonly { a0: number; a1: number }[] = [],
): number {
  if (along < s0 || along > s1) return 0;
  if (Math.abs(across - line) > halfTh) return 0;
  for (const g of gates) if (inSpan(along, g)) return 0;
  return hAbs;
}

/**
 * The castle's walkable lift field (single-valued; added into groundHeight
 * on top of the local pad target). Wall plateaus, tower bastions, and
 * stair ramps, all expressed as ABSOLUTE surface heights so the walk stays
 * level where the ground below is terraced.
 */
export function castleLift(x: number, z: number): number {
  const p = CASTLE.pad;
  if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) return 0;
  let abs = 0;
  // curtain walls (with gate gaps)
  if (z >= CASTLE.wz0 - HT && z <= CASTLE.wz1 + HT) {
    abs = Math.max(
      abs,
      wallStripAbs(z, x, CASTLE.wx0, G.main), // west
      wallStripAbs(z, x, CASTLE.wx1, G.breach), // east
    );
  }
  if (x >= CASTLE.wx0 - HT && x <= CASTLE.wx1 + HT) {
    abs = Math.max(
      abs,
      wallStripAbs(x, z, CASTLE.wz0, G.postern), // near wall
      wallStripAbs(x, z, CASTLE.wz1, null), // far wall (solid)
    );
  }
  // the barbican forecourt: outer wall on the road line plus its two side
  // walls back to the curtain (all low sheer works, no walk on top)
  {
    const b = BARBICAN;
    const bht = b.th / 2;
    abs = Math.max(
      abs,
      segStripAbs(z, x, b.x, b.z0, b.z1, b.hAbs, bht, [G.outer]),
      segStripAbs(x, z, b.z0, b.x, CASTLE.wx0, b.hAbs, bht),
      segStripAbs(x, z, b.z1, b.x, CASTLE.wx0, b.hAbs, bht),
    );
  }
  // the walled garden behind the far wall: a low south wall with two
  // doorway gaps, closed by short returns to the curtain
  {
    const g = GARDEN;
    const ght = g.th / 2;
    abs = Math.max(
      abs,
      segStripAbs(x, z, g.wallZ, g.x0, g.x1, g.hAbs, ght, g.gates),
      segStripAbs(z, x, g.x0, CASTLE.wz1, g.wallZ, g.hAbs, ght),
      segStripAbs(z, x, g.x1, CASTLE.wz1, g.wallZ, g.hAbs, ght),
    );
  }
  // tower bastions (square tops, walkable, continuous with the walks)
  for (const t of CASTLE_TOWERS) {
    if (Math.abs(x - t.x) <= t.hw && Math.abs(z - t.z) <= t.hw) {
      abs = Math.max(abs, t.hAbs);
    }
  }
  // stair ramps (solid masses; linear rise along their axis)
  for (const rmp of CASTLE_RAMPS) {
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
  return Math.max(0, abs - castlePadTarget(x, z));
}
