// The goal celebration's timeline: everything about WHEN, none of the Three.
//
// A deepball goal is worth four seconds of the bout, and this is the curve
// those four seconds ride. `deepglass_goal_wave.ts` is the painter, it asks
// this module what the frame looks like at t seconds after the whistle and
// draws exactly that, so the whole look can be retuned (and unit-tested)
// without touching a shader.
//
// The shape, in order:
//
//   the drain   the colour is pulled out of the frame in about a sixth of a
//               second, so the world goes grey while the ball is still in
//               the net;
//   the burst   three concentric shells leave the mouth of the net that
//               conceded, the first fast enough to cross the bell before the
//               third has left, which is what makes the wave read as ripples
//               rather than one balloon;
//   the flood   each shell paints the frame in the scoring team's colour as
//               it sweeps over the camera, then thins as it carries on out
//               past the pylons;
//   recovery    chroma eases back in time for the kickoff.

/** Total length of the celebration. Shorter than `DG_GOAL_CELEBRATE` (4s) on
 *  purpose: the frame must be fully back to normal BEFORE the sim resets for
 *  the kickoff, or the restart happens under a grey screen. */
export const DG_GOAL_WAVE_SECS = 3.4;

/** How much chroma comes out at the deepest point. Not 1: a hair of the
 *  arena's own colour left in keeps the grey looking like a drained frame
 *  rather than a broken one. */
const DESAT_PEAK = 0.88;
/**
 * How far the drained frame is pulled DOWN in brightness, on the same
 * envelope as the chroma.
 *
 * Desaturation preserves luminance, and on the composer tiers the graded
 * arena is close to white, so draining it alone produced a near-white grey
 * that an alpha-blended colour wave washed out to pastel over. The same
 * celebration read strongly on the low tier purely because its frame is
 * darker. Dimming is what makes the wave's colour land the same on every
 * tier, and "the lights go down" is the right beat for a goal anyway.
 */
const DIM_PEAK = 0.45;
/** How long the drain takes. Fast, this is a whistle, not a dissolve. */
const DESAT_IN = 0.16;
/** When chroma starts coming back, and it is fully back at DG_GOAL_WAVE_SECS. */
const DESAT_HOLD_UNTIL = 2.15;

/** Screen-buckle strength at the whistle, decaying from there. */
const WARP_PEAK = 0.028;
const WARP_DECAY = 2.1;

/** The white pop on the whistle itself. */
const FLASH_PEAK = 0.42;
const FLASH_SECS = 0.26;

/** Team-colour bloom crawling in from the screen edge, so the celebration
 *  reaches the corners the shells' silhouettes never cover. Kept low: this is
 *  a flat tint with no structure in it, and it was the single biggest
 *  contributor to the first pass reading as orange fog. */
const RIM_PEAK = 0.18;
const RIM_IN = 0.35;
const RIM_OUT = 2.6;

/** Reduced motion keeps the colour and loses the movement: no screen buckle,
 *  a fraction of the flash, and a much gentler drain. */
const REDUCED_DESAT = 0.45;
const REDUCED_DIM = 0.22;
const REDUCED_FLASH = 0.3;
const REDUCED_SHELL = 0.62;

export interface DgGoalShellSpec {
  /** Seconds after the whistle this shell leaves the net. */
  readonly delay: number;
  /** Yards per second. The bell is r38 and the parapet r99, so the leader has
   *  to run well past 130 yd to clear the building. */
  readonly speed: number;
  /** Seconds from leaving to fully faded. */
  readonly life: number;
  /** Master alpha ceiling, the trailing shells are quieter so three
   *  overlapping fills never flatten the frame to a single flat colour. */
  readonly peak: number;
}

/** Three fronts, deliberately unequal: a fast thin leader, then two slower
 *  and heavier ones behind it. Equal shells read as one thick shell.
 *
 *  The leader waits out the drain. Launched at 0 it was already over the
 *  camera by 0.18s, the frame went from full colour to full team colour with
 *  the grey never visible, which threw away the whole first beat. */
export const DG_GOAL_SHELLS: readonly DgGoalShellSpec[] = [
  { delay: 0.1, speed: 124, life: 1.6, peak: 1 },
  { delay: 0.34, speed: 96, life: 1.85, peak: 0.78 },
  { delay: 0.62, speed: 74, life: 2.1, peak: 0.6 },
];

