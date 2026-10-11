// The Straw Foreman's plank hide coming off and going back on: the motion, as pure math.
//
// The drill yard's effigy (src/sim/muster_effigy.ts) wears planks nailed over its chest,
// belly, shoulders and thighs, the soldiers' stand-in for Barrowhide. When a player's thrust
// puts the lantern in its eye out, the planks burst off FOR THAT VIEWER, tumble to the
// ground round its feet and lie there; when the window closes, the soldiers hammer them
// back on. This file is the choreography: where each plank is, and how it is turned, at
// any moment of either move, plus the shudder the whole figure gives at the blow. The Three
// half (effigy_rig.ts) only copies these numbers onto the plank nodes.
//
// Everything is in the effigy's MODEL space (y up, the feet on y = 0), deterministic (the
// per-plank variation hashes the plank's index, no clock, no Math.random), and allocation
// free on the per-frame path (callers pass their own out arrays). A Vitest drives it, and
// the RENDER_PURE_CORES purity sweep in tests/architecture.test.ts covers it.

/** Pull of the fall, yards per second squared (Balgath's own launch arc uses the same). */
export const EFFIGY_PLANK_GRAVITY = 16;
/** Seconds between one plank letting go and the next: the hide peels, it does not pop. */
export const EFFIGY_PLANK_STAGGER = 0.028;
/** Seconds a landed plank takes to settle its little bounce. */
export const EFFIGY_PLANK_BOUNCE = 0.22;
/** Seconds the hammering-back of one plank takes, once its turn comes. */
export const EFFIGY_PLANK_REBUILD = 0.55;
/** Seconds between planks going back on (the soldiers work round the figure). */
export const EFFIGY_REBUILD_STAGGER = 0.06;
/** Seconds the shudder at the blow rings for. */
export const EFFIGY_SHUDDER_SECONDS = 1.3;
/** Peak lean of the shudder, radians. */
export const EFFIGY_SHUDDER_AMPLITUDE = 0.075;

/** One plank at rest on the figure (model space). */
export interface EffigyPlankRest {
  /** Rest position. */
  x: number;
  y: number;
  z: number;
  /** Rest orientation, quaternion (x, y, z, w). */
  q: readonly [number, number, number, number];
  /** Its lying-flat orientation on the ground, quaternion (thin axis up, yawed). */
  flat: readonly [number, number, number, number];
  /** Half its thickness: the height its centre rests at once it lies on the ground. */
  halfThickness: number;
}

