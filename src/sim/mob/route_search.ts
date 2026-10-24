// A bounded grid search for a mob's route round an obstacle (mob/chase_route.ts
// is its only caller). It is NOT the shared pathfinder (pathfind.ts findPath,
// the warrior Charge and the pet heel): that one searches until it has flooded
// its window, allocates its buffers per call and smooths in quadratic time,
// which is fine for one player ability and far too dear for a pack of mobs on
// the server's tick. This search is built for that tick:
//   - it stops at a NODE CAP the caller sets (a node is one cell whose
//     walkability had to be worked out, the search's whole cost), so a search
//     that finds nothing costs no more than one that does;
//   - it reuses one set of scratch buffers and a flat numeric heap, and its
//     helpers are module functions, not per-call closures: the search's own
//     bookkeeping allocates nothing but its short result path. Judging a cell
//     still does: it asks colliders.ts isBlocked, which resolves the point (a
//     push-out and a few short-lived objects a cell, so a capped search makes
//     a few thousand). A direct overlap test was tried and dropped: isBlocked
//     reads a cell squeezed between two abutting walls as free (the second
//     wall pushes the point back where it began), the mover agrees with
//     isBlocked, and the search must judge as the mover does;
//   - it straightens its path with a capped look-ahead over the cells it has
//     already judged, never by re-sampling the world.
//
// It judges a cell exactly as the mover does where it is used (Sim.moveToward
// in an instanced interior, where chase_route.ts confines it): the same
// collider set at the same body radius, which is the slot's own view (an open
// or pending gate is no collider, a closed or sealed one is, and so is an
// encounter's combat wall), plus the landlocked mob's deep-water rule. Interior
// floors carry no slope gate for mobs (world.ts nearSteepWalls: cliffs there
// are colliders), so the search has none either.
//
// The goal is any walkable cell within GOAL_REACH of the target, never the
// target's own cell taken on trust: a target standing ON a collider (a perch)
// has no such cell beside it unless a body can really stand there, so a perch
// is "no route", not a route to the foot of it and a dance.
//
// The buffers and the s* variables below are SCRATCH, not state: a search
// writes them all before it reads them (cells are stamped with the search's
// own generation), it never yields mid-way, and nothing outside this file can
// see them, so nothing one search wrote is ever read by the next. Draws no
// rng; pure in its inputs (the positions, the seed's colliders, the cap).

import { isBlocked } from '../colliders';
import { PLAYER_BODY_RADIUS, PLAYER_SWIM_DEPTH } from '../pathfind';
import { groundHeight, waterLevelAt } from '../world';

/** Cells a side of the widest window the search accepts. */
export const ROUTE_SEARCH_SPAN = 80;
/** A walkable cell this near the target is the goal. */
const GOAL_REACH = 1.5;
/** How many points ahead the path straightener looks from each anchor. */
const SMOOTH_LOOKAHEAD = 12;
/** Yards between the samples of a straightened leg. */
const SMOOTH_STEP = 0.5;

const MAX_CELLS = ROUTE_SEARCH_SPAN * ROUTE_SEARCH_SPAN;
const HEAP_CAP = MAX_CELLS * 4;

// ---- scratch (see the header) ---------------------------------------------------
const cellGen = new Uint32Array(MAX_CELLS);
const cellWalk = new Uint8Array(MAX_CELLS); // 0 unknown, 1 walkable, 2 blocked
const cellClosed = new Uint8Array(MAX_CELLS);
const cellG = new Float32Array(MAX_CELLS);
const cellFrom = new Int32Array(MAX_CELLS);
const heapF = new Float32Array(HEAP_CAP);
const heapI = new Int32Array(HEAP_CAP);
let generation = 0;
let heapN = 0;
let sMinX = 0;
let sMinZ = 0;
let sW = 0;
let sSeed = 0;
let sToken = 0;
let sSwim = false;
let sStart = 0;
let sNodes = 0;
let sCap = 0;
let sCapped = false;
let sToX = 0;
let sToZ = 0;

