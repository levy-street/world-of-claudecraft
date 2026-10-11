// How the Abyssal Maw's tentacles LOOK and MOVE, as pure functions of the hoard
// cues' own clocks (src/sim/rift/hoard_tentacles_core.ts): the rise out of the
// floor, the idle sway, the rear and the lash, the low turning sweep, the death
// throes and the going back under. No Three.js, no DOM: a Vitest imports this
// directly, and the adapter beside it (hoard_tentacles.ts) only copies these
// numbers onto instanced meshes.
//
// A tentacle is a CHAIN of links. Each link is one instance of one Blender
// segment (docs/design/tentacles/), so the only thing that ever changes is where
// each link starts, which way it points and how thick and long it is. The chain
// is integrated from the floor up from two angles per link: its PITCH off the
// vertical and its HEADING round it. Every pose below is just a pitch profile
// along the chain; poses blend by blending pitch.

import {
  SWEEP_TOTAL_SEC,
  sweepArmBearing,
  sweepProgress,
  TENTACLES,
  WHIP_TOTAL_SEC,
} from '../sim/rift/hoard_tentacles_core';

export const TENTACLE_LOOK = Object.freeze({
  skin: 0x1d5560,
  under: 0x76907f,
  sucker: 0x40ffd0,
  suckerAngry: 0xff5a4a,
  stone: 0x6f675b,
  water: 0x03141a,
  warn: 0x36e0c0,
  danger: 0xff6a4a,
  spray: 0xbdf5ee,
  links: 16,
  /** Resting length and thickness, in yards. */
  length: 11,
  baseRadius: 1,
  tipRadius: 0.3,
  /** The tip model is this many radii long (docs/design/tentacles). */
  tipLength: 2.6,
  /** Out of the floor in this long once the warning ends. */
  riseSec: 0.55,
  /** Of a kill's fall, this much is thrashing before it drops. */
  thrashShare: 0.45,
});

/** Floats per link in a written chain: x, y, z of its base, pitch, heading,
 *  radius, length. */
export const LINK_STRIDE = 7;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const HALF_PI = Math.PI / 2;

function shortestArc(from: number, to: number, t: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * t;
}

export interface TentacleInput {
  /** Which of the set it is: only desynchronises the sway. */
  index: number;
  /** Free-running seconds, for the sway. */
  time: number;
  /** The `tide-tentacle` cue's elapsed seconds, or -1 once it has become the fall. */
  elapsed: number;
  /** Its resting heading (the cue's facing: toward the boss). */
  facing: number;
  /** A live attack: 0 none, 1 whip, 2 sweep, 3 grasp; its cue's elapsed seconds,
   *  the facing it was aimed along, and which way a sweep turns. */
  attack: 0 | 1 | 2 | 3;
  attackElapsed: number;
  attackFacing: number;
  direction: number;
  /** A grasp: how far away whoever it reaches for (or holds) is, and whether it
   *  has closed on them yet. */
  reachDistance: number;
  holding: boolean;
  /** The `tide-tentacle-fall` cue's elapsed seconds (-1 while it stands), and
   *  whether it was killed (it thrashes and drops) or only left (it withdraws). */
  fall: number;
  killed: boolean;
  /** Reduced motion: no sway, no tremble, no thrash. */
  still: boolean;
}

export interface TentaclePose {
  /** 0 to 1: how much of it is out of the floor. */
  grow: number;
  /** The heading the whole chain leans along this frame. */
  heading: number;
  /** How far the chain is stretched past its resting length. */
  stretch: number;
  /** 0 to 1 pose weights, for the adapter's side effects (spray, sucker colour). */
  rear: number;
  slam: number;
  low: number;
  /** A grasp: how far it has reached out (0 to 1), and how hard it has closed. */
  reach: number;
  clench: number;
  /** 1 on the frame the lash lands, decaying: the splash and the shake. */
  impact: number;
  /** How far the death has dissolved it, tip first (0 whole, 1 gone). */
  dissolve: number;
  /** The floor round it: the warning before it rises, then the broken ground. */
  warning: number;
  rubble: number;
}

