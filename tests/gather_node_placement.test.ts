// Gather-node placement: does every authored node in src/sim/content/gather_nodes.ts
// sit somewhere a player can actually reach, stand on, and work?
//
// Nothing validated a node COORDINATE before this file, and the content had drifted
// badly: six of the eleven herb patches sat on a lake floor about 4 yards under the
// surface, all three Eastbrook ones included, so the only way to pick a herb in the
// starting zone was to swim to the bottom of Mirror Lake. A seventh node, a wood
// stand, sat in the Glimmermere shallows against a wall whose gradient reaches 3.28
// rise/run inside its own harvest reach.
//
// Every threshold here is a SHIPPED constant, never a fresh number: the movement
// climb limit and body radius come from the pathfinding module, the harvest reach
// is the same INTERACT_RANGE the harvest gate uses, and the water margin matches
// the one generateDecorations already screens world props with. The point is that
// this file cannot drift away from the rules the game actually enforces.
//
// The seed is the shipped world seed, and only that one. Terrain is a pure
// function of (x, z, seed): node coordinates are hand-authored against THIS
// world, so validating them at any other seed would be checking placements
// against terrain that never ships.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  CAMPS,
  GATHER_NODE_TYPES,
  GATHER_NODES,
  MOBS,
  STRIP_MAX_X,
  STRIP_MIN_X,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
  ZONES,
  zoneAt,
} from '../src/sim/data';
import { POI_VISIT_RADIUS } from '../src/sim/deeds';
import { MAX_AGGRO_RADIUS } from '../src/sim/mob/aggro_ranges';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import { NODE_HARVEST_TABLE } from '../src/sim/professions/gathering';
import { GATHER_NODE_BODIES } from '../src/sim/prop_layout';
import { INTERACT_RANGE } from '../src/sim/types';
import {
  GOAL_LINE_EAST_X,
  GOAL_LINE_WEST_X,
  isOnPitch,
  PITCH_CENTER,
  SOWFIELD_EXCLUDE,
} from '../src/sim/vale_cup_layout';
import {
  DECORATION_MAX_SLOPE,
  groundHeight,
  isInWaterBody,
  roadDistance,
  SEALED_BORDERS,
  terrainHeight,
  terrainSteepness,
  terrainSteepnessAt,
  waterLevel,
  waterLevelAt,
} from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';
import { WORLD_SEED } from '../src/sim/world_seed';

// The live shipped seed (src/sim/world_seed.ts, the one both hosts build
// from), never a copy: every geometry assertion below is about THE world.
//
// One literal pin, deliberately: every suite now derives from the shared
// constant, so without this line a seed change would reshuffle the whole
// persistent world with a fully green suite (the constant-self-comparison
// trap). Moving the shipped seed must be a decision that reddens a test.
it('the shipped world seed is pinned to its literal', () => {
  expect(WORLD_SEED).toBe(20061);
});

// Freeboard a node needs above the local water surface. The NUMBER is not a new
// one: generateDecorations (world.ts) refuses to anchor a tree or boulder below
// waterLevel() + 1, and a gather node is the same kind of object, a procedurally
// placed world prop seated on the heightfield. The PREDICATE here is deliberately
// not the same: that screen reads terrainHeight against the global waterLevel()
// everywhere, while this reads groundHeight against waterLevelAt and only inside
// a declared water body, so a dry sunken feature (the Mirefen impact crater is
// one) stays legal exactly as isInWaterBody documents. The two predicates WERE
// separated by the v0.32.0 expansion's coastal starter kits: seven shipped
// expansion nodes sat below the global line (down to 3.6yd under it on the
// Wickharbor cove floor, whose two nodes moved ashore at the v0.34.0 merge)
// while passing this declared-water screen, which is
// why the world-plane check is now its own arm below (the sea-plane arm and its
// in-reach companion) rather than a claim in this comment. Measured headroom on
// the shipped content when this margin landed: the tightest passing node
// cleared by 0.57yd (ore_mirefen_t2, a genuine bank inside a lake's blend
// ring), and the tightest FAILING one missed by 0.54yd (the old
// wood_thornpeak_1, ankle deep in the Glimmermere), so the line sits in a real
// gap rather than splitting a cluster.
const WATER_MARGIN = 1;

// A node's "harvest reach" is exactly the gate harvestNode enforces: flat 2D
// distance <= INTERACT_RANGE (gathering.ts distToNode). Every arm below that
// talks about the ground AROUND a node means this disc.
const REACH = INTERACT_RANGE;

/** Height the local water surface sits at, or -Infinity where no water is declared. */
function waterAt(x: number, z: number): number {
  return waterLevelAt(x, z, WORLD_SEED);
}

/** True where the ground is high enough above any declared water to be dry land. */
function isDryLand(x: number, z: number): boolean {
  if (!isInWaterBody(x, z)) return true; // no water declared here at all
  return groundHeight(x, z, WORLD_SEED) >= waterAt(x, z) + WATER_MARGIN;
}

/** Deep enough under a declared water surface that a player swims instead of walking. */
function isSwimDepth(x: number, z: number): boolean {
  return groundHeight(x, z, WORLD_SEED) < waterAt(x, z) - PLAYER_SWIM_DEPTH;
}

/**
 * Can a player hold this exact spot? These are the sim's own rules, not a
 * restatement: player_motion strips control and slides the player downhill off
 * ground whose gradient beats MAX_CLIMB_SLOPE (its steepGround arm, which reads
 * the memoized terrainSteepnessAt, so this uses the same function), a static
 * collider pushes the body out (colliders.isBlocked), and ground below swim
 * depth means treading water rather than standing.
 */
function canStand(x: number, z: number): boolean {
  if (isBlocked(WORLD_SEED, x, z, PLAYER_BODY_RADIUS)) return false;
  if (isSwimDepth(x, z)) return false;
  return terrainSteepnessAt(x, z, WORLD_SEED) <= PLAYER_MAX_CLIMB_SLOPE;
}

// Sampling density for the two reach sweeps below. Both use the same fan so a
// gradient the slope arm rejects cannot hide in a gap the stand arm would have
// looked at: at 0.5yd rings and 24 spokes the widest arc gap is about 1.3yd at
// the far edge of reach. This is a screen, not a proof, and it deliberately
// costs more than it needs to; the whole file runs in about a second.
const SWEEP_STEP = 0.5;
const SWEEP_SPOKES = 24;

/**
 * Steepest gradient anywhere in a node's harvest reach, node included. Uses the
 * EXACT terrainSteepness rather than the cell-memoized terrainSteepnessAt,
 * because this arm is about the shape of the ground a prop is anchored into
 * (world.ts screens scatter props the same way) rather than about the movement
 * gate, which is what canStand covers.
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

/**
 * How far from a node's own centre the nearest standable ground can legitimately
 * sit when NOTHING foreign is in the way. An ore vein and a wood pile are solid
 * bodies centred on their own coordinate, so a player is pushed clear by the
 * node's radius plus their own; the extra sweep step is because nearestStandSpot
 * samples on a 0.5yd ring and so cannot report a finer distance than that.
 *
 * ONE definition, read by both the arm and its counter-example. They used to
 * compute it separately, which meant loosening the arm left the counter-example
 * still passing against its own private copy: a mutation pass caught exactly
 * that, so the number lives here and nowhere else.
 */
function selfClearanceFor(nodeType: string): number {
  return (GATHER_NODE_BODIES[nodeType]?.r ?? 0) + PLAYER_BODY_RADIUS + SWEEP_STEP;
}

/** The closest spot inside the harvest reach a player can stand on, or null. */
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

// --- hub reachability -------------------------------------------------------
// A coarse walkability flood, stepping the sim's own uphill wall rule. findPath
// cannot answer this: its window caps at 64 cells per axis and it falls back to
// a straight line past that, so it would report every far node "reachable" by
// fiat. Water is traversable because players swim, which is why a submerged node
// still passes THIS arm and gets caught by the dry-land and stand-spot arms
// instead: each arm fails for its own reason.

const FLOOD_CELL = 2; // yards per cell
const FLOOD_MARGIN = 45; // yards of slack around the hub + nodes bounding box

/** Height the body rides at: the water surface when submerged, else the ground. */
function rideHeight(x: number, z: number): number {
  const h = groundHeight(x, z, WORLD_SEED);
  const wl = waterAt(x, z);
  return h < wl ? wl : h;
}

/**
 * player_motion's wall rule in SHAPE, not verbatim: an uphill step is refused
 * when the step itself beats the climb limit OR it lands on ground whose own
 * gradient does, so approaching a wall at an angle cannot cheat it, and downhill
 * is never refused. Four deliberate divergences, all in the permissive direction
 * so this cannot invent a wall the game does not have: it rides rideHeight where
 * movement reads groundHeight and skips the block entirely while swimming, it
 * treats a swim-depth destination as passable outright, it steps 2 yards where a
 * player steps about RUN_SPEED * DT (which climbs the east rim roughly 2 yards
 * further than a 0.5-yard flood), and it refuses a blocked step where movement
 * would slide along the collider.
 */
/**
 * Is a FLOOD CELL passable, as opposed to its exact centre point? These are not
 * the same question once small world bodies exist. A gather node's own body is
 * a 0.44yd circle, which with the player's 0.5yd radius blocks a 0.94yd disc,
 * and probing only the cell centre therefore blanks a whole 2yd cell because a
 * rock sits in the middle of it. A player walks past that rock; the flood has
 * to be able to as well, or every ore and wood node on an even coordinate
 * reports itself unreachable.
 *
 * So the cell is passable when ANY of nine samples is: the centre plus a ring
 * at 0.8yd offsets. The 0.8 is chosen against the shipped radii rather than
 * picked: the four diagonal samples sit 1.13yd from the centre, clear of the
 * 0.94yd disc a node's own body can block, while staying inside the cell's own
 * 1.0yd half-width. Anything big enough to be a real wall still blanks all
 * nine. This is one more divergence in the PERMISSIVE direction, which is the
 * only direction this flood is allowed to differ in (see stepAllowed below).
 */
const CELL_PROBE_OFFSET = 0.8;
function cellPassable(x: number, z: number): boolean {
  for (const dx of [0, -CELL_PROBE_OFFSET, CELL_PROBE_OFFSET]) {
    for (const dz of [0, -CELL_PROBE_OFFSET, CELL_PROBE_OFFSET]) {
      if (!isBlocked(WORLD_SEED, x + dx, z + dz, PLAYER_BODY_RADIUS)) return true;
    }
  }
  return false;
}

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

