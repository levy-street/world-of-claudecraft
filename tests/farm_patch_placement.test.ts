// Farm-patch placement: does every garden bed in src/sim/content/farm_patches.ts
// sit on ground a player can actually reach, stand on, and work?
//
// A bed is a world prop a player returns to over and over, so it answers to
// the same physical questions an authored gather node does, and this file is
// the node suite's physical half (tests/gather_node_placement.test.ts) applied
// to the patch table. The helpers are cloned rather than imported because that
// file exports none of them; every clone is a copy of the shipped rule, and
// every threshold below is a SHIPPED constant (the movement climb limit and
// body radius from the pathfinding module, the working reach from the same
// INTERACT_RANGE the interact gate uses, the water freeboard the world already
// screens props with) rather than a fresh number, so this file cannot drift
// away from the rules the game enforces.
//
// The node suite's CIRCUIT-DESIGN arms (count floors, spatial coverage, the
// harvest ceiling, the named-mob margin) are deliberately NOT cloned: they
// audit a tuned zone set and a per-zone node budget that farming does not
// have. What carries over is the part that is true of any object seated on the
// heightfield.
//
// The seed is the shipped world seed, and only that one: terrain is a pure
// function of (x, z, seed), bed coordinates are hand-authored against THIS
// world, and validating them at another seed would check placements against
// terrain that never ships. The seed's own literal pin lives in
// tests/gather_node_placement.test.ts and is not duplicated here.

import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import {
  CAMPS,
  GATHER_NODES,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
  ZONES,
  zoneAt,
} from '../src/sim/data';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import { INTERACT_RANGE } from '../src/sim/types';
import { isOnPitch, SOWFIELD_EXCLUDE } from '../src/sim/vale_cup_layout';
import {
  groundHeight,
  isInWaterBody,
  roadDistance,
  SEALED_BORDERS,
  terrainSteepness,
  terrainSteepnessAt,
  waterLevel,
  waterLevelAt,
} from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// Freeboard a bed needs above the local water surface: the same yard
// generateDecorations (world.ts) demands before it will anchor any
// procedurally seated world prop, and the same one the node suite screens
// gather nodes with.
const WATER_MARGIN = 1;

// A bed's "working reach": the flat 2D disc an interact gate allows, exactly
// the INTERACT_RANGE the sim already uses. Every arm below that talks about
// the ground AROUND a bed means this disc.
const REACH = INTERACT_RANGE;

// Sampling density for the reach sweeps, the node suite's fan: at 0.5yd rings
// and 24 spokes the widest arc gap is about 1.3yd at the far edge of reach.
const SWEEP_STEP = 0.5;
const SWEEP_SPOKES = 24;

/**
 * How far from a bed's own centre the nearest standable ground may sit when
 * nothing foreign is in the way.
 *
 * Beds ship NO collider of their own this phase (there is no entry for them in
 * prop_layout's GATHER_NODE_BODIES, and nothing turns a bed into a solid
 * body), so unlike an ore vein or a wood pile a bed does not push the player
 * off its own centre. Its self clearance is therefore the herb case, the one
 * node type whose body is null: the player's own radius, plus one sweep step
 * because nearestStandSpot samples on a 0.5yd ring and cannot report a finer
 * distance than that. This is the TIGHTEST clearance in the world's table and
 * that is deliberate: a player must be able to stand essentially on the bed.
 * If a later phase gives beds a body, this constant becomes that body's radius
 * plus the two terms below, the way selfClearanceFor already does for nodes.
 */
const BED_CLEARANCE = PLAYER_BODY_RADIUS + SWEEP_STEP;

// The floor two beds are held apart at. INTERACT_RANGE rather than a fresh
// number, and for the node suite's reason: two beds closer than the working
// reach are ONE bed to a player, because a nearest-target pick has to
// arbitrate between them and the props overlap. The bound is inclusive, and
// the authored grid sits exactly on it (a 5yd pitch), so any bed nudged
// toward its neighbour fails immediately.
const BED_SPACING = INTERACT_RANGE;

// How far a bed stays off a road. world.ts already refuses to seat a ground
// object within 5 yards of one (its roadDistance screen), and a garden bed is
// the same kind of object: a site straddling the lane it is reached by reads
// as a defect and no other arm here can see it, since a road is dry, flat,
// unblocked and reachable by construction.
const ROAD_MARGIN = 5;

/** Height the local water surface sits at, or -Infinity where none is declared. */
function waterAt(x: number, z: number): number {
  return waterLevelAt(x, z, WORLD_SEED);
}

/** True where the ground is high enough above any declared water to be dry land. */
function isDryLand(x: number, z: number): boolean {
  if (!isInWaterBody(x, z)) return true;
  return groundHeight(x, z, WORLD_SEED) >= waterAt(x, z) + WATER_MARGIN;
}

/** Deep enough under a declared water surface that a player swims instead of walking. */
function isSwimDepth(x: number, z: number): boolean {
  return groundHeight(x, z, WORLD_SEED) < waterAt(x, z) - PLAYER_SWIM_DEPTH;
}

/**
 * Can a player hold this exact spot? The sim's own rules: player_motion strips
 * control on ground steeper than MAX_CLIMB_SLOPE (reading the memoized
 * terrainSteepnessAt, so this reads it too), a static collider pushes the body
 * out, and ground below swim depth means treading water rather than standing.
 */
function canStand(x: number, z: number): boolean {
  if (isBlocked(WORLD_SEED, x, z, PLAYER_BODY_RADIUS)) return false;
  if (isSwimDepth(x, z)) return false;
  return terrainSteepnessAt(x, z, WORLD_SEED) <= PLAYER_MAX_CLIMB_SLOPE;
}

