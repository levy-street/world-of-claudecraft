// Tuning + deterministic seed generation for the three BESPOKE Thornhollow Fields
// rune-pad effect kits. Three/DOM-free (a registered RENDER_PURE_CORE), so the
// numbers a designer actually turns are unit-testable without a browser.
//
// One kit per rune type, and they are deliberately NOT the same effect
// recolored, a player reading the field at distance should know which pad is
// up from its MOTION, before the color or the model resolves:
//
//   sprint  (orange) "Slipstream", motes fly a tight rising helix, fast.
//                    Reads as speed.
//   damage  (red)    "Forge"     , embers drift up slowly and FLICKER, over a
//                    lazy heat column. Reads as heat.
//   defense (cyan)   "Aegis"     , sparks ORBIT the pad instead of rising,
//                    under slow shard plates. Reads as shelter.
//
// All three share ONE ground element: the scrolling streak ring, recolored per
// rune. It is the family resemblance; the motion above the pad is the tell.
//
// Every kit is GPU-driven: the mote clouds animate entirely in their vertex
// shaders off the renderer's one `sharedUniforms.uTime` clock, so a pad costs
// no per-frame CPU beyond the light pulse and one shard-ring yaw below. That is
// why the seeds here are baked ONCE into a static buffer attribute at build
// time and never touched again.
import type { BgRuneType } from '../sim/social/battleground';

export interface RuneVfxTuning {
  /** GPU point count in the mote cloud (0 disables the cloud). */
  readonly motes: number;
  /** Yards the cloud travels over one particle cycle. */
  readonly rise: number;
  /** Spawn-ring radius in yards. */
  readonly radius: number;
  /** Point size in pixels at 1yd (the props.ts fixed-scale convention). */
  readonly moteSize: number;
  /** Seconds for one full particle cycle (slowest particle; seeds vary it). */
  readonly cycleSec: number;
  /** Peak fraction the pad's point light brightens by, +/- around 1. */
  readonly lightPulse: number;
  /** Light pulse rate in Hz. */
  readonly lightPulseHz: number;
  /** Yaw rate (rad/s) of the kit's orbiting shard ring; 0 = no shards. */
  readonly shardSpin: number;
}

export const RUNE_VFX_TUNING: Record<BgRuneType, RuneVfxTuning> = {
  // Fast, tight, low: the helix should look like it is being dragged upward.
  sprint: {
    motes: 36,
    rise: 2.5,
    radius: 0.92,
    moteSize: 62,
    cycleSec: 0.9,
    lightPulse: 0.26,
    lightPulseHz: 2.3,
    shardSpin: 0,
  },
  // Slow, wide, flickering: embers off a forge, not a fountain.
  damage: {
    motes: 42,
    rise: 3.1,
    radius: 0.78,
    moteSize: 92,
    cycleSec: 2.1,
    lightPulse: 0.42,
    lightPulseHz: 1.1,
    shardSpin: 0,
  },
  // Sparse and orbital: nothing rises, which is the whole read.
  defense: {
    motes: 24,
    rise: 1.5,
    radius: 1.04,
    moteSize: 52,
    cycleSec: 3.2,
    lightPulse: 0.15,
    lightPulseHz: 0.55,
    // NEGATIVE, and nowhere near the body's own BG_RUNE_SPIN_RADS (0.9): the
    // shards must not look welded to the shield they guard. Counter-rotation
    // is what sells them as a separate orbiting thing rather than as part of
    // the model, and it reads from much further out than a rate difference.
    shardSpin: -0.55,
  },
};

/** Radius (yd) the Ward shard plates orbit at, and their height above the pad. */
export const AEGIS_SHARD_RADIUS = 1.16;
export const AEGIS_SHARD_Y = 0.95;
export const AEGIS_SHARD_COUNT = 3;

/**
 * Outer/inner radius (yd) of the scrolling ground ring EVERY pad wears. It
 * started as the Slipstream signature, but a common footing turns out to be
 * what makes the three read as one family of objects, the kits already differ
 * where it counts, up in the motion above the pad.
 */
export const RUNE_RING_OUTER = 1.55;
export const RUNE_RING_INNER = 0.95;

/**
 * The Forge heat plume: two crossed quads the embers rise through, NOT a
 * cylinder shell. A shell was the first cut and it drew its own silhouette ,
 * a translucent cup hanging over the pad, obvious the moment a player stood
 * next to it. Crossed quads with a radial falloff have no rim to show.
 */
export const FORGE_PLUME_WIDTH = 1.7;
export const FORGE_PLUME_HEIGHT = 2.6;

/** Seeds per mote packed into the `aSeed` vec4 attribute. */
export const RUNE_MOTE_SEED_STRIDE = 4;

/**
 * A stable hash in [0, 1) for mote `index`, channel `salt`. Deterministic and
 * allocation-free: the same pad builds the same cloud on every client, which
 * matters because two players standing on one pad must see one effect.
 */
export function runeSeed(index: number, salt: number): number {
  // Integer avalanche (xorshift-multiply), then the top 24 bits as a mantissa.
  let h = (index * 0x27d4eb2d) ^ (salt * 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2d);
  h ^= h >>> 16;
  return ((h >>> 8) & 0xffffff) / 0x1000000;
}

/**
 * The static per-mote seed buffer: `[angle01, radius01, phase01, rate01]` per
 * particle. Every kit's vertex shader reads the same four channels and spends
 * them differently (see the shaders in battleground_rune_vfx.ts).
 */
export function runeMoteSeeds(count: number): Float32Array {
  const out = new Float32Array(Math.max(0, count) * RUNE_MOTE_SEED_STRIDE);
  for (let i = 0; i < count; i++) {
    const o = i * RUNE_MOTE_SEED_STRIDE;
    out[o] = runeSeed(i, 1); // start angle around the pad
    out[o + 1] = runeSeed(i, 2); // radial position within the spawn ring
    out[o + 2] = runeSeed(i, 3); // cycle phase, so the cloud never pumps in sync
    out[o + 3] = runeSeed(i, 4); // per-mote rate scatter
  }
  return out;
}

/**
 * The pad light's brightness multiplier at `time`. Kept on the CPU (one
 * multiply per pad per frame) because a PointLight's intensity is not a
 * shader uniform we can share.
 */
export function runeLightPulse(kind: BgRuneType, time: number): number {
  const t = RUNE_VFX_TUNING[kind];
  return 1 + t.lightPulse * Math.sin(time * Math.PI * 2 * t.lightPulseHz);
}

/** The Ward shard ring's yaw at `time` (0 for the kits with no shards). */
export function runeShardYaw(kind: BgRuneType, time: number): number {
  return time * RUNE_VFX_TUNING[kind].shardSpin;
}
