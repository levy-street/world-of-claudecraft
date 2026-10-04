// The fragmentation shell on screen, the pure half: the airburst over its
// target (a white flash, a small grey smoke puff, a ring of sparks) and the
// bomblets it scatters, each a small dark shell on a short arc from the burst to
// its landing point, landing on the tick its blast resolves, with a spark trail
// of a few motes. Each bomblet's blast is the cannon's own
// (cannon_shell_core.ts), smaller and with no lingering dust cloud, so a whole
// star of them never stacks past the smoke cap. The painter is cannon_shell_visuals.ts.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES), deterministic (every spread is a hash
// of the shot and the puff's index) and allocation-free per frame.

import { DT } from '../sim/types';
import {
  CANNON_PUFF_STYLES,
  type CannonPuff,
  cannonHash01,
  cannonPuffLaunch,
  cannonTierAlpha,
  cannonTrailPuffInto,
  PUFF,
} from './cannon_puff_core';

export const CANNON_BOMBLET = {
  /** A bomblet's size against a shell's. */
  scale: 0.4,
  /** How far its short arc rises over the chord from the burst (yd). */
  arc: 0.8,
  /** Spark motes behind it, and the seconds between two. */
  motes: 3,
  moteSpacing: 0.035,
  /** Its blast against a shell's: sizes and camera shake. */
  blastScale: 0.65,
} as const;

/**
 * The airburst's flash and the camera's kick on the burst: a frag reads bigger
 * than a shell, so its kick outweighs a shell blast's at its strongest (the
 * shake is trauma the renderer squares; it fades with distance as a blast's).
 */
export const CANNON_AIRBURST = {
  flashSize0: 4.6,
  flashSize1: 6.4,
  flashLife: 0.14,
  /** Its ring of sparks: the slowest, and how much faster the fastest go (yd/s). */
  sparkSpeed: 9,
  sparkSpread: 6,
  shake: 0.9,
  fovPunch: 2.6,
} as const;

/** Cosmetic counts of an airburst (the low preset sheds these; the flash stays). */
export interface CannonAirburstCounts {
  smoke: number;
  sparks: number;
}

const FULL_AIRBURST: Readonly<CannonAirburstCounts> = { smoke: 3, sparks: 14 };
const LOW_AIRBURST: Readonly<CannonAirburstCounts> = { smoke: 2, sparks: 6 };

export function cannonAirburstCounts(low: boolean): Readonly<CannonAirburstCounts> {
  return low ? LOW_AIRBURST : FULL_AIRBURST;
}

/** The most puffs one airburst launches (the full counts). */
export const CANNON_AIRBURST_PUFFS = 1 + FULL_AIRBURST.smoke + FULL_AIRBURST.sparks;

const TAU = Math.PI * 2;
const NO_FLOOR = Number.NEGATIVE_INFINITY;
/** Keys of a shot's bomblets: one per bomblet, never shared with the next shot's. */
const KEYS_PER_SHOT = 8;
/** Blast ids of bomblets start past every shell's and barrel's. */
const BLAST_ID_BASE = 1 << 24;

/** Bomblet `index` of shot `shotId`, as the flights know it (never 0). */
export function cannonBombletKey(shotId: number, index: number): number {
  return shotId * KEYS_PER_SHOT + index + 1;
}

/** The id its blast lands under: no shell in flight, no barrel and no other bomblet carries it. */
export function cannonBombletBlastId(shotId: number, index: number): number {
  return -(BLAST_ID_BASE + cannonBombletKey(shotId, index));
}

/**
 * Launches the airburst's puffs at (x, y, z) into `out` from index 0 and returns
 * how many: a white flash on every tier, then a small grey smoke puff and a ring
 * of sparks flung level and falling (`counts`).
 */
export function cannonAirburstPuffs(
  out: CannonPuff[],
  seed: number,
  x: number,
  y: number,
  z: number,
  counts: Readonly<CannonAirburstCounts>,
): number {
  let n = 0;
  const h = (i: number, k: number): number => cannonHash01(seed ^ 0x3a7f, i * 16 + k);
  cannonPuffLaunch(
    out[n++],
    PUFF.flash,
    x,
    y,
    z,
    0,
    0,
    0,
    0,
    0,
    CANNON_AIRBURST.flashSize0,
    CANNON_AIRBURST.flashSize1,
    CANNON_AIRBURST.flashLife,
    0,
    h(0, 0) * TAU,
    0,
    NO_FLOOR,
  );
  const smokeAlpha = cannonTierAlpha(
    CANNON_PUFF_STYLES[PUFF.smoke].alpha,
    FULL_AIRBURST.smoke,
    counts.smoke,
  );
  for (let i = 0; i < counts.smoke; i++) {
    const idx = 1 + i;
    const a = ((i + h(idx, 0)) / Math.max(1, counts.smoke)) * TAU;
    const drift = 0.6 + 0.8 * h(idx, 1);
    cannonPuffLaunch(
      out[n++],
      PUFF.smoke,
      x + Math.sin(a) * 0.3,
      y,
      z + Math.cos(a) * 0.3,
      Math.sin(a) * drift,
      0.4 + 0.4 * h(idx, 2),
      Math.cos(a) * drift,
      1.8,
      -0.3,
      0.9 + 0.3 * h(idx, 3),
      2.2 + 0.6 * h(idx, 4),
      1 + 0.3 * h(idx, 5),
      0.02 * i,
      h(idx, 6) * TAU,
      (h(idx, 7) - 0.5) * 0.8,
      NO_FLOOR,
    );
    out[n - 1].alpha = smokeAlpha;
  }
  for (let i = 0; i < counts.sparks; i++) {
    const idx = 20 + i;
    const a = ((i + 0.6 * h(idx, 0)) / Math.max(1, counts.sparks)) * TAU;
    const speed = CANNON_AIRBURST.sparkSpeed + CANNON_AIRBURST.sparkSpread * h(idx, 1);
    cannonPuffLaunch(
      out[n++],
      PUFF.spark,
      x,
      y,
      z,
      Math.sin(a) * speed,
      (h(idx, 2) - 0.3) * 3,
      Math.cos(a) * speed,
      1.4,
      12,
      0.36 + 0.14 * h(idx, 3),
      0.08,
      0.3 + 0.25 * h(idx, 4),
      0,
      0,
      0,
      NO_FLOOR,
    );
  }
  return n;
}

