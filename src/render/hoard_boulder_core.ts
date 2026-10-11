// How Grask's Rolling Boulder LOOKS, as pure functions of its hoard cues' own
// clocks (src/sim/rift/hoard_boulder_core.ts): the heft over his head, the roll
// (gathering pace, turning as far as it has travelled, skipping on the floor),
// the throw back, the break, and the ring the party stands in. No Three.js, no
// DOM: a Vitest imports this directly, and the adapter beside it
// (hoard_boulder.ts) only copies these numbers onto meshes.

import { BOULDER, boulderProgress } from '../sim/rift/hoard_boulder_core';

export const BOULDER_LOOK = Object.freeze({
  stone: 0x6b5d4f,
  iron: 0x2b2a2c,
  glow: 0xff8c1f,
  /** The ring is a place to STAND, never a place to leave: it is never red. */
  stand: 0x6dff9a,
  standDim: 0x1c5a34,
  lane: 0xff6a4a,
  dust: 0xcbb79a,
  /** How high he holds it before the throw. */
  heftHeight: 7.5,
  shards: 9,
  /** Most pips a ring ever shows (supportersNeeded never asks for more). */
  pips: 3,
});

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

export interface BoulderPose {
  /** Along the way from his hands (0) to its mark (1). */
  progress: number;
  /** Height of its CENTRE over the floor. */
  height: number;
  /** Radians it has turned about the axis across its path. */
  roll: number;
  /** 0 to 1: how much of it there is (it swells into his hands). */
  scale: number;
  /** How hot the fissures burn. */
  heat: number;
  /** 0 to 1: dust thrown off the floor this frame. */
  dust: number;
}

export function makeBoulderPose(): BoulderPose {
  return { progress: 0, height: 0, roll: 0, scale: 0, heat: 0, dust: 0 };
}

/** A boulder on its way: `distance` is the length of its path in yards. */
export function boulderPose(
  elapsed: number,
  total: number,
  travel: number,
  distance: number,
  out: BoulderPose,
): BoulderPose {
  const warning = total - travel;
  const p = boulderProgress(elapsed, total, travel);
  out.progress = p;
  out.scale = smooth(elapsed / Math.min(0.7, warning));
  if (p <= 0) {
    // Hefted: it rises over his head and shakes as he winds up.
    out.height =
      BOULDER.boulderRadius + BOULDER_LOOK.heftHeight * smooth(elapsed / (warning * 0.6));
    out.roll = 0;
    out.heat = 0.3 + 0.5 * clamp01(elapsed / warning);
    out.dust = 0;
    return out;
  }
  // Thrown DOWN onto the floor in its first stretch, then it skips: each bounce
  // lower than the last, flat by the time it arrives.
  const drop = 1 - smooth(p / 0.18);
  const skip = Math.abs(Math.sin(p * Math.PI * 4)) * 1.3 * (1 - p) * (1 - drop);
  out.height = BOULDER.boulderRadius + BOULDER_LOOK.heftHeight * drop + skip;
  // It turns exactly as far as it has rolled.
  out.roll = (p * distance) / BOULDER.boulderRadius;
  out.heat = 0.6 + 0.4 * p;
  out.dust = drop > 0.05 ? 0 : 0.4 + 0.6 * p;
  return out;
}

/** A boulder thrown back: a flat, fast arc from the party to him. */
export function boulderReturnPose(
  elapsed: number,
  total: number,
  distance: number,
  out: BoulderPose,
): BoulderPose {
  const p = clamp01(elapsed / Math.max(1e-6, total));
  out.progress = p;
  out.scale = 1;
  out.height = BOULDER.boulderRadius + Math.sin(p * Math.PI) * Math.min(6, distance * 0.22);
  out.roll = (-p * distance) / BOULDER.boulderRadius;
  out.heat = 1;
  out.dust = 0;
  return out;
}

/** Where shard `index` of `count` is `elapsed` seconds after the break, as an
 *  offset from where it sat in the whole rock (`sx`, `sy`, `sz`): thrown outward
 *  and up, falling, tumbling, shrinking away at the end. */
export function shardFlight(
  index: number,
  elapsed: number,
  sx: number,
  sy: number,
  sz: number,
  out: { x: number; y: number; z: number; spin: number; scale: number },
): void {
  const t = Math.max(0, elapsed);
  const horizontal = Math.max(0.2, Math.hypot(sx, sz));
  const speed = 5.5 + ((index * 37) % 10) * 0.45;
  const lift = 5 + ((index * 53) % 7) * 0.6;
  out.x = sx + (sx / horizontal) * speed * t;
  out.z = sz + (sz / horizontal) * speed * t;
  out.y = Math.max(-BOULDER.boulderRadius + 0.3, sy + lift * t - 11 * t * t);
  out.spin = t * (3 + (index % 4));
  out.scale = 1 - smooth((t - BOULDER.crushSec * 0.55) / (BOULDER.crushSec * 0.45));
}

/** The ring the party stands in: how bright, and how full each of its pips is
 *  (`standing` allies of `needed`). It turns from dim to lit as it is answered. */
export function supportRing(
  elapsed: number,
  needed: number,
  standing: number,
  out: { ring: number; answered: number; pips: number },
): void {
  out.ring = smooth(elapsed / 0.25);
  out.pips = Math.min(BOULDER_LOOK.pips, Math.max(0, needed));
  out.answered = needed <= 0 ? 0 : clamp01(standing / needed);
}