export interface RouteSearchOpts {
  seed: number;
  /** Yards of slack round the start-to-target box. */
  margin: number;
  /** The most cells the search may judge before it gives up. */
  maxNodes: number;
  /** The mover swims: deep water is no obstacle to it. */
  swim: boolean;
  /** Per-Sim rift collision token (colliders.ts registry); 0 for none. */
  riftToken: number;
}

export interface RouteSearchResult {
  /** The search ran. False when it was refused outright (the pair is too far
   *  apart for the window): nothing was judged and nothing was learned, so the
   *  caller must not count it as a search that failed. */
  attempted: boolean;
  /** A way was found (false: none inside the window, or the cap was hit). */
  found: boolean;
  /** Cells judged: the search's cost, for the caller's budget. */
  nodes: number;
  /** The waypoints after the start, ending on the target's own spot; one
   *  waypoint means the straight line is already clear. Empty when nothing
   *  was found. */
  path: { x: number; z: number }[];
}

function touch(i: number): void {
  if (cellGen[i] === generation) return;
  cellGen[i] = generation;
  cellWalk[i] = 0;
  cellClosed[i] = 0;
  cellG[i] = Infinity;
  cellFrom[i] = -1;
}

/** The mover's own two refusals at a cell's centre: a collider at its body
 *  radius, and (landlocked) ground deeper under water than it will wade. */
function walkable(i: number): boolean {
  touch(i);
  if (cellWalk[i] === 0) {
    let ok = i === sStart;
    if (!ok) {
      // The cap is exact: a cell past it is not judged at all (and not
      // remembered), it simply ends the search.
      if (sNodes >= sCap) {
        sCapped = true;
        return false;
      }
      sNodes++;
      const x = sMinX + (i % sW) + 0.5;
      const z = sMinZ + ((i / sW) | 0) + 0.5;
      ok = !isBlocked(sSeed, x, z, PLAYER_BODY_RADIUS, false, undefined, sToken);
      if (ok && !sSwim) {
        const water = waterLevelAt(x, z, sSeed);
        if (water !== -Infinity && groundHeight(x, z, sSeed) < water - PLAYER_SWIM_DEPTH)
          ok = false;
      }
    }
    cellWalk[i] = ok ? 1 : 2;
  }
  return cellWalk[i] === 1;
}

function cellOf(x: number, z: number): number {
  return (Math.floor(z) - sMinZ) * sW + (Math.floor(x) - sMinX);
}

function toGoal(i: number): number {
  return Math.hypot(sMinX + (i % sW) + 0.5 - sToX, sMinZ + ((i / sW) | 0) + 0.5 - sToZ);
}

// A flat binary min-heap over (f, cell), lazy deletion.
function push(f: number, i: number): boolean {
  if (heapN >= HEAP_CAP) return false;
  let at = heapN++;
  while (at > 0) {
    const up = (at - 1) >> 1;
    if (heapF[up] <= f) break;
    heapF[at] = heapF[up];
    heapI[at] = heapI[up];
    at = up;
  }
  heapF[at] = f;
  heapI[at] = i;
  return true;
}

function pop(): number {
  const top = heapI[0];
  heapN--;
  if (heapN > 0) {
    const f = heapF[heapN];
    const i = heapI[heapN];
    let at = 0;
    for (;;) {
      let child = at * 2 + 1;
      if (child >= heapN) break;
      if (child + 1 < heapN && heapF[child + 1] < heapF[child]) child++;
      if (heapF[child] >= f) break;
      heapF[at] = heapF[child];
      heapI[at] = heapI[child];
      at = child;
    }
    heapF[at] = f;
    heapI[at] = i;
  }
  return top;
}

/** Is the straight leg between two path points clear of every judged cell? */
function legClear(px: number[], pz: number[], a: number, b: number): boolean {
  const dx = px[b] - px[a];
  const dz = pz[b] - pz[a];
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / SMOOTH_STEP));
  const last = px.length - 1;
  // The leg's own two ends are the mob's spot or a cell already walked through.
  for (let s = 1; s < steps; s++) {
    const x = px[a] + (dx * s) / steps;
    const z = pz[a] + (dz * s) / steps;
    // The last leg ends on the target, whose own cell may be a wall's edge.
    if (b === last && Math.hypot(x - sToX, z - sToZ) <= GOAL_REACH) continue;
    if (!walkable(cellOf(x, z))) return false;
  }
  return true;
}