export interface CannonBombletFlight {
  /** 0 when the slot is free (cannonBombletKey otherwise). */
  key: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  firedTick: number;
  landTick: number;
  arc: number;
}

interface Point {
  x: number;
  y: number;
  z: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const MOTE: Point = { x: 0, y: 0, z: 0 };

/**
 * The bomblets in flight, in a fixed round-robin pool. Fed once per burst and
 * once per landing; read back per frame on the display tick.
 */
export class CannonBomblets {
  readonly flights: CannonBombletFlight[];
  private next = 0;

  /** A bomblet whose flight is over waits at its point for its blast for up to `holdTicks`. */
  constructor(
    capacity: number,
    private readonly holdTicks = 0,
  ) {
    this.flights = Array.from({ length: Math.max(0, Math.floor(capacity)) }, () => ({
      key: 0,
      fromX: 0,
      fromY: 0,
      fromZ: 0,
      toX: 0,
      toY: 0,
      toZ: 0,
      firedTick: 0,
      landTick: 0,
      arc: 0,
    }));
  }

  /** Bomblet `key` leaves the burst point `from` at `firedTick` for `to`, landing at `landTick`. */
  launch(
    key: number,
    from: Readonly<Point>,
    to: Readonly<Point>,
    firedTick: number,
    landTick: number,
  ): void {
    if (this.flights.length === 0) return;
    const f = this.flights[this.next];
    this.next = (this.next + 1) % this.flights.length;
    f.key = key;
    f.fromX = from.x;
    f.fromY = from.y;
    f.fromZ = from.z;
    f.toX = to.x;
    f.toY = to.y;
    f.toZ = to.z;
    f.firedTick = firedTick;
    f.landTick = Math.max(firedTick, landTick);
    // The centre bomblet drops straight down; the outer ones are tossed out on a short arc.
    f.arc = Math.hypot(to.x - from.x, to.z - from.z) > 0.5 ? CANNON_BOMBLET.arc : 0;
  }

  /** Bomblet `key` blasted: its flight is over. */
  land(key: number): void {
    for (const f of this.flights) if (f.key === key) f.key = 0;
  }

  clear(): void {
    for (const f of this.flights) f.key = 0;
  }

  /** Its progress at `tick`, 0 at the burst and 1 on its point. */
  progress(index: number, tick: number): number {
    const f = this.flights[index];
    const span = f.landTick - f.firedTick;
    return span > 0 ? clamp01((tick - f.firedTick) / span) : 1;
  }

  /** Writes bomblet `index`'s point at `tick`; false when none flies there (free, or past its hold). */
  at(index: number, tick: number, out: Point): boolean {
    const f = this.flights[index];
    if (!f || f.key === 0) return false;
    if (tick - f.landTick > this.holdTicks) {
      f.key = 0;
      return false;
    }
    this.pointInto(f, this.progress(index, tick), out);
    return true;
  }

  /** Seconds bomblet `index` has flown at `tick`. */
  age(index: number, tick: number): number {
    return Math.max(0, tick - this.flights[index].firedTick) * DT;
  }

  /**
   * The spark motes behind bomblet `index` at `tick`, newest first, into `out`
   * from index 0 with each one's age in `ages`: one where it was every
   * CANNON_BOMBLET.moteSpacing seconds before, never before it left.
   */
  motesInto(index: number, tick: number, out: CannonPuff[], ages: Float32Array): number {
    const f = this.flights[index];
    if (!f || f.key === 0) return 0;
    const cap = Math.min(out.length, ages.length, CANNON_BOMBLET.motes);
    let n = 0;
    for (let k = 1; k <= cap; k++) {
      const age = k * CANNON_BOMBLET.moteSpacing;
      const at = Math.min(tick, f.landTick) - age / DT;
      if (at < f.firedTick) break;
      this.pointInto(f, this.progress(index, at), MOTE);
      cannonTrailPuffInto(out[n], f.key, k, true, MOTE.x, MOTE.y, MOTE.z);
      ages[n++] = age;
    }
    return n;
  }

  private pointInto(f: CannonBombletFlight, t: number, out: Point): void {
    out.x = f.fromX + (f.toX - f.fromX) * t;
    out.z = f.fromZ + (f.toZ - f.fromZ) * t;
    // Tossed up and out, then falling faster onto its point.
    out.y = f.fromY + (f.toY - f.fromY) * t * t + f.arc * 4 * t * (1 - t);
  }
}