export interface DgGoalShellFrame {
  /** Radius in yards, from the mouth of the net that conceded. */
  radius: number;
  /** Master alpha; 0 means the shell is not on screen this frame. */
  fade: number;
  /** 0..1 through its own life. Drives the ripple bands' travel across the
   *  shell, so bands slow down as the front loses energy. */
  age01: number;
}

export interface DgGoalWaveFrame {
  /** False when there is nothing to draw, the painter's early-out. */
  active: boolean;
  /** Chroma to pull out of the finished frame, 0..1. */
  desat: number;
  /** Brightness to pull out of the drained frame, 0..1 (0 = untouched). Rides
   *  the same envelope as `desat`; see DIM_PEAK for why it exists. */
  dim: number;
  /** Screen-space ripple distortion strength. */
  warp: number;
  /** Additive white pop. */
  flash: number;
  /** Team-colour bloom from the screen edge inward. */
  rim: number;
  /** Seconds since the whistle, passed to the shaders as their clock. */
  t: number;
  /** One entry per DG_GOAL_SHELLS, same order. */
  shells: DgGoalShellFrame[];
}

/** A frame object the painter owns and this module fills in place. */
export function createDgGoalWaveFrame(): DgGoalWaveFrame {
  return {
    active: false,
    desat: 0,
    dim: 0,
    warp: 0,
    flash: 0,
    rim: 0,
    t: 0,
    shells: DG_GOAL_SHELLS.map(() => ({ radius: 0, fade: 0, age01: 0 })),
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The celebration at `t` seconds after the goal, written into `out`.
 *
 * Allocation-free by contract (renderer.ts's "no per-frame `new THREE.*`"
 * rule applies to plain objects on this path too): the caller owns `out` and
 * the reading is valid only until the next call.
 */
export function deepglassGoalWaveFrame(
  t: number,
  reducedMotion: boolean,
  out: DgGoalWaveFrame,
): DgGoalWaveFrame {
  out.t = t;
  if (!(t >= 0) || t >= DG_GOAL_WAVE_SECS) {
    out.active = false;
    out.desat = 0;
    out.dim = 0;
    out.warp = 0;
    out.flash = 0;
    out.rim = 0;
    for (const s of out.shells) {
      s.radius = 0;
      s.fade = 0;
      s.age01 = 0;
    }
    return out;
  }

  out.active = true;

  // One envelope for the whole drain: chroma and brightness leave and return
  // together, so the frame can never be caught grey-but-bright or dim-but-
  // saturated on the way in or out.
  const drain =
    smoothstep(0, DESAT_IN, t) * (1 - smoothstep(DESAT_HOLD_UNTIL, DG_GOAL_WAVE_SECS, t));
  out.desat = (reducedMotion ? REDUCED_DESAT : DESAT_PEAK) * drain;
  out.dim = (reducedMotion ? REDUCED_DIM : DIM_PEAK) * drain;

  out.warp = reducedMotion ? 0 : WARP_PEAK * Math.exp(-t * WARP_DECAY);

  const flashPeak = FLASH_PEAK * (reducedMotion ? REDUCED_FLASH : 1);
  out.flash = t < FLASH_SECS ? flashPeak * (1 - t / FLASH_SECS) ** 2 : 0;

  out.rim = RIM_PEAK * smoothstep(0, RIM_IN, t) * (1 - smoothstep(RIM_OUT, DG_GOAL_WAVE_SECS, t));

  const shellScale = reducedMotion ? REDUCED_SHELL : 1;
  for (let i = 0; i < DG_GOAL_SHELLS.length; i++) {
    const spec = DG_GOAL_SHELLS[i];
    const s = out.shells[i];
    const age = t - spec.delay;
    if (age <= 0 || age >= spec.life) {
      s.radius = 0;
      s.fade = 0;
      s.age01 = 0;
      continue;
    }
    const u = age / spec.life;
    s.age01 = u;
    // A shell starts at the net's own mouth rather than a point, so the first
    // frame is a ring around the goal instead of a dot in the middle of it.
    s.radius = 6 + spec.speed * age;
    // Snap open, then thin out: (1-u)^1.7 keeps the front bright while it is
    // crossing the building and lets it die quietly out past the parapet.
    s.fade = spec.peak * shellScale * smoothstep(0, 0.1, u) * (1 - u) ** 1.7;
  }
  return out;
}