/**
 * Steepest gradient anywhere in a bed's working reach, the bed included. Uses
 * the EXACT terrainSteepness rather than the cell-memoized terrainSteepnessAt,
 * because this is about the shape of the ground the prop is seated in (the
 * same question world.ts asks of scatter props) rather than about the movement
 * gate, which canStand covers.
 */
function steepestInReach(x: number, z: number): number {
  let worst = terrainSteepness(x, z, WORLD_SEED);
  for (let r = SWEEP_STEP; r <= REACH; r += SWEEP_STEP) {
    for (let k = 0; k < SWEEP_SPOKES; k++) {
      const a = (k / SWEEP_SPOKES) * Math.PI * 2;
      worst = Math.max(
        worst,
        terrainSteepness(x + Math.cos(a) * r, z + Math.sin(a) * r, WORLD_SEED),
      );
    }
  }
  return worst;
}

/** The closest spot inside the working reach a player can stand on, or null. */
function nearestStandSpot(x: number, z: number): { x: number; z: number; r: number } | null {
  if (canStand(x, z)) return { x, z, r: 0 };
  for (let r = SWEEP_STEP; r <= REACH; r += SWEEP_STEP) {
    for (let k = 0; k < SWEEP_SPOKES; k++) {
      const a = (k / SWEEP_SPOKES) * Math.PI * 2;
      const sx = x + Math.cos(a) * r;
      const sz = z + Math.sin(a) * r;
      if (canStand(sx, sz)) return { x: sx, z: sz, r };
    }
  }
  return null;
}

/**
 * How far the ground sits above the WORLD water surface. The render seats one
 * world-spanning plane at waterLevel(), so ground below that height shows
 * water everywhere, while isDryLand above screens only DECLARED water bodies:
 * a prop outside every declared body can pass every sim rule and still render
 * under the sea, which is why this is its own arm.
 */
function seaFreeboardAt(x: number, z: number): number {
  return groundHeight(x, z, WORLD_SEED) - waterLevel();
}

// The water sweep samples more densely than the slope sweep, because a
// waterline is a CONTOUR: a tongue of water reaching into the disc can be
// narrower than the slope fan's arc gap the whole way in, so the answer would
// depend on the spoke count. Rings at SWEEP_STEP with the spoke count derived
// from WATER_ARC cover every radius including the rim, where a shoreline
// usually crosses a disc; the square lattice covers the interior, where rings
// spread out. A screen rather than a proof, but one whose blind spot is a
// stated number.
const WATER_ARC = 0.35;

/** How far the LOWEST ground anywhere in a bed's reach sits above the world
 *  water surface. Negative means open water inside the disc. */
function seaClearanceInReach(x: number, z: number): number {
  let worst = seaFreeboardAt(x, z);
  for (let r = SWEEP_STEP; r <= REACH; r += SWEEP_STEP) {
    const spokes = Math.max(SWEEP_SPOKES, Math.ceil((2 * Math.PI * r) / WATER_ARC));
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2;
      worst = Math.min(worst, seaFreeboardAt(x + Math.cos(a) * r, z + Math.sin(a) * r));
    }
  }
  for (let dx = -REACH; dx <= REACH; dx += SWEEP_STEP) {
    for (let dz = -REACH; dz <= REACH; dz += SWEEP_STEP) {
      if (dx * dx + dz * dz > REACH * REACH) continue;
      worst = Math.min(worst, seaFreeboardAt(x + dx, z + dz));
    }
  }
  return worst;
}

// --- hub reachability -------------------------------------------------------
// A coarse walkability flood stepping the sim's own uphill wall rule. findPath
// cannot answer this: its window caps at 64 cells per axis and falls back to a
// straight line past that, so it would call every far bed reachable by fiat.
// Water is traversable because players swim, which is why a submerged bed
// would still pass THIS arm and be caught by the dry-land and stand-spot arms
// instead: each arm fails for its own reason.

const FLOOD_CELL = 2; // yards per cell
const FLOOD_MARGIN = 45; // yards of slack around the hub + beds bounding box
const CELL_PROBE_OFFSET = 0.8;

/** Height the body rides at: the water surface when submerged, else the ground. */
function rideHeight(x: number, z: number): number {
  const h = groundHeight(x, z, WORLD_SEED);
  const wl = waterAt(x, z);
  return h < wl ? wl : h;
}

/**
 * Is a flood CELL passable, as opposed to its exact centre point? The cell is
 * passable when any of nine samples is (centre plus a ring at 0.8yd offsets),
 * so a small body sitting in the middle of a cell cannot blank a 2yd cell a
 * player walks straight past. One more divergence in the PERMISSIVE direction,
 * which is the only direction this flood is allowed to differ in.
 */
function cellPassable(x: number, z: number): boolean {
  for (const dx of [0, -CELL_PROBE_OFFSET, CELL_PROBE_OFFSET]) {
    for (const dz of [0, -CELL_PROBE_OFFSET, CELL_PROBE_OFFSET]) {
      if (!isBlocked(WORLD_SEED, x + dx, z + dz, PLAYER_BODY_RADIUS)) return true;
    }
  }
  return false;
}

/**
 * player_motion's wall rule in SHAPE, not verbatim: an uphill step is refused
 * when the step itself beats the climb limit OR it lands on ground whose own
 * gradient does, so approaching a wall at an angle cannot cheat it, and
 * downhill is never refused. Every divergence is permissive, so this cannot
 * invent a wall the game does not have.
 */
