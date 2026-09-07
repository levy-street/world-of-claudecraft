// Nythraxis soft fire, the pure half. The crypt's fire (Grave Flame, Soulfire,
// the Gravefire line) is drawn the way Marrowgar's Coldflame was: a dense,
// translucent cloud of flame sprites rising and dissolving, not geometry. This
// core owns everything about that cloud that is not Three: the colour ramps
// per mechanic, the sprite shapes, the sprite budgets, and the deterministic
// spot each sprite rises from (hashed by index, so a cloud never shimmers as
// its window slides). The emitter (nythraxis_soft_fire.ts) turns spots into
// instance attributes; the painters place them.

import { NYTHRAXIS_GRAVEFIRE_LENGTH } from '../sim/nythraxis_gravefire';
import { hash2 } from '../sim/rng';

export type NythraxisSoftFireKind = 'grave' | 'soul' | 'gravefire';

/** Three stops of the sprite colour ramp: the hot core, the flame body, the cooling tip. */
export interface NythraxisSoftFireRamp {
  core: number;
  body: number;
  tip: number;
}

export const NYTHRAXIS_SOFT_FIRE_RAMPS: Readonly<
  Record<NythraxisSoftFireKind, NythraxisSoftFireRamp>
> = {
  // Grave Flame: blue-violet with a pale violet core.
  grave: { core: 0xefe4ff, body: 0x8a5cf0, tip: 0x1f0e3d },
  // Soulfire: magenta-violet with a pale pink-violet core, warmer than Grave
  // Flame so the two pools stay tellable apart in the same purple family.
  soul: { core: 0xf8dcff, body: 0xc84fff, tip: 0x3a0a3a },
  // Gravefire: the Coldflame read, violet with a near-white core.
  gravefire: { core: 0xf4ecff, body: 0xa070ff, tip: 0x2a0c4e },
};

/** How one kind's sprites move: world-unit size and rise, seconds per sprite loop. */
export interface NythraxisSoftFireShape {
  spriteScale: number;
  rise: number;
  duration: number;
}

export const NYTHRAXIS_SOFT_FIRE_SHAPES: Readonly<
  Record<NythraxisSoftFireKind, NythraxisSoftFireShape>
> = {
  grave: { spriteScale: 1.7, rise: 2.4, duration: 1.4 },
  soul: { spriteScale: 1.9, rise: 2.8, duration: 1.3 },
  gravefire: { spriteScale: 1.5, rise: 2.0, duration: 1.2 },
};

/** Patch sprites per square yard of footprint, clamped to a sane budget per patch. */
export const NYTHRAXIS_GRAVE_FLAME_SPRITE_DENSITY = 1.4;
export const NYTHRAXIS_GRAVE_FLAME_SPRITES_MIN = 24;
export const NYTHRAXIS_GRAVE_FLAME_SPRITES_MAX = 96;
/** Line sprites per lit yard. */
export const NYTHRAXIS_GRAVEFIRE_SPRITES_PER_YARD = 5;
/** Sprites rise from inside this fraction of the footprint, never off its edge. */
export const NYTHRAXIS_SOFT_FIRE_INSET = 0.85;

const SPOT_SEED = 0x51f7e;

/** Deterministic per-sprite seed in [0, 1): the shader's clock offset and shape jitter. */
export function nythraxisSoftFireSeed(index: number): number {
  return hash2(index, 3, SPOT_SEED);
}

/** Sprite budget for a circular patch of this radius. */
export function nythraxisGraveFlameSpriteCount(radius: number): number {
  const wanted = Math.ceil(Math.PI * radius * radius * NYTHRAXIS_GRAVE_FLAME_SPRITE_DENSITY);
  return Math.max(
    NYTHRAXIS_GRAVE_FLAME_SPRITES_MIN,
    Math.min(NYTHRAXIS_GRAVE_FLAME_SPRITES_MAX, wanted),
  );
}

/** Sprite budget for a line: enough for its whole possible length. */
export function nythraxisGravefireSpriteCount(
  length: number = NYTHRAXIS_GRAVEFIRE_LENGTH,
  perYard: number = NYTHRAXIS_GRAVEFIRE_SPRITES_PER_YARD,
): number {
  return perYard * length;
}

/**
 * The GLOBAL sprite ceiling across every live soft-fire emitter in the crypt.
 *
 * Each patch and each line is its own emitter with its own instanced geometry
 * and shader material, and the sim's caps allow them together: 24 Grave Flame
 * patches (NYTHRAXIS_GRAVE_FLAME_CAP, 3 yd radius, 40 sprites each), 12
 * Soulfire pools (NYTHRAXIS_SOULFIRE_CAP, 4 yd radius, 71 sprites each) and 6
 * Gravefire lines (NYTHRAXIS_GRAVEFIRE_CAP, 40 yd at 5 sprites a yard, 200
 * each). That is 42 emitters and 3,012 sprites at full authored density, with
 * nothing bounding the total but those three independent caps.
 *
 * 2,400 is the ceiling: about four fifths of that worst case, so an ordinary
 * fight never touches it and only a genuine pile-up sheds. Emitters that fit
 * under it keep their authored density; the ones after it taper toward the
 * per-emitter minimum instead of adding another full cloud.
 *
 * FAIRNESS: a thinner cloud is cosmetic richness only. The hazard's footprint
 * is separate geometry (the patch fill/rim/ember rings, the Gravefire strip),
 * it is never sized from this, and no emitter is ever taken to zero, so a
 * budgeted patch burns at exactly the position, radius and timing of an
 * unbudgeted one.
 */
