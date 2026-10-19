// The seasonal keeper's market stall: where it stands, resolved against the LIVE
// world like the rest of the city dressing (src/sim/seasonal_decor_layout.ts).
//
// The stall is anchored to the keeper herself: its origin is her standing spot
// (she works it from inside, behind the counter) and it faces the way she faces.
// So it moves with her, and she is the one coordinate an event author picks.
// Before it is drawn the whole footprint (the booth, its hay bales, crates and
// corn shocks) is checked: clear of every static collider, off the painted road,
// off every other NPC's spot and out of water. Then its ROOM: a booth wedged in a
// lane leaves nowhere to stand and puts the camera inside the next house (owner
// note 2026-10-18), so the customers' apron in front of the counter and the camera
// lane behind them must be open ground, and a strip down each side and behind the
// back wall must be free of walls. If her spot will not take it, a
// small sideways slide along the counter and a slight turn are tried (she still
// stands behind the counter either way); if nothing fits there is no stall and
// the resolver falls back to a pile of gourds round her, never a stall in a wall.
//
// Pure and deterministic: no rng, no clock, no Three.
import { pushOut } from './collider_pushout';
import type { Collider } from './collider_shapes';
import { isBlocked, queryOpenWorldColliders } from './colliders';
import { groundHeight, roadDistance, WATER_LEVEL } from './world';

/** The booth's footprint in its own frame (yards, before STALL_SCALE): +x along
 *  the counter, +z out toward the customers, origin = the keeper's spot. Measured
 *  off the authored model (scripts/assets/gourdlight_eve/stall.py). */
export const STALL_FOOTPRINT = Object.freeze({ minX: -3.5, maxX: 3.6, minZ: -1.3, maxZ: 2.0 });
/** The stall is drawn a little over its authored size, so it towers over a player. */
export const STALL_SCALE = 1.1;
/** The footprint's edge may come this near the road's centre line (yards): the
 *  booth stands at the roadside, its customers on the track in front of it. */
export const STALL_ROAD_CLEARANCE = 2.2;
/** Other NPCs keep this much room from the footprint's samples. */
export const STALL_NPC_CLEARANCE = 1.0;
/** The stall's ROOM, in its own frame (yards, AFTER STALL_SCALE): an apron of open,
 *  walkable ground in front of the counter where her customers stand... */
export const STALL_APRON = Object.freeze({ halfWidth: 3, depth: 4.5 });
/** ...a lane behind them where the chase camera sits, kept clear of buildings... */
export const STALL_CAMERA_LANE = Object.freeze({ halfWidth: 2.4, depth: 10.5 });
/** ...and no building within this much of either side of the booth. */
export const STALL_ELBOW_ROOM = 1.2;
/** A collider counts as a BUILDING (the thing a camera clips into) when it stands at
 *  least this tall over the ground... */
const BUILDING_MIN_HEIGHT = 4;
/** ...and is at least this wide (a lamp post, a tree trunk or a sign is not). */
const BUILDING_MIN_HALF_EXTENT = 1.5;
/** Collider probe radius at each footprint sample. */
const STALL_SAMPLE_RADIUS = 0.3;
const STALL_SAMPLE_STEP = 0.5;
/** Sideways slides along the counter (yards), then slight turns (radians). */
const STALL_SLIDES: readonly number[] = [0, 0.5, -0.5, 1, -1, 1.5, -1.5];
const STALL_TURNS: readonly number[] = [0, 0.15, -0.15, 0.3, -0.3];

export interface SeasonalStall {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  anchor: string;
}

export interface StallAnchor {
  id: string;
  pos: { x: number; z: number };
  facing: number;
}

/** A world point at local (lx, lz) of a stall at (x, z) turned by `yaw`
 *  (local +z maps to the yaw's facing, (sin yaw, cos yaw)). */
export function stallLocalToWorld(
  x: number,
  z: number,
  yaw: number,
  lx: number,
  lz: number,
): { x: number; z: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: x + lx * c + lz * s, z: z - lx * s + lz * c };
}

/** Whether world (px, pz) lies inside the stall's footprint grown by `margin`. */
export function insideStall(stall: SeasonalStall, px: number, pz: number, margin = 0): boolean {
  const dx = px - stall.x;
  const dz = pz - stall.z;
  const c = Math.cos(stall.yaw);
  const s = Math.sin(stall.yaw);
  const lx = (dx * c - dz * s) / stall.scale;
  const lz = (dx * s + dz * c) / stall.scale;
  const m = margin / stall.scale;
  return (
    lx >= STALL_FOOTPRINT.minX - m &&
    lx <= STALL_FOOTPRINT.maxX + m &&
    lz >= STALL_FOOTPRINT.minZ - m &&
    lz <= STALL_FOOTPRINT.maxZ + m
  );
}

/** The footprint's sample grid, in world space. */
export function stallSamples(
  x: number,
  z: number,
  yaw: number,
  scale = STALL_SCALE,
): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const f = STALL_FOOTPRINT;
  // an even grid that always lands on both edges, so every corner is a sample (its
  // ground sets the stall's seat: a missed corner is a floating one on a slope)
  const nx = Math.ceil((f.maxX - f.minX) / STALL_SAMPLE_STEP - 1e-9);
  const nz = Math.ceil((f.maxZ - f.minZ) / STALL_SAMPLE_STEP - 1e-9);
  for (let i = 0; i <= nx; i++) {
    const lx = f.minX + ((f.maxX - f.minX) * i) / nx;
    for (let j = 0; j <= nz; j++) {
      const lz = f.minZ + ((f.maxZ - f.minZ) * j) / nz;
      out.push(stallLocalToWorld(x, z, yaw, lx * scale, lz * scale));
    }
  }
  return out;
}

