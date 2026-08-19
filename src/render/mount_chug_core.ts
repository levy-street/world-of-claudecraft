// Engine-cadence math for vehicle mounts: how often a combustion mount fires
// its chug cue, at what pitch, and how loud.
//
// A gait mount plays one stride cue per stride, driven by the renderer's
// distance accumulator. A VEHICLE has no gait: an engine turns over whether or
// not the wheels are, and it revs with the throttle rather than with the stride
// length. So this core owns a small time accumulator instead, and converts
// ground speed into a firing rate, a playback rate, and a gain. The renderer is
// the thin consumer; src/game/sfx.ts just plays what it is told.
//
// Pure and Node-tested (tests/mount_chug_core.test.ts): no Three, no DOM, no
// clock of its own. The caller passes dt.

import { mountMoveSpeedPct } from '../sim/content/mounts';
import { RUN_SPEED } from '../sim/types';

/** Firing rate at a standstill and at full throttle, in chugs per second. An
 *  idling truck lopes; at speed it gallops. The two ends are what make the cue
 *  read as a THROTTLE rather than as a pitch-shifted loop. */
const IDLE_CHUG_HZ = 4.4;
const TOP_CHUG_HZ = 13.5;

/** Playback rate at each end. Rate couples pitch and speed on an
 *  AudioBufferSourceNode, so a faster engine is also a tighter, brighter chug,
 *  which is the behaviour we want. */
const IDLE_RATE = 0.82;
const TOP_RATE = 1.46;

/** Gain at each end. An idling engine is background; a working one is not. */
const IDLE_GAIN = 0.28;
const TOP_GAIN = 0.6;

/** Off the ground the engine is unloaded, so it revs up and thins out: the
 *  classic "wheels leave the road" flare. */
const AIRBORNE_RATE = 1.16;
const AIRBORNE_GAIN = 0.82;

/** Throttle curve. Below 1 so the low end of the speed range opens the engine up
 *  quickly and the top end compresses, which is how a real gearbox feels. */
const THROTTLE_CURVE = 0.7;

/** Ceiling on how many chugs one step may emit. A long frame (a hitch, a
 *  backgrounded tab) would otherwise drain a large accumulated debt as a burst
 *  of overlapping one-shots. */
const MAX_CHUGS_PER_STEP = 2;

/** Per-mounted-entity accumulator. The renderer owns one of these per view. */
export interface MountChugState {
  /** Fractional chugs owed since the last firing. */
  accum: number;
}

export function createMountChugState(): MountChugState {
  return { accum: 0 };
}

export interface MountChugInput {
  /** Ground speed in yards per second. */
  speed: number;
  /** Top speed this mount can actually reach, the throttle denominator. */
  topSpeed: number;
  /** Wheels off the ground. */
  airborne: boolean;
  /** Seconds elapsed since the previous step. */
  dt: number;
}

export interface MountChugTick {
  /** How many chug cues to play this step (0, 1, or 2). */
  chugs: number;
  /** Playback rate for each cue. */
  rate: number;
  /** Gain for each cue. */
  gain: number;
}

/** Normalized throttle for a ground speed, 0 at rest and 1 at top speed. */
export function mountThrottle(speed: number, topSpeed: number): number {
  if (!(topSpeed > 0)) return 0;
  const linear = Math.min(1, Math.max(0, speed / topSpeed));
  return linear ** THROTTLE_CURVE;
}

/**
 * Top speed of a mounted player on `mountKey`, in yards per second.
 *
 * The throttle denominator has to be the speed the mount can REALLY hit, not the
 * VISUALS `runRef` (which is a gait foot-match reference and sits well below
 * mounted speed): normalizing by runRef would peg the throttle at full before
 * the truck was halfway to its actual top speed, and the engine would stop
 * responding exactly where the player is doing most of their riding.
 */
export function mountTopSpeed(mountKey: string): number {
  return RUN_SPEED * (1 + mountMoveSpeedPct(mountKey));
}

/**
 * Advance one mount's engine by `dt` and report what to play.
 *
 * Mutates `state.accum`, which is the only state the cadence needs; everything
 * else is derived from the current speed, so a mount that changes speed responds
 * on the next step rather than after a smoothing lag.
 */
export function stepMountChug(state: MountChugState, input: MountChugInput): MountChugTick {
  const throttle = mountThrottle(input.speed, input.topSpeed);
  const hz = IDLE_CHUG_HZ + (TOP_CHUG_HZ - IDLE_CHUG_HZ) * throttle;
  const rate =
    (IDLE_RATE + (TOP_RATE - IDLE_RATE) * throttle) * (input.airborne ? AIRBORNE_RATE : 1);
  const gain =
    (IDLE_GAIN + (TOP_GAIN - IDLE_GAIN) * throttle) * (input.airborne ? AIRBORNE_GAIN : 1);

  // A negative or absurd dt (a paused tab resuming, a clock jump) must not bank
  // firing debt; clamp it to a frame's worth before accumulating.
  state.accum += Math.min(Math.max(input.dt, 0), 0.25) * hz;
  let chugs = 0;
  while (state.accum >= 1 && chugs < MAX_CHUGS_PER_STEP) {
    state.accum -= 1;
    chugs++;
  }
  if (state.accum >= 1) state.accum = 0; // drop the rest of a long-frame debt
  return { chugs, rate, gain };
}