// The hub CENTRE is not guaranteed walkable: several expansion hubs seat a
// structure on the exact centre (Eldergleam's great tree, the Wyrmwatch
// brazier, Icemantle's hearth), and a player gathers from the plaza around
// it. The flood therefore starts from the nearest passable cell inside the
// hub circle; a hub with NO passable cell at all would return the centre and
// flood nothing, which the reachability arm below then reports node by node.
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

// Reachability floods are the one expensive thing here, so run each zone's once
// and share it across the arms that need it.
const reachedByZone = new Map<string, Set<string>>();
for (const zone of ZONES) {
  const nodes = GATHER_NODES.filter((n) => n.zoneId === zone.id).map((n) => n.pos);
  const start = hubFloodStart(zone);
  reachedByZone.set(zone.id, floodFrom(start, boxAround([start, ...nodes])));
}

// Named points used as counter-examples below. Every one is measured, not
// assumed, and each is asserted to genuinely have the property it stands for, so
// an arm can never pass because its counter-example quietly stopped being one.
const ON_MIRROR_LAKE_FLOOR = { x: -86, z: 90 }; // where herb_eastbrook_1 used to sit
const IN_GLIMMERMERE_SHALLOWS = { x: -55, z: 765 }; // where wood_thornpeak_1 used to sit
// The deliberate-geometry screens the slope arm applies to every node. Since
// v0.32.0 nearSteepWalls paints a broad ADVISORY band around every border
// (world.ts: the border hills are "never a hard wall", and legitimate gather
// ground sits inside the 4-sigma band), so the screen is the two shapes a
// player genuinely cannot work: the world-rim margin and a sealed border
// crest (crossesSealedBorder is a hard movement wall; 48 is
// SEALED_RIDGE_SIGMA * 4, the crest's own relief band).
function againstWorldRim(x: number, z: number): boolean {
  return (
    x <= WORLD_MIN_X + 40 || x >= WORLD_MAX_X - 40 || z <= WORLD_MIN_Z + 40 || z >= WORLD_MAX_Z - 40
  );
}
function onSealedCrest(x: number, z: number): boolean {
  return SEALED_BORDERS.some((b) => x >= b.lo && x <= b.hi && Math.abs(z - b.at) < 48);
}

// The pre-expansion fixture here was the east rim wall at (165,0); the
// v0.32.0 world fades the rim into flat, REACHABLE staging ground, so the
// wall counter-example moved to a Great Maze terrain-wall corner, which is
// steep, wall-banded, and encloses its own standable foot away from the
// zone flood (measured: steepness 4.59, spot (-231.5,452.0) unreached).
const ON_MAZE_WALL_POCKET = { x: -232, z: 452 };
// Shared once, the same reason reachedByZone above is: the stand-spot and
// reachability counter-example arms below both flood this exact origin
// against this exact box (ZONES[0].hub, boxed around the hub and the maze
// pocket), so computing it twice bought nothing but wall time.
const MAZE_WALL_FLOOD_BOX = boxAround([ZONES[0].hub, ON_MAZE_WALL_POCKET]);
const MAZE_WALL_FLOOD = floodFrom(ZONES[0].hub, MAZE_WALL_FLOOD_BOX);
const ON_SOWFIELD_STAND = { x: -41, z: -137 }; // groundHeight adds the stand lift here
const INSIDE_A_TOWN_COLLIDER = { x: -29, z: 0 };
// Genuinely enclosed, not merely overlapping: the nearest ground a player
// can hold is 4.5yd away, three times the widest clearance a node's own
// body can account for, and still inside the harvest reach the sweep
// searches so the fixture fails on distance rather than on running out of
// room. This is the counter-example the buried-in-geometry arm needs.
const DEEP_INSIDE_A_BUILDING = { x: 17, z: -6 };