/**
 * Search for a walkable route from `from` to within reach of `to`. Bounded by
 * `opts.maxNodes`; deterministic.
 */
export function searchRoute(
  from: { x: number; z: number },
  to: { x: number; z: number },
  opts: RouteSearchOpts,
): RouteSearchResult {
  sMinX = Math.floor(Math.min(from.x, to.x) - opts.margin);
  sMinZ = Math.floor(Math.min(from.z, to.z) - opts.margin);
  sW = Math.ceil(Math.max(from.x, to.x) + opts.margin) - sMinX;
  const H = Math.ceil(Math.max(from.z, to.z) + opts.margin) - sMinZ;
  if (sW > ROUTE_SEARCH_SPAN || H > ROUTE_SEARCH_SPAN || opts.maxNodes <= 0)
    return { attempted: false, found: false, nodes: 0, path: [] };
  generation = (generation + 1) >>> 0;
  if (generation === 0) {
    // The counter wrapped: no stale stamp may read as this search's.
    cellGen.fill(0);
    generation = 1;
  }
  sSeed = opts.seed;
  sToken = opts.riftToken;
  sSwim = opts.swim;
  sToX = to.x;
  sToZ = to.z;
  sNodes = 0;
  sCap = opts.maxNodes;
  sCapped = false;
  heapN = 0;
  sStart = cellOf(from.x, from.z);
  const W = sW;

  touch(sStart);
  cellG[sStart] = 0;
  push(toGoal(sStart), sStart);
  let goal = -1;
  while (heapN > 0 && !sCapped) {
    const cur = pop();
    if (cellClosed[cur] === 1) continue;
    cellClosed[cur] = 1;
    // Within reach of the target on a cell a body can stand on: arrived.
    if (toGoal(cur) <= GOAL_REACH) {
      goal = cur;
      break;
    }
    const gx = cur % W;
    const gz = (cur / W) | 0;
    for (let dz = -1; dz <= 1; dz++) {
      const nz = gz + dz;
      if (nz < 0 || nz >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = gx + dx;
        if (nx < 0 || nx >= W) continue;
        const next = nz * W + nx;
        if (!walkable(next)) continue;
        // A diagonal only between two open sides: no cutting a corner.
        if (dx !== 0 && dz !== 0 && (!walkable(gz * W + nx) || !walkable(nz * W + gx))) continue;
        const g = cellG[cur] + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
        if (g < cellG[next]) {
          cellG[next] = g;
          cellFrom[next] = cur;
          if (!push(g + toGoal(next), next))
            return { attempted: true, found: false, nodes: sNodes, path: [] };
        }
      }
    }
  }
  if (goal < 0) return { attempted: true, found: false, nodes: sNodes, path: [] };
  // Found with cells to spare or not, the straightening below spends only
  // what is left of the cap: a leg it cannot afford to check stays as walked.

  // Rebuild, then straighten over the cells already judged.
  const cells: number[] = [];
  for (let i = goal; i !== -1; i = cellFrom[i]) cells.push(i);
  cells.reverse();
  const px: number[] = [from.x];
  const pz: number[] = [from.z];
  for (let k = 1; k < cells.length; k++) {
    px.push(sMinX + (cells[k] % W) + 0.5);
    pz.push(sMinZ + ((cells[k] / W) | 0) + 0.5);
  }
  px.push(to.x);
  pz.push(to.z);
  const last = px.length - 1;
  // The straight line may already be clear (the caller was stopped by
  // something that has since moved): one waypoint, no route to walk.
  if (legClear(px, pz, 0, last))
    return { attempted: true, found: true, nodes: sNodes, path: [{ x: to.x, z: to.z }] };
  const path: { x: number; z: number }[] = [];
  let anchor = 0;
  while (anchor < last) {
    let next = Math.min(last, anchor + SMOOTH_LOOKAHEAD);
    while (next > anchor + 1 && !legClear(px, pz, anchor, next)) next--;
    path.push({ x: px[next], z: pz[next] });
    anchor = next;
  }
  return { attempted: true, found: true, nodes: sNodes, path };
}
