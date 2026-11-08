// The Blades Wake on the Guardian of the Quench, as numbers (round 2 of her
// look, Jose's lead's notes of 2026-11-08: the column read as a pale curtain
// on a pale lake, the lines to the blades were all but lost). The painters
// are quench_wake_fx.ts (the column through the bar) and quench_wake_throw.ts
// (the throw-down); this module plans them:
//  - the column: a beam of cold power, a dense bright cyan core from over her
//    crown on up into the dark, inside a deep blue shell that stands dark
//    against the white lake and the pale walls, a ring flashing on the ice at
//    its foot (`quenchWakeColumnLook`);
//  - the throw: a frost shockwave racing out over the lake with ice spikes
//    erupting behind its front (`quenchWakeSpikeRise`, the ring's spikes
//    `quenchWakeRingSpikes`), a line racing to each blade, a bright cyan core
//    in a deep blue edge, frost crystals sprouting along it as its head passes
//    (`quenchWakeLine`, `quenchWakeCrystal`), each blade flaring as its line
//    arrives (`quenchWakeFlare`).
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, deterministic (a hash,
// never rng). Cosmetic: the blades' own warnings are the fight painters'.

import { quenchBodyHash } from './quench_body_core';

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const ease = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

// ---- the column ---------------------------------------------------------------------------

/** The column's size (yards): the shell round her (wider at its foot than
 *  her gown's hem), the core beam from over her crown on up into the dark
 *  (never drawn through her translucent gown), the ring at its foot. */
export const QUENCH_WAKE_COLUMN = {
  height: 30,
  coreFrom: 10.5,
  coreHeight: 34,
  shellR0: 5.4,
  shellR1: 3.6,
  coreR: 1.3,
  footR: 8.5,
} as const;

export interface QuenchWakeColumnLook {
  /** The deep blue shell's strength (0..1). */
  shell: number;
  /** The bright core's strength (0..1). */
  core: number;
  /** How far up the column has climbed (share of its height). */
  rise: number;
  /** The ring at its foot (0..1, pulsing). */
  foot: number;
}

/** The column at `amount` (0..1: the wake's bar, the hunt's held share) on
 *  render time `t`, written into `out`. Nothing at 0. */
export function quenchWakeColumnLook(
  amount: number,
  t: number,
  out: QuenchWakeColumnLook = { shell: 0, core: 0, rise: 0, foot: 0 },
): QuenchWakeColumnLook {
  const a = clamp01(amount);
  if (a <= 0.01) {
    out.shell = 0;
    out.core = 0;
    out.rise = 0;
    out.foot = 0;
    return out;
  }
  out.shell = 0.35 + 0.65 * ease(a * 1.4);
  out.core = ease(a * 1.25) ** 0.8;
  out.rise = 0.12 + 0.98 * ease(a * 1.2);
  out.foot = (0.45 + 0.55 * ease(a)) * (0.85 + 0.15 * Math.sin(t * 9));
  return out;
}

// ---- the throw ----------------------------------------------------------------------------

/** The throw's timeline and sizes (seconds, yards). */
export const QUENCH_WAKE_THROW = {
  /** The lines' heads run out to the blades in this. */
  lineRun: 0.55,
  /** Then hold, then fade. */
  lineHold: 1.5,
  lineFade: 0.8,
  /** The lines' width on the ice. */
  lineWidth: 2.6,
  /** The shockwave's front over the lake (yards a second). */
  waveSpeed: 32,
  /** A spike rises this fast as the front passes it, holds, then sinks. */
  spikeRise: 0.11,
  spikeHold: 0.8,
  spikeSink: 0.45,
  /** The ring of spikes all round her, and along each line. */
  ringSpikes: 44,
  lineSpikes: 10,
  /** Crystals sprouting along each line, every this many yards. */
  crystalStep: 1.5,
  crystalsPerLine: 16,
  /** The blades' flare (yards) and its life. */
  flareSize: 9,
  flareLife: 0.75,
} as const;

/** Seconds the whole throw reads for. */
export const QUENCH_WAKE_THROW_SECONDS =
  QUENCH_WAKE_THROW.lineRun + QUENCH_WAKE_THROW.lineHold + QUENCH_WAKE_THROW.lineFade;

/** A line `age` seconds after her arms came down: how far its head is (0..1
 *  of the way), its strength (0..1), and the head's own glow (0..1). */
export function quenchWakeLine(
  age: number,
  out: { head: number; alpha: number; glow: number } = { head: 0, alpha: 0, glow: 0 },
): { head: number; alpha: number; glow: number } {
  const T = QUENCH_WAKE_THROW;
  if (age < 0 || age > QUENCH_WAKE_THROW_SECONDS) {
    out.head = 0;
    out.alpha = 0;
    out.glow = 0;
    return out;
  }
  const k = clamp01(age / T.lineRun);
  out.head = 1 - (1 - k) ** 2;
  out.alpha = clamp01(age / 0.06) * clamp01(1 - (age - T.lineRun - T.lineHold) / T.lineFade);
  out.glow = age < T.lineRun ? 1 : clamp01(1 - (age - T.lineRun) / 0.5);
  return out;
}

/** A spike `age` seconds after the throw, `at` seconds after it when the
 *  front reached it: its height share (0: unseen; rises fast, holds, sinks). */
export function quenchWakeSpikeRise(age: number, at: number): number {
  const T = QUENCH_WAKE_THROW;
  const l = age - at;
  if (l < 0 || l >= T.spikeRise + T.spikeHold + T.spikeSink) return 0;
  if (l < T.spikeRise) return 1 - (1 - l / T.spikeRise) ** 3;
  if (l < T.spikeRise + T.spikeHold) return 1;
  return clamp01(1 - (l - T.spikeRise - T.spikeHold) / T.spikeSink);
}

/** Has the spike `at` seconds out just sunk (its shatter, once)? */
export function quenchWakeSpikeDone(age: number, at: number): boolean {
  const T = QUENCH_WAKE_THROW;
  return age - at >= T.spikeRise + T.spikeHold + T.spikeSink;
}

export interface WakeSpike {
  /** Bearing round her (radians, 0 along +z) and distance (yards). */
  a: number;
  r: number;
  /** Height (yards), lean out from her (radians), turn about its own axis. */
  h: number;
  lean: number;
  yaw: number;
}

/** The ring of spikes the throw raises all round her: thicker and taller
 *  near her, thinning out over the lake (deterministic for `seed`). */
export function quenchWakeRingSpikes(seed: number): WakeSpike[] {
  const T = QUENCH_WAKE_THROW;
  const out: WakeSpike[] = [];
  for (let i = 0; i < T.ringSpikes; i++) {
    const h0 = quenchBodyHash(seed, i * 5 + 1);
    const h1 = quenchBodyHash(seed, i * 5 + 2);
    const h2 = quenchBodyHash(seed, i * 5 + 3);
    const h3 = quenchBodyHash(seed, i * 5 + 4);
    const a = ((i + 0.6 * (h0 - 0.5)) / T.ringSpikes) * Math.PI * 2;
    // Two loose bands: a dense one at her gown's edge, a sparse one beyond.
    const near = i % 3 !== 2;
    const r = near ? 5.2 + h1 * 3.2 : 9 + h1 * 6;
    out.push({
      a,
      r,
      h: (near ? 2.4 : 1.5) + h2 * (near ? 2.2 : 1.4),
      lean: 0.25 + 0.3 * h3,
      yaw: h0 * Math.PI * 2,
    });
  }
  return out;
}

/** The seconds the front takes to reach `r` yards. */
export function quenchWakeFrontAt(r: number): number {
  return Math.max(0, r) / QUENCH_WAKE_THROW.waveSpeed;
}

/** The spikes along a line `len` yards long (its own frame: `r` along it,
 *  `side` across), deterministic for its `seed`, written into `out`. */
export function quenchWakeLineSpikes(
  len: number,
  seed: number,
  out: { r: number; side: number; h: number; lean: number; yaw: number }[],
): number {
  const T = QUENCH_WAKE_THROW;
  const from = 4.5;
  const to = Math.max(from, len - 2.5);
  const n = Math.min(T.lineSpikes, out.length);
  for (let i = 0; i < n; i++) {
    const k = n > 1 ? i / (n - 1) : 0;
    const h0 = quenchBodyHash(seed, i * 3 + 11);
    const h1 = quenchBodyHash(seed, i * 3 + 12);
    const o = out[i];
    o.r = from + (to - from) * k;
    o.side = (i % 2 === 0 ? 1 : -1) * (1.6 + h0 * 0.9);
    o.h = 1.4 + 1.6 * (1 - k) + h1 * 0.8;
    o.lean = 0.3 + 0.2 * h1;
    o.yaw = h0 * 6.283;
  }
  return n;
}

/** A crystal on a line `age` seconds after the throw, the head passing it
 *  at `at`: its height share (sprouts as the head passes, held with the
 *  line, melts with its fade). */
export function quenchWakeCrystal(age: number, at: number): number {
  const T = QUENCH_WAKE_THROW;
  const l = age - at;
  if (l < 0) return 0;
  const grow = 1 - (1 - clamp01(l / 0.16)) ** 2;
  const fade = clamp01(1 - (age - T.lineRun - T.lineHold) / T.lineFade);
  return grow * fade;
}

/** The seconds after the throw the line's head passes `k` (0..1) of its way
 *  (the inverse of `quenchWakeLine`'s ease). */
export function quenchWakeHeadAt(k: number): number {
  return QUENCH_WAKE_THROW.lineRun * (1 - Math.sqrt(1 - clamp01(k)));
}

/** A blade's flare `age` seconds after the throw (0..1: peaks as its line
 *  arrives, fades). */
export function quenchWakeFlare(age: number): number {
  const T = QUENCH_WAKE_THROW;
  const l = age - T.lineRun;
  if (l < -0.08) return 0;
  if (l < 0) return (l + 0.08) / 0.08;
  return clamp01(1 - l / T.flareLife) ** 1.5;
}

/** The throw's shockwave `age` seconds in, out to `reach` yards: its radius
 *  and strength (0..1). */
export function quenchWakeWave(
  age: number,
  reach: number,
  out: { radius: number; alpha: number } = { radius: 0, alpha: 0 },
): { radius: number; alpha: number } {
  const span = Math.max(0.2, reach / QUENCH_WAKE_THROW.waveSpeed);
  const k = age / span;
  out.radius = reach * clamp01(k);
  out.alpha = k < 0 ? 0 : k < 1 ? 1 : clamp01(1 - (k - 1) * 2.5);
  return out;
}

/** The palette (linear 0..1): the deep blue that stands dark on the white
 *  lake, the bright cyan core, the white-hot head. */
export const QUENCH_WAKE_COLORS = {
  deep: [0.006, 0.035, 0.16] as const,
  mid: [0.03, 0.2, 0.6] as const,
  core: [0.12, 0.78, 1.0] as const,
  hot: [0.62, 0.97, 1.0] as const,
} as const;
