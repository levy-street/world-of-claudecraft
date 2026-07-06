// Hodric's Castle: the obstacle-race gauntlet layout. Single source of truth
// for BOTH sim collision and render dressing (the dungeon_layout.ts pattern):
// the course surfaces, walls, checkpoints, and every moving obstacle are
// defined here as plain data plus pure analytic pose functions, so what the
// renderer draws is exactly what the sim collides with and they cannot drift.
//
// Coordinates are instance-local: origin at hodricsOrigin(slot), the race runs
// along +z from the Start Yard (z ~ -116, y 0) up to the Finish Keep
// (z ~ +132, y 14). Everything off a surface is the chasm (the course floats
// on a crag; falling past HC_KILL_Y respawns the racer at their checkpoint).
//
// DETERMINISM CONTRACT: every obstacle pose is a pure function of absolute
// sim time with fixed per-obstacle phase stagger. Nothing here draws from any
// rng stream, so the course animates identically on every host, needs zero
// per-tick wire traffic, and runs in attract mode between matches. The
// renderer evaluates the same functions at render-frame time for perfectly
// smooth motion.
//
// Sim layer: no DOM/three.js imports.

import type { Collider } from './colliders';
import { hodricsOriginAt } from './data';

// ---------------------------------------------------------------------------
// Footprint and vertical constants
// ---------------------------------------------------------------------------

/** Course half extents, used by proximity checks and the renderer build gate. */
export const HC_HALF_X = 34;
export const HC_HALF_Z = 140;

/** Chasm floor far below the course (visual depth for the falling camera). */
export const HC_CHASM_Y = -40;
/** Falling past this y respawns the racer at their last checkpoint. */
export const HC_KILL_Y = -14;

// ---------------------------------------------------------------------------
// Surfaces: the walkable course, as axis-aligned terraces and ramps.
// y0 applies at z0; ramps interpolate linearly to y1 at z1.
// ---------------------------------------------------------------------------

export type HcSurfaceKind = 'grass' | 'wood' | 'stone' | 'plaza' | 'carpet' | 'keep';

export interface HcSurface {
  id: string;
  kind: HcSurfaceKind;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  /** Ramp end height at z1; flat surfaces omit it. */
  y1?: number;
}

export const HC_SURFACES: readonly HcSurface[] = [
  { id: 'start_yard', kind: 'grass', x0: -16, x1: 16, z0: -116, z1: -85, y0: 0 },
  { id: 'flail_bridge', kind: 'wood', x0: -6, x1: 6, z0: -85, z1: -45, y0: 0 },
  { id: 'cp1_landing', kind: 'stone', x0: -14, x1: 14, z0: -45, z1: -35, y0: 0 },
  { id: 'log_court', kind: 'plaza', x0: -14, x1: 14, z0: -35, z1: 15, y0: 0 },
  { id: 'axe_walk', kind: 'carpet', x0: -4, x1: 4, z0: 15, z1: 50, y0: 0 },
  { id: 'cp3_landing', kind: 'stone', x0: -12, x1: 12, z0: 50, z1: 58, y0: 0 },
  // The Drawspan gap z 58..78 has no static surface: two analytic platforms.
  { id: 'cp4_landing', kind: 'stone', x0: -12, x1: 12, z0: 78, z1: 86, y0: 0 },
  { id: 'boulder_alley', kind: 'stone', x0: -10, x1: 10, z0: 86, z1: 106, y0: 0, y1: 8 },
  { id: 'red_ascent', kind: 'carpet', x0: -8, x1: 8, z0: 106, z1: 118, y0: 8, y1: 14 },
  { id: 'finish_keep', kind: 'keep', x0: -14, x1: 14, z0: 118, z1: 132, y0: 14 },
];

/** Walkable ground height at an instance-local point, or the chasm floor. */
export function hodricsGroundLocal(lx: number, lz: number): number {
  for (const s of HC_SURFACES) {
    if (lx >= s.x0 && lx <= s.x1 && lz >= s.z0 && lz <= s.z1) {
      if (s.y1 === undefined) return s.y0;
      const f = (lz - s.z0) / (s.z1 - s.z0);
      return s.y0 + (s.y1 - s.y0) * f;
    }
  }
  return HC_CHASM_Y;
}

/**
 * World-space course ground for the band routing arm in world.groundHeight.
 * Resolves the nearest race slot by z (the x is shared across slots).
 */
export function hodricsGroundWorld(x: number, z: number): number {
  const o = hodricsOriginAt(z);
  return hodricsGroundLocal(x - o.x, z - o.z);
}