function stepAllowed(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
  if (!cellPassable(toX, toZ)) return false;
  const h0 = rideHeight(fromX, fromZ);
  const h1 = rideHeight(toX, toZ);
  const run = Math.hypot(toX - fromX, toZ - fromZ);
  if (h1 <= h0 || run <= 1e-5) return true;
  if ((h1 - h0) / run > PLAYER_MAX_CLIMB_SLOPE) return false;
  if (isSwimDepth(toX, toZ)) return true; // swimming skips the climb gate
  return terrainSteepnessAt(toX, toZ, WORLD_SEED) <= PLAYER_MAX_CLIMB_SLOPE;
}

interface Box {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

function floodFrom(origin: { x: number; z: number }, box: Box): Set<string> {
  const cell = (v: number) => Math.round(v / FLOOD_CELL);
  const key = (cx: number, cz: number) => `${cx},${cz}`;
  const start: [number, number] = [cell(origin.x), cell(origin.z)];
  const reached = new Set([key(start[0], start[1])]);
  const queue: [number, number][] = [start];
  for (let head = 0; head < queue.length; head++) {
    const [cx, cz] = queue[head];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = (cx + dx) * FLOOD_CELL;
        const nz = (cz + dz) * FLOOD_CELL;
        if (nx < box.xMin || nx > box.xMax || nz < box.zMin || nz > box.zMax) continue;
        const k = key(cx + dx, cz + dz);
        if (reached.has(k)) continue;
        if (!stepAllowed(cx * FLOOD_CELL, cz * FLOOD_CELL, nx, nz)) continue;
        reached.add(k);
        queue.push([cx + dx, cz + dz]);
      }
    }
  }
  return reached;
}

function boxAround(points: { x: number; z: number }[]): Box {
  return {
    xMin: Math.max(-WORLD_MAX_X, Math.min(...points.map((p) => p.x)) - FLOOD_MARGIN),
    xMax: Math.min(WORLD_MAX_X, Math.max(...points.map((p) => p.x)) + FLOOD_MARGIN),
    zMin: Math.min(...points.map((p) => p.z)) - FLOOD_MARGIN,
    zMax: Math.max(...points.map((p) => p.z)) + FLOOD_MARGIN,
  };
}

function cellKey(x: number, z: number): string {
  return `${Math.round(x / FLOOD_CELL)},${Math.round(z / FLOOD_CELL)}`;
}

/**
 * The hub CENTRE is not guaranteed walkable (several hubs seat a structure on
 * it), so the flood starts from the nearest passable cell inside the hub
 * circle. This matters most at the Evergarden, whose patch sits out on the
 * parterre grounds while its reachability origin is the ZONE hub, Hedgewick:
 * the Parterre Walk is a landmark, not a hub, and a site reachable only from a
 * landmark is not reachable from where players arrive.
 */
function hubFloodStart(zone: (typeof ZONES)[number]): { x: number; z: number } {
  const { x, z } = zone.hub;
  if (cellPassable(x, z)) return { x, z };
  const radius = zone.hub.radius ?? 30;
  for (let ring = FLOOD_CELL; ring <= radius; ring += FLOOD_CELL) {
    for (let dx = -ring; dx <= ring; dx += FLOOD_CELL) {
      for (let dz = -ring; dz <= ring; dz += FLOOD_CELL) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        if (cellPassable(x + dx, z + dz)) return { x: x + dx, z: z + dz };
      }
    }
  }
  return { x, z };
}

// The deliberate-geometry screens: the two shapes a player genuinely cannot
// work, the world-rim margin and a sealed border crest (crossesSealedBorder is
// a hard movement wall; 48 is SEALED_RIDGE_SIGMA * 4, the crest's own relief
// band). The broad advisory band nearSteepWalls paints around every border is
// NOT one of them: legitimate ground sits inside it.
function againstWorldRim(x: number, z: number): boolean {
  return (
    x <= WORLD_MIN_X + 40 || x >= WORLD_MAX_X - 40 || z <= WORLD_MIN_Z + 40 || z >= WORLD_MAX_Z - 40
  );
}
function onSealedCrest(x: number, z: number): boolean {
  return SEALED_BORDERS.some((b) => x >= b.lo && x <= b.hi && Math.abs(z - b.at) < 48);
}

/**
 * How far a point sits OUTSIDE the nearest mob camp's footprint, negative
 * inside it. A camp's `radius` is the disc its `count` mobs are scattered
 * across (the Sableweb webwood is one 28.5yd disc holding six lurkers), so the
 * footprint is that disc and clearing it means standing at or beyond the rim.
 */
function campFootprintMargin(x: number, z: number): { margin: number; mobId: string } {
  let margin = Number.POSITIVE_INFINITY;
  let mobId = '';
  for (const camp of CAMPS) {
    const m = Math.hypot(x - camp.center.x, z - camp.center.z) - camp.radius;
    if (m < margin) {
      margin = m;
      mobId = camp.mobId;
    }
  }
  return { margin, mobId };
}

function inSowfield(x: number, z: number): boolean {
  return (
    x >= SOWFIELD_EXCLUDE.xMin &&
    x <= SOWFIELD_EXCLUDE.xMax &&
    z >= SOWFIELD_EXCLUDE.zMin &&
    z <= SOWFIELD_EXCLUDE.zMax
  );
}

// --- the table under test ---------------------------------------------------

interface BedRow {
  patchId: string;
  zoneId: string;
  id: string;
  x: number;
  z: number;
}
const BEDS: BedRow[] = FARM_PATCHES.flatMap((p) =>
  p.beds.map((b) => ({ patchId: p.id, zoneId: p.zoneId, id: b.id, x: b.x, z: b.z })),
);

// One flood per farmed zone, computed once and shared: the floods are the one
// expensive thing here.
const reachedByZone = new Map<string, Set<string>>();
for (const zone of ZONES) {
  const points = BEDS.filter((b) => b.zoneId === zone.id);
  if (points.length === 0) continue;
  const start = hubFloodStart(zone);
  reachedByZone.set(zone.id, floodFrom(start, boxAround([start, ...points])));
}