export function makeTentaclePose(): TentaclePose {
  return {
    grow: 0,
    heading: 0,
    stretch: 1,
    rear: 0,
    slam: 0,
    low: 0,
    reach: 0,
    clench: 0,
    impact: 0,
    dissolve: 0,
    warning: 0,
    rubble: 0,
  };
}

/** The pose weights of this frame. Pure in its inputs. */
export function tentaclePose(input: TentacleInput, out: TentaclePose): TentaclePose {
  const falling = input.fall >= 0;
  const e = input.elapsed;
  out.warning = falling || e < 0 ? 0 : 1 - smooth((e - TENTACLES.spawnWarningSec) / 0.3);
  out.grow = falling ? 1 : smooth((e - TENTACLES.spawnWarningSec) / TENTACLE_LOOK.riseSec);
  out.rubble = falling ? 1 : smooth((e - TENTACLES.spawnWarningSec) / 0.18);
  out.heading = input.facing;
  out.stretch = 1;
  out.rear = 0;
  out.slam = 0;
  out.low = 0;
  out.reach = 0;
  out.clench = 0;
  out.impact = 0;
  out.dissolve = 0;
  if (falling) {
    const t = clamp01(input.fall / TENTACLES.retractSec);
    if (input.killed) {
      // It drops where it leaned, and rots away from the tip down.
      const dropped = smooth((t - TENTACLE_LOOK.thrashShare) / (1 - TENTACLE_LOOK.thrashShare));
      out.slam = dropped;
      out.dissolve = smooth((t - 0.55) / 0.45);
      out.rubble = 1 - smooth((t - 0.8) / 0.2);
    } else {
      out.grow = 1 - smooth(t / 0.85);
      out.rubble = 1 - smooth((t - 0.7) / 0.3);
    }
    return out;
  }
  if (input.attack === 1) {
    const a = input.attackElapsed;
    const tele = TENTACLES.whipTelegraphSec;
    const landed = tele + TENTACLES.whipStrikeSec;
    const turn = smooth(a / (tele * 0.45));
    out.heading = shortestArc(input.facing, input.attackFacing, turn);
    if (a < tele) {
      out.rear = smooth(a / (tele * 0.7));
    } else if (a < landed) {
      // It comes down faster and faster: most of the travel is in the last third.
      const k = clamp01((a - tele) / TENTACLES.whipStrikeSec);
      out.slam = k * k;
      out.rear = 1 - out.slam;
    } else {
      const back = smooth((a - landed - 0.2) / Math.max(0.05, WHIP_TOTAL_SEC - landed - 0.2));
      out.slam = 1 - back;
      out.impact = Math.max(0, 1 - (a - landed) / 0.45);
      out.heading = shortestArc(input.attackFacing, input.facing, back);
    }
    // Slammed, it stretches to the whip's full length (TENTACLES.whipLength).
    out.stretch = 1 + 1.16 * out.slam + 0.06 * out.rear;
  } else if (input.attack === 2) {
    const a = input.attackElapsed;
    const tele = TENTACLES.sweepTelegraphSec;
    const done = tele + TENTACLES.sweepSec;
    if (a < tele) {
      out.low = smooth(a / (tele * 0.8));
      out.heading = shortestArc(input.facing, input.attackFacing, smooth(a / (tele * 0.5)));
    } else if (a < done) {
      out.low = 1;
      out.heading = sweepArmBearing(input.attackFacing, input.direction, sweepProgress(a));
    } else {
      const back = smooth((a - done) / Math.max(0.05, SWEEP_TOTAL_SEC - done));
      out.low = 1 - back;
      out.heading = shortestArc(input.attackFacing, input.facing, back);
    }
    out.stretch = 1 - 0.17 * out.low;
  } else if (input.attack === 3) {
    const a = input.attackElapsed;
    out.heading = shortestArc(input.facing, input.attackFacing, smooth(a / 0.5));
    if (input.holding) {
      out.reach = 1;
      out.clench = smooth(a / 0.3);
    } else {
      // It arches out over them and hangs there, then comes down as it closes.
      out.reach = 0.85 * smooth(a / (TENTACLES.grabTelegraphSec * 0.7));
      out.clench = 0;
    }
    // Stretched (or drawn in) so its end is over whoever it wants.
    const solved = reachStretch(input.reachDistance, out.clench);
    out.stretch = 1 + (solved - 1) * out.reach;
  }
  return out;
}