describe('gather node placement: every node sits on ground a player can work', () => {
  it('dry land: no node sits at or under a declared water surface', () => {
    for (const node of GATHER_NODES) {
      const { x, z } = node.pos;
      const clearance = isInWaterBody(x, z)
        ? groundHeight(x, z, WORLD_SEED) - waterAt(x, z)
        : Number.POSITIVE_INFINITY;
      expect(
        isDryLand(x, z),
        `${node.id} at (${x},${z}) clears the water by ${clearance.toFixed(2)}yd, needs ${WATER_MARGIN}`,
      ).toBe(true);
    }
  });

  it('the dry-land arm rejects a lake floor and the shallows, so it can fail', () => {
    // Both are real placements this change moved off. Assert the property first
    // (these points ARE wet), then that the arm says so.
    expect(isInWaterBody(ON_MIRROR_LAKE_FLOOR.x, ON_MIRROR_LAKE_FLOOR.z)).toBe(true);
    expect(groundHeight(ON_MIRROR_LAKE_FLOOR.x, ON_MIRROR_LAKE_FLOOR.z, WORLD_SEED)).toBeLessThan(
      waterAt(ON_MIRROR_LAKE_FLOOR.x, ON_MIRROR_LAKE_FLOOR.z),
    );
    expect(isDryLand(ON_MIRROR_LAKE_FLOOR.x, ON_MIRROR_LAKE_FLOOR.z)).toBe(false);
    // The shallows are ABOVE the waterline yet still fail: freeboard alone is
    // what this arm measures, not merely "is it submerged".
    expect(
      groundHeight(IN_GLIMMERMERE_SHALLOWS.x, IN_GLIMMERMERE_SHALLOWS.z, WORLD_SEED),
    ).toBeGreaterThan(waterAt(IN_GLIMMERMERE_SHALLOWS.x, IN_GLIMMERMERE_SHALLOWS.z));
    expect(isDryLand(IN_GLIMMERMERE_SHALLOWS.x, IN_GLIMMERMERE_SHALLOWS.z)).toBe(false);
  });

  // The render seats ONE world-spanning water surface at waterLevel()
  // (src/render/water.ts: a plane per zone plus the shared apron on the high
  // tier, a single 3000yd plane on the low tier), so ground below that height
  // shows water EVERYWHERE, while the dry-land arm above screens only
  // DECLARED water bodies and the swim rules engage only inside them. A node
  // outside every declared body can therefore pass every sim rule and still
  // render under the sea (the phase 20 authoring pass found candidates doing
  // exactly that, and the census below found seven SHIPPED ones). The
  // freeboard is WATER_MARGIN, the same yard generateDecorations demands of
  // every other procedurally seated world prop.
  const seaFreeboardAt = (x: number, z: number): number =>
    groundHeight(x, z, WORLD_SEED) - waterLevel();

  // No exemptions. There WAS an exemption list here, holding the three nodes
  // that shipped at or under the waterline (ore_frostveil_2 under it outright,
  // wood_evergarden_2 and ore_willowfen_1 at half a yard) on the reading that
  // relocating expansion starter nodes was zone-4-pass content work rather
  // than a side effect of a guard landing. Four earlier members had already
  // retired that way at the release/v0.34.0 merge, when open-sea swim turned
  // herb_galecrest_1, ore_galecrest_2, herb_farshore_isle_2 and
  // wood_farshore_isle_1 from render-only violations into nodes a player
  // cannot stand at. The last three retired the same way here: a vein
  // rendering on a pond floor is the defect a player reports, not a decision
  // to record, so all three moved ashore and the list went with them. A node
  // under the sea plane now simply reds.
  it('sea plane: every node clears the WORLD water surface by the prop freeboard', () => {
    for (const node of GATHER_NODES) {
      const freeboard = seaFreeboardAt(node.pos.x, node.pos.z);
      expect(
        freeboard,
        `${node.id} at (${node.pos.x},${node.pos.z}) clears the sea plane by ${freeboard.toFixed(2)}yd, needs ${WATER_MARGIN}`,
      ).toBeGreaterThanOrEqual(WATER_MARGIN);
    }
  });

  it('the sea-plane floor is exercised by real content, not passing by slack', () => {
    // What the retired exemption list used to do, without the license: name
    // the tightest shipped node, so the floor is provably load-bearing rather
    // than clearing by twenty yards everywhere. The tightest passer sits
    // inside a yard of the bound, which is where a floor has to sit to mean
    // anything; if this reds, terrain or the waterline moved under a node.
    let tightest = Number.POSITIVE_INFINITY;
    let who = '';
    for (const node of GATHER_NODES) {
      const freeboard = seaFreeboardAt(node.pos.x, node.pos.z);
      if (freeboard < tightest) {
        tightest = freeboard;
        who = node.id;
      }
    }
    expect(tightest, `tightest freeboard is ${who}`).toBeGreaterThanOrEqual(WATER_MARGIN);
    expect(tightest, `tightest freeboard is ${who}`).toBeLessThan(WATER_MARGIN + 1);
  });

  // The water sweep samples MORE densely than the slope sweeps above, and the
  // reason is the shape of what it hunts rather than a taste for precision. A
  // cliff is a broad feature, so the fan's widening arc gap (about 1.3yd at
  // the edge of reach) cannot hide one. A waterline is a CONTOUR, and a tongue
  // of sea reaching into a disc can be narrower than that gap the whole way
  // in, so on a coarse fan the ANSWER depends on the spoke count you happened
  // to pick: the old herb_farshore_isle_4 spot on the Gull Mere neck reads
  // +0.07 on 24 spokes and -0.13 on 36, because a 36-spoke ray lands in a
  // sliver the 24-spoke rays straddle. So this sweep uses two grids whose
  // resolution is stated rather than incidental. Rings at SWEEP_STEP with the
  // spoke count derived from WATER_ARC cover every radius including the RIM,
  // which is where a shoreline usually crosses a disc and where a square
  // lattice has no samples at all; the lattice covers the interior, where
  // rings spread out. Together no point of the disc is further than about
  // WATER_ARC from a sample. Still a screen and not a proof (a channel
  // thinner than that can cross between samples), but a screen whose blind
  // spot is a number.
  const WATER_ARC = 0.35;
  /**
   * How far the LOWEST ground anywhere in a node's harvest reach sits above the
   * world water surface. Negative means open water inside the disc.
   */
  const seaClearanceInReach = (x: number, z: number): number => {
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
  };

  // Computed once and shared, the same reason reachedByZone above is: the
  // arm right below and the tightest-pair check inside the next test both run
  // this exact sweep over every shipped node, and re-running it a second time
  // over the same 54 nodes bought nothing but wall time, since the function is
  // a pure read of the (seed, node position) pair both arms already validate.
  const seaClearanceByNode = new Map(
    GATHER_NODES.map((node) => [node.id, seaClearanceInReach(node.pos.x, node.pos.z)] as const),
  );
  function cachedSeaClearance(nodeId: string): number {
    const cached = seaClearanceByNode.get(nodeId);
    if (cached === undefined) throw new Error(`no cached sea clearance for ${nodeId}`);
    return cached;
  }

  it('no water in reach: a gatherer never has to stand in the sea to work a node', () => {
    // Freeboard at the node's own point is not the whole question, and the
    // shipped content proved it: five nodes cleared the sea plane where they
    // stood while the waterline cut THROUGH their harvest disc, so part of the
    // ground a player may legally gather from was open water and the prop read
    // as standing in the surf (wood_farshore_isle_6 was the worst, with the sea
    // 2 yards out, 1.32yd deep inside the reach and a fifth of the disc under
    // water; the player report that opened this was "some of the gathering
    // nodes are in the water"). Three more failed the point arm above as well.
    // The reach is the same INTERACT_RANGE disc harvestNode enforces, so this
    // arm is about exactly the ground the gate lets a player use, and the
    // bound is the waterline itself: ground under it is water, and a node
    // whose working area contains water is not placed on land.
    for (const node of GATHER_NODES) {
      const clearance = cachedSeaClearance(node.id);
      expect(
        clearance,
        `${node.id} at (${node.pos.x},${node.pos.z}) has open water ${(-clearance).toFixed(2)}yd deep inside its ${REACH}yd harvest reach`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('the in-reach arm rejects the pre-fix shore spots, and is not passing by slack', () => {
    // Non-vacuity in both directions. Every one of these is a spot this change
    // moved a node off, so the arm has to fail at all of them or it is not the
    // rule that forced the relocations. They are also the proof that the arm
    // sees something the point-freeboard arm above cannot: each one PASSES
    // that arm (dry where the node stood) and fails only here.
    //
    // A sixth node moved in the same pass and is deliberately NOT listed:
    // herb_farshore_isle_4's old spot on the Gull Mere neck sits tangent to
    // the waterline rather than over it, and it moved on the placement
    // judgement the player report named (open water on four of its eight
    // compass bearings at 14 yards, and the waterline on a fifth) rather than
    // because this arm failed it. Listing it would be claiming a red this arm
    // does not produce.
    const MOVED_OFF: [string, number, number][] = [
      ['wood_farshore_isle_6', 210, -24],
      ['herb_galecrest_2', 406, 412],
      ['wood_willowfen_6', -417, 580],
      ['herb_amberfall_1', -342, 2110],
      ['wood_willowfen_2', -392, 322],
    ];
    for (const [id, x, z] of MOVED_OFF) {
      expect(seaFreeboardAt(x, z), `${id}'s old spot was dry AT the node`).toBeGreaterThanOrEqual(
        WATER_MARGIN,
      );
      expect(seaClearanceInReach(x, z), `${id}'s old spot had water in reach`).toBeLessThan(0);
    }
    // And the bound bites on the shipped table rather than clearing it by
    // yards. It bites HARD, on purpose: the tightest passers are the authored
    // lakeside patches (a herb on the Mirror Lake bank is the flavour, not a
    // defect) and they sit within a tenth of a yard of the waterline at the
    // far edge of their reach. So this arm is a knife edge for them by
    // design, and the honest reading of a future red here is that a shoreline
    // moved under a node: the fix is a yard of nudge, not a looser bound.
    let tightest = Number.POSITIVE_INFINITY;
    let who = '';
    for (const node of GATHER_NODES) {
      const clearance = cachedSeaClearance(node.id);
      if (clearance < tightest) {
        tightest = clearance;
        who = node.id;
      }
    }
    expect(tightest, `tightest in-reach clearance is ${who}`).toBeGreaterThanOrEqual(0);
    expect(tightest, `tightest in-reach clearance is ${who}`).toBeLessThan(0.5);
  });

  it('no node grows inside the Sowfield boarball ground', () => {
    // A gather node is a world prop, and SOWFIELD_EXCLUDE is the footprint
    // world.ts generateDecorations already refuses to seat one in: the pitch,
    // its goal pockets, both stands, the gate approach and the terrain
    // flatten's falloff apron. Nothing applied that screen to authored nodes,
    // and herb_eastbrook_4 shipped at (23,-99), INSIDE the pitch rectangle in
    // the east goal's corner (the second half of the player report that opened
    // this change: "one of the fine sheenleaf herb is inside the football game
    // in eastbrook"). Every other arm passed it: the flattened pitch is dry,
    // level, unblocked and reachable. The ground is a match venue, so a node
    // on it is worked at the pitch police's pleasure (social/vale_cup.ts
    // ejects any non-fighter standing there, cancelling the gather cast) and
    // the patch grows on the playing surface. Reusing the shipped exclusion
    // rather than a fresh rectangle keeps ONE definition of the venue's
    // footprint for the terrain, the decorations and the nodes.
    for (const node of GATHER_NODES) {
      const { x, z } = node.pos;
      const inside =
        x >= SOWFIELD_EXCLUDE.xMin &&
        x <= SOWFIELD_EXCLUDE.xMax &&
        z >= SOWFIELD_EXCLUDE.zMin &&
        z <= SOWFIELD_EXCLUDE.zMax;
      expect(inside, `${node.id} at (${x},${z}) sits inside the Sowfield boarball ground`).toBe(
        false,
      );
    }
  });

  it('the Sowfield arm rejects the old herb spot and the pitch it stood on', () => {
    const inSowfield = (x: number, z: number) =>
      x >= SOWFIELD_EXCLUDE.xMin &&
      x <= SOWFIELD_EXCLUDE.xMax &&
      z >= SOWFIELD_EXCLUDE.zMin &&
      z <= SOWFIELD_EXCLUDE.zMax;
    // The shipped-then-moved spot, and the property that made it a defect:
    // it was not merely inside the exclusion apron, it was on the pitch.
    expect(inSowfield(23, -99)).toBe(true);
    expect(isOnPitch(23, -99)).toBe(true);
    // The exclusion really does contain the whole playing surface, so the
    // screen above cannot pass a node standing in a goal mouth either.
    expect(inSowfield(PITCH_CENTER.x, PITCH_CENTER.z)).toBe(true);
    expect(inSowfield(GOAL_LINE_WEST_X, PITCH_CENTER.z)).toBe(true);
    expect(inSowfield(GOAL_LINE_EAST_X, PITCH_CENTER.z)).toBe(true);
    // And it is a screen, not a blanket: the relocated patch is outside it,
    // with real clearance rather than sitting on the boundary.
    const moved = GATHER_NODES.find((n) => n.id === 'herb_eastbrook_4');
    expect(moved, 'herb_eastbrook_4 names a live node').toBeDefined();
    if (!moved) return;
    expect(inSowfield(moved.pos.x, moved.pos.z)).toBe(false);
    expect(moved.pos.z - SOWFIELD_EXCLUDE.zMax).toBeGreaterThanOrEqual(2);
  });

  it('the sea-plane arm rejects the Wickharbor cove floor, so it can fail', () => {
    // herb_galecrest_1's pre-v0.34.0 spot: the harbor cove carves the ground
    // to 3.6yd BELOW the world sea plane, outside every declared water body,
    // so the dry-land arm passes and only depth-aware arms can object.
    // Before open-sea swim the swim rules never engaged out here, a player
    // walked the cove floor, every other arm passed, and this arm was the
    // ONE that said no; since the water overhaul the open sea is real water,
    // so the stand-spot arm now also refuses (the cove floor is swim depth,
    // nothing in reach is standable). Assert both: the sea-plane arm still
    // fires here (its non-vacuity, and it stays the only guard for the
    // shallow wadeable band the exemption list records, where players stand
    // fine and only the render sits underwater), and the swim model really
    // did close the walk-the-cove-floor hole.
    const ON_WICKHARBOR_COVE_FLOOR = { x: 448, z: 400 };
    expect(isInWaterBody(ON_WICKHARBOR_COVE_FLOOR.x, ON_WICKHARBOR_COVE_FLOOR.z)).toBe(false);
    expect(isDryLand(ON_WICKHARBOR_COVE_FLOOR.x, ON_WICKHARBOR_COVE_FLOOR.z)).toBe(true);
    expect(nearestStandSpot(ON_WICKHARBOR_COVE_FLOOR.x, ON_WICKHARBOR_COVE_FLOOR.z)).toBeNull();
    expect(seaFreeboardAt(ON_WICKHARBOR_COVE_FLOOR.x, ON_WICKHARBOR_COVE_FLOOR.z)).toBeLessThan(0);
  });

  it('walkable slope: no node, and no ground in its harvest reach, is a cliff', () => {
    // Both halves matter and neither subsumes the other. The old wood_thornpeak_1
    // measured a perfectly walkable 0.94 AT the node while the wall inside its
    // own reach hit 3.28, so a node-only check passed it; the reach sweep is what
    // caught it. Both figures come from the sweep below, so re-measuring with it
    // reproduces them. Headroom on the shipped table is real rather than
    // marginal: the steepest reach of any passing node is wood_thornpeak_t2 at
    // 1.04 against the 1.5 limit.
    expect(
      DECORATION_MAX_SLOPE,
      'this arm reads the movement climb limit as the prop-anchoring limit too; world.ts says they are the same gradient, and they are two independent literals, so pin the equality rather than the coincidence',
    ).toBe(PLAYER_MAX_CLIMB_SLOPE);
    for (const node of GATHER_NODES) {
      const { x, z } = node.pos;
      expect(
        terrainSteepness(x, z, WORLD_SEED),
        `${node.id} at (${x},${z}) stands on unwalkable ground`,
      ).toBeLessThanOrEqual(PLAYER_MAX_CLIMB_SLOPE);
      expect(
        steepestInReach(x, z),
        `${node.id} at (${x},${z}) has a cliff inside its ${REACH}yd harvest reach`,
      ).toBeLessThanOrEqual(PLAYER_MAX_CLIMB_SLOPE);
      expect(againstWorldRim(x, z), `${node.id} at (${x},${z}) sits against the world rim`).toBe(
        false,
      );
      expect(onSealedCrest(x, z), `${node.id} at (${x},${z}) sits on a sealed border crest`).toBe(
        false,
      );
    }
  });

  it('the slope arm rejects the maze wall and the reach sweep rejects a wall in range', () => {
    expect(
      terrainSteepness(ON_MAZE_WALL_POCKET.x, ON_MAZE_WALL_POCKET.z, WORLD_SEED),
    ).toBeGreaterThan(PLAYER_MAX_CLIMB_SLOPE);
    // The rim and sealed-crest screens have live fixtures: a point inside the
    // rim margin, and the midpoint of a shipped sealed crest, both rejected
    // by the exact predicates the node sweep runs.
    expect(againstWorldRim(WORLD_MAX_X - 10, 0)).toBe(true);
    expect(SEALED_BORDERS.length).toBeGreaterThan(0);
    const crest = SEALED_BORDERS[0];
    expect(onSealedCrest((crest.lo + crest.hi) / 2, crest.at)).toBe(true);
    // The reach sweep on its own: walkable at the point, cliff within reach.
    expect(
      terrainSteepness(IN_GLIMMERMERE_SHALLOWS.x, IN_GLIMMERMERE_SHALLOWS.z, WORLD_SEED),
    ).toBeLessThanOrEqual(PLAYER_MAX_CLIMB_SLOPE);
    expect(steepestInReach(IN_GLIMMERMERE_SHALLOWS.x, IN_GLIMMERMERE_SHALLOWS.z)).toBeGreaterThan(
      PLAYER_MAX_CLIMB_SLOPE,
    );
  });

  it('no collider overlap: no node is buried inside a building, trunk or fence', () => {
    // An ore vein and a wood pile are THEMSELVES solid standable bodies
    // (prop_layout.ts GATHER_NODE_BODIES, turned into colliders by
    // colliders.ts), so a player cannot stand on a node's own centre and
    // `isBlocked` at that centre is true BY DESIGN for every ore and wood
    // node. Asking whether the centre is clear would therefore fail 43 of the
    // 54 shipped nodes and could never be satisfied by moving any of them.
    //
    // The question that still means something is whether anything FOREIGN
    // buries the node. A node blocked only by its own body clears as soon as
    // you step past its radius plus the player's; a node inside a building or
    // a trunk has no clear ground anywhere near it. So the arm bounds HOW FAR
    // the nearest unblocked ground is, and the bound is built from the shipped
    // radii rather than picked: own body radius plus PLAYER_BODY_RADIUS, plus
    // one sweep step of slack because nearestStandSpot samples on a 0.5yd ring
    // and therefore cannot report a distance finer than that.
    for (const node of GATHER_NODES) {
      const { x, z } = node.pos;
      const selfClearance = selfClearanceFor(node.type);
      const spot = nearestStandSpot(x, z);
      expect(spot, `${node.id} at (${x},${z}) has no unblocked ground in reach`).not.toBeNull();
      if (!spot) continue;
      expect(
        spot.r,
        `${node.id} at (${x},${z}) is buried in foreign geometry: nearest standable ground is ${spot.r.toFixed(2)}yd out, past its own ${selfClearance.toFixed(2)}yd body clearance`,
      ).toBeLessThanOrEqual(selfClearance);
    }
  });

  it('the collider arm rejects a point inside a town collider, so it can fail', () => {
    expect(
      isBlocked(WORLD_SEED, INSIDE_A_TOWN_COLLIDER.x, INSIDE_A_TOWN_COLLIDER.z, PLAYER_BODY_RADIUS),
    ).toBe(true);
    // Blocked alone no longer fails the arm, because every ore and wood node is
    // blocked at its own centre by its own body. What the arm actually reads is
    // the DISTANCE to the nearest standable ground, so the counter-example has
    // to fail on THAT measure or it stops being one.
    //
    // The town-collider point above does not: it sits just inside a wall, and
    // standable ground is about a yard away, inside the self-clearance any ore
    // node already claims. That is worth stating rather than hiding, because it
    // marks exactly how much this arm can see: it catches ENCLOSED, not merely
    // overlapping. DEEP_INSIDE_A_BUILDING is the point that genuinely is
    // enclosed, and both facts are asserted so neither can rot.
    const widestSelfClearance = Math.max(...GATHER_NODE_TYPES.map(selfClearanceFor));
    const shallow = nearestStandSpot(INSIDE_A_TOWN_COLLIDER.x, INSIDE_A_TOWN_COLLIDER.z);
    expect(shallow, 'the shallow fixture must still be standable-adjacent').not.toBeNull();
    expect(shallow?.r ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(widestSelfClearance);

    const buried = nearestStandSpot(DEEP_INSIDE_A_BUILDING.x, DEEP_INSIDE_A_BUILDING.z);
    expect(
      buried === null || buried.r > widestSelfClearance,
      'the buried fixture must fail the arm, or the arm proves nothing',
    ).toBe(true);
    // Still measurable rather than merely absent: the nearest standable ground
    // is inside the harvest reach the sweep searches, so this fixture fails on
    // DISTANCE and not because the sweep simply ran out of room.
    expect(buried).not.toBeNull();
    expect(buried?.r ?? 0).toBeLessThanOrEqual(REACH);
    // And the bound is tight enough to be worth having.
    expect(widestSelfClearance).toBeLessThan(REACH);
  });

  it('a stand spot: every node can be worked from a spot that is itself reachable', () => {
    // Existence alone is not enough: a standable ledge walled off from the rest
    // of the zone would satisfy "there is somewhere to stand" while being no use
    // to a player, so the spot has to sit in the hub's reachable set too.
    for (const node of GATHER_NODES) {
      const { x, z } = node.pos;
      const spot = nearestStandSpot(x, z);
      expect(
        spot,
        `${node.id} at (${x},${z}) has nowhere within ${REACH}yd a player can stand`,
      ).not.toBeNull();
      if (!spot) continue;
      expect(spot.r).toBeLessThanOrEqual(REACH);
      expect(
        reachedByZone.get(node.zoneId)?.has(cellKey(spot.x, spot.z)),
        `${node.id}'s stand spot (${spot.x.toFixed(1)},${spot.z.toFixed(1)}) is cut off from the ${node.zoneId} hub`,
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
    // wall a spot IS standable, and the leg is the only thing that rejects it.
    // Floods its own box containing the point, because the Eastbrook box stops
    // near x = -12 and using it would pass for being out of bounds instead.
    // Shared with the reachability arm below (MAZE_WALL_FLOOD): same origin,
    // same box, computed once above.
    const spot = nearestStandSpot(ON_MAZE_WALL_POCKET.x, ON_MAZE_WALL_POCKET.z);
    expect(spot, 'the maze fixture must be standable, or it proves nothing').not.toBeNull();
    if (!spot) return;
    expect(MAZE_WALL_FLOOD.has(cellKey(spot.x, spot.z))).toBe(false);
  });

  it('hub reachability: every node is walkable-or-swimmable from its zone hub', () => {
    for (const node of GATHER_NODES) {
      const reached = reachedByZone.get(node.zoneId);
      expect(reached, `no flood for zone ${node.zoneId}`).toBeDefined();
      expect(
        reached?.has(cellKey(node.pos.x, node.pos.z)),
        `${node.id} at (${node.pos.x},${node.pos.z}) is cut off from the ${node.zoneId} hub`,
      ).toBe(true);
    }
  });

  it('the reachability arm rejects a point walled off in the maze pocket', () => {
    // Flood a box that deliberately CONTAINS the maze point, so failing to
    // reach it is the wall's doing and not the bounding box's. Shared with the
    // stand-spot arm above (MAZE_WALL_FLOOD): same origin, same box, computed
    // once above.
    expect(ON_MAZE_WALL_POCKET.x).toBeLessThanOrEqual(MAZE_WALL_FLOOD_BOX.xMax);
    expect(ON_MAZE_WALL_POCKET.z).toBeLessThanOrEqual(MAZE_WALL_FLOOD_BOX.zMax);
    expect(ON_MAZE_WALL_POCKET.z).toBeGreaterThanOrEqual(MAZE_WALL_FLOOD_BOX.zMin);
    // NOT the hub cell: floodFrom seeds that unconditionally, so asserting it
    // would hold for a flood that spread nowhere at all. A cell 100 yards out
    // (west, INSIDE this box; the box's east edge sits at the hub margin)
    // proves the flood actually travelled before the wall stopped it.
    expect(MAZE_WALL_FLOOD.has(cellKey(-100, 0))).toBe(true);
    expect(MAZE_WALL_FLOOD.has(cellKey(ON_MAZE_WALL_POCKET.x, ON_MAZE_WALL_POCKET.z))).toBe(false);
  });

  it('zone containment: a node resolves to the zone whose material it grants', () => {
    // nodeMaterialFor(node.type, node.zoneId) keys the yield off the DECLARED
    // zoneId, so a node standing in one band while claiming another hands out
    // that other zone's material. zoneAt is the same resolver the sim uses, and
    // it is exclusive at zMax where the existing band check in
    // tests/gather_nodes.test.ts is inclusive on both ends: a node exactly on a
    // boundary passes there and is mis-zoned here.
    for (const node of GATHER_NODES) {
      expect(
        zoneAt(node.pos.x, node.pos.z).id,
        `${node.id} at z=${node.pos.z} claims ${node.zoneId} but stands in another zone`,
      ).toBe(node.zoneId);
      expect(
        Math.abs(node.pos.x),
        `${node.id} is outside the world's x bounds`,
      ).toBeLessThanOrEqual(WORLD_MAX_X);
    }
  });

  it('the zone arm rejects a boundary z the inclusive band check would allow', () => {
    const eastbrook = ZONES[0];
    expect(eastbrook.id).toBe('eastbrook_vale');
    // z === zMax passes "z >= zMin && z <= zMax" for eastbrook_vale, yet zoneAt
    // hands it to the next band, which is precisely the mis-zoned yield case.
    const boundary = eastbrook.zMax;
    expect(boundary >= eastbrook.zMin && boundary <= eastbrook.zMax).toBe(true);
    expect(zoneAt(0, boundary).id).not.toBe(eastbrook.id);
  });

  it('minimum spacing: no two nodes collapse into one harvest reach', () => {
    // Two nodes closer than the reach are one node to a player: useGatherToolItem
    // has to arbitrate between them, and the props overlap. INTERACT_RANGE is the
    // floor rather than a fresh number, and the Eastbrook ore trio deliberately
    // sits at exactly that distance (tests/gather_tool_use.test.ts leans on the
    // 5yd pair to prove nearest-node selection), so the bound is inclusive.
    for (let i = 0; i < GATHER_NODES.length; i++) {
      for (let j = i + 1; j < GATHER_NODES.length; j++) {
        const a = GATHER_NODES[i];
        const b = GATHER_NODES[j];
        const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
        expect(d, `${a.id} and ${b.id} are ${d.toFixed(2)}yd apart`).toBeGreaterThanOrEqual(
          INTERACT_RANGE,
        );
      }
    }
  });

  it('the spacing floor is exercised by real content, not passing by slack', () => {
    // Without this the arm above could hold simply because nothing comes close
    // to the floor. Bracketing the tightest real pair into [INTERACT_RANGE,
    // INTERACT_RANGE + 1) proves the bound is load-bearing: the Eastbrook ore
    // trio sits exactly on it, so any node nudged closer fails immediately.
    let tightest = Number.POSITIVE_INFINITY;
    let pair = '';
    for (let i = 0; i < GATHER_NODES.length; i++) {
      for (let j = i + 1; j < GATHER_NODES.length; j++) {
        const a = GATHER_NODES[i];
        const b = GATHER_NODES[j];
        const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
        if (d < tightest) {
          tightest = d;
          pair = `${a.id} / ${b.id}`;
        }
      }
    }
    expect(tightest, `tightest pair ${pair}`).toBeLessThan(INTERACT_RANGE + 1);
  });

  // The circuit-design arms below (count floors, spatial coverage, the road
  // exemption set, the harvest ceiling) audit the packet's TUNED zone set:
  // the original strip, whose node circuits phases 8 to 10 rebuilt against
  // these exact floors. The v0.32.0 expansion zones deliberately ship two
  // hub-outskirt starter nodes per profession (see gather_nodes.ts), a
  // different and thinner design authored before these floors existed;
  // integrating them into the tier ladder and these floors is phase 13 work
  // (docs/design/professions-tuning-packet-review.md), so sweeping them here
  // would fail content this packet has not tuned yet. Exception since the
  // phase 20 density pass: the three bottom-map zones (willowfen, galecrest,
  // farshore_isle) grew to the strip's own density and carry their own floor
  // arms below the tuned ones. The PHYSICAL arms above
  // (dry land, slope, colliders, stand spots, hub reachability) stay
  // world-wide: unworkable ground is a defect no matter which release
  // authored it.
  const TUNED_ZONE_IDS = ['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights'] as const;
  const TUNED_ZONES = ZONES.filter((zn) => (TUNED_ZONE_IDS as readonly string[]).includes(zn.id));
  it('the tuned-zone scope names real zones, in strip order', () => {
    expect(TUNED_ZONES.map((zn) => zn.id)).toEqual([...TUNED_ZONE_IDS]);
  });

  it('count floor: every TUNED zone keeps every gathering profession worth visiting', () => {
    // A relocation must never be allowed to drain a zone of a type (moving a node
    // across a band boundary would), and the count itself is the density the
    // world is tuned around: every TUNED zone (this loop's scope; the eleven
    // expansion zones ship the thinner two-per-type starter kit, see the
    // header note) carries six nodes of every type against
    // the 240-second respawn in NODE_HARVEST_TABLE, which is the pair that holds
    // the per-zone harvest ceiling flat while roughly doubling the circuit. NOT,
    // deliberately not, "which makes the circuit longer than the wait": measured
    // as a nearest-neighbour tour, no zone circuit reaches 240 seconds even now
    // (160 / 207 / 197 for all 18 nodes), and the honest before-and-after is
    // recorded at the top of src/sim/content/gather_nodes.ts.
    //
    // The total is NOT enough on its own. Thornpeak carries six nodes per type
    // but only two of them are tier 1, so a total-only floor would still pass a
    // relocation that drained the zone's last tier-1 node and left a traveller
    // holding a starter tool with nothing it can work. Hence the second floor.
    for (const zone of TUNED_ZONES) {
      for (const type of GATHER_NODE_TYPES) {
        const ofType = GATHER_NODES.filter((n) => n.zoneId === zone.id && n.type === type);
        expect(
          ofType.length,
          `${zone.id} offers only ${ofType.length} ${type} node(s)`,
        ).toBeGreaterThanOrEqual(6);
        const tier1 = ofType.filter((n) => n.tier === 1);
        expect(
          tier1.length,
          `${zone.id} offers no tier-1 ${type} node, so a starter tool cannot work the zone`,
        ).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('the count floors are exercised by real content, not passing by slack', () => {
    // Both floors sit close enough to the shipped content to bite. Without this,
    // either could hold purely because every zone ships far more than the floor.
    let leanestTotal = Number.POSITIVE_INFINITY;
    let leanestTier1 = Number.POSITIVE_INFINITY;
    for (const zone of TUNED_ZONES) {
      for (const type of GATHER_NODE_TYPES) {
        const ofType = GATHER_NODES.filter((n) => n.zoneId === zone.id && n.type === type);
        leanestTotal = Math.min(leanestTotal, ofType.length);
        leanestTier1 = Math.min(leanestTier1, ofType.filter((n) => n.tier === 1).length);
      }
    }
    // Every TUNED zone carries exactly six of each type (the starter zones sit
    // outside this loop at two), so the total floor is
    // exact rather than merely tight: it was three when Eastbrook shipped three
    // ore, three wood and three herb, and it moved with the content.
    expect(leanestTotal).toBe(6);
    // Thornpeak still carries exactly two tier-1 nodes of each type, and this
    // number deliberately did NOT move with the count: the two nodes Thornpeak
    // gained per type went to tier 2 and tier 3, because a tier only one node in
    // the zone carries would have halved its own rate when respawn doubled, and
    // tier 3 is what carries a gatherer's last 25 points of proficiency. The
    // floor above only demands ONE tier-1 node per type; that a starter-tool
    // traveller actually gets two in Thornpeak is pinned here, by this exact
    // value, and nowhere else.
    expect(leanestTier1).toBe(2);
  });

  it('spatial coverage: a gathering circuit reaches most of every zone', () => {
    // The count floor above says a zone HAS six of each type; it cannot say they
    // are spread. Six nodes thickened into one clearing satisfy it while leaving
    // most of the zone with nothing to gather, which is the shape the content
    // actually had (Eastbrook's ore, wood and herb were three clumps, and 13.5
    // percent of the zone's walkable ground sat within 40 yards of any node).
    //
    // The metric is deliberately an AREA measure rather than a spread measure.
    // The obvious alternatives, an enclosing-circle radius or a
    // minimum-pairwise-distance bound, both land exactly on a boundary of the
    // shipped content (the Eastbrook ore trio is intentionally 5.00 yards apart
    // with a 10.00-yard span, see the spacing arms above), so either would be a
    // knife edge that a legitimate content nudge flips.
    //
    // Where 40 percent comes from: the same measure over mob camp centres, which
    // is the world's own answer to "how thickly is content laid out". Measured on
    // the shipped content, camps reach 39.9 percent of Eastbrook's walkable
    // ground, 48.7 of Mirefen's and 55.1 of Thornpeak's, 48.0 percent world-wide.
    // Gathering sits deliberately below that: nodes reach 40.6 / 43.7 / 45.6 per
    // zone, 43.3 percent world-wide. The world-wide comparison is asserted below
    // rather than left as prose, so "below the mob-camp figure" cannot rot.
    //
    // If this arm ever reds, read the failure message before assuming a node
    // moved. The denominator is walkable-and-dry ground, so it also moves when
    // terrain, water or a static collider does: a new building in Eastbrook, a
    // widened lake, or an edit-layer change shifts the fraction without anyone
    // touching gather content. Eastbrook clears the floor by 0.6 points, so it is
    // the zone that will notice first, and the message names the measured figure
    // so the next reader can tell a drained zone from a resized denominator.
    const COVERAGE_RADIUS = 40;
    // 38 since the release/v0.34.0 merge, was 35 (and 40 before the v0.32.0
    // rim-mountain fade grew the denominator): open-sea swim made coastal
    // shallows real water, so shore cells fall out of the walkable-and-dry
    // denominator and every coastal zone's fraction rises without a node
    // moving (the leanest tuned zone re-measured at 40.2 against 37.3
    // pre-overhaul). The rule is unchanged (below the mob-camp density,
    // slack-bounded below); only the calibration input resized, which is
    // exactly the denominator caveat in the prose above.
    const COVERAGE_FLOOR_PCT = 38;

    /** Fraction of `cells` within COVERAGE_RADIUS of any of `centres`, as a percent. */
    const reachPct = (
      cells: { x: number; z: number }[],
      centres: { x: number; z: number }[],
    ): number => {
      let hit = 0;
      for (const c of cells) {
        if (centres.some((p) => Math.hypot(p.x - c.x, p.z - c.z) <= COVERAGE_RADIUS)) hit++;
      }
      return (hit / cells.length) * 100;
    };

    let worldCells = 0;
    let worldNodeHits = 0;
    let worldCampHits = 0;
    let leanest = Number.POSITIVE_INFINITY;
    for (const zone of TUNED_ZONES) {
      // Walkable-and-dry ground on a 2-yard lattice: the same two predicates the
      // arms above hold a node to, so "walkable ground" means one thing in this
      // file. Coarser than the reach sweeps because this is a whole-zone area
      // integral, not a per-node screen.
      const cells: { x: number; z: number }[] = [];
      // The zone's own authored rect, NOT zoneAt membership: beyond the strip
      // the southmost-band FALLBACK arm of zoneAt claims the open staging
      // ground out to the world rim for whichever band it overhangs, and that
      // ground is not circuit territory. The tuned zones are strip bands, so
      // the rect is the strip's own width.
      const rectX0 = zone.xMin ?? STRIP_MIN_X;
      const rectX1 = zone.xMax ?? STRIP_MAX_X;
      for (let x = rectX0; x <= rectX1; x += 2) {
        for (let z = zone.zMin; z <= zone.zMax; z += 2) {
          if (canStand(x, z) && isDryLand(x, z)) cells.push({ x, z });
        }
      }
      const nodes = GATHER_NODES.filter((n) => n.zoneId === zone.id).map((n) => n.pos);
      const camps = CAMPS.filter((c) => zoneAt(c.center.x, c.center.z).id === zone.id).map(
        (c) => c.center,
      );
      const nodePct = reachPct(cells, nodes);
      expect(
        nodePct,
        `${zone.id} keeps only ${nodePct.toFixed(1)} percent of its walkable ground within ${COVERAGE_RADIUS}yd of a gather node`,
      ).toBeGreaterThanOrEqual(COVERAGE_FLOOR_PCT);
      leanest = Math.min(leanest, nodePct);
      worldCells += cells.length;
      worldNodeHits += (nodePct / 100) * cells.length;
      worldCampHits += (reachPct(cells, camps) / 100) * cells.length;
    }

    // Not passing by slack: the leanest zone (Eastbrook, whose six ore veins are
    // held inside one 20-yard ring by tests/gather_nodes.test.ts and so cover
    // little ground between them) sits within 5 points of the floor. Measured at
    // 40.2 after the v0.34.0 water overhaul, so the band holds by about two
    // points each way, which is deliberate: a floor the content clears by
    // twenty points asserts nothing.
    expect(leanest, `leanest zone coverage ${leanest.toFixed(1)} percent`).toBeLessThan(
      COVERAGE_FLOOR_PCT + 5,
    );

    // And the relationship the floor was chosen against, pinned rather than
    // asserted in prose: gathering is laid out less thickly than combat is
    // (measured across the tuned zones, the same scope as the floor).
    const worldNodePct = (worldNodeHits / worldCells) * 100;
    const worldCampPct = (worldCampHits / worldCells) * 100;
    expect(
      worldNodePct,
      `nodes reach ${worldNodePct.toFixed(1)} percent world-wide against mob camps' ${worldCampPct.toFixed(1)}`,
    ).toBeLessThan(worldCampPct);
  });

  // Placement margin (the R33 arm). A vein once shipped 2.2 yards from Grix
  // the Tunnelking's spawn centre; the first arm that closed it measured BASE
  // aggro against the node CENTRE, in the starting zone only. Both halves
  // undershot the real reach: aggro is level-scaled (src/sim/mob/locomotion.ts,
  // base + 1.5 yards per level the mob has over the player, floored at 4,
  // clamped at MAX_AGGRO_RADIUS), and a gatherer may legally stand
  // INTERACT_RANGE from the node centre, so it is the whole harvest disc that
  // has to clear the reach. Measured for the zone's own leveling player
  // (levelRange floor), the level the zone's content is authored for: against
  // a level-1 at the Copper Dig, Grix's 13-yard base scales to the 20-yard
  // clamp, which is what made the old tutorial vein spots a forced fight at
  // any level (R33's stated exception; those veins moved).
  //
  // The bound is the STANDING worst case: a mob rolled to its spawn ring's
  // edge, detecting at the scaled radius, against the disc's near edge. The
  // idle WANDER ring (2 to 9 yards off spawn, src/sim/mob/aggro_ranges.ts)
  // adds a transient tail deliberately NOT priced in: the class this arm
  // exists for is CONSTANT overlap (a cast started at the node is inside
  // detection every time), while the wander tail needs the mob to have
  // drifted toward that node in that moment, which is the ordinary-world
  // risk texture every camp-adjacent node has always accepted. Pricing the
  // tail would condemn five of the six Copper Dig veins including the trio
  // that has shipped since the field existed (measured; the acceptance is
  // recorded in the packet review's phase 13 record).
  //
  // Scope: NAMED mobs (camps whose mob is rare or boss flagged, plus the
  // WORLD_BOSSES registry). Ordinary and generic-elite camps are deliberate
  // gathering risk: a third of all nodes sit inside one on purpose, from
  // grey trash fields up to the eight-elite ogre warcamp, and none of them
  // is a single named fight the way this arm's subjects are.
  const scaledAggro = (base: number, mobLevel: number, playerLevel: number) =>
    Math.max(4, Math.min(MAX_AGGRO_RADIUS, base + (mobLevel - playerLevel) * 1.5));

  // Every node-versus-named-mob pairing with the margin rule's clearance:
  // distance minus spawn ring minus scaled reach minus the harvest disc.
  // Negative means the disc overlaps the reach (the pairing is "hot").
  function namedMobClearances(): { key: string; clearance: number }[] {
    const out: { key: string; clearance: number }[] = [];
    for (const node of GATHER_NODES) {
      const playerLevel = zoneAt(node.pos.x, node.pos.z).levelRange[0];
      for (const camp of CAMPS) {
        const mob = MOBS[camp.mobId];
        if (!mob?.rare && !mob?.boss) continue;
        const reach = camp.radius + scaledAggro(mob.aggroRadius, mob.maxLevel, playerLevel);
        const d = Math.hypot(node.pos.x - camp.center.x, node.pos.z - camp.center.z);
        out.push({ key: `${node.id}:${camp.mobId}`, clearance: d - reach - REACH });
      }
      for (const boss of WORLD_BOSSES) {
        const mob = MOBS[boss.templateId];
        if (!mob) continue;
        const reach = scaledAggro(mob.aggroRadius, mob.maxLevel, playerLevel);
        const d = Math.hypot(node.pos.x - boss.pos.x, node.pos.z - boss.pos.z);
        out.push({ key: `${node.id}:${boss.templateId}`, clearance: d - reach - REACH });
      }
    }
    return out;
  }

  // The deliberate dangers, node:mob, sorted. Every entry is a placement the
  // design wants hot, with the intent named; the exact-set pin below prunes
  // any entry that cools off and reds any new pairing that heats up, so both
  // directions require a human decision here. R33 names the two t3 entries
  // outright; the rest were measured hot when the scaled rule landed and are
  // kept as the same risk-beside-a-named-mob flavour, recorded in the packet
  // review doc as build-judged.
  const DELIBERATE_DANGERS = [
    // Mogger's meadow: the herb patch sits beside the group-quest boss.
    // Mogger himself IS a quest target (q_mogger, suggested for three), and
    // that is the point: the patch shares the danger of a fight the zone
    // already tells players to bring friends to; level-first is the path
    // (R32 family), and no tutorial quest sends anyone to this patch.
    'herb_eastbrook_5:mogger',
    // The drowned bank: t2 ore beside the marsh's named lurker.
    'ore_mirefen_4:sloomtooth_the_drowned',
    // The cult side of the marsh: t2 ore inside Sister Nhalia's vigil.
    'ore_mirefen_t2b:sister_nhalia',
    // The ironvein dig is the foreman's own story: all three veins sit in his
    // shadow, flavour aimed at a player who can survive the level-17 zone
    // (ore_thornpeak_t2 at 2.8 yards was the old arm's named example).
    'ore_thornpeak_1:ironvein_foreman',
    'ore_thornpeak_2:ironvein_foreman',
    'ore_thornpeak_t2:ironvein_foreman',
    // Stormcrag, among the elementals: exactly on the world boss's scaled
    // reach (R33 names it deliberate).
    'ore_thornpeak_t3b:thunzharr_waking_peak',
    // Old Greyjaw's woods hold an optional stand; a level-4 named wolf is the
    // zone's intended first rare fight, not a tutorial blocker.
    'wood_eastbrook_4:old_greyjaw',
    // Brutok's treeline: both stands sit against the ogre warcamp.
    'wood_thornpeak_1:brutok_skullsmasher',
    'wood_thornpeak_t2:brutok_skullsmasher',
    // The Revenant Fields treeline, inside Sethrael's coils.
    'wood_thornpeak_t3:sethrael_palecoil',
    // Inside Marrowlord Varkas's aggro on purpose (R33 names it deliberate).
    'wood_thornpeak_t3b:marrowlord_varkas',
  ];

  it('hot node-versus-named-mob pairings are exactly the pinned deliberate dangers', () => {
    const namedCamps = CAMPS.filter(
      (camp) => MOBS[camp.mobId]?.rare === true || MOBS[camp.mobId]?.boss === true,
    );
    expect(namedCamps.length, 'no named camps found, so this arm proves nothing').toBeGreaterThan(
      0,
    );
    // Both halves of the scope are populated: rare camps and boss-flagged
    // camps (the quest bosses) each contribute, so neither filter arm can
    // silently go dead.
    expect(namedCamps.some((c) => MOBS[c.mobId]?.boss === true)).toBe(true);
    expect(namedCamps.some((c) => MOBS[c.mobId]?.rare === true)).toBe(true);
    expect(WORLD_BOSSES.length, 'no world bosses, so the boss half proves nothing').toBeGreaterThan(
      0,
    );
    const all = namedMobClearances();
    expect(all.length, 'no pairings measured, so this arm proves nothing').toBeGreaterThan(100);
    const hot = [...new Set(all.filter((p) => p.clearance < 0).map((p) => p.key))].sort();
    expect(hot).toEqual(DELIBERATE_DANGERS);
    // Sorted-input guard: an unsorted insertion would make the equality above
    // fail confusingly, so pin the list's own order too.
    expect([...DELIBERATE_DANGERS].sort()).toEqual(DELIBERATE_DANGERS);
  });

  it('every allowlisted danger stays at its RECORDED heat (the clearance floor)', () => {
    // The exact-set pin above says WHICH pairings are hot; this says HOW hot,
    // so an allowlisted node cannot silently drift deeper into its named
    // mob's reach (the old arm's starting-zone floor generalized: a
    // deliberate danger is a recorded number, not an unbounded license).
    // Values are the measured clearances at allowlisting time, negative =
    // yards of overlap between the harvest disc and the scaled reach; one
    // yard of tolerance absorbs spawn-scatter-free re-measurement noise
    // while any real relocation reds and forces a fresh decision here.
    const EXPECTED_CLEARANCE: Record<string, number> = {
      'herb_eastbrook_5:mogger': -0.98,
      'ore_mirefen_4:sloomtooth_the_drowned': -5.0,
      'ore_mirefen_t2b:sister_nhalia': -8.98,
      'ore_thornpeak_1:ironvein_foreman': -13.05,
      'ore_thornpeak_2:ironvein_foreman': -0.95,
      'ore_thornpeak_t2:ironvein_foreman': -23.67,
      'ore_thornpeak_t3b:thunzharr_waking_peak': -5.0,
      'wood_eastbrook_4:old_greyjaw': -4.48,
      'wood_thornpeak_1:brutok_skullsmasher': -9.75,
      'wood_thornpeak_t2:brutok_skullsmasher': -20.0,
      'wood_thornpeak_t3:sethrael_palecoil': -3.12,
      'wood_thornpeak_t3b:marrowlord_varkas': -22.0,
    };
    expect(Object.keys(EXPECTED_CLEARANCE).sort()).toEqual(DELIBERATE_DANGERS);
    const worst = new Map<string, number>();
    for (const pairing of namedMobClearances()) {
      const prev = worst.get(pairing.key);
      if (prev === undefined || pairing.clearance < prev) worst.set(pairing.key, pairing.clearance);
    }
    for (const [key, expected] of Object.entries(EXPECTED_CLEARANCE)) {
      const actual = worst.get(key);
      expect(actual, `${key} was measured when allowlisted`).toBeDefined();
      expect(
        Math.abs((actual ?? 0) - expected),
        `${key} drifted from its recorded clearance (${expected} to ${actual?.toFixed(2)})`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('the margin arm mirrors the LIVE aggro formula (source pin on locomotion)', () => {
    // scaledAggro above re-implements production's level scaling because
    // locomotion exports no helper; this pin keeps the FORMULA mirror honest
    // (slope, floor, clamp). What it deliberately does not cover: the arm
    // feeds maxLevel where production reads the live mob.level, the
    // conservative worst case a margin rule wants. Comment-stripped and
    // whitespace-collapsed so neither prose nor a formatter wrap can satisfy
    // or dodge it.
    const source = readFileSync(path.resolve(process.cwd(), 'src/sim/mob/locomotion.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1')
      .replace(/\s+/g, '')
      .replace(/,\)/g, ')');
    const formula =
      'Math.max(4,Math.min(MAX_AGGRO_RADIUS,template.aggroRadius+(mob.level-e.level)*1.5))';
    // EXACTLY twice: the boss branch and the general branch each carry a
    // copy, and a bare toContain would stay green while EITHER copy drifted
    // (the general branch has a live behavioral kill in
    // tests/mob_scan_counters.test.ts; the boss copy's slope has no
    // behavioral pin, so this count is what keeps it honest).
    expect(source.split(formula).length - 1).toBe(2);
  });

  it('every allowlisted pair names a real node and a real named mob', () => {
    const nodeIds = new Set(GATHER_NODES.map((n) => n.id));
    const namedIds = new Set([
      ...CAMPS.filter((c) => MOBS[c.mobId]?.rare === true || MOBS[c.mobId]?.boss === true).map(
        (c) => c.mobId,
      ),
      ...WORLD_BOSSES.map((b) => b.templateId),
    ]);
    for (const entry of DELIBERATE_DANGERS) {
      const [nodeId, mobId] = entry.split(':');
      expect(nodeIds.has(nodeId), `${entry} names a node that does not exist`).toBe(true);
      expect(namedIds.has(mobId), `${entry} names a mob that is not a named rare or boss`).toBe(
        true,
      );
    }
  });

  it('counter-example: the old Grix-side vein spots fail the margin rule; the moved spots clear it', () => {
    const grix = CAMPS.find((c) => c.mobId === 'grix_the_tunnelking');
    expect(grix).toBeDefined();
    if (!grix) throw new Error('missing Grix camp');
    const mob = MOBS[grix.mobId];
    const reach = grix.radius + scaledAggro(mob.aggroRadius, mob.maxLevel, 1);
    const clearanceAt = (x: number, z: number) =>
      Math.hypot(x - grix.center.x, z - grix.center.z) - reach - REACH;
    // The shipped-then-moved spots: both inside the scaled reach.
    expect(clearanceAt(-99, -56)).toBeLessThan(0);
    expect(clearanceAt(-76, -79)).toBeLessThan(0);
    // Their replacements clear it with real margin.
    const five = GATHER_NODES.find((n) => n.id === 'ore_eastbrook_5');
    const six = GATHER_NODES.find((n) => n.id === 'ore_eastbrook_6');
    expect(five && clearanceAt(five.pos.x, five.pos.z)).toBeGreaterThan(0);
    expect(six && clearanceAt(six.pos.x, six.pos.z)).toBeGreaterThan(0);
  });

  it('the road band holds exactly the four deliberately-exempt nodes', () => {
    // The trailing comment at the bottom of this file explains why road clearance
    // is NOT an arm: generateDecorations screens world props at 5 yards from a
    // road, and four shipped nodes sit inside that, two of them the Copper Dig ore
    // deliberately placed beside the mine road and pinned there. Leaving that as
    // prose meant a relocation could quietly add a fifth. Pinning the exception
    // SET keeps the decision where it belongs (a human adding to this list) while
    // making a new violation mechanical rather than invisible. This is not the
    // clearance rule; it is the record of who is exempt from one.
    // wood_mirefen_t2 left this set when R11 moved it off the road surface: it
    // was the one member whose exemption recorded a defect, not a decision.
    const inBand = GATHER_NODES.filter(
      (n) =>
        (TUNED_ZONE_IDS as readonly string[]).includes(n.zoneId) &&
        roadDistance(n.pos.x, n.pos.z) < 5,
    )
      .map((n) => n.id)
      .sort();
    expect(inBand).toEqual([
      'herb_thornpeak_2',
      'ore_eastbrook_1',
      'ore_eastbrook_3',
      'ore_mirefen_2',
    ]);
  });

  it('the expansion-zone road band holds exactly the eight recorded exemptions', () => {
    // The phase 20 pass swept the expansion zones with the same 5yd screen
    // (docs/design/professions-tuning-packet-review.md, Q13). The ninth
    // member, ore_evergarden_1 at 0.42yd, stood IN the roadway by the R11
    // standard and moved to legal ground in that pass; the eight that remain
    // sit shallower in the band (1.17 to 3.54yd, verge placements rather
    // than roadway ones) and are pinned here exactly as the tuned zones'
    // four are above: relocating them is a content decision for the zone-4
    // pass, and a NEW in-band node must be a human adding to this list, not
    // a drift the suite cannot see.
    const inBand = GATHER_NODES.filter(
      (n) =>
        !(TUNED_ZONE_IDS as readonly string[]).includes(n.zoneId) &&
        roadDistance(n.pos.x, n.pos.z) < 5,
    )
      .map((n) => n.id)
      .sort();
    const EXPANSION_ROAD_EXEMPT = [
      'herb_amberfall_2',
      'herb_palmreach_1',
      'herb_palmreach_2',
      'herb_veiled_hollow_2',
      'herb_wraithwood_2',
      'ore_galecrest_1',
      'wood_amberfall_2',
      'wood_wraithwood_1',
    ];
    expect(inBand).toEqual(EXPANSION_ROAD_EXEMPT);
    // Severity floor, per exemption (the review round): each of the eight is
    // a VERGE placement, not a roadway one. The R11 standard that moved
    // wood_mirefen_t2 (0.3yd) and ore_evergarden_1 (0.42yd) is a body
    // standing in the road surface, so an exempt node drifting under a full
    // yard from the center line reds here even while it stays on the list.
    // Edge notes (the QA round): both edges are deliberately thin. The
    // tightest node OUTSIDE the 5yd screen is wood_palmreach_1 at 5.192yd
    // (0.192 from joining this list), and the tightest exemption above the
    // verge floor is ore_galecrest_1 at 1.169yd (0.169 of floor margin), so
    // either failure most likely means a road or node moved, not a broken
    // arm.
    for (const id of EXPANSION_ROAD_EXEMPT) {
      const node = GATHER_NODES.find((n) => n.id === id);
      expect(node, `${id} names a live node`).toBeDefined();
      if (!node) continue;
      expect(
        roadDistance(node.pos.x, node.pos.z),
        `${id} drifted from the verge into the roadway`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('the added higher-tier node of each type is the one further from its hub', () => {
    // The rule the tier-ramp block in gather_nodes.ts states: of a type's two
    // additions in a later zone, the higher tier goes to the further one, so the
    // long arm of the new circuit is the arm that asks for the better tool. It has
    // to be scoped to the ADDITIONS (the `b` ids and their plainly-numbered
    // siblings) rather than applied to all nodes, because the shipped Thornpeak
    // ore pair predates the rule and inverts it. Unpinned, the rule drifted once
    // already during authoring: the Mirefen ore pair was tiered the wrong way
    // round until this arm's numbers were measured.
    let groupsChecked = 0;
    for (const zone of ZONES) {
      for (const type of GATHER_NODE_TYPES) {
        const added = GATHER_NODES.filter(
          (n) => n.zoneId === zone.id && n.type === type && /(_[456]|_t[23]b)$/.test(n.id),
        );
        if (added.length < 2) continue;
        const byTier = [...added].sort((a, b) => a.tier - b.tier);
        const lowest = byTier[0];
        const highest = byTier[byTier.length - 1];
        if (lowest.tier === highest.tier) continue; // all one tier (Eastbrook)
        const hubDist = (n: (typeof added)[number]) =>
          Math.hypot(n.pos.x - zone.hub.x, n.pos.z - zone.hub.z);
        expect(
          hubDist(highest),
          `${highest.id} (tier ${highest.tier}) is ${hubDist(highest).toFixed(1)}yd from the ${zone.id} hub but ${lowest.id} (tier ${lowest.tier}) is ${hubDist(lowest).toFixed(1)}`,
        ).toBeGreaterThan(hubDist(lowest));
        groupsChecked += 1;
      }
    }
    // Non-vacuity: the discovery regex empties SILENTLY on an id rename
    // (every other arm in this file counts its corpus; this one did not), so
    // pin the zone/type groups that actually reached the comparison. Six
    // today: both later zones ramp all three types.
    expect(groupsChecked).toBe(6);
  });

  it('every zone lands on one harvest ceiling, which is why both levers moved', () => {
    // The whole reason the node count and the respawn changed together. The
    // ceiling a zone can sustain is nodes * 3600 / respawn, and the point was to
    // hold it flat rather than raise it: Eastbrook was 9 nodes at 120 seconds and
    // is 18 at 240, identical, while Mirefen and Thornpeak came DOWN from 12 at
    // 120. Composition of the count floor and the respawn literal implies this,
    // but nothing named it, so tuning either lever alone would leave both of those
    // pins green while the ceiling moved.
    const perHour = (nodes: number) => (nodes * 3600) / NODE_HARVEST_TABLE.ore.respawnSeconds;
    const ceilings = TUNED_ZONES.map((zone) =>
      perHour(GATHER_NODES.filter((n) => n.zoneId === zone.id).length),
    );
    expect(new Set(ceilings).size, `zone ceilings differ: ${ceilings.join(', ')}`).toBe(1);
    expect(ceilings[0]).toBe(270);
    // All three types share the respawn, so the ceiling is one number per zone
    // rather than three.
    for (const type of GATHER_NODE_TYPES) {
      expect(NODE_HARVEST_TABLE[type].respawnSeconds).toBe(NODE_HARVEST_TABLE.ore.respawnSeconds);
    }
  });

  // The phase 20 density floors (docs/design/professions-tuning-packet-review.md,
  // the +36 bottom-three set, Q9/Q10): the three bottom-map zones now hold the
  // same design contract as the tuned strip, at the density the pass authored.
  // Their rollout ledger rows deliberately stay 'starter'
  // (tests/professions_zone_rollout.test.ts owns that pin and the per-zone
  // count re-mint); these arms own the SPREAD, the same split as the tuned
  // zones' count-versus-coverage pair above.
  const BOTTOM_ZONE_IDS = ['willowfen', 'galecrest', 'farshore_isle'] as const;
  const BOTTOM_ZONES = ZONES.filter((zn) => (BOTTOM_ZONE_IDS as readonly string[]).includes(zn.id));
  it('the bottom-zone scope names real zones', () => {
    expect(BOTTOM_ZONES.map((zn) => zn.id)).toEqual([...BOTTOM_ZONE_IDS]);
  });

  it('count floor: every bottom-map zone carries six of each type, all of them tier 1', () => {
    for (const zone of BOTTOM_ZONES) {
      for (const type of GATHER_NODE_TYPES) {
        const ofType = GATHER_NODES.filter((n) => n.zoneId === zone.id && n.type === type);
        expect(
          ofType.length,
          `${zone.id} offers only ${ofType.length} ${type} node(s)`,
        ).toBeGreaterThanOrEqual(6);
        // Tier 1 across the WHOLE kit, not just one entry node: re-tiering is
        // the zone-4 pass's decision (R37), and the material_grades
        // below-material-rung arm reds on any above-tier-1 addition here.
        for (const node of ofType) {
          expect(node.tier, `${node.id} outruns the bottom-zone tier-1 density pass`).toBe(1);
        }
      }
    }
  });

  it('the bottom-zone count floor is exercised by real content, not passing by slack', () => {
    // The floor moved with the content: the LEANEST zone/type kit measures
    // exactly six, so the floor bites on the first drained node. Prose
    // honesty (the QA round): this arm and the count floor above bound only
    // the minimum, so a SEVENTH vein would pass here; per-kit exactness is
    // pinned by the per-zone count map in
    // tests/professions_zone_rollout.test.ts, and this arm owns only the
    // floor's non-vacuity.
    let leanestTotal = Number.POSITIVE_INFINITY;
    for (const zone of BOTTOM_ZONES) {
      for (const type of GATHER_NODE_TYPES) {
        leanestTotal = Math.min(
          leanestTotal,
          GATHER_NODES.filter((n) => n.zoneId === zone.id && n.type === type).length,
        );
      }
    }
    expect(leanestTotal).toBe(6);
  });

  it('spatial coverage: a bottom-map gathering circuit reaches most of each zone', () => {
    // The same lattice and predicates as the tuned arm above (2yd lattice
    // over the zone's own authored rect, canStand and isDryLand cells, 40yd
    // reach): measured at authoring, willowfen 38.6, galecrest 37.2,
    // farshore_isle 45.0 percent, against 9.5 to 15.5 before the pass. The
    // floor re-tightened to 43 at the release/v0.34.0 merge for the same
    // denominator resize the tuned arm records (open-sea swim drops coastal
    // shallows out of the walkable ground, and the bottom-map rects carry
    // the most coast): the leanest bottom zone re-measured at 45.2.
    const COVERAGE_RADIUS = 40;
    const COVERAGE_FLOOR_PCT = 43;
    let leanest = Number.POSITIVE_INFINITY;
    for (const zone of BOTTOM_ZONES) {
      const cells: { x: number; z: number }[] = [];
      const rectX0 = zone.xMin ?? STRIP_MIN_X;
      const rectX1 = zone.xMax ?? STRIP_MAX_X;
      for (let x = rectX0; x <= rectX1; x += 2) {
        for (let z = zone.zMin; z <= zone.zMax; z += 2) {
          if (canStand(x, z) && isDryLand(x, z)) cells.push({ x, z });
        }
      }
      const nodes = GATHER_NODES.filter((n) => n.zoneId === zone.id).map((n) => n.pos);
      let hit = 0;
      for (const c of cells) {
        if (nodes.some((p) => Math.hypot(p.x - c.x, p.z - c.z) <= COVERAGE_RADIUS)) hit++;
      }
      const nodePct = (hit / cells.length) * 100;
      expect(
        nodePct,
        `${zone.id} keeps only ${nodePct.toFixed(1)} percent of its walkable ground within ${COVERAGE_RADIUS}yd of a gather node`,
      ).toBeGreaterThanOrEqual(COVERAGE_FLOOR_PCT);
      leanest = Math.min(leanest, nodePct);
    }
    // Not passing by slack: the leanest bottom-map zone (galecrest, whose
    // rect carries the most un-walkable coast) sits within 5 points of the
    // floor, the same bracket the tuned arm holds.
    expect(leanest, `leanest bottom-zone coverage ${leanest.toFixed(1)} percent`).toBeLessThan(
      COVERAGE_FLOOR_PCT + 5,
    );
  });

  it('every bottom-map zone lands on the strip harvest ceiling exactly', () => {
    // Q10's ceiling-texture ruling: the strip's 270 per hour extends to the
    // level-20 zones (and farshore's level-5 kit rides the same number), so
    // density parity is ceiling parity, both levers held by the same pair of
    // pins as the tuned arm above.
    const perHour = (nodes: number) => (nodes * 3600) / NODE_HARVEST_TABLE.ore.respawnSeconds;
    for (const zone of BOTTOM_ZONES) {
      const ceiling = perHour(GATHER_NODES.filter((n) => n.zoneId === zone.id).length);
      expect(ceiling, `${zone.id} harvest ceiling`).toBe(270);
    }
  });

  it('every node level equals its zone authored level (the ceil-midpoint rule)', () => {
    // The one GatherNodeDef field no other arm pinned (the QA round): level
    // feeds the profession-XP green/gray curve (gatherActionXp in
    // src/sim/professions/profession_xp.ts, called from gathering.ts), and
    // the GatherNodeDef doc in
    // src/sim/types.ts states the authoring rule this arm enforces: every
    // node of every tier carries the ceil of its zone levelRange midpoint
    // (willowfen and galecrest 20, farshore_isle 5, the strip 4/10/17).
    // World-wide and cross-table (node records against zone records), so a
    // record drifting from its zone's number reds here by name.
    for (const node of GATHER_NODES) {
      const zone = ZONES.find((zn) => zn.id === node.zoneId);
      expect(zone, `${node.id} names a live zone`).toBeDefined();
      if (!zone) continue;
      const [lo, hi] = zone.levelRange;
      expect(node.level, `${node.id} level`).toBe(Math.ceil((lo + hi) / 2));
    }
  });

  it('render anchor: groundHeight and terrainHeight agree at every node', () => {
    // src/render/gather_nodes.ts seats each node prop at terrainHeight, while
    // every check above (and all movement) uses groundHeight, which adds the
    // Sowfield stand lift and dock plank surfaces on top of the same baseline.
    // Where the two disagree the prop renders sunk into the platform a player is
    // standing on, so a node authored onto a dock or a stand tier is a bug even
    // though it is dry, level, clear and reachable.
    for (const node of GATHER_NODES) {
      const { x, z } = node.pos;
      expect(
        groundHeight(x, z, WORLD_SEED),
        `${node.id} at (${x},${z}) is anchored on a raised walkable surface`,
      ).toBeCloseTo(terrainHeight(x, z, WORLD_SEED), 9);
    }
  });

  it('the Mirror Lake landmark stays reachable on foot without swimming', () => {
    // Moving the Eastbrook herbs onto the bank took them outside this landmark's
    // visit radius, so Wayfarer of the Vale no longer collects the mark while you
    // pick. That is only acceptable while the landmark itself can still be
    // visited dry, and nothing else asserts it: after the relocation no test and
    // no parity golden touches this POI at all, so a future lake-radius or
    // edit-layer change could flood the shore and quietly turn a deed step into a
    // swim. One standable, dry point inside the radius is all the deed needs.
    const poi = ZONES[0].pois.find((p) => p.id === 'mirror_lake');
    expect(poi, 'mirror_lake POI missing from eastbrook_vale').toBeDefined();
    if (!poi) return;
    const VISIT_RADIUS = POI_VISIT_RADIUS; // the live deeds constant, no copy to drift
    let best = Number.NEGATIVE_INFINITY;
    for (let dx = -VISIT_RADIUS; dx <= VISIT_RADIUS; dx += 0.5) {
      for (let dz = -VISIT_RADIUS; dz <= VISIT_RADIUS; dz += 0.5) {
        if (Math.hypot(dx, dz) > VISIT_RADIUS) continue;
        const x = poi.x + dx;
        const z = poi.z + dz;
        if (!canStand(x, z) || !isDryLand(x, z)) continue;
        const wl = waterAt(x, z);
        best = Math.max(
          best,
          wl === -Infinity ? Number.POSITIVE_INFINITY : groundHeight(x, z, WORLD_SEED) - wl,
        );
      }
    }
    expect(
      best,
      `no dry standable ground within ${VISIT_RADIUS}yd of the Mirror Lake landmark`,
    ).toBeGreaterThanOrEqual(WATER_MARGIN);
  });

  it('the anchor arm rejects a Sowfield stand tier, where the two really differ', () => {
    const { x, z } = ON_SOWFIELD_STAND;
    const lift = groundHeight(x, z, WORLD_SEED) - terrainHeight(x, z, WORLD_SEED);
    expect(lift).toBeGreaterThan(0.2);
    expect(groundHeight(x, z, WORLD_SEED)).not.toBeCloseTo(terrainHeight(x, z, WORLD_SEED), 9);
  });
});

// Deliberately NOT an arm: road clearance, and the honest reason is not that no
// threshold exists. One does, in exactly the form the water margin above was
// taken from: generateDecorations refuses to anchor a world prop within 5 yards
// of a road (world.ts, `roadDistance(x, z) < 5`). Adopting it here would fail
// four nodes that ship today: ore_eastbrook_1 at 1.7yd, ore_eastbrook_3 at 3.3,
// herb_thornpeak_2 at 3.8, and ore_mirefen_2 at 4.0.
//
// Two of those are the Copper Dig ore trio, deliberately placed beside the road
// that serves the mine and pinned there by tests/gather_nodes.test.ts, so the
// rule would fight an intentional placement as well as force relocations this
// change is not scoped to make. That is a content decision needing its own pass,
// not something to settle as a side effect. Recorded here so the omission reads
// as a decision rather than an oversight. The fifth former member,
// wood_mirefen_t2 at 0.3yd (standing in the road surface), WAS a real defect
// and R11 moved it to legal ground; the exemption pin above is what made that
// relocation a deliberate edit instead of a drift. The phase 20 pass repeated
// that exact treatment for the expansion zones: the one roadway-standing
// member (ore_evergarden_1 at 0.42yd) moved, and the eight verge placements
// that remain are pinned by the expansion-zone exemption arm, so both scopes
// now carry the record-not-rule shape.