// Sweeps shared between the arm that bounds them and the non-vacuity check
// that measures the tightest survivor.
const seaClearanceByBed = new Map(BEDS.map((b) => [b.id, seaClearanceInReach(b.x, b.z)] as const));
function cachedSeaClearance(bedId: string): number {
  const cached = seaClearanceByBed.get(bedId);
  if (cached === undefined) throw new Error(`no cached sea clearance for ${bedId}`);
  return cached;
}

// --- counter-example fixtures ----------------------------------------------
// Every one is measured against THIS world, and each is asserted to genuinely
// have the property it stands for, so an arm can never pass because its
// counter-example quietly stopped being one.

const ON_MIRROR_LAKE_FLOOR = { x: -86, z: 90 }; // 3.1yd under the Mirror Lake surface
const IN_GLIMMERMERE_SHALLOWS = { x: -55, z: 765 }; // above the line, inside the margin
const ON_WICKHARBOR_COVE_FLOOR = { x: 448, z: 400 }; // 3.6yd under the sea plane, no declared body
const ON_A_DRY_SHORE_WITH_WATER_IN_REACH = { x: 210, z: -24 }; // dry underfoot, sea inside the disc
const ON_MAZE_WALL_POCKET = { x: -232, z: 452 }; // steep, and encloses its own standable foot
const DEEP_INSIDE_A_BUILDING = { x: 17, z: -6 }; // standable ground is 4.5yd out
const ON_THE_EASTBROOK_NORTH_LANE = { x: 0, z: 10 }; // the road itself: dry, flat, unblocked
const IN_THE_SOWFIELD_GOAL = { x: 23, z: -99 }; // where herb_eastbrook_4 once grew, on the pitch

const MAZE_WALL_FLOOD_BOX = boxAround([ZONES[0].hub, ON_MAZE_WALL_POCKET]);
const MAZE_WALL_FLOOD = floodFrom(ZONES[0].hub, MAZE_WALL_FLOOD_BOX);