/** The pitch of a grasp: arched out over them, its end coming DOWN on them the
 *  harder it has closed. */
function reachPitch(s: number, clench: number): number {
  return (HALF_PI + 0.1 + 0.5 * clench) * smooth(s / 0.5);
}

/** How far the chain must stretch for a grasp's end to be `distance` away. The
 *  horizontal run of a pose is linear in its stretch, so this is one division. */
export function reachStretch(distance: number, clench: number): number {
  const links = TENTACLE_LOOK.links;
  let run = 0;
  for (let link = 0; link < links; link++) {
    run += Math.sin(Math.min(HALF_PI, reachPitch((link + 0.5) / links, clench)));
  }
  const perUnit = (run * TENTACLE_LOOK.length) / links;
  const wanted = Math.max(0.5, distance - TENTACLE_LOOK.tipLength * TENTACLE_LOOK.tipRadius * 0.5);
  return Math.max(0.3, Math.min(1.6, wanted / perUnit));
}

/** How hard the arm is turning (0 to 1) `elapsed` seconds into a sweep cue: the
 *  tip trails behind the arm by this much, and throws spray by it. */
export function sweepSpeed(elapsed: number): number {
  const t = (elapsed - TENTACLES.sweepTelegraphSec) / TENTACLES.sweepSec;
  if (t <= 0 || t >= 1) return 0;
  // The derivative of the sim's eased turn, normalised to its peak.
  return 4 * t * (1 - t);
}

/** The pitch off the vertical at `s` (0 floor, 1 tip) of each pose. */
function idlePitch(s: number): number {
  // Up out of the floor, leaning, its end curling over.
  return 0.16 + 0.5 * s ** 1.5 + 1.5 * Math.max(0, s - 0.7) ** 1.3;
}
function rearPitch(s: number): number {
  // Reared back AWAY from whoever it is about to hit, its end still hooked over.
  return -0.8 * s ** 0.85 + 1.1 * Math.max(0, s - 0.78);
}
function flatPitch(s: number, bendShare: number, droop: number): number {
  // Over within its first part and on DOWN past level, so it comes to the floor
  // instead of hanging at the height of its bend (the chain writer levels a link
  // off the moment it touches down).
  return (HALF_PI + droop) * smooth(s / bendShare);
}

/** Write the chain for this pose: LINK_STRIDE floats per link, in the tentacle's
 *  own frame (its root on the origin, y up). Returns the tip's x, y, z, pitch and
 *  heading in `tipOut` (five floats). */