/** A stable [0, 1) value per plank index and salt (a tiny integer hash). */
export function effigyHash01(index: number, salt: number): number {
  let h = (index + 1) * 374761393 + salt * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The plank's launch: out from the figure's spine, and up. */
export function effigyPlankLaunch(
  rest: EffigyPlankRest,
  index: number,
): { vx: number; vy: number; vz: number; delay: number } {
  let ox = rest.x;
  let oz = rest.z;
  const len = Math.hypot(ox, oz);
  if (len < 1e-3) {
    ox = 0;
    oz = 1;
  } else {
    ox /= len;
    oz /= len;
  }
  const out = 2.1 + 1.3 * effigyHash01(index, 1);
  const up = 0.9 + 1.4 * effigyHash01(index, 2);
  // A little sideways scatter so the planks do not all land on one ray from the spine.
  const side = (effigyHash01(index, 3) - 0.5) * 1.2;
  return {
    vx: ox * out - oz * side,
    vy: up,
    vz: oz * out + ox * side,
    delay: index * EFFIGY_PLANK_STAGGER + 0.04 * effigyHash01(index, 4),
  };
}

/** Seconds from a plank's release to its first touch of the ground. */
export function effigyPlankLandTime(rest: EffigyPlankRest, vy: number): number {
  const drop = rest.y - rest.halfThickness;
  // y(t) = drop + vy t - g t^2 / 2 = 0, the positive root.
  const g = EFFIGY_PLANK_GRAVITY;
  return (vy + Math.sqrt(vy * vy + 2 * g * Math.max(0, drop))) / g;
}

/**
 * Where a falling plank is `t` seconds after the blow. Writes position into `pos` and the
 * slerp weight from rest to flat into the return value (0 at rest, 1 lying flat).
 */
export function effigyPlankFallAt(
  rest: EffigyPlankRest,
  index: number,
  t: number,
  pos: [number, number, number],
): number {
  const launch = effigyPlankLaunch(rest, index);
  const local = t - launch.delay;
  if (local <= 0) {
    pos[0] = rest.x;
    pos[1] = rest.y;
    pos[2] = rest.z;
    return 0;
  }
  const land = effigyPlankLandTime(rest, launch.vy);
  const flight = Math.min(local, land);
  pos[0] = rest.x + launch.vx * flight;
  pos[2] = rest.z + launch.vz * flight;
  pos[1] = Math.max(
    rest.halfThickness,
    rest.y + launch.vy * flight - 0.5 * EFFIGY_PLANK_GRAVITY * flight * flight,
  );
  if (local > land) {
    // One small bounce where it lands, then still.
    const b = (local - land) / EFFIGY_PLANK_BOUNCE;
    if (b < 1) pos[1] = rest.halfThickness + 0.09 * Math.sin(Math.PI * b) * (1 - b);
    return 1;
  }
  const u = flight / land;
  return u * u * (3 - 2 * u);
}

/**
 * Where a plank being hammered back is `t` seconds after the rebuild began, from where it
 * lay (`from`, a landed fall pose). Writes position into `pos`; returns the slerp weight
 * from rest to flat (1 lying, 0 back in place).
 */
export function effigyPlankRebuildAt(
  rest: EffigyPlankRest,
  from: readonly [number, number, number],
  index: number,
  count: number,
  t: number,
  pos: [number, number, number],
): number {
  // The soldiers work from the top of the figure down, the way a man on a ladder would.
  const order = count - 1 - index;
  const local = (t - order * EFFIGY_REBUILD_STAGGER) / EFFIGY_PLANK_REBUILD;
  if (local <= 0) {
    pos[0] = from[0];
    pos[1] = from[1];
    pos[2] = from[2];
    return 1;
  }
  const u = Math.min(1, local);
  // Ease out with a small overshoot: carried up, pressed in, nailed.
  const s = 1.70158;
  const e = 1 + (s + 1) * (u - 1) ** 3 + s * (u - 1) ** 2;
  const lift = Math.sin(Math.PI * Math.min(1, u)) * 0.6;
  pos[0] = from[0] + (rest.x - from[0]) * e;
  pos[1] = from[1] + (rest.y - from[1]) * e + lift * (1 - u);
  pos[2] = from[2] + (rest.z - from[2]) * e;
  return 1 - Math.min(1, u * 1.15);
}

/** Seconds the whole rebuild takes for `count` planks. */
export function effigyRebuildSeconds(count: number): number {
  return Math.max(0, count - 1) * EFFIGY_REBUILD_STAGGER + EFFIGY_PLANK_REBUILD;
}

/** The figure's lean at `t` seconds after the blow: a decaying shiver, zero at rest. */
export function effigyShudderAt(t: number, reducedMotion = false): { pitch: number; roll: number } {
  if (t < 0 || t >= EFFIGY_SHUDDER_SECONDS) return { pitch: 0, roll: 0 };
  const scale = reducedMotion ? 0.35 : 1;
  const decay = Math.exp(-3.6 * t) * (1 - t / EFFIGY_SHUDDER_SECONDS);
  return {
    pitch: -EFFIGY_SHUDDER_AMPLITUDE * scale * decay * Math.cos(t * 17),
    roll: EFFIGY_SHUDDER_AMPLITUDE * 0.6 * scale * decay * Math.sin(t * 23),
  };
}

/** The lantern flame's brightness this frame (a lit candle's flicker), 0..1. */
export function effigyFlameFlicker(clock: number, reducedMotion = false): number {
  if (reducedMotion) return 0.9;
  return (
    0.82 +
    0.1 * Math.sin(clock * 11.3) +
    0.05 * Math.sin(clock * 23.7 + 1.3) +
    0.03 * Math.sin(clock * 41.1 + 0.4)
  );
}
