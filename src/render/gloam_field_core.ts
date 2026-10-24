// Gloamveil's floor and smoke layer, the pure half: what each graphics tier
// and the reduced-motion setting keep, how the layer thins with distance, and
// who is being tracked.
//
// WHAT A SHADOW PRIEST IS RECOGNISED BY is the body: the dark legs with their
// pointed edge, the violet halo and the dark closing over the body at the
// shift. That is a shader layer every rig material already carries
// (characters/gloam_climb.ts), so it draws on every tier at no extra cost and
// nothing here can take it away. This module only decides the RICHNESS around
// it: the smoke, the haze, the bubbles, the wake and how finely the pool is
// laid on the ground.
//
// The tier is the STATIC effects tier of the graphics preset (gfx.ts
// GFX.effectsTier), never the frame-budget governor; the only governor input
// is the pooled cloud's own floored quality, which thins the smoke rate and
// nothing else (the lever every continuous aura in vfx.ts already answers to).
// The distance arm reads the fixed CHARACTER_LOD_RANGE, never the live crowd
// band, so two viewers standing in the same spot see the same thing.
// docs/design/graphics-settings-fairness.md has the ruling.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/gloam_field_core.test.ts.

import { CHARACTER_LOD_RANGE, CHARACTER_LOD_RANGE_SQ } from './crowd_lod';

/** The effects tiers of gfx.ts, lowest first. */
export type GloamTier = 'low' | 'medium' | 'high' | 'ultra' | 'insane';

/** What the layer draws around one wearer. */
export interface GloamPlan {
  /** Share of the full smoke rate off the body (0 drops the smoke). */
  smoke: number;
  /** The faint violet haze close to the body. */
  haze: boolean;
  /** The bubble of shadow that swells and bursts every few seconds. */
  bubbles: boolean;
  /** Violet sparkles on a bubble burst and on the entry. */
  sparkles: boolean;
  /** Stains the wake may hold behind a walking wearer (0: no wake). */
  wakeStains: number;
  /** Cells along one side of the pool's draped grid. */
  poolCells: number;
  /** Share of the entry's smoke column and skirt (0: the entry is a fade). */
  entry: number;
  /** The shock ring that races out over the floor on the entry. */
  ring: boolean;
  /** The pool's tendrils and ripples move (false: one still shape). */
  living: boolean;
}

/** The approved look, in full: high and every tier above it. */
const FULL: GloamPlan = Object.freeze({
  smoke: 1,
  haze: true,
  bubbles: true,
  sparkles: true,
  wakeStains: 8,
  poolCells: 12,
  entry: 1,
  ring: true,
  living: true,
});

/** Medium sheds the sparkles and half the wake, and thins the smoke. */
const MEDIUM: GloamPlan = Object.freeze({
  ...FULL,
  smoke: 0.7,
  sparkles: false,
  wakeStains: 4,
  poolCells: 8,
  entry: 0.7,
});

/** Low keeps the pool, the entry and a thin smoke; the haze, the bubbles and
 *  the wake go, and the pool is laid on a coarser grid. */
const LOW: GloamPlan = Object.freeze({
  ...FULL,
  smoke: 0.4,
  haze: false,
  bubbles: false,
  sparkles: false,
  wakeStains: 0,
  poolCells: 6,
  entry: 0.4,
});

const BY_TIER: Readonly<Record<GloamTier, GloamPlan>> = {
  low: LOW,
  medium: MEDIUM,
  high: FULL,
  ultra: FULL,
  insane: FULL,
};

/** Reduced motion keeps the still read (the pool under the feet, one shape,
 *  faded in) and drops everything that moves, on whatever tier. */
const STILL: Readonly<Record<GloamTier, GloamPlan>> = {
  low: stillOf(LOW),
  medium: stillOf(MEDIUM),
  high: stillOf(FULL),
  ultra: stillOf(FULL),
  insane: stillOf(FULL),
};

function stillOf(plan: GloamPlan): GloamPlan {
  return Object.freeze({
    ...plan,
    smoke: 0,
    haze: false,
    bubbles: false,
    sparkles: false,
    wakeStains: 0,
    entry: 0,
    ring: false,
    living: false,
  });
}

/** The plan for a tier. The returned object is shared and frozen. */
export function gloamPlan(tier: GloamTier, reducedMotion: boolean): GloamPlan {
  const table = reducedMotion ? STILL : BY_TIER;
  return table[tier] ?? table.low;
}

/** Fraction of the fixed LOD range inside which the layer draws in full. */
const FULL_STRENGTH_FRACTION = 0.4;
/** Where the smoke's thinning bottoms out, at and beyond the range. */
export const GLOAM_FAR_SMOKE_SCALE = 0.4;

const FULL_STRENGTH_YD = CHARACTER_LOD_RANGE * FULL_STRENGTH_FRACTION;

/** How much of the smoke rate a wearer `d2` (squared yards) from the viewer
 *  keeps: all of it up close, thinning to a floor at the fixed LOD range. */