export function writeTentacleChain(
  input: TentacleInput,
  pose: TentaclePose,
  out: Float32Array,
  tipOut: Float32Array,
): void {
  const links = TENTACLE_LOOK.links;
  const swaying = input.still ? 0 : 1;
  const phase = input.index * 1.93;
  const calm = 1 - Math.max(pose.rear, pose.slam, pose.low, pose.reach);
  const lag = input.attack === 2 ? sweepSpeed(input.attackElapsed) : 0;
  const falling = input.fall >= 0 && input.killed;
  const thrash =
    falling && swaying
      ? 1 - smooth(input.fall / (TENTACLES.retractSec * TENTACLE_LOOK.thrashShare))
      : 0;
  const tremble = swaying * pose.rear * (1 - pose.slam);
  let x = 0;
  let y = 0;
  let z = 0;
  const step = (TENTACLE_LOOK.length / links) * pose.stretch * pose.grow;
  for (let link = 0; link < links; link++) {
    const s = (link + 0.5) / links;
    let pitch =
      idlePitch(s) * calm +
      rearPitch(s) * pose.rear +
      flatPitch(s, 0.24, 0.5) * pose.slam +
      flatPitch(s, 0.3, 0.2) * pose.low +
      reachPitch(s, pose.clench) * pose.reach;
    let heading = pose.heading;
    if (swaying) {
      pitch += calm * 0.12 * Math.sin(input.time * 1.3 + s * 2.6 + phase);
      heading += calm * 0.4 * s * Math.sin(input.time * 0.9 + s * 1.7 + phase * 1.3);
      pitch += tremble * 0.035 * Math.sin(input.time * 41 + s * 9);
      if (thrash > 0) {
        pitch += thrash * 0.9 * s * Math.sin(input.fall * 23 + s * 5 + phase);
        heading += thrash * 1.1 * s * Math.sin(input.fall * 17 + s * 3.1);
      }
    }
    // The end of a turning arm trails behind its root.
    heading -= input.direction * lag * 0.34 * s * s;
    const taper =
      TENTACLE_LOOK.baseRadius + (TENTACLE_LOOK.tipRadius - TENTACLE_LOOK.baseRadius) * s ** 0.85;
    // A death rots it from the tip down; a rise thickens it as it comes.
    const rot = pose.dissolve <= 0 ? 1 : clamp01((1 - pose.dissolve) * 1.6 - s * 0.6);
    const radius = taper * (0.55 + 0.45 * pose.grow) * rot;
    // Never through the floor: a link lying flat rests on its own thickness, and
    // one that has touched down runs level from there.
    const floor = radius * 0.55;
    if (y <= floor + 1e-3 && link > 0) {
      y = floor;
      if (pitch > HALF_PI) pitch = HALF_PI;
    }
    const o = link * LINK_STRIDE;
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
    out[o + 3] = pitch;
    out[o + 4] = heading;
    out[o + 5] = radius;
    out[o + 6] = step;
    const sp = Math.sin(pitch);
    x += Math.sin(heading) * sp * step;
    y += Math.cos(pitch) * step;
    z += Math.cos(heading) * sp * step;
    if (link === links - 1) {
      tipOut[0] = x;
      tipOut[1] = Math.max(y, floor);
      tipOut[2] = z;
      tipOut[3] = pitch;
      tipOut[4] = heading;
    }
  }
}

/** A link's basis in the tentacle's frame: `axis` the way it points, `belly` the
 *  side its suckers face (always square to the axis, and on the INSIDE of a lean:
 *  toward the heading while it stands, toward the floor once it lies along it). */
export function linkBasis(
  pitch: number,
  heading: number,
  axis: Float32Array,
  belly: Float32Array,
): void {
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sh = Math.sin(heading);
  const ch = Math.cos(heading);
  axis[0] = sh * sp;
  axis[1] = cp;
  axis[2] = ch * sp;
  belly[0] = sh * cp;
  belly[1] = -sp;
  belly[2] = ch * cp;
}

/** The whip's floor telegraph: how far along its length the fill has run, how
 *  bright the whole lane is, and the flash as it lands. */
export function whipTelegraph(
  elapsed: number,
  out: { fill: number; lane: number; flash: number },
): void {
  const tele = TENTACLES.whipTelegraphSec;
  const landed = tele + TENTACLES.whipStrikeSec;
  out.fill = clamp01(elapsed / tele);
  out.lane =
    elapsed < landed
      ? 0.35 + 0.65 * smooth(elapsed / 0.2)
      : 1 - smooth((elapsed - landed) / (WHIP_TOTAL_SEC - landed));
  out.flash = elapsed < landed ? 0 : Math.max(0, 1 - (elapsed - landed) / 0.3);
}

/** The sweep's floor telegraph: the ring's brightness, the arm's bearing, and how
 *  bright the arm and the wake behind it are. */
export function sweepTelegraph(
  elapsed: number,
  facing: number,
  direction: number,
  out: { ring: number; bearing: number; arm: number; wake: number; fill: number },
): void {
  const tele = TENTACLES.sweepTelegraphSec;
  const done = tele + TENTACLES.sweepSec;
  out.fill = clamp01(elapsed / tele);
  out.ring =
    elapsed < done
      ? smooth(elapsed / 0.2)
      : 1 - smooth((elapsed - done) / (SWEEP_TOTAL_SEC - done));
  out.bearing = sweepArmBearing(facing, direction, sweepProgress(elapsed));
  out.arm = elapsed < done ? 0.5 + 0.5 * out.fill : out.ring;
  out.wake = elapsed < tele ? 0 : out.ring * sweepSpeed(elapsed);
}
