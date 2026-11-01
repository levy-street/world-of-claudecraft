// Pure core of the Magma Burst triple braid (the Shaman's lava_burst): three
// molten strands that spiral around each other from the caster's hand into the
// flying magma orb, the per-strand look, and what each budget tier draws.
// Three-, DOM- and i18n-free; the clock and every position come in as plain
// numbers, so a test drives it directly. The Three-side owner is
// magma_braid.ts, which draws these points as ribbon strips, drips lava off
// them, and crumbles them when the orb lands.
import { type Basis, segmentBasis } from './stepped_leader_core';

/** Points per strand: enough for a smooth spiral over the longest cast. */
export const BRAID_PTS = 40;
/** Helix radius in yards at the middle of the channel (it pinches to zero at
 * the hand and at the orb, so the strands leave and enter as one). */
export const BRAID_RADIUS = 0.42;
/** Turns per yard of channel, and how fast the twist rolls toward the orb. */
export const BRAID_TWIST_PER_YD = 0.45;
export const BRAID_SPIN = 15;
/** How far the channel sags below the straight line, in yards at the middle:
 * molten, heavy, never a laser. */
export const BRAID_SAG = 0.45;
/** Seconds the strands take to drain into the target at impact. */
export const BRAID_DRAIN_S = 0.2;
/** Seconds the ring of fire burns at the target's feet. */
export const FIRE_RING_S = 1.3;
export const FIRE_RING_RADIUS = 2.2;

export interface StrandStyle {
  /** Phase offset around the helix (radians). */
  phase: number;
  /** Width multiplier for this strand. */
  width: number;
  /** Outer glow, body and hot core colors. */
  glow: number;
  body: number;
  core: number;
}

/** The three strands: deep red-orange, white-hot, and orange, evenly spaced
 * around the twist. With two strands (low quality) the first two draw. */
export const MAGMA_STRANDS: readonly StrandStyle[] = [
  { phase: 0, width: 1, glow: 0xd9300f, body: 0xff7a1a, core: 0xffd23f },
  { phase: (Math.PI * 2) / 3, width: 0.8, glow: 0xb8260c, body: 0xff9a2e, core: 0xfff6d6 },
  { phase: (Math.PI * 4) / 3, width: 0.9, glow: 0xd9300f, body: 0xff6a12, core: 0xffd23f },
];

const basis: Basis = { dx: 0, dy: 0, dz: 0, sx: 0, sy: 0, sz: 0, ux: 0, uy: 0, uz: 0 };

/**
 * Fill `out` (packed x, y, z, BRAID_PTS points) with one strand of the braid
 * from (fx, fy, fz) to (tx, ty, tz) at time `t`. The strand rides a sagging
 * channel and circles it on a helix whose radius pinches to zero at both ends.
 * Returns the point count written (0 for a zero-length channel).
 */
export function fillStrand(
  out: Float32Array,
  fx: number,
  fy: number,
  fz: number,
  tx: number,
  ty: number,
  tz: number,
  t: number,
  phase: number,
  radius = BRAID_RADIUS,
): number {
  const dx = tx - fx;
  const dy = ty - fy;
  const dz = tz - fz;
  if (!segmentBasis(dx, dy, dz, basis)) return 0;
  const len = Math.hypot(dx, dy, dz);
  const n = Math.min(BRAID_PTS, out.length / 3);
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const env = Math.sin(Math.PI * Math.min(1, f * 1.06));
    const a = f * len * BRAID_TWIST_PER_YD * Math.PI * 2 - t * BRAID_SPIN + phase;
    const lat = Math.cos(a) * radius * env;
    const vert = Math.sin(a) * radius * env;
    const sag = 4 * f * (1 - f) * BRAID_SAG;
    const k = i * 3;
    out[k] = fx + dx * f + basis.sx * lat + basis.ux * vert;
    out[k + 1] = fy + dy * f + basis.sy * lat + basis.uy * vert - sag;
    out[k + 2] = fz + dz * f + basis.sz * lat + basis.uz * vert;
  }
  return n;
}

/**
 * The drain at impact: the fraction of the strand (from the hand end) already
 * gone, 0 at the moment of impact and 1 once BRAID_DRAIN_S has passed, eased
 * so the tail whips into the target.
 */
export function drainedFraction(since: number): number {
  if (since <= 0) return 0;
  if (since >= BRAID_DRAIN_S) return 1;
  const k = since / BRAID_DRAIN_S;
  return k * k;
}

/** Light gain after impact: full at the burst, a quick fall, then the ring of
 * fire's low glow until it burns out. */
export function impactLightGain(since: number): number {
  if (since < 0 || since >= FIRE_RING_S) return 0;
  if (since < 0.08) return 1;
  const burst = Math.max(0, 1 - (since - 0.08) / 0.4);
  const ring = 0.22 * (1 - since / FIRE_RING_S);
  return Math.max(burst * burst, ring);
}

export interface MagmaBurstPlan {
  /** Strands drawn (3 normally, 2 at low VFX quality). */
  strands: number;
  /** Lava dripping off the strands in flight. */
  drips: boolean;
  /** The ring of fire at the target's feet after the burst. */
  fireRing: boolean;
}

/** VFX quality (the render budget's 0..1 level) below which the braid sheds
 * its third strand and its drips. */
export const BRAID_FULL_QUALITY = 0.5;

/**
 * What a Magma Burst draws on a given ability-VFX budget tier and VFX quality:
 * tier 0 the full braid, drips and ring of fire; tier 1 the braid alone;
 * tier 2 (the spam floor) nothing, which keeps the color-only heavy bolt.
 * Falling quality sheds the third strand and the drips. Cosmetic only: the
 * flight time and the hit are identical on every arm.
 */
export function magmaBurstPlan(tier: number, quality = 1): MagmaBurstPlan | null {
  if (tier >= 2) return null;
  const full = tier === 0;
  const rich = quality >= BRAID_FULL_QUALITY;
  return {
    strands: rich ? 3 : 2,
    drips: full && rich,
    fireRing: full,
  };
}
