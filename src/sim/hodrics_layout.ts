// Hodric's Castle: obstacle def shapes and their pure pose functions. Since
// Lord Hodric rebuilds his gauntlet for every round (src/sim/hodrics_course.ts
// generates a fresh course per round seed), nothing here is a fixed course:
// this module is the obstacle VOCABULARY, shared by the generator, the race
// physics, the bots, and the renderer.
//
// DETERMINISM CONTRACT: every pose is a pure function of the def and absolute
// sim time with fixed per-obstacle phase stagger. Nothing here draws from any
// rng stream, so a course animates identically on every host, needs zero
// per-tick wire traffic, and runs in attract mode between matches. The
// renderer evaluates the same functions at render-frame time for perfectly
// smooth motion.
//
// Sim layer: no DOM/three.js imports.

// ---------------------------------------------------------------------------
// Footprint and vertical constants
// ---------------------------------------------------------------------------

/** Course half length, used by the renderer's approach-proximity build gate. */
export const HC_HALF_Z = 140;

/** Chasm floor far below the course (visual depth for the falling camera). */
export const HC_CHASM_Y = -40;
/** Falling past this y respawns the racer at their last checkpoint. */
export const HC_KILL_Y = -14;

export const HC_FIELD_SIZE = 10;

// ---------------------------------------------------------------------------
// Surfaces and checkpoints (shapes only; instances live on an HcCourse)
// ---------------------------------------------------------------------------

export type HcSurfaceKind = 'grass' | 'wood' | 'stone' | 'plaza' | 'carpet' | 'keep' | 'gallery';

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

export interface HcCheckpoint {
  /** Crossing this local z (while on a surface) banks the checkpoint. */
  z: number;
  /** Respawn spot (spread across x by seat so racers do not stack). */
  spawnX0: number;
  spawnX1: number;
}

// ---------------------------------------------------------------------------
// Pendulums (hammers and axes)
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
  /** Deck height under the gantry (poses and hits are relative to it). */
  y: number;
  pivotY: number;
  chainLen: number;
  bobR: number;
  amp: number;
  period: number;
  phase: number;
}

/** Flail bob center and its horizontal velocity (for the knock direction). */
export function hcFlailBob(d: HcFlailDef, t: number): { x: number; y: number; vx: number } {
  const th = hcPendulumAngle(d.amp, d.period, d.phase, t);
  const om = hcPendulumAngVel(d.amp, d.period, d.phase, t);
  return {
    x: d.chainLen * Math.sin(th),
    y: d.y + d.pivotY - d.chainLen * Math.cos(th),
    vx: d.chainLen * Math.cos(th) * om,
  };
}

export interface HcAxeDef {
  z: number;
  /** Deck height under the gantry. */
  y: number;
  pivotY: number;
  armLen: number;
  headR: number;
  amp: number;
  period: number;
  phase: number;
}

/** Axe head center and horizontal velocity. */
export function hcAxeHead(d: HcAxeDef, t: number): { x: number; y: number; vx: number } {
  const th = hcPendulumAngle(d.amp, d.period, d.phase, t);
  const om = hcPendulumAngVel(d.amp, d.period, d.phase, t);
  return {
    x: d.armLen * Math.sin(th),
    y: d.y + d.pivotY - d.armLen * Math.cos(th),
    vx: d.armLen * Math.cos(th) * om,
  };
}

// ---------------------------------------------------------------------------
// Rotors (spinning log sweepers)
// ---------------------------------------------------------------------------

export interface HcRotorDef {
  cx: number;
  cz: number;
  /** Deck height of the court the beam sweeps. */
  y: number;
  /** Beam reach from the hub; the log spans the full 2r diameter. */
  r: number;
  /** Signed angular speed, rad/s. Opposite signs make a pair weave. */
  omega: number;
  /** Log radius: the beam blocks below beamTopY and is jumpable above it. */
  beamHalf: number;
  beamTopY: number;
}

export function hcRotorAngle(d: HcRotorDef, t: number): number {
  return d.omega * t;
}

// ---------------------------------------------------------------------------
// Drawspan (sliding gap platforms)
// ---------------------------------------------------------------------------

export interface HcDrawspanDef {
  /** Platform center travel across x: min..max, constant speed (triangle). */
  xMin: number;
  xMax: number;
  zCenter: number;
  halfX: number;
  halfZ: number;
  y: number;
  period: number;
  /** Phase offset in periods (0..1). A pair runs half a period apart. */
  phase: number;
}

/** Platform center x at time t (triangle wave: constant speed, no rng). */
export function hcDrawspanX(d: HcDrawspanDef, t: number): number {
  const u = (t / d.period + d.phase) % 1;
  const tri = u < 0.5 ? u * 2 : 2 - u * 2;
  return d.xMin + (d.xMax - d.xMin) * tri;
}

// ---------------------------------------------------------------------------
// Boulder lanes
// ---------------------------------------------------------------------------

export interface HcBoulderLaneDef {
  /** Lane center x; boulders roll from zTop down to zEnd. */
  x: number;
  laneHalf: number;
  zTop: number;
  zEnd: number;
  /** Ground height at the release line and at the end of the run. */
  yTop: number;
  yEnd: number;
  speed: number;
  r: number;
  period: number;
  phase: number;
}

/**
 * Active boulder centers for one lane at time t. A lane releases one boulder
 * per period; it lives until it rolls past zEnd, so at most
 * ceil(travelTime / period) boulders are ever active per lane. Self-contained:
 * the lane def carries its own ground line (yTop at release, yEnd at exit).
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
    const f = (d.zTop - z) / (d.zTop - d.zEnd);
    out.push({ z, y: d.yTop + (d.yEnd - d.yTop) * f + d.r });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pusher pistons (new gimmick: wall-mounted rams shoving across a ledge)
// ---------------------------------------------------------------------------

export interface HcPusherDef {
  /** Local z of the ram. */
  z: number;
  /** Deck height of the ledge it sweeps. */
  y: number;
  /** Wall side the ram is mounted on: its head pushes toward -side. */
  side: 1 | -1;
  /** Wall face x (head retracts flush against it). */
  wallX: number;
  /** Full extension distance across the ledge. */
  reach: number;
  headR: number;
  period: number;
  /** Phase offset in periods (0..1). */
  phase: number;
}

/**
 * Ram head extension fraction at time t: a punchy asymmetric cycle, fast jab
 * (20% of the period), slower retract (35%), then flush dwell. Analytic,
 * zero rng.
 */
export function hcPusherExt(d: HcPusherDef, t: number): number {
  const u = (t / d.period + d.phase) % 1;
  if (u < 0.2) return u / 0.2;
  if (u < 0.55) return 1 - (u - 0.2) / 0.35;
  return 0;
}

/** Ram head center x at time t. */
export function hcPusherX(d: HcPusherDef, t: number): number {
  return d.wallX - d.side * hcPusherExt(d, t) * d.reach;
}

// ---------------------------------------------------------------------------
// Spinner plates (new gimmick: rotating discs bridging a gap)
// ---------------------------------------------------------------------------

export interface HcSpinnerDef {
  cx: number;
  cz: number;
  /** Disc top height (walkable). */
  y: number;
  r: number;
  /** Signed angular speed, rad/s: riders are carried around the center. */
  omega: number;
}

export function hcSpinnerAngle(d: HcSpinnerDef, t: number): number {
  return d.omega * t;
}
