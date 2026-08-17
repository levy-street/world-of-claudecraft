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
import { hexBuildingBox } from './hex_building_dims';
import type { BlockerDef } from './types';

export const CASTLE = {
  // the graded grounds (terrain levels to the local pad target; the skirt
  // blends out to the waste; the west reach carries the barbican forecourt)
  pad: { x0: 334, x1: 452, z0: 1980, z1: 2085, h: 6 },
  // The inner ward: the keep's raised terrace (z0 sits back far enough that the
  // alley flight lane clears the thicker near wall).
  //
  // The .6 on x0 and z1 is load-bearing, not decoration. terrainSteepnessAt
  // memoizes on 1-yard cells sampled at the CENTRE, so a retaining face whose
  // foot sits near a whole number stamps the cliff's steepness onto up to half a
  // cell of dead level floor either side of it. On the flat below that reads as
  // steep with no downhill (a freeze, now also handled in player_motion); on the
  // terrace above it reads as steep WITH a downhill and shoves a standing player
  // off the drop. Both vanish once the face lands mid-cell. The safe window for
  // a foot at coordinate a is frac(a) in [0.35, 0.85): z0 1992.6 and the east
  // blend foot 432.7 were already inside it, x0 398 and z1 2018 were not. x0
  // goes WEST to 397.6 rather than east to 398.4 because hexrBarracks (x 403.5,
  // r 5.2) reaches to 398.3 and would then overhang the terrace edge.
  ward: { x0: 397.6, x1: 433.4, z0: 1992.6, z1: 2018.6, h: 8.6 },
  // the curtain wall square: wall centerlines
  wx0: 360,
  wx1: 436.8,
  wz0: 1988,
  wz1: 2071.8,
  /** wall module length (KayKit wall is 4 units at scale 1.75) */
  module: 7,
  /** wall thickness: the lift plateau strip (the walkable wall-walk width;
   *  the render skins BOTH faces with wall modules at this thickness) */
  wallTh: 3.0,
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
  /** the barbican's outer gate on the road line: the doorway module sits on
   *  its 4-unit grid slot (center 2030), and the walkable span keeps a
   *  margin inside the arch's 2yd foot opening (2029 to 2031) */
  outer: { a0: 2029.15, a1: 2030.85 },
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
  gates: [
    { a0: 365, a1: 368.5 },
    { a0: 428, a1: 431.5 },
  ],
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
  // west flight: bailey floor up the inner face to the west walk (the band
  // tucks 0.3 INTO the thicker wall strip so no low sliver opens between
  // flight and walk; the wall's own max() simply wins over that edge)
  { axis: 'z', b0: 361.2, b1: 364.0, a0: 2040, a1: 2058.6, h0: 6, h1: CASTLE.walkAbs },
  // ...and its flat landing, bridging the flight top onto the SW bastion. It
  // runs INTO the south wall strip, not up to it: stopping short left a lane
  // of bailey floor between the landing's end wall and the south curtain that
  // narrowed to nothing in the corner.
  {
    axis: 'z',
    b0: 361.2,
    b1: 364.0,
    a0: 2058.6,
    a1: CASTLE.wz1 - CASTLE.wallTh / 2 + 0.3,
    h0: CASTLE.walkAbs,
    h1: CASTLE.walkAbs,
  },
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

// The ward's grand stair: ONE broad cut through the south retaining edge,
// four of the old flight widths flush side by side (14yd), centered on the
// keep's door axis so the terrace approach reads as a single processional
// ramp spanning the keep foundations instead of two narrow side stairs.
export const WARD_STEPS = [{ x0: 414, x1: 428 }] as const;

/**
 * An OUTSIDE way up: corbelled shelves climbing the east curtain, so the
 * wall-walk is reachable by parkour as well as by the flights. Tops are
 * ABSOLUTE (the pad here is 6.0, the walk 13.0) and each rise sits in a
 * band the engine can actually cross: 1.3 vault off the pad, then 2.0 and
 * 2.1 ledge climbs, then a 1.6 vault onto the walk. Pinned by
 * tests/castle_ledges.
 *
 * Each shelf's inner face sits FLUSH on the curtain's outer face (438.3).
 * Standing them off the wall left a slot of bailey-level floor behind them,
 * too narrow to turn around in, which is what a corbel is not: a corbel grows
 * out of the wall it is cut into.
 */
export interface CastleWallLedge {
  x: number;
  z: number;
  hw: number;
  hd: number;
  /** absolute shelf height */
  top: number;
}
export const CASTLE_WALL_LEDGES: readonly CastleWallLedge[] = [
  { x: 439.8, z: 2040, hw: 1.5, hd: 1.8, top: 7.3 },
  { x: 439.7, z: 2036, hw: 1.4, hd: 1.8, top: 9.35 },
  { x: 439.7, z: 2032, hw: 1.4, hd: 1.8, top: 11.4 },
] as const;
/** the step ramps run from the ward edge z1 down to bailey over this run */
export const WARD_STEP_RUN = 4;

// THE WALL-WALK'S OUTER PARAPET.
//
// The curtain is terrain, and terrain gives a body no standoff at a DOWN edge:
// terrainWallStandoff only pushes away from RISING ground. So the walk was a
// 3.0yd strip with nothing at either lip, and a player drifting four ticks off
// the centreline simply left it, seven yards down into the bailey. The drawn
// stone says otherwise: castle_features already lays a crenellated battlement
// along the outer edge and a rail along the inner one. This is that battlement
// made solid, so the wall you see is the wall you are held by.
//
// OUTER edge only, which is what was asked for and also the right call: the
// inner lip overlooks the bailey a player often wants to drop into on purpose,
// and railing both would turn the circuit into a corridor.
/** centre of the parapet band, measured out from the wall centreline */
export const PARAPET_INSET = 1.2;
/** half-thickness of the band (the drawn merlon is 0.4 deep) */
export const PARAPET_HALF = 0.2;
/** the parapet's top over the walk it stands on */
export const PARAPET_RISE = 1.56;

export interface CastleParapet {
  axis: 'x' | 'z';
  /** the across coordinate: the band's CENTRE, already offset outward */
  line: number;
  a0: number;
  a1: number;
  /** ABSOLUTE top of the stone */
  top: number;
}

/** Subtract a set of gaps from one run, yielding the spans that remain. */
function splitRun(a0: number, a1: number, gaps: { a0: number; a1: number }[]): [number, number][] {
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
  return spans.filter(([s0, s1]) => s1 - s0 > 1);
}

/**
 * The parapet spans, with a gap wherever one would break something that works.
 *
 * Three kinds of gap, and the third is the subtle one:
 *  - every GATE mouth, so the walk still opens over the way in;
 *  - the watch flight, which climbs the south wall itself and rises clear above
 *    parapet height, so a band there would be buried in the ramp;
 *  - the CLIMBING SHELVES on the east curtain. fitsOn (physics/ledge.ts) vetoes
 *    a ledge grab whose landing lands inside anything carrying a movement top,
 *    whether or not it is standable, so a parapet over the shelves' approach
 *    would silently kill the whole outside climb. The gap covers the run, not
 *    just the one shelf that tops out.
 */
export function castleParapetSegments(): CastleParapet[] {
  const hw = CASTLE.towerHw;
  const top = CASTLE.walkAbs + PARAPET_RISE;
  const G = CASTLE_GATES;
  const ledgeGap = { a0: 2026, a1: 2044 }; // CASTLE_WALL_LEDGES climb z 2032..2040
  const out: CastleParapet[] = [];
  const add = (
    axis: 'x' | 'z',
    line: number,
    outward: -1 | 1,
    a0: number,
    a1: number,
    gaps: { a0: number; a1: number }[],
  ): void => {
    for (const [s0, s1] of splitRun(a0, a1, gaps)) {
      out.push({ axis, line: line + outward * PARAPET_INSET, a0: s0, a1: s1, top });
    }
  };
  // west curtain, outward is -x; the main gate parts it
  add('z', CASTLE.wx0, -1, CASTLE.wz0 + hw, CASTLE.wz1 - hw, [G.main]);
  // east curtain, outward is +x; the breach and the climbing shelves part it
  add('z', CASTLE.wx1, 1, CASTLE.wz0 + hw, CASTLE.wz1 - hw, [ledgeGap, G.breach]);
  // north curtain, outward is -z; the postern parts it
  add('x', CASTLE.wz0, -1, CASTLE.wx0 + hw, CASTLE.wx1 - hw, [G.postern]);
  // south curtain, outward is +z, solid, but stop at the watch flight's foot
  add('x', CASTLE.wz1, 1, CASTLE.wx0 + hw, 424, []);
  return out;
}

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
  /** stands on the ward terrace (placement checks use this, not the key) */
  ward?: boolean;
  /** part of the composed keep mass: allowed to touch its complex mates */
  keepComplex?: boolean;
  /** Collide as the model's measured BOX rather than as `r`. Opt-in per
   * building because it is not always an improvement: the keep's circle is
   * already inside its mesh, and boxing it would close the alley flight's lane
   * to under a body's width. `r` stays authored either way, as the clearance
   * radius scatter and roads read. */
  boxed?: boolean;
}