export const NYTHRAXIS_SOFT_FIRE_SPRITE_BUDGET = 2400;

/**
 * Sprites a new emitter that wants `wanted` may have, given `liveSprites`
 * already burning. Full density while the ledger has room for it, then a
 * linear taper down to `minimum` as the headroom closes. Never below the
 * minimum and never zero.
 */
export function nythraxisSoftFireSpriteCountUnderBudget(
  wanted: number,
  liveSprites: number,
  budget: number = NYTHRAXIS_SOFT_FIRE_SPRITE_BUDGET,
  minimum: number = NYTHRAXIS_GRAVE_FLAME_SPRITES_MIN,
): number {
  const floor = Math.max(1, Math.min(wanted, minimum));
  if (wanted <= floor) return wanted;
  const headroom = Math.max(0, budget - Math.max(0, liveSprites));
  if (headroom >= wanted) return wanted;
  return Math.max(floor, Math.round(floor + (wanted - floor) * (headroom / wanted)));
}

/**
 * Sprites per yard that fits `count` sprites over a `length` yard line, at
 * least one so the fire still reaches the far end of the footprint (a raw
 * count cut would leave the last yards of a lit line with no sprites at all,
 * since nythraxisGravefireSpotInto seats sprite `index` in yard
 * `floor(index / perYard)`). Never above the authored rate.
 */
export function nythraxisGravefireSpritesPerYard(
  count: number,
  length: number = NYTHRAXIS_GRAVEFIRE_LENGTH,
): number {
  const perYard = Math.floor(count / Math.max(1, length));
  return Math.max(1, Math.min(NYTHRAXIS_GRAVEFIRE_SPRITES_PER_YARD, perYard));
}

/**
 * The live sprite ledger, owned by the mechanic facade and shared by every
 * emitter-building painter: `grant` sizes a new emitter against what is
 * already burning, `reserve` books what was actually built, and `release`
 * hands it back when the emitter is disposed.
 */
export class NythraxisSoftFireBudget {
  private total = 0;

  constructor(private readonly budget: number = NYTHRAXIS_SOFT_FIRE_SPRITE_BUDGET) {}

  /** Sprites burning across every emitter booked against this ledger. */
  get live(): number {
    return this.total;
  }

  /** What a new emitter wanting `wanted` sprites may have. Books nothing. */
  grant(wanted: number): number {
    return nythraxisSoftFireSpriteCountUnderBudget(wanted, this.total, this.budget);
  }

  /** Book an emitter's actual sprite count; returns it so a call site can chain. */
  reserve(count: number): number {
    this.total += Math.max(0, count);
    return count;
  }

  release(count: number): void {
    this.total = Math.max(0, this.total - Math.max(0, count));
  }
}

export interface NythraxisSoftFireDiscSpot {
  dx: number;
  dz: number;
}

/** Sprite `index` of a patch rises from a fixed, area-uniform spot inside the circle. */
export function nythraxisSoftFireDiscSpotInto(
  out: NythraxisSoftFireDiscSpot,
  index: number,
  radius: number,
): NythraxisSoftFireDiscSpot {
  const spread = Math.sqrt(hash2(index, 0, SPOT_SEED)) * radius * NYTHRAXIS_SOFT_FIRE_INSET;
  const angle = hash2(index, 1, SPOT_SEED) * Math.PI * 2;
  out.dx = Math.cos(angle) * spread;
  out.dz = Math.sin(angle) * spread;
  return out;
}

export interface NythraxisGravefireSpot {
  /** yards from the ignition point along the line */
  along: number;
  /** world units across the line, signed */
  across: number;
}

/**
 * Sprite `index` of a line owns yard `floor(index / perYard)` plus a hashed
 * offset along and across it. The emitter shows only the sprites whose spot is
 * inside the lit window, so a sliding window never re-seats a sprite.
 */
export function nythraxisGravefireSpotInto(
  out: NythraxisGravefireSpot,
  index: number,
  halfWidth: number,
  perYard: number = NYTHRAXIS_GRAVEFIRE_SPRITES_PER_YARD,
): NythraxisGravefireSpot {
  const yard = Math.floor(index / perYard);
  out.along = yard + hash2(index, 0, SPOT_SEED);
  out.across = (hash2(index, 1, SPOT_SEED) * 2 - 1) * halfWidth * NYTHRAXIS_SOFT_FIRE_INSET;
  return out;
}