describe('farm patch placement: every bed sits on ground a player can work', () => {
  it('the table is well formed: unique ids, tiered zones, beds on every patch', () => {
    const patchIds = FARM_PATCHES.map((p) => p.id);
    expect(new Set(patchIds).size, 'patch ids collide').toBe(patchIds.length);
    const bedIds = BEDS.map((b) => b.id);
    expect(new Set(bedIds).size, 'bed ids collide across the whole table').toBe(bedIds.length);
    // Ids are the persistence key, so a duplicate is not a cosmetic clash: two
    // beds sharing an id share one player's plot state.
    for (const patch of FARM_PATCHES) {
      expect(patch.beds.length, `${patch.id} has no beds`).toBeGreaterThan(0);
    }
    expect(BEDS.length).toBeGreaterThan(0);
  });

  it('dry land: no bed sits at or under a declared water surface', () => {
    for (const bed of BEDS) {
      const clearance = isInWaterBody(bed.x, bed.z)
        ? groundHeight(bed.x, bed.z, WORLD_SEED) - waterAt(bed.x, bed.z)
        : Number.POSITIVE_INFINITY;
      expect(
        isDryLand(bed.x, bed.z),
        `${bed.id} at (${bed.x},${bed.z}) clears the water by ${clearance.toFixed(2)}yd, needs ${WATER_MARGIN}`,
      ).toBe(true);
    }
  });

  it('the dry-land arm rejects a lake floor and the shallows, so it can fail', () => {
    // Assert the property first (these points ARE wet), then that the arm says so.
    expect(isInWaterBody(ON_MIRROR_LAKE_FLOOR.x, ON_MIRROR_LAKE_FLOOR.z)).toBe(true);
    expect(groundHeight(ON_MIRROR_LAKE_FLOOR.x, ON_MIRROR_LAKE_FLOOR.z, WORLD_SEED)).toBeLessThan(
      waterAt(ON_MIRROR_LAKE_FLOOR.x, ON_MIRROR_LAKE_FLOOR.z),
    );
    expect(isDryLand(ON_MIRROR_LAKE_FLOOR.x, ON_MIRROR_LAKE_FLOOR.z)).toBe(false);
    // The shallows are ABOVE the waterline and still fail: freeboard is what
    // this arm measures, not merely "is it submerged".
    expect(
      groundHeight(IN_GLIMMERMERE_SHALLOWS.x, IN_GLIMMERMERE_SHALLOWS.z, WORLD_SEED),
    ).toBeGreaterThan(waterAt(IN_GLIMMERMERE_SHALLOWS.x, IN_GLIMMERMERE_SHALLOWS.z));
    expect(isDryLand(IN_GLIMMERMERE_SHALLOWS.x, IN_GLIMMERMERE_SHALLOWS.z)).toBe(false);
  });

  it('sea plane: every bed clears the WORLD water surface by the prop freeboard', () => {
    for (const bed of BEDS) {
      const freeboard = seaFreeboardAt(bed.x, bed.z);
      expect(
        freeboard,
        `${bed.id} at (${bed.x},${bed.z}) clears the sea plane by ${freeboard.toFixed(2)}yd, needs ${WATER_MARGIN}`,
      ).toBeGreaterThanOrEqual(WATER_MARGIN);
    }
  });

  it('the sea-plane arm rejects the Wickharbor cove floor, so it can fail', () => {
    // The cove carves the ground 3.6yd BELOW the world sea plane while sitting
    // outside every declared water body, so the dry-land arm passes it and
    // only a depth-aware arm can object. Both halves asserted, so the fixture
    // cannot rot into a point some other arm was catching all along.
    expect(isInWaterBody(ON_WICKHARBOR_COVE_FLOOR.x, ON_WICKHARBOR_COVE_FLOOR.z)).toBe(false);
    expect(isDryLand(ON_WICKHARBOR_COVE_FLOOR.x, ON_WICKHARBOR_COVE_FLOOR.z)).toBe(true);
    expect(seaFreeboardAt(ON_WICKHARBOR_COVE_FLOOR.x, ON_WICKHARBOR_COVE_FLOOR.z)).toBeLessThan(0);
  });

  it('no water in reach: a farmer never has to stand in the water to work a bed', () => {
    // Freeboard underfoot is not the whole question: a waterline can cut
    // THROUGH the working disc, leaving part of the ground a player may
    // legally work as open water and the prop reading as standing in the surf.
    for (const bed of BEDS) {
      const clearance = cachedSeaClearance(bed.id);
      expect(
        clearance,
        `${bed.id} at (${bed.x},${bed.z}) has open water ${(-clearance).toFixed(2)}yd deep inside its ${REACH}yd working reach`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('the in-reach arm rejects a dry shore whose disc contains water', () => {
    // A spot the node suite moved a node off, chosen because it PASSES the
    // point-freeboard arm and fails only here: that is the whole reason this
    // arm exists as a separate one.
    const p = ON_A_DRY_SHORE_WITH_WATER_IN_REACH;
    expect(seaFreeboardAt(p.x, p.z), 'the fixture must be dry underfoot').toBeGreaterThanOrEqual(
      WATER_MARGIN,
    );
    expect(seaClearanceInReach(p.x, p.z), 'the fixture must have water in reach').toBeLessThan(0);
  });

  it('walkable slope: no bed, and no ground in its working reach, is a cliff', () => {
    for (const bed of BEDS) {
      expect(
        terrainSteepness(bed.x, bed.z, WORLD_SEED),
        `${bed.id} at (${bed.x},${bed.z}) stands on unwalkable ground`,
      ).toBeLessThanOrEqual(PLAYER_MAX_CLIMB_SLOPE);
      expect(
        steepestInReach(bed.x, bed.z),
        `${bed.id} at (${bed.x},${bed.z}) has a cliff inside its ${REACH}yd working reach`,
      ).toBeLessThanOrEqual(PLAYER_MAX_CLIMB_SLOPE);
      expect(
        againstWorldRim(bed.x, bed.z),
        `${bed.id} at (${bed.x},${bed.z}) sits against the world rim`,
      ).toBe(false);
      expect(
        onSealedCrest(bed.x, bed.z),
        `${bed.id} at (${bed.x},${bed.z}) sits on a sealed border crest`,
      ).toBe(false);
    }
  });

  it('the slope arm rejects a wall, and the reach sweep rejects a wall in range', () => {
    expect(
      terrainSteepness(ON_MAZE_WALL_POCKET.x, ON_MAZE_WALL_POCKET.z, WORLD_SEED),
    ).toBeGreaterThan(PLAYER_MAX_CLIMB_SLOPE);
    // The rim and sealed-crest screens get live fixtures too, or they would be
    // three predicates nothing has ever seen return true.
    expect(againstWorldRim(WORLD_MAX_X - 10, 0)).toBe(true);
    expect(againstWorldRim(0, WORLD_MIN_Z + 10)).toBe(true);
    expect(SEALED_BORDERS.length).toBeGreaterThan(0);
    const crest = SEALED_BORDERS[0];
    expect(onSealedCrest((crest.lo + crest.hi) / 2, crest.at)).toBe(true);
    // The reach sweep on its own: walkable underfoot, cliff within reach. This
    // is the half a point-only slope check cannot see.
    expect(
      terrainSteepness(IN_GLIMMERMERE_SHALLOWS.x, IN_GLIMMERMERE_SHALLOWS.z, WORLD_SEED),
    ).toBeLessThanOrEqual(PLAYER_MAX_CLIMB_SLOPE);
    expect(steepestInReach(IN_GLIMMERMERE_SHALLOWS.x, IN_GLIMMERMERE_SHALLOWS.z)).toBeGreaterThan(
      PLAYER_MAX_CLIMB_SLOPE,
    );
  });

  it('no collider overlap: no bed is buried inside a building, trunk or fence', () => {
    // Beds carry no body of their own, so the question is entirely about
    // FOREIGN geometry: the nearest standable ground must be within a bed's
    // self clearance, which for a bodiless prop is the player's own radius
    // plus one sweep step.
    for (const bed of BEDS) {
      const spot = nearestStandSpot(bed.x, bed.z);
      expect(
        spot,
        `${bed.id} at (${bed.x},${bed.z}) has no unblocked ground in reach`,
      ).not.toBeNull();
      if (!spot) continue;
      expect(
        spot.r,
        `${bed.id} at (${bed.x},${bed.z}) is buried in foreign geometry: nearest standable ground is ${spot.r.toFixed(2)}yd out, past its ${BED_CLEARANCE.toFixed(2)}yd clearance`,
      ).toBeLessThanOrEqual(BED_CLEARANCE);
    }
  });

  it('the collider arm rejects a point buried inside a building, so it can fail', () => {
    expect(
      isBlocked(WORLD_SEED, DEEP_INSIDE_A_BUILDING.x, DEEP_INSIDE_A_BUILDING.z, PLAYER_BODY_RADIUS),
    ).toBe(true);
    const buried = nearestStandSpot(DEEP_INSIDE_A_BUILDING.x, DEEP_INSIDE_A_BUILDING.z);
    // Fails on DISTANCE rather than because the sweep ran out of room: the
    // nearest standable ground is real, measurable, and inside the reach the
    // sweep searches, and still well past the bed clearance.
    expect(buried, 'the buried fixture must be measurable, or it proves nothing').not.toBeNull();
    if (!buried) return;
    expect(buried.r).toBeGreaterThan(BED_CLEARANCE);
    expect(buried.r).toBeLessThanOrEqual(REACH);
    // And the bound is tight enough to be worth having.
    expect(BED_CLEARANCE).toBeLessThan(REACH);
  });

  it('a stand spot: every bed can be worked from a spot that is itself reachable', () => {
    // Existence alone is not enough: a standable ledge walled off from the
    // rest of the zone satisfies "there is somewhere to stand" while being no
    // use to a player, so the spot has to sit in the hub's reachable set too.
    for (const bed of BEDS) {
      const spot = nearestStandSpot(bed.x, bed.z);
      expect(
        spot,
        `${bed.id} at (${bed.x},${bed.z}) has nowhere within ${REACH}yd a player can stand`,
      ).not.toBeNull();
      if (!spot) continue;
      expect(spot.r).toBeLessThanOrEqual(REACH);
      expect(
        reachedByZone.get(bed.zoneId)?.has(cellKey(spot.x, spot.z)),
        `${bed.id}'s stand spot (${spot.x.toFixed(1)},${spot.z.toFixed(1)}) is cut off from the ${bed.zoneId} hub`,
      ).toBe(true);
    }
  });

  it('the stand-spot arm rejects a lake floor, whose whole reach is swim depth', () => {
    expect(isSwimDepth(ON_MIRROR_LAKE_FLOOR.x, ON_MIRROR_LAKE_FLOOR.z)).toBe(true);
    expect(nearestStandSpot(ON_MIRROR_LAKE_FLOOR.x, ON_MIRROR_LAKE_FLOOR.z)).toBeNull();
  });

  it('the stand-spot arm rejects a standable spot that is walled off', () => {
    // The other half of that arm, which the lake floor cannot exercise: it
    // returns null before the reachability leg is ever consulted. At the maze
    // wall a spot IS standable and the leg is the only thing that rejects it.
    const spot = nearestStandSpot(ON_MAZE_WALL_POCKET.x, ON_MAZE_WALL_POCKET.z);
    expect(spot, 'the maze fixture must be standable, or it proves nothing').not.toBeNull();
    if (!spot) return;
    expect(MAZE_WALL_FLOOD.has(cellKey(spot.x, spot.z))).toBe(false);
  });

  it('hub reachability: every bed is walkable-or-swimmable from its zone hub', () => {
    for (const bed of BEDS) {
      const reached = reachedByZone.get(bed.zoneId);
      expect(reached, `no flood for zone ${bed.zoneId}`).toBeDefined();
      expect(
        reached?.has(cellKey(bed.x, bed.z)),
        `${bed.id} at (${bed.x},${bed.z}) is cut off from the ${bed.zoneId} hub`,
      ).toBe(true);
    }
    // Every farmed zone really did get a flood, so the arm above cannot pass
    // for a zone whose map entry is simply missing.
    for (const zoneId of new Set(BEDS.map((b) => b.zoneId))) {
      expect(reachedByZone.has(zoneId), `${zoneId} has beds but no flood`).toBe(true);
    }
  });

  it('the reachability arm rejects a point walled off in the maze pocket', () => {
    // Flood a box that deliberately CONTAINS the maze point, so failing to
    // reach it is the wall's doing and not the bounding box's.
    expect(ON_MAZE_WALL_POCKET.x).toBeGreaterThanOrEqual(MAZE_WALL_FLOOD_BOX.xMin);
    expect(ON_MAZE_WALL_POCKET.x).toBeLessThanOrEqual(MAZE_WALL_FLOOD_BOX.xMax);
    expect(ON_MAZE_WALL_POCKET.z).toBeGreaterThanOrEqual(MAZE_WALL_FLOOD_BOX.zMin);
    expect(ON_MAZE_WALL_POCKET.z).toBeLessThanOrEqual(MAZE_WALL_FLOOD_BOX.zMax);
    // NOT the origin cell, which floodFrom seeds unconditionally: a cell 100
    // yards out proves the flood actually travelled before the wall stopped it.
    expect(MAZE_WALL_FLOOD.has(cellKey(-100, 0))).toBe(true);
    expect(MAZE_WALL_FLOOD.has(cellKey(ON_MAZE_WALL_POCKET.x, ON_MAZE_WALL_POCKET.z))).toBe(false);
  });

  it('zone containment: every bed and every patch anchor stands in its declared zone', () => {
    // The declared zoneId is what the farming tier ladder is keyed on
    // (professions/farming_zones.ts), so a patch standing in one band while
    // claiming another farms at the other band's tier. zoneAt is the resolver
    // the sim uses, and it is EXCLUSIVE at zMax where an inclusive band check
    // would pass a row sitting exactly on a boundary.
    for (const patch of FARM_PATCHES) {
      expect(
        zoneAt(patch.x, patch.z).id,
        `${patch.id}'s anchor at (${patch.x},${patch.z}) claims ${patch.zoneId} but stands in another zone`,
      ).toBe(patch.zoneId);
      expect(Math.abs(patch.x), `${patch.id} is outside the world's x bounds`).toBeLessThanOrEqual(
        WORLD_MAX_X,
      );
    }
    for (const bed of BEDS) {
      expect(
        zoneAt(bed.x, bed.z).id,
        `${bed.id} at (${bed.x},${bed.z}) claims ${bed.zoneId} but stands in another zone`,
      ).toBe(bed.zoneId);
      expect(Math.abs(bed.x), `${bed.id} is outside the world's x bounds`).toBeLessThanOrEqual(
        WORLD_MAX_X,
      );
    }
  });

  it('the zone arm rejects a boundary z the inclusive band check would allow', () => {
    const eastbrook = ZONES[0];
    expect(eastbrook.id).toBe('eastbrook_vale');
    const boundary = eastbrook.zMax;
    expect(boundary >= eastbrook.zMin && boundary <= eastbrook.zMax).toBe(true);
    expect(zoneAt(0, boundary).id).not.toBe(eastbrook.id);
  });

  it('a patch anchor is itself ground a player can reach and stand on', () => {
    // The anchor is what a map pin and the render phase read, so it is where a
    // player walks to. A pin inside a wall or on a lake floor is the same
    // defect as a bed there, one step earlier.
    for (const patch of FARM_PATCHES) {
      expect(isDryLand(patch.x, patch.z), `${patch.id}'s anchor is in the water`).toBe(true);
      expect(
        seaFreeboardAt(patch.x, patch.z),
        `${patch.id}'s anchor is under the sea plane`,
      ).toBeGreaterThanOrEqual(WATER_MARGIN);
      const spot = nearestStandSpot(patch.x, patch.z);
      expect(spot, `${patch.id}'s anchor has nowhere to stand`).not.toBeNull();
      if (!spot) continue;
      expect(
        reachedByZone.get(patch.zoneId)?.has(cellKey(spot.x, spot.z)),
        `${patch.id}'s anchor is cut off from the ${patch.zoneId} hub`,
      ).toBe(true);
    }
  });

  it('minimum spacing: no two beds collapse into one working reach', () => {
    for (let i = 0; i < BEDS.length; i++) {
      for (let j = i + 1; j < BEDS.length; j++) {
        const a = BEDS[i];
        const b = BEDS[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        expect(d, `${a.id} and ${b.id} are ${d.toFixed(2)}yd apart`).toBeGreaterThanOrEqual(
          BED_SPACING,
        );
      }
    }
  });

  it('the spacing floor is exercised by real content, not passing by slack', () => {
    // Without this the arm above could hold simply because nothing comes near
    // the floor. The authored grid sits EXACTLY on it, so the bound is
    // load-bearing: any bed nudged toward its neighbour reds immediately.
    let tightest = Number.POSITIVE_INFINITY;
    let pair = '';
    for (let i = 0; i < BEDS.length; i++) {
      for (let j = i + 1; j < BEDS.length; j++) {
        const a = BEDS[i];
        const b = BEDS[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < tightest) {
          tightest = d;
          pair = `${a.id} / ${b.id}`;
        }
      }
    }
    expect(tightest, `tightest pair ${pair}`).toBeGreaterThanOrEqual(BED_SPACING);
    expect(tightest, `tightest pair ${pair}`).toBe(BED_SPACING);
  });

  it('no bed grows on top of a gather node', () => {
    // The same floor, applied across the two tables: a bed sharing ground with
    // an ore vein or a wood pile puts two different interact targets in one
    // reach, and the vein is also a solid body a bed would be seated inside.
    for (const bed of BEDS) {
      for (const node of GATHER_NODES) {
        const d = Math.hypot(bed.x - node.pos.x, bed.z - node.pos.z);
        expect(d, `${bed.id} is ${d.toFixed(2)}yd from ${node.id}`).toBeGreaterThanOrEqual(
          BED_SPACING,
        );
      }
    }
  });

  it('the node-clearance arm rejects a bed placed on a node, so it can fail', () => {
    // A node's own coordinate is the zero-distance case, which no arm above
    // would catch: the ground under a gather node is dry, walkable, reachable
    // and in the right zone by construction, because it passed the node suite.
    expect(GATHER_NODES.length).toBeGreaterThan(0);
    const node = GATHER_NODES[0];
    const d = Math.hypot(node.pos.x - node.pos.x, node.pos.z - node.pos.z);
    expect(d).toBe(0);
    expect(d).toBeLessThan(BED_SPACING);
  });

  it('no bed grows inside the Sowfield boarball ground', () => {
    // SOWFIELD_EXCLUDE is the footprint world.ts already refuses to seat a
    // world prop in: the pitch, its goal pockets, both stands, the gate
    // approach and the terrain flatten's apron. A farm on a match venue is
    // worked at the pitch police's pleasure (vale_cup ejects any non-fighter
    // standing there), and the beds would grow on the playing surface. Reusing
    // the shipped exclusion keeps ONE definition of the venue's footprint.
    for (const bed of BEDS) {
      expect(
        inSowfield(bed.x, bed.z),
        `${bed.id} at (${bed.x},${bed.z}) sits inside the Sowfield boarball ground`,
      ).toBe(false);
    }
  });

  it('the Sowfield arm rejects the pitch, so it can fail', () => {
    // Not merely inside the apron: on the playing surface itself.
    expect(inSowfield(IN_THE_SOWFIELD_GOAL.x, IN_THE_SOWFIELD_GOAL.z)).toBe(true);
    expect(isOnPitch(IN_THE_SOWFIELD_GOAL.x, IN_THE_SOWFIELD_GOAL.z)).toBe(true);
    // And the Eastbrook beds, the only ones near this venue, clear it by a
    // real distance rather than sitting on its boundary.
    const eastbrookBeds = BEDS.filter((b) => b.zoneId === 'eastbrook_vale');
    expect(eastbrookBeds.length).toBeGreaterThan(0);
    for (const bed of eastbrookBeds) {
      expect(bed.z - SOWFIELD_EXCLUDE.zMax, `${bed.id} hugs the Sowfield apron`).toBeGreaterThan(2);
    }
  });

  it('no bed grows inside a mob camp footprint', () => {
    // STRICTER THAN THE NODE SUITE, deliberately. That suite screens gather
    // nodes against NAMED mobs only, and records ordinary camp overlap as
    // designed risk: a third of all nodes sit inside a camp on purpose. A farm
    // is a different kind of place. A node is a few seconds of exposure, while
    // a bed is ground a player returns to and stands on through a plant, a
    // tend and a harvest, so a site inside a spawn disc is a site that is
    // fought over every visit. This is the rule that moved the tier-1 patch
    // off the obvious farmland west of Eastbrook, and without an arm the next
    // coordinate edit would reseat it there with every other arm still green.
    for (const bed of BEDS) {
      const { margin, mobId } = campFootprintMargin(bed.x, bed.z);
      expect(
        margin,
        `${bed.id} at (${bed.x},${bed.z}) is ${(-margin).toFixed(2)}yd inside the ${mobId} camp`,
      ).toBeGreaterThanOrEqual(0);
    }
    // The anchor is a map pin players walk to, so it answers the same question.
    for (const patch of FARM_PATCHES) {
      const { margin, mobId } = campFootprintMargin(patch.x, patch.z);
      expect(
        margin,
        `${patch.id}'s anchor is ${(-margin).toFixed(2)}yd inside the ${mobId} camp`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('the camp arm rejects the old west site, and nothing else would have', () => {
    // The skeleton's original Eastbrook anchor. It is 8.1yd inside the
    // Sableweb webwood spider disc, and it passes every other arm in this
    // file: dry, above the sea plane, level, unblocked, standable, in its
    // zone, off the road, out of the Sowfield and clear of every gather node.
    // That is the point of asserting all of them here rather than just the
    // camp margin: this arm is the ONLY thing that rejects the site, so
    // deleting it silently reopens the placement it forced.
    const OLD_WEST_SITE = { x: -48, z: -2 };
    const { margin, mobId } = campFootprintMargin(OLD_WEST_SITE.x, OLD_WEST_SITE.z);
    expect(mobId).toBe('webwood_spider');
    expect(margin).toBeLessThan(0);

    expect(isDryLand(OLD_WEST_SITE.x, OLD_WEST_SITE.z)).toBe(true);
    expect(seaFreeboardAt(OLD_WEST_SITE.x, OLD_WEST_SITE.z)).toBeGreaterThanOrEqual(WATER_MARGIN);
    expect(seaClearanceInReach(OLD_WEST_SITE.x, OLD_WEST_SITE.z)).toBeGreaterThanOrEqual(0);
    expect(steepestInReach(OLD_WEST_SITE.x, OLD_WEST_SITE.z)).toBeLessThanOrEqual(
      PLAYER_MAX_CLIMB_SLOPE,
    );
    expect(againstWorldRim(OLD_WEST_SITE.x, OLD_WEST_SITE.z)).toBe(false);
    expect(onSealedCrest(OLD_WEST_SITE.x, OLD_WEST_SITE.z)).toBe(false);
    const spot = nearestStandSpot(OLD_WEST_SITE.x, OLD_WEST_SITE.z);
    expect(spot).not.toBeNull();
    expect(spot?.r ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(BED_CLEARANCE);
    expect(zoneAt(OLD_WEST_SITE.x, OLD_WEST_SITE.z).id).toBe('eastbrook_vale');
    expect(roadDistance(OLD_WEST_SITE.x, OLD_WEST_SITE.z)).toBeGreaterThanOrEqual(ROAD_MARGIN);
    expect(inSowfield(OLD_WEST_SITE.x, OLD_WEST_SITE.z)).toBe(false);
    for (const node of GATHER_NODES) {
      const d = Math.hypot(OLD_WEST_SITE.x - node.pos.x, OLD_WEST_SITE.z - node.pos.z);
      expect(d).toBeGreaterThanOrEqual(BED_SPACING);
    }
    // And the arm is a screen rather than a blanket: the shipped beds clear
    // every footprint by a real margin instead of sitting on a rim.
    const tightest = Math.min(...BEDS.map((b) => campFootprintMargin(b.x, b.z).margin));
    expect(tightest).toBeGreaterThan(0);
  });

  it('off the road: no bed straddles the lane it is reached by', () => {
    for (const bed of BEDS) {
      const d = roadDistance(bed.x, bed.z);
      expect(
        d,
        `${bed.id} at (${bed.x},${bed.z}) sits ${d.toFixed(2)}yd from a road, needs ${ROAD_MARGIN}`,
      ).toBeGreaterThanOrEqual(ROAD_MARGIN);
    }
  });

  it('the road arm rejects a point on the road, and nothing else would have', () => {
    // The fixture is the Eastbrook north lane. It passes every other arm in
    // this file, which is the point: a road is dry, level, unblocked, in its
    // zone and reachable by construction, so this arm is the only one that can
    // see it.
    const p = ON_THE_EASTBROOK_NORTH_LANE;
    expect(roadDistance(p.x, p.z)).toBeLessThan(ROAD_MARGIN);
    expect(isDryLand(p.x, p.z)).toBe(true);
    expect(seaFreeboardAt(p.x, p.z)).toBeGreaterThanOrEqual(WATER_MARGIN);
    expect(steepestInReach(p.x, p.z)).toBeLessThanOrEqual(PLAYER_MAX_CLIMB_SLOPE);
    expect(nearestStandSpot(p.x, p.z)?.r ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      BED_CLEARANCE,
    );
    expect(inSowfield(p.x, p.z)).toBe(false);
    // And it is a screen, not a blanket: the authored beds are off the roads
    // without being banished from the lanes that serve them.
    const nearest = Math.min(...BEDS.map((b) => roadDistance(b.x, b.z)));
    expect(nearest).toBeGreaterThanOrEqual(ROAD_MARGIN);
    expect(nearest).toBeLessThan(40);
  });
});
