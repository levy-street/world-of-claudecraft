// Gourdlight Eve's indoor dressing: carved, candle-lit pumpkins INSIDE the event cities'
// walk-in houses (Eastbrook, Fenbridge, Highwatch). Purely decorative: no collider, no
// interaction, no reward; drawn only while the event runs (the city decor view,
// src/render/seasonal_decor.ts, draws them with the rest of the dressing).
//
// Like the street dressing, nothing here is a coordinate: every piece is found inside a
// walk-in building record (sim/authored_town_registry.ts) against the live colliders, so a
// house that moves or is refurnished re-seats its pumpkins on its own. Per house, a spot is:
//   - INDOORS: inside the house's walled body (never its eaves or an open annex such as
//     a smithy's forge shelter), with walls on all four sides of it within reach (a probe
//     outward along the building's own axes meets a wall each way), off the door line;
//   - ON A SURFACE: a table, counter or shelf top (a standable furniture top a hand to a
//     chest high over the floor, wide enough for the whole pumpkin), or else the floor
//     snug against a wall or a piece of furniture, never out in the walkway;
//   - CLEAR: off every furniture collider at the pumpkin's own radius, and off every
//     townsfolk's spot.
// Never in a chapel (seasonal_decor_exclusions.ts keeps the street dressing off it too).
// One pumpkin per house at most, a few per city, taken in a fixed order. Pinned against
// the live world by tests/seasonal_interior_pumpkins.test.ts. Pure: no rng, no clock.

import { isBlocked, supportHeightAt } from './colliders';
import { NPCS } from './data';
import { hash2 } from './rng';
import type { SeasonalGroundPiece } from './seasonal_decor_layout';
import { SEASONAL_EVENT_TOWNS } from './seasonal_towns';
import { groundHeight } from './world';

/** The pumpkin's footprint radius on its surface (yards, at its drawn size). */
export const INTERIOR_PUMPKIN_RADIUS = 0.32;
/** At most this many per city (and one per house). */
export const INTERIOR_PUMPKINS_PER_CITY = 3;
/** A furniture top counts from a hand to a chest high over the floor (yards). */
const TOP_MIN = 0.55;
const TOP_MAX = 1.45;
/** How far a wall may be from an indoor spot along each axis (yards). */
const ENCLOSED_REACH = 9;
/** Clearance from the door line and from any townsfolk (yards). */
const DOOR_CLEARANCE = 1.6;
const NPC_CLEARANCE = 1.4;
const GRID_STEP = 0.4;
const INSET = 0.6;
/** The drawn sizes: a lit pumpkin on a table, a bigger one on the floor. */
const TABLE_SCALE = 0.78;
const FLOOR_SCALE = 1.05;

export interface InteriorPumpkin extends SeasonalGroundPiece {
  /** What it stands on. */
  surface: 'table' | 'floor';
  /** The walk-in building record it is inside. */
  buildingId: string;
}

function toWorld(cx: number, cz: number, rot: number, lx: number, lz: number) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: cx + lx * c + lz * s, z: cz - lx * s + lz * c };
}

/** Walls along all four of the building's axes within reach: the spot is indoors. */
export function enclosedAt(seed: number, x: number, z: number, rot: number): boolean {
  const axes = [
    [Math.cos(rot), -Math.sin(rot)],
    [-Math.cos(rot), Math.sin(rot)],
    [Math.sin(rot), Math.cos(rot)],
    [-Math.sin(rot), -Math.cos(rot)],
  ];
  for (const [dx, dz] of axes) {
    let hit = false;
    for (let d = 0.5; d <= ENCLOSED_REACH; d += 0.5) {
      if (isBlocked(seed, x + dx * d, z + dz * d, 0.2)) {
        hit = true;
        break;
      }
    }
    if (!hit) return false;
  }
  return true;
}

function distToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len2)) : 0;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

/** A furniture top under (x, z) the whole pumpkin fits on, or null. */
export function tableTopAt(seed: number, x: number, z: number, floor: number): number | null {
  const top = supportHeightAt(seed, x, z, 0.2, floor + TOP_MAX);
  if (!Number.isFinite(top) || top < floor + TOP_MIN) return null;
  const r = INTERIOR_PUMPKIN_RADIUS * 0.8;
  for (const [ox, oz] of [
    [r, 0],
    [-r, 0],
    [0, r],
    [0, -r],
  ]) {
    const t = supportHeightAt(seed, x + ox, z + oz, 0.1, floor + TOP_MAX);
    if (!Number.isFinite(t) || Math.abs(t - top) > 0.04) return null;
  }
  return top;
}

interface Candidate {
  x: number;
  y: number;
  z: number;
  surface: 'table' | 'floor';
  order: number;
}

/** Every indoor pumpkin for the built-in world at `seed`, in a fixed order. */
export function resolveInteriorPumpkins(seed: number): InteriorPumpkin[] {
  const job = interiorPumpkinJob(seed, false);
  while (!job.step()) {
    // one house a step; run to the end
  }
  return job.result ? [...job.result] : [];
}

/** The resolve cut into one house per step, so a client spreads it over frames instead
 *  of stalling one (the decor view steps it once a frame until it is done). The result
 *  is the same list in the same order as the one-shot resolve; `memoize` stores it in
 *  the per-seed memo when the job finishes. */