export function gloamDistanceScale(d2: number): number {
  if (!(d2 > FULL_STRENGTH_YD * FULL_STRENGTH_YD)) return 1;
  if (d2 >= CHARACTER_LOD_RANGE_SQ) return GLOAM_FAR_SMOKE_SCALE;
  const t = (Math.sqrt(d2) - FULL_STRENGTH_YD) / (CHARACTER_LOD_RANGE - FULL_STRENGTH_YD);
  return 1 - (1 - GLOAM_FAR_SMOKE_SCALE) * t;
}

/** Inside the fixed LOD range the pool is draped on the ground, vertex by
 *  vertex, and leaves a wake; beyond it the pool is one flat stain at its
 *  wearer's feet, a few pixels across at that distance. */
export function gloamPoolDraped(d2: number): boolean {
  return d2 < CHARACTER_LOD_RANGE_SQ;
}

/** Share of the cloud's rate the frame-budget governor leaves at `quality`
 *  (0 to 1): the same floor vfx.ts emitCount gives every continuous aura. */
export function gloamGovernorScale(quality: number): number {
  const q = Number.isFinite(quality) ? Math.min(1, Math.max(0, quality)) : 1;
  return 0.35 + 0.65 * q;
}

/**
 * How many to emit this frame for a rate per second: the whole expected count
 * plus one more on the fraction, so a slow frame emits what a fast one would.
 * `chance` is a uniform draw in [0, 1).
 */
export function gloamEmitCount(ratePerSecond: number, dt: number, chance: number): number {
  const expected = Math.max(0, ratePerSecond * dt);
  const whole = Math.floor(expected);
  return whole + (chance < expected - whole ? 1 : 0);
}

/** A wearer nobody has reported for this long has left the form or the view.
 *  Longer than a wake stain lives, so its last prints fade rather than pop. */
export const GLOAM_WEARER_LINGER = 1.6;
/** Wearers tracked at once. Past this the nearest keep their pools and a
 *  farther one draws its body and nothing else. */
export const GLOAM_MAX_WEARERS = 24;
/** Pools kept for reuse once their wearers are gone, so a camera turning away
 *  from a priest and back mints no buffer. Bounded: a pool past it is disposed. */
export const GLOAM_SPARE_POOLS = 8;

/**
 * Who is wearing the form in view, bounded. `touch` is called once a frame per
 * wearer the renderer presents; `sweep` drops the ones it stopped reporting.
 * Items are created and released through the caller's own functions, so the
 * roster owns no GPU object itself.
 */
export class GloamRoster<T> {
  private readonly ids: number[] = [];
  private readonly seen: number[] = [];
  private readonly items: T[] = [];
  private readonly slots = new Map<number, number>();

  constructor(private readonly capacity = GLOAM_MAX_WEARERS) {}

  get size(): number {
    return this.ids.length;
  }

  /** The item at `index` (0 to size - 1), in no promised order. */
  at(index: number): T {
    return this.items[index];
  }

  /** The id of the wearer at `index`. */
  idAt(index: number): number {
    return this.ids[index];
  }

  get(id: number): T | undefined {
    const slot = this.slots.get(id);
    return slot === undefined ? undefined : this.items[slot];
  }

  /** Mark `id` seen at `clock`. Returns its item, made with `make` on first
   *  sight, or undefined when the roster is full. */
  touch(id: number, clock: number, make: () => T): T | undefined {
    const slot = this.slots.get(id);
    if (slot !== undefined) {
      this.seen[slot] = clock;
      return this.items[slot];
    }
    if (this.ids.length >= this.capacity) return undefined;
    const item = make();
    this.slots.set(id, this.ids.length);
    this.ids.push(id);
    this.seen.push(clock);
    this.items.push(item);
    return item;
  }

  /** Release every wearer not seen since `clock - linger`. Returns how many. */
  sweep(clock: number, linger: number, release: (item: T) => void): number {
    let dropped = 0;
    for (let i = this.ids.length - 1; i >= 0; i--) {
      if (clock - this.seen[i] <= linger) continue;
      this.removeAt(i, release);
      dropped += 1;
    }
    return dropped;
  }

  /** Release `id` now (a wearer that must leave no trace). */
  drop(id: number, release: (item: T) => void): boolean {
    const slot = this.slots.get(id);
    if (slot === undefined) return false;
    this.removeAt(slot, release);
    return true;
  }

  /** Release everyone. */
  clear(release: (item: T) => void): void {
    for (let i = this.ids.length - 1; i >= 0; i--) this.removeAt(i, release);
  }

  private removeAt(index: number, release: (item: T) => void): void {
    const item = this.items[index];
    const last = this.ids.length - 1;
    this.slots.delete(this.ids[index]);
    if (index !== last) {
      this.ids[index] = this.ids[last];
      this.seen[index] = this.seen[last];
      this.items[index] = this.items[last];
      this.slots.set(this.ids[index], index);
    }
    this.ids.pop();
    this.seen.pop();
    this.items.pop();
    release(item);
  }
}