/**
 * The bailey and ward buildings as `decorProps`, with a measured box on every
 * entry flagged `boxed`. Derived, never hand-typed: the half-extents come from
 * the shipped model via hex_building_dims, so a re-scaled building cannot drift
 * away from its own collision.
 */
export function castleBuildingProps(): {
  key: string;
  x: number;
  z: number;
  rot: number;
  scale: number;
  r: number;
  h: number;
  hw?: number;
  hd?: number;
}[] {
  return CASTLE_BUILDINGS.map((b) => {
    const box = b.boxed ? hexBuildingBox(b.key, b.scale) : null;
    return {
      key: b.key,
      x: b.x,
      z: b.z,
      rot: b.rot,
      scale: b.scale,
      r: b.r,
      h: b.h,
      ...(box ?? {}),
    };
  });
}
export const CASTLE_BUILDINGS: readonly CastleBuilding[] = [
  // THE WARD: the keep with a barracks hall wing set beside it, the pair
  // composing the terrace; the keep's own door faces +z, straight down the
  // ward toward the portal.
  //
  // The wing used to be pulled in tight enough that the two collision circles
  // CROSSED. Two crossing circles always meet at a cusp, and a cusp is a
  // notch that tapers to nothing: walk in and you cannot turn around. It
  // cannot be fenced off either. Sealing a cusp means overlapping the circle's
  // own standoff, and then the fence and the circle push a body opposite ways
  // and cancel, which holds it solid. So the wing stands clear instead, and
  // the 2.3yd between the two masses is a real passage across the terrace.
  {
    key: 'hexrCastle',
    x: 421,
    z: 2001.5,
    rot: 0,
    scale: 9.5,
    r: 9,
    h: 36,
    ward: true,
    keepComplex: true,
  },
  {
    key: 'hexrBarracks',
    x: 403.5,
    z: 2001.5,
    rot: Math.PI / 2,
    scale: 6.5,
    r: 5.2,
    h: 11,
    ward: true,
    keepComplex: true,
    boxed: true,
  },
  // the great hall, moved down into the bailey to free the terrace
  { key: 'hexrTownhall', x: 390, z: 2016, rot: 0, scale: 7, r: 5.8, h: 15, boxed: true },
  // THE BAILEY. Every mass here collides as a circle, and a circle that comes
  // within a body diameter of the curtain, a stair mass, a bastion, or its
  // neighbour leaves a tapering alley the player can walk into and wedge in
  // (the arcs cross, or graze a straight riser, and the floor between is
  // inside the rendered stonework). So the quarters are spaced to keep a real
  // lane, at least 1.6yd of standable floor, around every building on every
  // side: the bailey reads as a walled town with a circulation ring rather
  // than sheds shoved against the wall. Pinned by
  // tests/last_keep_flank_traps.test.ts.
  //
  // northwest military quarter: catapult tower, archery range, and the
  // servants' house
  {
    key: 'hexrTowerCatapult',
    x: 369,
    z: 1997,
    rot: Math.PI / 2,
    scale: 7,
    r: 4,
    h: 14,
    boxed: true,
  },
  { key: 'hexrArcheryrange', x: 384, z: 1998.5, rot: 0, scale: 7, r: 5.5, h: 12.5, boxed: true },
  { key: 'hexrHomeB', x: 370.5, z: 2008.5, rot: Math.PI / 2, scale: 7, r: 4.5, h: 9, boxed: true },
  // the forge and market quarter by the gate road
  { key: 'hexrBlacksmith', x: 371, z: 2021, rot: Math.PI / 2, scale: 7, r: 5, h: 7, boxed: true },
  // The market and the stables are the two entries whose real box is BIGGER
  // than the circle they were given, not smaller, so boxing them would take
  // bailey away rather than give it back. Both are open compounds (a stall run
  // and a fenced paddock, barely a fifth solid at chest height), so their true
  // rectangle is a poor description of them either way: the honest fix is a
  // collider that follows the fence and leaves the yard open, which one box
  // cannot express. Circles until then, and their corners stay approximate.
  { key: 'hexrMarket', x: 388, z: 2040, rot: -Math.PI / 2, scale: 6.5, r: 4.5, h: 6.5 },
  { key: 'hexrHomeA', x: 376, z: 2039, rot: Math.PI, scale: 6, r: 3.8, h: 6, boxed: true },
  // the south quarter: stables, the twin barracks, chapel, and the inn. The
  // stables stand clear of the west flight's mass, not beside it.
  { key: 'hexrStables', x: 373, z: 2052, rot: 0.35, scale: 7, r: 5.5, h: 4.5 },
  { key: 'hexrBarracks', x: 386.5, z: 2061, rot: Math.PI, scale: 7.5, r: 6, h: 12.5, boxed: true },
  { key: 'hexrBarracks', x: 401, z: 2059.8, rot: 0, scale: 7.5, r: 6, h: 12.5, boxed: true },
  {
    key: 'hexrChurch',
    x: 416,
    z: 2059,
    rot: -Math.PI / 2,
    scale: 7.5,
    r: 5.5,
    h: 12.5,
    boxed: true,
  },
  { key: 'hexrTavern', x: 421, z: 2043, rot: Math.PI, scale: 7.5, r: 5.5, h: 10.5, boxed: true },
] as const;

