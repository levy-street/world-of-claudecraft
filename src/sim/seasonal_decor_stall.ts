// The seasonal keeper's market stall: where it stands, resolved against the LIVE
// world like the rest of the city dressing (src/sim/seasonal_decor_layout.ts).
//
// The stall is anchored to the keeper herself: its origin is her standing spot
// (she works it from inside, behind the counter) and it faces the way she faces.
// So it moves with her, and she is the one coordinate an event author picks.
// Before it is drawn the whole footprint (the booth, its hay bales, crates and
// corn shocks) is checked: clear of every static collider, off the painted road,
// off every other NPC's spot and out of water. If her spot will not take it, a
// small sideways slide along the counter and a slight turn are tried (she still
// stands behind the counter either way); if nothing fits there is no stall and
// the resolver falls back to a pile of gourds round her, never a stall in a wall.
//
// Pure and deterministic: no rng, no clock, no Three.
import { isBlocked } from './colliders';
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
  for (let lx = f.minX; lx <= f.maxX + 1e-6; lx += STALL_SAMPLE_STEP) {
    for (let lz = f.minZ; lz <= f.maxZ + 1e-6; lz += STALL_SAMPLE_STEP) {
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
): 'collider' | 'road' | 'npc' | 'water' | null {
  for (const p of stallSamples(x, z, yaw)) {
    if (groundHeight(p.x, p.z, seed) < WATER_LEVEL + 0.4) return 'water';
    if (roadDistance(p.x, p.z) < STALL_ROAD_CLEARANCE) return 'road';
    for (const n of otherNpcs) {
      if (Math.hypot(n.x - p.x, n.z - p.z) < STALL_NPC_CLEARANCE) return 'npc';
    }
    if (isBlocked(seed, p.x, p.z, STALL_SAMPLE_RADIUS)) return 'collider';
  }
  return null;
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