export interface InteriorPumpkinJob {
  /** Resolve the next house; true once every city is done (and on every later call). */
  step(): boolean;
  /** The finished list, or null while the job still runs. */
  readonly result: readonly InteriorPumpkin[] | null;
}

export function interiorPumpkinJob(seed: number, memoize = true): InteriorPumpkinJob {
  const cached = memo.get(seed);
  if (cached) return { step: () => true, result: cached };
  const npcSpots = Object.values(NPCS).map((n) => n.pos);
  const queue = SEASONAL_EVENT_TOWNS.flatMap((town, townIndex) =>
    town.buildings
      // never in a chapel: no event dressing at or in it (owner note 2026-10-18)
      .filter((b) => b.walkIn === true && b.kind !== 'chapel')
      .slice()
      .sort((a, b) => hash2(hashId(a.id), 3, 0x51) - hash2(hashId(b.id), 3, 0x51))
      .map((house) => ({ townIndex, house })),
  );
  const perTown = SEASONAL_EVENT_TOWNS.map((): InteriorPumpkin[] => []);
  let next = 0;
  const job = {
    result: null as InteriorPumpkin[] | null,
    step(): boolean {
      if (job.result) return true;
      // skip the houses of a town that already has its share (no probe spent on them)
      while (
        next < queue.length &&
        perTown[queue[next].townIndex].length >= INTERIOR_PUMPKINS_PER_CITY
      )
        next++;
      if (next < queue.length) {
        const { townIndex, house } = queue[next++];
        const best = houseSpot(seed, house, npcSpots);
        if (best) perTown[townIndex].push(best);
        return false;
      }
      job.result = perTown.flat();
      if (memoize) memo.set(seed, job.result);
      return true;
    },
  };
  return job;
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h;
}

function houseSpot(
  seed: number,
  house: (typeof SEASONAL_EVENT_TOWNS)[number]['buildings'][number],
  npcSpots: readonly { x: number; z: number }[],
): InteriorPumpkin | null {
  // the walled body (the record's footprint: its position and its walls' own size),
  // never the model's whole reach, which takes in the eaves and any open annex
  const rot = house.rotation;
  const door = house.frontStandingPoint;
  const centre = house.position;
  const halfW = house.nativeDimensions.width / 2;
  const halfD = house.nativeDimensions.depth / 2;
  // The house's grid cells in a fixed hashed order; each test runs lazily down it, so a
  // furnished house stops at its first good table (the probes are the cost).
  const cells: { x: number; z: number; order: number }[] = [];
  const hw = halfW - INSET;
  const hd = halfD - INSET;
  for (let lx = -hw; lx <= hw; lx += GRID_STEP) {
    for (let lz = -hd; lz <= hd; lz += GRID_STEP) {
      const { x, z } = toWorld(centre.x, centre.z, rot, lx, lz);
      if (distToSegment(x, z, door.x, door.z, centre.x, centre.z) < DOOR_CLEARANCE) continue;
      if (npcSpots.some((n) => Math.hypot(n.x - x, n.z - z) < NPC_CLEARANCE)) continue;
      cells.push({ x, z, order: hash2(Math.round(x * 10), Math.round(z * 10), 0x7a3) });
    }
  }
  cells.sort((a, b) => a.order - b.order || a.x - b.x || a.z - b.z);
  let c: Candidate | null = null;
  for (const cell of cells) {
    const top = tableTopAt(seed, cell.x, cell.z, groundHeight(cell.x, cell.z, seed));
    if (top === null || !enclosedAt(seed, cell.x, cell.z, rot)) continue;
    c = { x: cell.x, y: top, z: cell.z, surface: 'table', order: cell.order };
    break;
  }
  // no table fits: the floor, clear at the pumpkin's radius, snug against something solid
  if (!c) {
    for (const cell of cells) {
      if (isBlocked(seed, cell.x, cell.z, INTERIOR_PUMPKIN_RADIUS)) continue;
      if (!isBlocked(seed, cell.x, cell.z, INTERIOR_PUMPKIN_RADIUS + 0.45)) continue;
      const floor = groundHeight(cell.x, cell.z, seed);
      if (tableTopAt(seed, cell.x, cell.z, floor) !== null) continue;
      if (!enclosedAt(seed, cell.x, cell.z, rot)) continue;
      c = { x: cell.x, y: floor, z: cell.z, surface: 'floor', order: cell.order };
      break;
    }
  }
  if (!c) return null;
  // its carved face turns toward the room's middle, where whoever walks in will look
  const yaw = Math.atan2(centre.x - c.x, centre.z - c.z);
  return {
    kind: 'pumpkin_lit',
    x: c.x,
    y: c.y,
    z: c.z,
    yaw,
    scale: c.surface === 'table' ? TABLE_SCALE : FLOOR_SCALE,
    anchor: `interior:${house.id}`,
    surface: c.surface,
    buildingId: house.id,
  };
}

const memo = new Map<number, InteriorPumpkin[]>();
/** Memoized per seed (the built-in world's houses never move at runtime). */
export function interiorPumpkins(seed: number): readonly InteriorPumpkin[] {
  let list = memo.get(seed);
  if (!list) {
    list = resolveInteriorPumpkins(seed);
    memo.set(seed, list);
  }
  return list;
}