// THE KEEP'S FOUNDATION SEALS. Every mass on the ward terrace collides as a
// CIRCLE inscribed in a SQUARE mesh, so the mesh corners always overhang
// walkable ground: wherever two of those arcs (or an arc and a stair mass)
// come within a body diameter, the floor between them is inside the rendered
// stonework and a player who walks in wedges there, unable to turn around.
// Player report: "you get stuck along the side of the foundation."
//
// Growing a radius only MOVES a circle-crossing cusp, it never removes one, so
// each pinch is closed at its MOUTH instead: an invisible wall whose two ends
// sit inside solid geometry, placed where the gap is still wide enough to
// stand in. Every route the ward needs stays open: the terrace east of the
// keep is the way around to the north yard, and the keep's door lane between
// the arch jambs carries no seal at all (the keep's own door apron solves that
// one, see dungeons.ts the_last_keep doorPos).
//
// A seal is only ever safe where nothing can PUT a player behind it. Never
// place one across ground a mass depenetrates into, above all the keep facade:
// the instance-return path drops a logged-out character at doorPos.z - 4,
// inside the keep's circle, and the circle then pushes them south onto
// whatever is there.
//
// Same idiom as JAIL_BLOCKERS: fence-width, camera-ghost, never jumpable, and
// pure static data (no rng, no tick-order effect). Merged into the built-in
// world's blockers in data.ts, so all three hosts collide identically.
// Pinned by tests/last_keep_flank_traps.test.ts (the reachable-wedge scan).
export const CASTLE_BLOCKERS: readonly BlockerDef[] = [
  // The old pair at z 2003.9/2006.1 is gone: once the great hall moved down
  // into the bailey they sat inside both remaining masses and did nothing. The
  // keep/barracks cusps they were re-aimed at are gone too, solved above by
  // standing the wing clear rather than by fencing.
  //
  // THE ALLEY FLIGHT'S SOUTH FACE. East of x 425.5 the flight has climbed more
  // than a step above the terrace beside it, and the keep's arc runs back
  // toward it, so the strip between the two closes from 2.2yd to nothing at
  // x 425.8. Sealed at the east mouth, flight mass to keep arc; west of the
  // seal the strip is only ever entered by walking round the keep's east
  // terrace, which this closes.
  //
  // NOTE the x: a blocker is not the thin segment it reads as. It becomes an
  // OBB padded by FENCE_HALF_DEPTH and FENCE_END_PAD, and a body stands off
  // that by its own radius, so its real reach is 0.85yd, not 0.5. Sizing one
  // as a bare segment is how the first cut of this pass put a blocker's
  // standoff PAST the keep's own: the two push vectors then cancel and the
  // player is held, which is the exact defect these seals exist to remove.
  { x1: 427.6, z1: 1993.2, x2: 427.6, z2: 1995.3 },
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