/** Why a stall placement is refused, or null when the whole footprint is clear. */
export function stallSpotProblem(
  seed: number,
  x: number,
  z: number,
  yaw: number,
  otherNpcs: readonly { x: number; z: number }[],
): 'collider' | 'road' | 'npc' | 'water' | 'cramped' | null {
  for (const p of stallSamples(x, z, yaw)) {
    if (groundHeight(p.x, p.z, seed) < WATER_LEVEL + 0.4) return 'water';
    if (roadDistance(p.x, p.z) < STALL_ROAD_CLEARANCE) return 'road';
    for (const n of otherNpcs) {
      if (Math.hypot(n.x - p.x, n.z - p.z) < STALL_NPC_CLEARANCE) return 'npc';
    }
    if (isBlocked(seed, p.x, p.z, STALL_SAMPLE_RADIUS)) return 'collider';
  }
  return stallRoomProblem(seed, x, z, yaw);
}

/** Probe radius of an apron sample: a standing body. */
const STALL_ROOM_RADIUS = 0.45;

/** 'cramped' when a stall at (x, z, yaw) leaves her customers nowhere to stand (the apron
 *  blocked by anything solid) or puts a building in the camera lane behind them or hard
 *  against a side of the booth; null when it has room. */
export function stallRoomProblem(
  seed: number,
  x: number,
  z: number,
  yaw: number,
): 'cramped' | null {
  const f = STALL_FOOTPRINT;
  const s = STALL_SCALE;
  const front = f.maxZ * s + 0.5;
  const apron = STALL_APRON;
  for (let lz = front; lz <= front + apron.depth + 1e-6; lz += 1) {
    for (let lx = -apron.halfWidth; lx <= apron.halfWidth + 1e-6; lx += 1) {
      const p = stallLocalToWorld(x, z, yaw, lx, lz);
      if (isBlocked(seed, p.x, p.z, STALL_ROOM_RADIUS)) return 'cramped';
    }
  }
  const lane = STALL_CAMERA_LANE;
  for (let lz = front + apron.depth; lz <= lane.depth + 1e-6; lz += 1) {
    for (let lx = -lane.halfWidth; lx <= lane.halfWidth + 1e-6; lx += 1.2) {
      const p = stallLocalToWorld(x, z, yaw, lx, lz);
      if (buildingAt(seed, p.x, p.z, 0.6)) return 'cramped';
    }
  }
  for (let lz = f.minZ * s; lz <= f.maxZ * s + 1e-6; lz += 0.8) {
    for (const lx of [f.minX * s - STALL_ELBOW_ROOM, f.maxX * s + STALL_ELBOW_ROOM]) {
      const p = stallLocalToWorld(x, z, yaw, lx, lz);
      if (buildingAt(seed, p.x, p.z, 0.3)) return 'cramped';
    }
  }
  return null;
}

const nearby: Collider[] = [];

/** Whether a building (tall and wide, see BUILDING_MIN_*) stands within `pad` of (x, z). */
function buildingAt(seed: number, x: number, z: number, pad: number): boolean {
  nearby.length = 0;
  queryOpenWorldColliders(seed, x - pad, z - pad, x + pad, z + pad, nearby);
  for (const c of nearby) {
    const extent = c.type === 'obb' ? Math.max(c.hw, c.hd) : c.type === 'circle' ? c.r : c.br;
    if (extent < BUILDING_MIN_HALF_EXTENT) continue;
    if (
      c.cameraTopY !== undefined &&
      c.cameraTopY - groundHeight(c.x, c.z, seed) < BUILDING_MIN_HEIGHT
    )
      continue;
    if (pushOut(c, x, z, pad) !== null) return true;
  }
  return false;
}

/** Seat the keeper's stall round her spot, or null when nothing fits. Its
 *  height is the lowest ground under the footprint, so no corner ever floats
 *  (the booth's deck skirt runs below its origin into higher ground). */
export function resolveSeasonalStall(
  seed: number,
  keeper: StallAnchor,
  otherNpcs: readonly { x: number; z: number }[],
): SeasonalStall | null {
  for (const turn of STALL_TURNS) {
    const yaw = keeper.facing + turn;
    for (const slide of STALL_SLIDES) {
      // a slide moves the booth along its counter, so she still stands behind it
      const o = stallLocalToWorld(keeper.pos.x, keeper.pos.z, yaw, -slide, 0);
      if (stallSpotProblem(seed, o.x, o.z, yaw, otherNpcs) !== null) continue;
      let y = Number.POSITIVE_INFINITY;
      for (const p of stallSamples(o.x, o.z, yaw)) y = Math.min(y, groundHeight(p.x, p.z, seed));
      return { x: o.x, y, z: o.z, yaw, scale: STALL_SCALE, anchor: `stall:${keeper.id}` };
    }
  }
  return null;
}