/** The course surface under an instance-local point, if any. */
export function hodricsSurfaceAt(lx: number, lz: number): HcSurface | null {
  for (const s of HC_SURFACES) {
    if (lx >= s.x0 && lx <= s.x1 && lz >= s.z0 && lz <= s.z1) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Race line: start plates, checkpoints, finish
// ---------------------------------------------------------------------------

export const HC_FIELD_SIZE = 10;

/** Two rows of five start plates in the yard, facing the bridge (+z). */
export function hcStartPlate(seat: number): { x: number; z: number; facing: number } {
  const row = seat < 5 ? 0 : 1;
  const col = seat % 5;
  return { x: -12 + col * 6, z: -98 - row * 4, facing: 0 };
}

export interface HcCheckpoint {
  /** Crossing this local z (while on a surface) banks the checkpoint. */
  z: number;
  /** Respawn spot (spread across x by seat so racers do not stack). */
  spawnX0: number;
  spawnX1: number;
}

/** Ordered respawn line. Index 0 is the start yard. */
export const HC_CHECKPOINTS: readonly HcCheckpoint[] = [
  { z: -98, spawnX0: -12, spawnX1: 12 },
  { z: -40, spawnX0: -8, spawnX1: 8 },
  { z: 10, spawnX0: -8, spawnX1: 8 },
  { z: 54, spawnX0: -8, spawnX1: 8 },
  { z: 82, spawnX0: -8, spawnX1: 8 },
];

export function hcCheckpointSpawn(cp: number, seat: number): { x: number; z: number } {
  const c = HC_CHECKPOINTS[Math.max(0, Math.min(cp, HC_CHECKPOINTS.length - 1))];
  const lanes = HC_FIELD_SIZE;
  const f = lanes <= 1 ? 0.5 : (seat % lanes) / (lanes - 1);
  return { x: c.spawnX0 + (c.spawnX1 - c.spawnX0) * f, z: c.z };
}

/** Crossing this local z on the keep terrace finishes the race. */
export const HC_FINISH_Z = 119;

/** Course progress metric: furthest local z, normalized 0..1 for the HUD. */
export function hcProgressFrac(furthestZ: number): number {
  const z0 = HC_CHECKPOINTS[0].z;
  const f = (furthestZ - z0) / (HC_FINISH_Z - z0);
  return Math.max(0, Math.min(1, f));
}

/** Section id under a local z, for HUD progress labels. */
export function hcSectionAt(lz: number): string {
  if (lz < -85) return 'start_yard';
  if (lz < -45) return 'flail_bridge';
  if (lz < 15) return 'log_court';
  if (lz < 50) return 'axe_walk';
  if (lz < 78) return 'drawspan';
  if (lz < 106) return 'boulder_alley';
  if (lz < 118) return 'red_ascent';
  return 'finish_keep';
}

// ---------------------------------------------------------------------------
// Obstacles: analytic motion, zero rng
// ---------------------------------------------------------------------------

const TWO_PI = Math.PI * 2;

/** Pendulum angle for flails and axes: amp * sin(w t + phase), radians. */
export function hcPendulumAngle(amp: number, period: number, phase: number, t: number): number {
  return amp * Math.sin((TWO_PI / period) * t + phase);
}

/** Pendulum angular velocity, the time derivative of hcPendulumAngle. */
export function hcPendulumAngVel(amp: number, period: number, phase: number, t: number): number {
  const w = TWO_PI / period;
  return amp * w * Math.cos(w * t + phase);
}

export interface HcFlailDef {
  /** Local z of the gantry this flail hangs from. */
  z: number;
  pivotY: number;
  chainLen: number;
  bobR: number;
  amp: number;
  period: number;
  phase: number;
}

/** Spiked flails over the bridge, swinging across x. */
export const HC_FLAILS: readonly HcFlailDef[] = [
  { z: -76, pivotY: 7, chainLen: 5.4, bobR: 1.3, amp: 1.05, period: 2.6, phase: 0 },
  { z: -67, pivotY: 7, chainLen: 5.4, bobR: 1.3, amp: 1.05, period: 2.6, phase: 2.4 },
  { z: -58, pivotY: 7, chainLen: 5.4, bobR: 1.3, amp: 1.05, period: 2.6, phase: 1.2 },
  { z: -49, pivotY: 7, chainLen: 5.4, bobR: 1.3, amp: 1.05, period: 2.6, phase: 3.6 },
];

/** Flail bob center and its horizontal velocity (for the knock direction). */
export function hcFlailBob(d: HcFlailDef, t: number): { x: number; y: number; vx: number } {
  const th = hcPendulumAngle(d.amp, d.period, d.phase, t);
  const om = hcPendulumAngVel(d.amp, d.period, d.phase, t);
  return {
    x: d.chainLen * Math.sin(th),
    y: d.pivotY - d.chainLen * Math.cos(th),
    vx: d.chainLen * Math.cos(th) * om,
  };
}

export interface HcAxeDef {
  z: number;
  pivotY: number;
  armLen: number;
  headR: number;
  amp: number;
  period: number;
  phase: number;
}

/** Pendulum axes over the wall walk, sweeping the carpet across x. */
export const HC_AXES: readonly HcAxeDef[] = [
  { z: 22, pivotY: 7.5, armLen: 5.9, headR: 1.7, amp: 0.95, period: 2.4, phase: 0 },
  { z: 30, pivotY: 7.5, armLen: 5.9, headR: 1.7, amp: 0.95, period: 2.4, phase: 3.1 },
  { z: 38, pivotY: 7.5, armLen: 5.9, headR: 1.7, amp: 0.95, period: 2.4, phase: 1.6 },
  { z: 46, pivotY: 7.5, armLen: 5.9, headR: 1.7, amp: 0.95, period: 2.4, phase: 4.7 },
];

/** Axe head center and horizontal velocity. */
export function hcAxeHead(d: HcAxeDef, t: number): { x: number; y: number; vx: number } {
  const th = hcPendulumAngle(d.amp, d.period, d.phase, t);
  const om = hcPendulumAngVel(d.amp, d.period, d.phase, t);
  return {
    x: d.armLen * Math.sin(th),
    y: d.pivotY - d.armLen * Math.cos(th),
    vx: d.armLen * Math.cos(th) * om,
  };
}

export interface HcRotorDef {
  cx: number;
  cz: number;
  /** Beam reach from the hub; the log spans the full 2r diameter. */
  r: number;
  /** Signed angular speed, rad/s. Opposite signs make the pair weave. */
  omega: number;
  /** Log radius: the beam blocks below beamTopY and is jumpable above it. */
  beamHalf: number;
  beamTopY: number;
}

/** Two spinning log sweepers on the plaza, turning in opposite directions. */
export const HC_ROTORS: readonly HcRotorDef[] = [
  { cx: -4, cz: -24, r: 10, omega: TWO_PI / 4.6, beamHalf: 0.55, beamTopY: 0.85 },
  { cx: 4, cz: -4, r: 10, omega: -TWO_PI / 5.4, beamHalf: 0.55, beamTopY: 0.85 },
];

export function hcRotorAngle(d: HcRotorDef, t: number): number {
  return d.omega * t;
}

export interface HcDrawspanDef {
  /** Platform center travel across x: min..max, constant speed (triangle). */
  xMin: number;
  xMax: number;
  zCenter: number;
  halfX: number;
  halfZ: number;
  y: number;
  period: number;
  /** Phase offset in periods (0..1). The pair runs half a period apart. */
  phase: number;
}

/**
 * The Drawspan: two gilded platforms sliding across the gap in antiphase.
 * Their z-spans tile the gap exactly (58..68 and 68..78, zero slivers against
 * the landings or each other), so the crossing is purely an x-timing problem:
 * the pair mirrors through x 0 and both cover the middle for about 2.5 s
 * twice per period. Wait for the meet, walk straight across; a confident
 * jump can also clear misaligned platforms early.
 */
export const HC_DRAWSPANS: readonly HcDrawspanDef[] = [
  { xMin: -6, xMax: 6, zCenter: 63, halfX: 3.2, halfZ: 5, y: 0, period: 9.6, phase: 0 },
  { xMin: -6, xMax: 6, zCenter: 73, halfX: 3.2, halfZ: 5, y: 0, period: 9.6, phase: 0.5 },
];

/** Platform center x at time t (triangle wave: constant speed, no rng). */
export function hcDrawspanX(d: HcDrawspanDef, t: number): number {
  const u = (t / d.period + d.phase) % 1;
  const tri = u < 0.5 ? u * 2 : 2 - u * 2;
  return d.xMin + (d.xMax - d.xMin) * tri;
}

export interface HcBoulderLaneDef {
  /** Lane center x; boulders roll from zTop down to zEnd. */
  x: number;
  laneHalf: number;
  zTop: number;
  zEnd: number;
  speed: number;
  r: number;
  period: number;
  phase: number;
}

/** Boulder Alley release lanes, staggered so no pattern ever repeats short. */
export const HC_BOULDER_LANES: readonly HcBoulderLaneDef[] = [
  { x: -6, laneHalf: 2.6, zTop: 106, zEnd: 84, speed: 8.5, r: 1.35, period: 3.6, phase: 0 },
  { x: 0, laneHalf: 2.6, zTop: 106, zEnd: 84, speed: 8.5, r: 1.35, period: 4.4, phase: 1.7 },
  { x: 6, laneHalf: 2.6, zTop: 106, zEnd: 84, speed: 8.5, r: 1.35, period: 5.2, phase: 2.9 },
];

/**
 * Active boulder centers for one lane at time t. A lane releases one boulder
 * per period; it lives until it rolls past zEnd, so at most
 * ceil(travelTime / period) boulders are ever active per lane.
 */
export function hcLaneBoulders(d: HcBoulderLaneDef, t: number): { z: number; y: number }[] {
  const travel = (d.zTop - d.zEnd) / d.speed;
  const out: { z: number; y: number }[] = [];
  const shifted = t - d.phase;
  if (shifted < 0) return out;
  const newest = Math.floor(shifted / d.period);
  const oldest = Math.max(0, Math.ceil((shifted - travel) / d.period));
  for (let k = oldest; k <= newest; k++) {
    const age = shifted - k * d.period;
    if (age < 0 || age > travel) continue;
    const z = d.zTop - d.speed * age;
    out.push({ z, y: hodricsGroundLocal(d.x, z) + d.r });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Static colliders: walls, funnels, posts. Movement-blocking only; the course
// deliberately leaves the bridge sides and the Drawspan gap open (falls are
// part of the game). Instance-local coordinates, translated by the routing
// arm in colliders.ts.
// ---------------------------------------------------------------------------

function wallX(x: number, z0: number, z1: number): Collider {
  return { type: 'obb', x, z: (z0 + z1) / 2, hw: 0.4, hd: (z1 - z0) / 2, rot: 0 };
}

function wallZ(z: number, x0: number, x1: number): Collider {
  return { type: 'obb', x: (x0 + x1) / 2, z, hw: (x1 - x0) / 2, hd: 0.4, rot: 0 };
}

function post(x: number, z: number, r: number): Collider {
  return { type: 'circle', x, z, r };
}

export function hodricsColliders(): Collider[] {
  const out: Collider[] = [];
  // Start Yard: enclosed except the bridge mouth.
  out.push(wallZ(-116, -16, 16), wallX(-16, -116, -85), wallX(16, -116, -85));
  out.push(wallZ(-85, -16, -6), wallZ(-85, 6, 16));
  // Flail Bridge: open sides; gantry posts flank the deck at each flail.
  for (const f of HC_FLAILS) {
    out.push(post(-6.9, f.z, 0.45), post(6.9, f.z, 0.45));
  }
  // Landing funnel off the bridge, then the walled Log Court with gates.
  out.push(wallZ(-45, -14, -6), wallZ(-45, 6, 14));
  out.push(wallX(-14, -45, 15), wallX(14, -45, 15));
  out.push(wallZ(-35, -14, -3), wallZ(-35, 3, 14));
  out.push(wallZ(15, -14, -3), wallZ(15, 3, 14));
  // Axe Walk battlements.
  out.push(wallX(-4.4, 15, 50), wallX(4.4, 15, 50));
  // Checkpoint 3 landing, then the open Drawspan gap (no rails).
  out.push(wallX(-12, 50, 58), wallX(12, 50, 58), wallZ(50, -12, -4), wallZ(50, 4, 12));
  // Far landing and Boulder Alley walls.
  out.push(wallX(-12, 78, 86), wallX(12, 78, 86));
  out.push(wallZ(86, -12.5, -10), wallZ(86, 10, 12.5));
  out.push(wallX(-10.5, 86, 106), wallX(10.5, 86, 106));
  // Red Ascent rails and the Finish Keep.
  out.push(wallZ(106, -10, -8), wallZ(106, 8, 10));
  out.push(wallX(-8.4, 106, 118), wallX(8.4, 106, 118));
  out.push(wallZ(118, -14, -8), wallZ(118, 8, 14));
  out.push(wallX(-14, 118, 132), wallX(14, 118, 132), wallZ(132, -14, 14));
  // Finish arch posts.
  out.push(post(-5, HC_FINISH_Z, 0.6), post(5, HC_FINISH_Z, 0.6));
  // Start arch posts over the yard.
  out.push(post(-7, -104, 0.5), post(7, -104, 0.5));
  return out;
}
